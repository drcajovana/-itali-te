// Fotografije korica: smanjivanje u pregledaču pre slanja, imena fajlova u Storage-u i
// poredak adresa za prikaz. Čist modul (bez supabase-a i import.meta), da ga test:api
// može da učita; samo `smanjiSliku` koristi API-je pregledača (canvas).
//
// Korica se prikazuje samo iz NAŠEG Storage-a (bucket „korice", migracije 0013 i 0014): ili je
// bibliotekar snimio fotografiju, ili je slika preuzeta sa linka na njegov zahtev. Slika se
// nikad ne učitava sa tuđeg servera. Lanac prikaza:
//   1. naša slika (knjige.korice_url, samo uz korice_izvor 'fotografija' ili 'preuzeto')
//   2. Open Library po ISBN-u
//   3. pločica sa naslovom i autorom (komponenta Korica)
import { uIsbn13 } from "./isbn.js";

export const BUCKET_KORICE = "korice";
export const NAJVISE_SIRINA = 600;
const NAJVISE_VISINA = 900; // uska i visoka slika ne sme da naraste preko ovoga
const NAJVECI_ULAZ = 25 * 1024 * 1024; // fotografije telefonom su 2–8 MB; preko 25 MB nije fotografija korice
const KVALITET = { "image/webp": 0.82, "image/jpeg": 0.85 };

const greska = (kod) => Object.assign(new Error(kod), { kod });

// Nova dimenzija: najviše 600 px širine (i 900 px visine), razmera ostaje, slika se nikad ne uvećava.
export function dimenzijePosleSmanjenja(sirina, visina, najvise = NAJVISE_SIRINA) {
  if (!(sirina > 0) || !(visina > 0)) throw greska("slika_neispravna");
  const razmera = Math.min(1, najvise / sirina, NAJVISE_VISINA / visina);
  return { sirina: Math.max(1, Math.round(sirina * razmera)), visina: Math.max(1, Math.round(visina * razmera)) };
}

const EKSTENZIJE = { "image/webp": "webp", "image/jpeg": "jpg", "image/png": "png" };
export const ekstenzijaZa = (tip) => EKSTENZIJE[tip] ?? null;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// <id knjige>/<vreme>.<ekstenzija>. Ime je uvek novo (vreme), pa zamena korice ne ostavlja
// staru sliku u kešu pregledača i CDN-a. Isti oblik zahteva politika iz migracije 0013.
export function putanjaKorice(knjigaId, vreme, tip) {
  const ekstenzija = ekstenzijaZa(tip);
  if (!UUID.test(String(knjigaId))) throw greska("knjiga_neispravna");
  if (!ekstenzija) throw greska("slika_tip");
  return `${knjigaId}/${vreme}.${ekstenzija}`;
}

