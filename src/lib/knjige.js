// Pretraga i dodavanje knjiga: naša baza, Google Books, link, ručni upis.
// Sve ide preko klijenta iz supabase.js; spoljni izvori preko api/ funkcija.
//
// Google Books je pomoć pri pretrazi uživo, ne izvor podataka: iz spoljnih izvora se
// trajno čuva samo ono što član potvrdi (red-knjige.js). Nikad opis, nikad Google-ova
// korica, nikad masovno.
import { supabase } from "./supabase.js";
import { GreskaApija, pozoviApi } from "./api.js";
import { uIsbn13 } from "./isbn.js";
import { BUCKET_KORICE, kodGreskeSlanja, putanjaIzAdrese, putanjaKorice } from "./korica-slika.js";
import { redZaUpis, urediPotvrdu } from "./red-knjige.js";

// 1. Naša baza. Normalizaciju teksta (ćirilica/latinica) radi baza, u funkciji
// trazi_knjige, preko privatno.norm_tekst.
export async function pretraziNasuBazu(upit) {
  const { data, error } = await supabase.rpc("trazi_knjige", { upit, najvise: 20 });
  if (error) throw error;
  return data ?? [];
}

// 2. Google Books (preko api/pretraga-google.js). Server prepoznaje ISBN u slobodnom upitu.
export const pretraziGoogle = (upit) => pozoviApi("/api/pretraga-google", { q: upit });

// 3. Link sa sajta izdavača (preko api/iz-linka.js).
export const izLinka = (url) => pozoviApi("/api/iz-linka", { url });

// Preuzimanje slike korice sa predloga iz izLinka u naš Storage (samo bibliotekar). Server
// čuva sliku, upisuje korice_url, korice_izvor='preuzeto' i korice_poreklo. Vraća
// { korica_url, korica_poreklo }; baca GreskaApija (kod prevodi porukaGreske).
export async function koricaIzLinka(knjigaId, url) {
  const rezultati = await pozoviApi("/api/korica-iz-linka", { knjigaId, url });
  if (!rezultati[0]?.korica_url) throw new GreskaApija("greska_servera");
  return rezultati[0];
}

// `knjiga` je ili red iz naše baze (ima `id`), ili POTVRĐENI spoljni rezultat:
// { podaci }, gde su `podaci` izlaz iz urediPotvrdu (ono što je član
// video u formi i potvrdio). Vraća id knjige u našoj bazi, a ako je još nema, upisuje je.
// Upis radi običan član: okidač u bazi svakako postavlja izvor='clan' i u_fondu=false,
// pa član ne može da proglasi knjigu delom fonda.
async function nadjiIliUpisi(knjiga) {
  if (knjiga.id) return { id: knjiga.id, uFondu: knjiga.u_fondu ?? null };

  const { podaci } = knjiga;

  // Ista knjiga po ISBN-u (isti ISBN-13 iz različitih izvora): ne pravi se duplikat,
  // a postojeći zapis se ne menja.
  if (podaci.isbn) {
    const slicne = await pretraziNasuBazu(podaci.isbn);
    const ista = slicne.find((k) => uIsbn13(k.isbn) === podaci.isbn);
    if (ista) return { id: ista.id, uFondu: ista.u_fondu };
  }

  const { data, error } = await supabase.from("knjige").insert(redZaUpis(podaci)).select("id, u_fondu").single();
  if (error) throw error;
  return { id: data.id, uFondu: data.u_fondu };
}

// Dodavanje na policu (status: citam | procitano | zelim). Vraća { uFondu }.
export async function dodajNaPolicu(clanId, knjiga, status) {
  const { id, uFondu } = await nadjiIliUpisi(knjiga);
  const { error } = await supabase
    .from("polica")
    .upsert({ clan_id: clanId, knjiga_id: id, status }, { onConflict: "clan_id,knjiga_id" });
  if (error) throw error;
  return { uFondu };
}

