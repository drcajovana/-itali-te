// Kandidati za koricu sa stranice knjige i procena svakog od njih (za predlog korice i za
// dijagnostiku koju dobijaju samo bibliotekari). Čist modul: ne radi nikakav mrežni poziv.
//
// Redosled važan za predlog (prvi PRIHVAĆEN se predlaže):
//   JSON-LD "image", og:image:secure_url, og:image, og:image:url, twitter:image(:src),
//   link rel="image_src", itemprop="image". Slike iz <img> oznaka (class, alt ili src sa
//   "cover", "korica", "product" ili "book") nalaze se u spisku kandidata radi dijagnostike, ali se
//   NE predlažu same od sebe: takve slike često nisu korica te knjige (preporuke, logo...).
//
// Svaka adresa se PRVO dopunjuje prema konačnoj adresi stranice (relativne i „//host/…"), pa se
// tek onda proverava bezbednost (https, bez korisnika i porta, bez IP adrese i localhost-a,
// najviše 500 znakova). Domen slike nije ograničen listom.
import { proveriUrl } from "./bezbedan-fetch.js";

export const NAJVISE_ADRESA = 500;
const NAJVISE_SIROVA = 2000; // duže od ovoga se ni ne pokušava razrešiti
const NAJVISE_KANDIDATA = 30;
const NAJVISE_IMG = 5;
const NAJVISE_PO_POLJU = 5;
const PRIKAZ_DUZINA = 300; // sirova vrednost u dijagnostici se skraćuje na ovoliko znakova

const kratko = (s) => (s.length > PRIKAZ_DUZINA ? `${s.slice(0, PRIKAZ_DUZINA)}…` : s);

// Dopuna i bezbednost jedne adrese. Vraća { sirova, vrsta, dopunjena, ishod, razlog }:
//   vrsta: 'apsolutna' | 'bez protokola (//)' | 'relativna'
//   ishod: 'prihvacena' | 'odbijena' (razlog je tekst na srpskom, ili null)
export function proceniAdresu(sirovo, osnova) {
  const sirova = typeof sirovo === "string" ? sirovo.trim() : "";
  const vrsta = sirova.startsWith("//") ? "bez protokola (//)" : /^[a-z][a-z0-9+.-]*:/i.test(sirova) ? "apsolutna" : "relativna";
  const odbij = (razlog, dopunjena = null) => ({ sirova: kratko(sirova), vrsta, dopunjena: dopunjena ? kratko(dopunjena) : null, ishod: "odbijena", razlog });

  if (!sirova) return odbij("prazna vrednost");
  if (sirova.length > NAJVISE_SIROVA) return odbij(`vrednost duža od ${NAJVISE_SIROVA} znakova`);
  let u;
  try {
    u = new URL(sirova, osnova);
  } catch {
    return odbij("adresa se ne može pročitati ni dopuniti prema stranici");
  }
  const dopunjena = u.href;
  if (u.protocol === "data:") return odbij("data: adresa (slika je ugrađena u stranicu)", dopunjena.slice(0, 40));
  if (u.protocol !== "https:") return odbij(`nije https (${u.protocol.replace(":", "")})`, dopunjena);
  if (u.username || u.password) return odbij("adresa sadrži korisnika i lozinku", dopunjena);
  if (u.port && u.port !== "443") return odbij(`port ${u.port} nije dozvoljen`, dopunjena);
  if (dopunjena.length > NAJVISE_ADRESA) return odbij(`adresa duža od ${NAJVISE_ADRESA} znakova`, dopunjena);
  try {
    proveriUrl(dopunjena, null);
  } catch (e) {
    const host = u.hostname.toLowerCase();
    return odbij(e?.kod === "domen_nije_dozvoljen" ? `IP adresa ili localhost (${host})` : `adresa nije bezbedna (${e?.kod ?? "neispravna"})`, dopunjena);
  }
  return { sirova: kratko(sirova), vrsta, dopunjena, ishod: "prihvacena", razlog: null };
}

