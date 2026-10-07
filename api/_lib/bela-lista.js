// Domeni sa kojih api/iz-linka.js sme da pročita stranicu knjige. Jedno mesto,
// lako se proširuje: dodaje se samo domen, bez „www." (važi i za poddomene, pa
// „laguna.rs" propušta i „www.laguna.rs"). Sve ostalo se odbija.
//
// Pre dodavanja domena proveriti da sajt dozvoljava ovakvo čitanje (link koji
// član sam zalepi, jedna stranica, uz ograničenje 30 zahteva na sat). Ovo nije
// i ne sme da postane skidanje kataloga (CLAUDE.md, „Šta se ne radi").
export const DOZVOLJENI_DOMENI = [
  // Izdavači koje je tražila biblioteka
  "laguna.rs",
  "delfi.rs",
  "vulkani.rs",
  "dereta.rs",
  "booka.rs",
  "geopoetika.rs",
  "arhipelag.rs",
  "carobnaknjiga.rs",
  "kreativnicentar.rs",

  // Iz starog parsera (docs/nabavka-extract.js)
  "pcelica.rs",
  "publikpraktikum.rs",
  "stelaknjige.rs",

  // Predlog: izdavači koji su odgovarali na proveru (oktobar 2026)
  "clio.rs",
  "klett.rs",
  // geopoetika.rs ne odgovara; izdavač je na geopoetika.com
  "geopoetika.com",
];

// ───────────────────────── korice ─────────────────────────
// Domeni sa kojih sme da dođe adresa korice koja se TRAJNO čuva u knjige.korice_url:
// domeni sa liste iznad (slike izdavača), Open Library i naš Supabase Storage
// (fotografije korica koje okači bibliotekar). ISTA lista je u bazi
// (privatno.domeni_korica, migracija 0009), a test:db proverava da se ne razilaze.
// Dodavanje domena: ovde I u novoj migraciji (INSERT u tabelu).
//
// Google Books NIJE na listi namerno: njegovi uslovi ne dozvoljavaju trajno čuvanje
// sadržaja iz API-ja. Google korica se prikazuje samo u rezultatima pretrage uživo
// (api/_lib/google-books.js), nikad se ne upisuje u bazu.

// Host našeg Supabase projekta (isti koji je u VITE_SUPABASE_URL, pa se već nalazi u
// javnom klijentskom kodu; nije tajna). Storage URL-ovi su
// https://<host>/storage/v1/object/public/<bucket>/<fajl>. Pri prelasku na drugi
// projekat menja se ovde i u novoj migraciji.
export const SUPABASE_STORAGE_DOMEN = "jrmzgulxvxtpghwbhmrc.supabase.co";

export const DOMENI_KORICA_DODATNI = ["covers.openlibrary.org", SUPABASE_STORAGE_DOMEN];
export const DOZVOLJENI_DOMENI_KORICA = [...DOZVOLJENI_DOMENI, ...DOMENI_KORICA_DODATNI];

// Isto pravilo kao SQL funkcija privatno.korice_dozvoljena (test:db proverava
// da se slažu na istim primerima): samo https, najviše 500 znakova, bez razmaka
// i kontrolnih znakova, domen bez porta, korisnika i IP adrese, i to tačno domen
// sa liste ili njegov poddomen.
export function koricaJeDozvoljena(url, lista = DOZVOLJENI_DOMENI_KORICA) {
  if (typeof url !== "string" || url.length > 500 || /[\s\p{Cc}]/u.test(url)) return false;
  const m = /^https:\/\/([A-Za-z0-9.-]+)(?:[/?#]|$)/.exec(url);
  if (!m) return false;
  const host = m[1].toLowerCase();
  if (host.startsWith(".") || host.endsWith(".") || host.includes("..")) return false;
  return lista.some((d) => host === d || host.endsWith(`.${d}`));
}