// 4. Ručni upis: naslov i autor, ništa više. Ide na policu kao „želim da pročitam";
// knjiga je „nije u fondu" i ulazi u izveštaj za nabavku.
export function dodajRucno(clanId, naslov, autor) {
  const r = urediPotvrdu({ naslov, autor });
  if (!r.ok) throw new Error(`neispravan unos: ${r.polje} (${r.razlog})`);
  return dodajNaPolicu(clanId, { podaci: r.podaci, izvor: "clan" }, "zelim");
}

// ───────────────────────── korice: fotografije u Storage-u ─────────────────────────
// Korica dolazi samo iz fotografije koju bibliotekar okači (bucket „korice", migracija 0013);
// redosled prikaza (fotografija → Open Library → pločica) je u korica-slika.js.

// Jedna knjiga za stranicu knjige (/knjiga/:id). null ako ne postoji (ili je ne vidi RLS).
export async function ucitajKnjigu(id) {
  const { data, error } = await supabase
    .from("knjige")
    .select("id, naslov, autor, izdavac, godina, isbn, zanrovi, opis, signatura, korice_url, korice_izvor, korice_poreklo, u_fondu, broj_primeraka, broj_slobodnih")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

const greskaKorice = (kod) => Object.assign(new Error(kod), { kod });

// Okači fotografiju (već smanjenu, korica-slika.js) i postavi je kao koricu knjige:
//   1. upis u Storage pod novim imenom <id knjige>/<vreme>.<tip> (politika iz 0013: samo
//      bibliotekar i administrator, samo jpeg/png/webp do 1 MB);
//   2. knjige.korice_url = javna adresa, korice_izvor = 'fotografija'. Okidač u bazi
//      (0009) propušta adresu jer je domen Storage-a na listi;
//   3. stara fotografija (ako je bila naša) se briše; neuspelo brisanje ništa ne kvari.
// Ako korak 2 ne uspe, nova slika se uklanja iz Storage-a, da ne ostane siroče.
// Baca grešku sa `kod` (tekst.korice.greske): slika_velika, korica_upload, korica_upis,
// korica_nije_prihvacena. Vraća javnu adresu nove korice.
export async function postaviKoricu(knjigaId, blob, staraAdresa = null) {
  const putanja = putanjaKorice(knjigaId, Date.now(), blob.type);
  const skladiste = supabase.storage.from(BUCKET_KORICE);

  const { error: greskaSlanja } = await skladiste.upload(putanja, blob, {
    contentType: blob.type,
    cacheControl: "31536000", // ime je novo pri svakoj zameni, pa se slika sme dugo keširati
    upsert: false,
  });
  if (greskaSlanja) {
    console.error("upis korice u Storage:", greskaSlanja);
    throw greskaKorice(kodGreskeSlanja(greskaSlanja));
  }

  const adresa = skladiste.getPublicUrl(putanja).data.publicUrl;
  const ukloniNovu = async () => {
    try {
      await skladiste.remove([putanja]);
    } catch (e) {
      console.error("uklanjanje nove korice:", e);
    }
  };

  const { data, error } = await supabase
    .from("knjige")
    .update({ korice_url: adresa, korice_izvor: "fotografija", korice_poreklo: null })
    .eq("id", knjigaId)
    .select("korice_url")
    .maybeSingle();
  if (error || !data) {
    if (error) console.error("upis adrese korice:", error);
    await ukloniNovu();
    // izmena koju je RLS filtrirala (nema reda) ili odbila (42501) znači: nema dozvole
    throw greskaKorice(error?.code === "42501" || (!error && !data) ? "nema_dozvole" : "korica_upis");
  }
  if (data.korice_url !== adresa) {
    // okidač je adresu postavio na NULL (domen Storage-a nije na listi, npr. drugi projekat)
    await ukloniNovu();
    throw greskaKorice("korica_nije_prihvacena");
  }

  const prefiks = adresa.slice(0, adresa.length - putanja.length);
  const stara = staraAdresa && staraAdresa !== adresa ? putanjaIzAdrese(staraAdresa, prefiks) : null;
  if (stara && stara.startsWith(`${knjigaId}/`)) {
    try {
      await skladiste.remove([stara]);
    } catch (e) {
      console.error("brisanje stare korice:", e);
    }
  }
  return adresa;
}

// Uklanja koricu knjige: prazni korice_url, korice_izvor i korice_poreklo, pa briše fajl iz
// Storage-a (običnim klijentom, politika brisanja iz 0013). Prvo se menja knjiga, pa tek onda
// briše fajl: ako brisanje fajla ne uspe, ostaje samo siroče u bucket-u, a ne pokvaren prikaz.
// Fajl se briše samo ako je adresa sa našeg bucket-a i iz fascikle ove knjige. Vraća
// { fajlObrisan }: true, false (fajl nije obrisan) ili null (adresa nije naša, nema šta da se briše).
export async function ukloniKoricu(knjigaId, staraAdresa) {
  const skladiste = supabase.storage.from(BUCKET_KORICE);
  const { data, error } = await supabase
    .from("knjige")
    .update({ korice_url: null, korice_izvor: null, korice_poreklo: null })
    .eq("id", knjigaId)
    .select("id")
    .maybeSingle();
  if (error || !data) {
    if (error) console.error("uklanjanje korice iz knjige:", error);
    throw greskaKorice(error?.code === "42501" || (!error && !data) ? "nema_dozvole" : "korica_upis");
  }

  const javniPrefiks = skladiste.getPublicUrl("x").data.publicUrl.slice(0, -1);
  const putanja = staraAdresa ? putanjaIzAdrese(staraAdresa, javniPrefiks) : null;
  if (!putanja || !putanja.startsWith(`${knjigaId}/`)) return { fajlObrisan: null };
  try {
    const r = await skladiste.remove([putanja]);
    if (r.error) {
      console.error("brisanje fajla korice:", r.error);
      return { fajlObrisan: false };
    }
    return { fajlObrisan: r.data?.length > 0 };
  } catch (e) {
    console.error("brisanje fajla korice:", e);
    return { fajlObrisan: false };
  }
}

// ───────────────────────── ekran za bibliotekare (unos linkovima) ─────────────────────────

// Postoji li već ova knjiga? Normalizaciju radi baza (trazi_knjige → privatno.norm_tekst i
// privatno.isbn13), pa „Андрић" i „Andric", kao i ISBN-10 i ISBN-13, daju isti pogodak.
//   poIsbn:   isti ISBN-13 (praktično sigurno ista knjiga)
//   poTekstu: svaka reč iz naslova i autora stoji u naslovu ili autoru postojećeg zapisa
//             (moguć duplikat; bibliotekar odlučuje)
export async function nadjiDuplikate({ isbn, naslov, autor }) {
  const poIsbn = isbn ? (await pretraziNasuBazu(isbn)).filter((k) => uIsbn13(k.isbn) === isbn) : [];
  const upit = [naslov, autor].filter(Boolean).join(" ");
  const poTekstu = (await pretraziNasuBazu(upit)).filter((k) => !poIsbn.some((i) => i.id === k.id));
  return { poIsbn, poTekstu };
}

// Upis kao PRIJAVLJENI bibliotekar (običan klijent, ne service_role): RLS i okidači važe.
// Okidač knjige_unos_clana za bibliotekare propušta u_fondu, broj primeraka i izvor.
export async function sacuvajKnjigu(red) {
  const { data, error } = await supabase.from("knjige").insert(red).select("id, naslov, u_fondu, izvor").single();
  if (error) throw error;
  return data;
}

// Povećanje broja primeraka postojećeg zapisa (novi primerci su slobodni). Ako je zapis
// bio „nije u fondu", postaje deo fonda. Uslov na tekuće vrednosti hvata istovremenu
// izmenu: ako se zapis u međuvremenu promenio, ne menja se ništa.
export async function dodajPrimerke(postojeca, kolicina) {
  const { data, error } = await supabase
    .from("knjige")
    .update({
      u_fondu: true,
      broj_primeraka: postojeca.broj_primeraka + kolicina,
      broj_slobodnih: postojeca.broj_slobodnih + kolicina,
    })
    .eq("id", postojeca.id)
    .eq("broj_primeraka", postojeca.broj_primeraka)
    .eq("broj_slobodnih", postojeca.broj_slobodnih)
    .select("id, broj_primeraka")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new GreskaApija("izmenjeno_u_medjuvremenu");
  return data;
}