// JSON-LD „image": tekst, niz (tekstova ili objekata) ili objekat sa „url" (ili „contentUrl").
function vrednostiSlike(v) {
  const stavke = Array.isArray(v) ? v : [v];
  const izlaz = [];
  for (const stavka of stavke.slice(0, NAJVISE_PO_POLJU)) {
    const objekat = typeof stavka === "object" && stavka;
    const sirova = objekat ? (stavka.url ?? stavka.contentUrl) : stavka;
    if (typeof sirova !== "string" || !sirova.trim()) continue;
    izlaz.push({ sirova, oblik: Array.isArray(v) ? "niz" : objekat ? "objekat" : "tekst" });
  }
  return izlaz;
}

const META_IZVORI = [
  ["og:image:secure_url", "og:image:secure_url"],
  ["og:image", "og:image"],
  ["og:image:url", "og:image:url"],
  ["twitter:image", "twitter:image"],
  ["twitter:image:src", "twitter:image:src"],
];

// Svi kandidati sa stranice, redom prioriteta: [{ izvor, sirova, predlog }]. `predlog: false`
// znači da se kandidat prikazuje u dijagnostici, ali se sam od sebe ne predlaže.
// `jsonLdSlike`: vrednosti polja „image" iz JSON-LD čvorova Book/Product (parser ih je već našao).
export function skupiKandidate(doc, jsonLdSlike = []) {
  const k = [];
  const dodaj = (izvor, sirova, predlog = true) => {
    if (typeof sirova === "string" && sirova.trim() && k.length < NAJVISE_KANDIDATA) k.push({ izvor, sirova, predlog });
  };

  for (const v of jsonLdSlike) for (const x of vrednostiSlike(v)) dodaj(`JSON-LD image (${x.oblik})`, x.sirova);

  for (const [oznaka, izvor] of META_IZVORI) {
    for (const el of doc.querySelectorAll(`meta[property="${oznaka}"], meta[name="${oznaka}"]`)) {
      dodaj(izvor, el.getAttribute("content"));
    }
  }
  for (const el of doc.querySelectorAll("link[rel]")) {
    if (/(^|\s)image_src(\s|$)/i.test(el.getAttribute("rel") || "")) dodaj('link rel="image_src"', el.getAttribute("href"));
  }
  for (const el of doc.querySelectorAll('[itemprop="image"]')) {
    const tag = el.tagName.toLowerCase();
    dodaj(`itemprop=image (${tag})`, el.getAttribute("content") || el.getAttribute("href") || el.getAttribute("src") || el.getAttribute("data-src"));
  }

  const SLIKA_KOJA_LICI = /cover|korica|product|book/i;
  let brojImg = 0;
  for (const img of doc.querySelectorAll("img")) {
    if (brojImg >= NAJVISE_IMG) break;
    const src = img.getAttribute("src") || img.getAttribute("data-src") || img.getAttribute("data-lazy-src") || "";
    const tekst = `${img.getAttribute("class") || ""} ${img.getAttribute("alt") || ""} ${src}`;
    if (!src || !SLIKA_KOJA_LICI.test(tekst)) continue;
    brojImg++;
    dodaj("<img> (cover, korica, product ili book u class, alt ili src; samo dijagnostika)", src, false);
  }
  return k;
}

// Procena svakog kandidata prema konačnoj adresi stranice i izbor predloga (prvi prihvaćen kod koga je
// `predlog` true). Vraća { korica: adresa|null, izvor: tekst|null, kandidati: [...] }.
export function proceniKandidate(kandidati, osnova) {
  let izabrana = null;
  let izvor = null;
  const procene = kandidati.map((c) => {
    const p = proceniAdresu(c.sirova, osnova);
    const bira = !izabrana && c.predlog && p.ishod === "prihvacena";
    if (bira) {
      izabrana = p.dopunjena;
      izvor = c.izvor;
    }
    return { izvor: c.izvor, ...p, izabrana: bira };
  });
  return { korica: izabrana, izvor, kandidati: procene };
}
