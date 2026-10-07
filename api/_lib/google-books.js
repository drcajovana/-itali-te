// Google Books API (zvanični, ne kvari se). Pomoć pri pretrazi UŽIVO, ne izvor
// podataka: pokrivenost starijih izdanja i zavičajne građe je slaba, a uslovi
// Google-a (Google APIs ToS, odeljak 5e) ne dozvoljavaju pravljenje baze ni trajnih
// kopija sadržaja iz API-ja. Zato se rezultati samo prikazuju; trajno se čuva samo
// ono što član potvrdi (ISBN-13, naslov, autor, godina, izdavač; src/lib/red-knjige.js),
// nikad opis, nikad korica, nikad masovno.
//
// VAŽNO: bez API ključa Google trenutno vraća 429 (dnevna kvota za anonimne
// zahteve je 0). Treba GOOGLE_BOOKS_API_KEY (besplatan; Books API se uključuje
// u Google Cloud konzoli). Bez ključa funkcija vraća grešku google_nije_podeseno.

import { ApiGreska } from "./greska.js";
import { googleKljuc } from "./okruzenje.js";
import { uIsbn13 } from "../../src/lib/isbn.js";

const OSNOVA = "https://www.googleapis.com/books/v1/volumes";
const POLJA =
  "items(id,volumeInfo(title,subtitle,authors,publisher,publishedDate,description,industryIdentifiers,imageLinks,infoLink))";
const NAJVISE_REZULTATA = 10;
const ROK_MS = 8000;
const NAJVISE_BAJTOVA = 1_000_000;
const NAJVISE_ZNAKOVA = 150;

