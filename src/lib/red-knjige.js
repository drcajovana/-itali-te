// Šta se trajno upisuje u `knjige` kad član doda knjigu iz spoljnog izvora (Google
// Books, link). Običan JS bez uvoza klijenta i bez import.meta, da se testira u
// `npm run test:api`.
//
// PRAVILO (CLAUDE.md, „Google Books"): iz Google-a se trajno čuva samo ono što član
// potvrdi: ISBN-13, naslov, autor, godina, izdavač. Nikad opis, nikad korica, nikad
// masovno. Uslovi Google-a ne dozvoljavaju pravljenje baze ni trajnih kopija
// sadržaja iz API-ja. Isto važi za opis i sliku sa tuđeg sajta (link): ne čuvaju se.
// Korica dolazi samo iz fotografije koju bibliotekar okači u Storage (korica-slika.js).
import { uIsbn13 } from "./isbn.js";

const NAJVISE = { naslov: 300, autor: 200, izdavac: 150 };
const urediTekst = (v) => String(v ?? "").replace(/\s+/g, " ").trim();

// Proverava i sređuje vrednosti iz forme za potvrdu (sve su tekst).
// Vraća { ok: true, podaci } ili { ok: false, polje, razlog } (razlog: prazno | predugo | neispravno).
export function urediPotvrdu(unos) {
  const naslov = urediTekst(unos?.naslov);
  const autor = urediTekst(unos?.autor);
  const izdavac = urediTekst(unos?.izdavac);
  const godinaTekst = urediTekst(unos?.godina);
  const isbnTekst = urediTekst(unos?.isbn);

  if (!naslov) return { ok: false, polje: "naslov", razlog: "prazno" };
  for (const [polje, v] of [["naslov", naslov], ["autor", autor], ["izdavac", izdavac]]) {
    if (v.length > NAJVISE[polje]) return { ok: false, polje, razlog: "predugo" };
  }

  let godina = null;
  if (godinaTekst) {
    if (!/^\d{4}$/.test(godinaTekst) || Number(godinaTekst) < 1400 || Number(godinaTekst) > 2200) {
      return { ok: false, polje: "godina", razlog: "neispravno" };
    }
    godina = Number(godinaTekst);
  }

  let isbn = null;
  if (isbnTekst) {
    isbn = uIsbn13(isbnTekst);
    if (!isbn) return { ok: false, polje: "isbn", razlog: "neispravno" };
  }

  return { ok: true, podaci: { naslov, autor: autor || null, izdavac: izdavac || null, godina, isbn } };
}

// Red za INSERT u `knjige`, tačno ovih pet polja i ni jednog više: nikad opis, nikad
// korica (ni Google-ova, ni sa tuđeg sajta).
export function redZaUpis(podaci) {
  return {
    naslov: podaci.naslov,
    autor: podaci.autor ?? null,
    izdavac: podaci.izdavac ?? null,
    godina: podaci.godina ?? null,
    isbn: podaci.isbn ?? null,
  };
}