// Putanja u bucket-u iz javne adrese (za brisanje stare korice pri zameni). Samo adrese
// oblika .../storage/v1/object/public/korice/<id>/<ime>; za sve ostalo null, pa se
// nikad ne briše ništa što nije naša slika. `javniPrefiks` (adresa našeg bucket-a, do
// zaključno „korice/", dobija se iz getPublicUrl) dodatno traži da adresa počinje tačno njim,
// tj. da je sa NAŠEG Supabase projekta, a ne samo sa putanjom istog oblika.
export function putanjaIzAdrese(adresa, javniPrefiks = null) {
  let sirova;
  if (javniPrefiks) {
    const t = String(adresa);
    if (!t.startsWith(javniPrefiks)) return null;
    sirova = t.slice(javniPrefiks.length).split(/[?#]/)[0];
  } else {
    let u;
    try {
      u = new URL(String(adresa));
    } catch {
      return null;
    }
    const prefiks = `/storage/v1/object/public/${BUCKET_KORICE}/`;
    if (u.protocol !== "https:" || !u.pathname.startsWith(prefiks)) return null;
    sirova = u.pathname.slice(prefiks.length);
  }
  let putanja;
  try {
    putanja = decodeURIComponent(sirova);
  } catch {
    return null;
  }
  return /^[0-9a-f-]{36}\/[A-Za-z0-9_-]{1,64}\.(webp|jpg|png)$/.test(putanja) && UUID.test(putanja.split("/")[0]) ? putanja : null;
}

// Naša slika u Storage-u: izvor 'fotografija' (snimio bibliotekar) ili 'preuzeto' (preuzeta sa
// linka, api/korica-iz-linka.js). Stare adrese (og_slika sa sajtova izdavača) se ne prikazuju:
// slika se nikad ne učitava sa tuđeg servera, samo naša kopija.
export const nasaFotografija = (knjiga) =>
  (knjiga?.korice_izvor === "fotografija" || knjiga?.korice_izvor === "preuzeto") && typeof knjiga.korice_url === "string" && knjiga.korice_url.startsWith("https://")
    ? knjiga.korice_url
    : null;

// Adrese za prikaz, redom kojim se probaju (komponenta Korica prelazi na sledeću kad se
// slika ne učita). Google Books rezultat (pretraga uživo, pre upisa) ima svoju sličicu
// samo za prikaz uz oznaku „Google Books"; ona se nikad ne upisuje u bazu.
export function adreseKorica(knjiga) {
  const isbn = uIsbn13(knjiga.isbn);
  return [
    nasaFotografija(knjiga),
    knjiga.izvor === "google_books" ? knjiga.korica : null,
    // default=false: Open Library vraća 404 kad korice nema, pa lanac ide dalje
    isbn ? `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg?default=false` : null,
  ].filter(Boolean);
}

// Kod greške (tekst.korice.greske) iz greške koju vrati Storage pri slanju: prevelika slika,
// pogrešan tip, nema dozvole (politike iz 0013), ostalo.
export function kodGreskeSlanja(greska) {
  const status = String(greska?.statusCode ?? greska?.status ?? "");
  const poruka = String(greska?.message ?? "").toLowerCase();
  if (status === "413" || /payload too large|exceeded the maximum/.test(poruka)) return "slika_velika";
  if (status === "415" || /mime type|invalid_mime/.test(poruka)) return "slika_tip";
  if (status === "401" || status === "403" || /row-level security|unauthorized|not allowed/.test(poruka)) return "nema_dozvole";
  return "korica_upload";
}

function uBlob(platno, tip) {
  return new Promise((resolve) => platno.toBlob(resolve, tip, KVALITET[tip]));
}

// Smanjuje sliku u pregledaču: najviše 600 px širine, pa webp (ili jpeg tamo gde pregledač
// ne zna da kodira webp). Ispravlja orijentaciju iz EXIF-a (fotografija telefonom). Vraća
// { blob, sirina, visina } ili baca grešku sa `kod`: slika_tip, slika_velika, slika_neispravna.
export async function smanjiSliku(fajl, { najvise = NAJVISE_SIRINA } = {}) {
  if (!(fajl instanceof Blob)) throw greska("slika_neispravna");
  if (fajl.type && !fajl.type.startsWith("image/")) throw greska("slika_tip");
  if (fajl.size > NAJVECI_ULAZ) throw greska("slika_velika");

  let bitmapa;
  try {
    bitmapa = await createImageBitmap(fajl, { imageOrientation: "from-image" });
  } catch {
    throw greska("slika_neispravna");
  }
  try {
    const { sirina, visina } = dimenzijePosleSmanjenja(bitmapa.width, bitmapa.height, najvise);
    const platno = document.createElement("canvas");
    platno.width = sirina;
    platno.height = visina;
    const ctx = platno.getContext("2d");
    // bela podloga: providni PNG bi se u jpeg-u pretvorio u crnu pozadinu
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, sirina, visina);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmapa, 0, 0, sirina, visina);

    let blob = await uBlob(platno, "image/webp");
    if (!blob || blob.type !== "image/webp") blob = await uBlob(platno, "image/jpeg");
    if (!blob) throw greska("slika_neispravna");
    return { blob, sirina, visina };
  } finally {
    bitmapa.close?.();
  }
}