function ocisti(s) {
  // bez kontrolnih znakova i navodnika (navodnici bi razbili frazu u upitu)
  return String(s ?? "").replace(/[\p{Cc}"\\]/gu, " ").replace(/\s+/g, " ").trim();
}

// Upit za Google: ISBN ima prednost; inače fraza za naslov i autora.
export function napraviUpit({ naslov, autor, isbn, q } = {}) {
  const polja = { naslov: ocisti(naslov), autor: ocisti(autor), isbn: ocisti(isbn), q: ocisti(q) };
  for (const [ime, v] of Object.entries(polja)) {
    if (v.length > NAJVISE_ZNAKOVA) throw new ApiGreska(400, "neispravan_upit", `Polje ${ime} je predugo.`);
  }

  if (polja.isbn) {
    const isbn13 = uIsbn13(polja.isbn);
    if (!isbn13) throw new ApiGreska(400, "neispravan_isbn", "ISBN nije ispravan.");
    return `isbn:${isbn13}`;
  }
  // Slobodan upit koji je zapravo ISBN („978-86-521-2603-3") ide kao ISBN.
  if (polja.q && /^[0-9Xx\- ]{10,17}$/.test(polja.q)) {
    const isbn13 = uIsbn13(polja.q);
    if (isbn13) return `isbn:${isbn13}`;
  }

  const delovi = [];
  if (polja.naslov) delovi.push(`intitle:"${polja.naslov}"`);
  if (polja.autor) delovi.push(`inauthor:"${polja.autor}"`);
  if (polja.q) delovi.push(polja.q);
  if (!delovi.length) throw new ApiGreska(400, "prazan_upit", "Upišite naslov, autora ili ISBN.");
  return delovi.join(" ");
}

const ENTITETI = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };
const bezOznaka = (s) =>
  String(s ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(amp|lt|gt|quot|nbsp|#39);/g, (m) => ENTITETI[m])
    .replace(/\s+/g, " ")
    .trim();

// Korica služi SAMO ZA PRIKAZ u rezultatima (uz oznaku „Google Books" i vezu ka
// njihovoj stranici). Ne čuva se nigde: ni kao fajl, ni kao adresa u bazi, a baza bi
// je svakako postavila na NULL (Google nije na listi domena za korice, migracija 0009).
// Samo https i samo Google-ovi domeni za slike knjiga.
const DOMENI_ZA_PRIKAZ = ["books.google.com", "books.googleusercontent.com"];

function koricaZaPrikaz(imageLinks) {
  const sirova = imageLinks?.thumbnail ?? imageLinks?.smallThumbnail;
  if (!sirova) return null;
  try {
    const u = new URL(String(sirova).replace(/^http:\/\//i, "https://"));
    u.searchParams.delete("edge"); // „edge=curl" savija ćošak slike
    const host = u.hostname.toLowerCase();
    const dozvoljen = DOMENI_ZA_PRIKAZ.some((d) => host === d || host.endsWith(`.${d}`));
    return u.protocol === "https:" && dozvoljen && u.href.length <= 500 ? u.href : null;
  } catch {
    return null;
  }
}

export function normalizujStavku(stavka) {
  const v = stavka?.volumeInfo;
  if (!v?.title) return null;
  const identifikatori = v.industryIdentifiers ?? [];
  const isbn =
    uIsbn13(identifikatori.find((i) => i.type === "ISBN_13")?.identifier) ??
    uIsbn13(identifikatori.find((i) => i.type === "ISBN_10")?.identifier) ??
    null;
  const godina = /^(\d{4})/.exec(v.publishedDate ?? "");
  return {
    naslov: ocisti(v.subtitle ? `${v.title}: ${v.subtitle}` : v.title).slice(0, 300),
    autori: (v.authors ?? []).map((a) => ocisti(a).slice(0, 200)).filter(Boolean).slice(0, 10),
    izdavac: ocisti(v.publisher).slice(0, 150),
    godina: godina ? Number(godina[1]) : null,
    isbn,
    opis: bezOznaka(v.description).slice(0, 2000),
    korica: koricaZaPrikaz(v.imageLinks), // samo za prikaz, ne čuva se
    izvor: "google_books",
    url: typeof v.infoLink === "string" && v.infoLink.startsWith("https://") ? v.infoLink : null,
  };
}

async function procitajOgranicen(odgovor, najviseBajtova) {
  const citac = odgovor.body.getReader();
  const delovi = [];
  let ukupno = 0;
  for (;;) {
    const { done, value } = await citac.read();
    if (done) break;
    ukupno += value.length;
    if (ukupno > najviseBajtova) {
      await citac.cancel();
      throw new ApiGreska(502, "google_greska", "Odgovor je prevelik.");
    }
    delovi.push(value);
  }
  return Buffer.concat(delovi).toString("utf8");
}

export async function pretraziGoogle(parametri, { fetchFn = fetch } = {}) {
  const upit = napraviUpit(parametri);
  const kljuc = googleKljuc();
  const url = new URL(OSNOVA);
  url.searchParams.set("q", upit);
  url.searchParams.set("maxResults", String(NAJVISE_REZULTATA));
  url.searchParams.set("printType", "books");
  url.searchParams.set("fields", POLJA);
  if (kljuc) url.searchParams.set("key", kljuc);

  const kontrola = new AbortController();
  const sat = setTimeout(() => kontrola.abort(), ROK_MS);
  try {
    const odgovor = await fetchFn(url, { signal: kontrola.signal, headers: { Accept: "application/json" } });
    const telo = await procitajOgranicen(odgovor, NAJVISE_BAJTOVA);

    if (!odgovor.ok) {
      // Bez ključa je kvota nula: to nije „zauzeto", nego nepodešeno.
      if ((odgovor.status === 429 || odgovor.status === 403) && !kljuc) {
        throw new ApiGreska(503, "google_nije_podeseno", "Google Books zahteva API ključ (GOOGLE_BOOKS_API_KEY).");
      }
      if (odgovor.status === 429 || odgovor.status === 403) {
        throw new ApiGreska(503, "google_zauzet", "Google Books je trenutno zauzet.");
      }
      if (odgovor.status === 400) throw new ApiGreska(400, "neispravan_upit", "Google nije prihvatio upit.");
      throw new ApiGreska(502, "google_greska", `Google Books je odgovorio sa HTTP ${odgovor.status}.`);
    }

    let podaci;
    try {
      podaci = JSON.parse(telo);
    } catch {
      throw new ApiGreska(502, "google_greska", "Odgovor nije ispravan JSON.");
    }
    const videno = new Set();
    const rezultati = [];
    for (const stavka of podaci.items ?? []) {
      const r = normalizujStavku(stavka);
      if (!r) continue;
      const kljucStavke = r.isbn ?? `${r.naslov}|${r.autori[0] ?? ""}|${r.izdavac}|${r.godina}`;
      if (videno.has(kljucStavke)) continue;
      videno.add(kljucStavke);
      rezultati.push(r);
    }
    return rezultati;
  } catch (e) {
    if (e instanceof ApiGreska) throw e;
    if (e?.name === "AbortError") throw new ApiGreska(504, "predugo", "Google Books predugo odgovara.");
    throw new ApiGreska(502, "google_greska", `Veza sa Google Books nije uspela: ${e?.message ?? e}`);
  } finally {
    clearTimeout(sat);
  }
}
