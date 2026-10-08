// Parser stranice knjige. Prilagođen iz docs/nabavka-extract.js (aplikacija za
// nabavku): ista logika i isti redosled izvora, samo što radi nad DOM-om iz
// linkedom umesto DOMParser-a iz pregledača, a preuzimanje ide kroz
// bezbedan-fetch.js umesto Tauri fetch-a.
//
// Redosled izvora (kao u starom parseru):
//   1. JSON-LD (schema.org Book / Product)
//   2. oznake „Autor:" / „Izdavač:" u tekstu stranice (uključujući razdvajanje
//      po <br>), pa CSS klase (product-authors...)
//   3. Open Graph / meta
//   4. NOVO: <title>, da se nikad ne vrati prazan rezultat
//
// Razlike od starog parsera: nema transliteracije ni „capitalize" koraka (ostaje
// tekst kakav je na sajtu), a rezultat je normalizovan (autori su niz, ISBN-13,
// godina je broj).
//
// Vraća podatke koje bibliotekar potvrđuje: naslov, autore, izdavača, godinu i ISBN, plus
// `korica`: PREDLOG adrese slike (JSON-LD `image`, pa og:image) ili null. Ovde se slika ne
// preuzima i ne prikazuje; preuzima je tek api/korica-iz-linka.js, na zahtev bibliotekara,
// u naš Storage. Opis sa tuđeg sajta se i dalje ne čita.

import { parseHTML } from "linkedom";
import { uIsbn13 } from "../../src/lib/isbn.js";
import { ApiGreska } from "./greska.js";
import { preuzmi, proveriUrl } from "./bezbedan-fetch.js";
import { proceniKandidate, skupiKandidate } from "./slike-stranice.js";

const OZNAKA_AUTOR = /^(autor|aut\.?|аутор|аут\.?)$/i;
const OZNAKA_IZDAVAC = /^(izdava[cč]|издавач)$/i;

// Sajtovi sa kojih se poručuje a nisu sami izdavač konkretne knjige (npr. Delfi
// preprodaje knjige različitih izdavača): za njih izdavač uvek postaje sam sajt,
// bez obzira šta JSON-LD kaže o stvarnom izdavaču.
const DOMEN_IZDAVAC = {
  "delfi.rs": "Delfi",
  "publikpraktikum.rs": "Publik Praktikum - Stela",
  "stelaknjige.rs": "Publik Praktikum - Stela",
  "kreativnicentar.rs": "Kreativni centar",
  "pcelica.rs": "Pčelica Izdavaštvo",
  "vulkani.rs": "Vulkan izdavaštvo",
};

// delfi.rs je React SPA: sirov HTML nema nijedan podatak o knjizi (sve se
// renderuje JS-om). Njihova strana sama zove ovaj JSON API; gađamo ga direktno.
const jeDelfi = (host) => host === "delfi.rs" || host.endsWith(".delfi.rs");

// Ista provera kao pri preuzimanju (https, bez korisnika i porta, bez IP adrese i localhost-a;
// domen nije ograničen listom), da se ne predlaže adresa koju bi preuzimanje odbilo.
export function jeJavnaHttpsAdresa(adresa) {
  if (typeof adresa !== "string" || adresa.length > 500 || /[\s\p{Cc}]/u.test(adresa)) return false;
  try {
    proveriUrl(adresa, null);
    return true;
  } catch {
    return false;
  }
}

const NAJVISE_ELEMENATA = 8000; // gornja granica skeniranja oznaka na ogromnim stranicama

// ───────────────────────── pomoćne ─────────────────────────

const urediTekst = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

function imeIz(v) {
  if (!v) return "";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map(imeIz).filter(Boolean).join(", ");
  return typeof v.name === "string" ? v.name : "";
}

function imenaIz(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v.flatMap(imenaIz);
  const ime = urediTekst(imeIz(v));
  return ime ? [ime] : [];
}

function metaSadrzaj(doc, selektor) {
  const el = doc.querySelector(selektor);
  return el ? (el.getAttribute("content") || "").trim() : "";
}

function godinaIz(v) {
  const m = /(1[4-9]\d\d|2[01]\d\d)/.exec(String(v ?? ""));
  return m ? Number(m[1]) : null;
}

function cvoroviIzJsonLd(podaci) {
  const lista = Array.isArray(podaci) ? podaci : podaci?.["@graph"] || [podaci];
  return lista.flatMap((c) => (c && Array.isArray(c["@graph"]) ? [c, ...c["@graph"]] : [c])).filter(Boolean);
}

function prviIsbn(cvor) {
  const kandidati = [cvor.isbn, cvor.gtin13, cvor.gtin, cvor.sku];
  for (const w of [].concat(cvor.workExample ?? [])) kandidati.push(w?.isbn);
  for (const k of kandidati) {
    const isbn = uIsbn13(Array.isArray(k) ? k[0] : k);
    if (isbn) return isbn;
  }
  return null;
}

// Naslov iz og:title / <title>: „Naslov | Sajt", „Naslov - Autor".
export function parseOgNaslov(sirov) {
  let naslov = String(sirov ?? "").split(" | ")[0].trim();
  let autorPretpostavka = null;
  const m = naslov.match(/^(.+?)\s+-\s+([^-]{2,40})$/);
  if (m) {
    const kandidatNaslov = m[1].trim();
    const kandidatAutor = m[2].trim();
    const brojReci = kandidatAutor.split(/\s+/).length;
    if (brojReci <= 4 && !/[!?:]$/.test(kandidatAutor) && kandidatNaslov.length >= 3) {
      naslov = kandidatNaslov;
      autorPretpostavka = kandidatAutor;
    }
  }
  return { naslov, autorPretpostavka };
}

// Izdavač koji je goli domen (npr. „laguna.rs"): skini nastavak.
function skiniNastavakDomena(s) {
  const m = (s || "").match(/^([a-zA-Z0-9čćžšđČĆŽŠĐ-]+)\.(rs|com|net|org)$/i);
  return m ? m[1] : s;
}

// Deli čvorove elementa u „linije" na mestima gde stoji <br>, da bi oznake
// nagomilane u istom roditelju mogle da se testiraju zasebno. (Neki sajtovi,
// npr. kreativnicentar.rs, trpaju „Autor: ... <br> Ilustrator: ..." u isti element.)
function podeliPoBr(cvorovi) {
  const linije = [];
  let tekuca = [];
  for (const n of cvorovi) {
    if (n.nodeType === 1 && n.tagName === "BR") {
      linije.push(tekuca);
      tekuca = [];
    } else tekuca.push(n);
  }
  linije.push(tekuca);
  return linije;
}

const linkTekst = (a) => (a.getAttribute("title") || a.textContent || "").trim();

function skenirajOznaku(doc, oznakaRegex) {
  const elementi = doc.body ? [...doc.body.querySelectorAll("*")].slice(0, NAJVISE_ELEMENATA) : [];
  for (const el of elementi) {
    for (const linija of podeliPoBr(el.childNodes)) {
      const svoj = linija.filter((n) => n.nodeType === 3).map((n) => n.textContent).join("");
      if (!svoj) continue;
      // Oznaka je tekst do prve dvotačke. (Stari parser je proveravao ceo tekst
      // linije, pa „Autor: Ime Prezime" nikad nije prolazilo, a grana (a) niže je
      // bila mrtva; vrednost u <a> u istoj liniji je radila jer je tada u tekstu ostajalo samo „Autor:".)
      const norm = svoj.trim().toLowerCase().split(":")[0].trim();
      if (!norm || norm.length > 20 || !oznakaRegex.test(norm)) continue;

      // (a) tekst posle ":" u istoj liniji
      const posleDvotacke = svoj.split(":").slice(1).join(":").trim();
      if (posleDvotacke) return posleDvotacke;

      // (b) <a> unutar iste linije
      for (const n of linija) {
        if (n.nodeType !== 1) continue;
        const a = n.tagName === "A" ? n : n.querySelector("a");
        if (a && linkTekst(a)) return linkTekst(a);
      }

      // (c) sledeći element (do 2 koraka): cela linija je samo oznaka, vrednost je u susedu
      let sused = el.nextElementSibling;
      for (let i = 0; i < 2 && sused; i++, sused = sused.nextElementSibling) {
        const a = sused.tagName === "A" ? sused : sused.querySelector("a");
        if (a && linkTekst(a)) return linkTekst(a);
        const t = (sused.textContent || "").trim();
        if (t) return t;
      }

      // (d) susedni tekst čvor direktno na roditelju
      let cvor = el.nextSibling;
      while (cvor) {
        if (cvor.nodeType === 3) {
          const t = cvor.textContent.trim();
          if (t) return t;
        }
        cvor = cvor.nextSibling;
      }
    }
  }
  return "";
}

// Rezerva preko CSS klase (npr. <h3 class="product-authors"><a>...</a></h3>
// bez ikakvog „Autor:" teksta u blizini): čest obrazac na nekim sajtovima.
function skenirajPoKlasi(doc, nagovestaj) {
  for (const el of doc.querySelectorAll("[class]")) {
    if (!nagovestaj.test(el.getAttribute("class") || "")) continue;
    const a = el.querySelector("a");
    if (a && linkTekst(a)) return linkTekst(a);
    const t = (el.textContent || "").trim();
    if (t && t.length < 80) return t;
  }
  return "";
}

function izdavacZaDomen(host) {
  const kljuc = Object.keys(DOMEN_IZDAVAC).find((d) => host === d || host.endsWith(`.${d}`));
  return kljuc ? DOMEN_IZDAVAC[kljuc] : null;
}

// ───────────────────────── glavni parser ─────────────────────────

// Čita HTML jedne stranice i vraća sirove podatke (bez ograničenja dužine). `urlStr` je KONAČNA
// adresa stranice (posle preusmeravanja): prema njoj se dopunjuju relativne adrese slika.
// Uz `{ dijagnostika: true }` vraća i `dijagnostika`: iz kog izvora je pročitano svako polje i svi
// kandidati za koricu sa ishodom (nikad ceo HTML); kanal ka klijentu je samo za bibliotekare.
export function izvuciIzHtmla(html, urlStr, { dijagnostika = false } = {}) {
  const { document: doc } = parseHTML(html);
  const host = new URL(urlStr).hostname.replace(/^www\./i, "").toLowerCase();

  let autori = [];
  let naslov = "";
  let izdavac = "";
  let isbn = null;
  let godina = null;
  let izvor = "";
  const jsonLdSlike = []; // vrednosti polja „image” iz JSON-LD čvorova Book/Product
  const izv = {}; // polje -> odakle je pročitano (za dijagnostiku)

  // 1) JSON-LD (schema.org Book / Product)
  for (const blok of doc.querySelectorAll('script[type="application/ld+json"]')) {
    let podaci;
    try {
      podaci = JSON.parse(blok.textContent);
    } catch {
      continue;
    }
    for (const cvor of cvoroviIzJsonLd(podaci)) {
      const tipovi = [].concat(cvor["@type"] ?? []);
      if (!tipovi.includes("Book") && !tipovi.includes("Product")) continue;
      izvor ||= "json-ld";
      if (!naslov && imeIz(cvor.name)) (naslov = imeIz(cvor.name)), (izv.naslov = "JSON-LD name");
      if (!autori.length && imenaIz(cvor.author).length) (autori = imenaIz(cvor.author)), (izv.autor = "JSON-LD author");
      if (!izdavac && (imeIz(cvor.publisher) || imeIz(cvor.brand))) (izdavac = imeIz(cvor.publisher) || imeIz(cvor.brand)), (izv.izdavac = "JSON-LD publisher/brand");
      if (!isbn && prviIsbn(cvor)) (isbn = prviIsbn(cvor)), (izv.isbn = "JSON-LD isbn");
      if (!godina && godinaIz(cvor.datePublished ?? cvor.copyrightYear)) (godina = godinaIz(cvor.datePublished ?? cvor.copyrightYear)), (izv.godina = "JSON-LD datePublished");
      if (cvor.image !== undefined) jsonLdSlike.push(cvor.image);
    }
  }

  // 2) oznake „Autor:" / „Izdavač:", pa CSS klase
  if (!autori.length) {
    const poOznaci = skenirajOznaku(doc, OZNAKA_AUTOR);
    const a = poOznaci || skenirajPoKlasi(doc, /autor|author/i);
    if (a) {
      autori = [urediTekst(a)];
      izv.autor = poOznaci ? "oznaka „Autor:”" : "CSS klasa (autor/author)";
      izvor ||= "oznake";
    }
  }
  if (!izdavac) {
    const poOznaci = skenirajOznaku(doc, OZNAKA_IZDAVAC);
    izdavac = poOznaci || skenirajPoKlasi(doc, /izdava[cč]|publisher/i);
    if (izdavac) izv.izdavac = poOznaci ? "oznaka „Izdavač:”" : "CSS klasa (izdavac/publisher)";
  }

  // 3) Open Graph / meta kao rezerva
  let ogPretpostavka = null;
  if (!naslov) {
    const ogNaslov = metaSadrzaj(doc, 'meta[property="og:title"]');
    if (ogNaslov) {
      const p = parseOgNaslov(ogNaslov);
      naslov = p.naslov;
      if (naslov) izv.naslov = "og:title";
      ogPretpostavka = p.autorPretpostavka;
      izvor ||= "og";
    } else {
      naslov = (doc.querySelector("h1")?.textContent || "").trim();
      if (naslov) (izvor ||= "og"), (izv.naslov = "<h1>");
    }
  }
  if (!autori.length) {
    const poKnjizi = metaSadrzaj(doc, 'meta[property="book:author"]');
    const a = poKnjizi || metaSadrzaj(doc, 'meta[name="author"]'); // meta[name=author] je poslednje mesto: često nosi ime CMS-a
    if (a) (autori = [urediTekst(a)]), (izv.autor = poKnjizi ? "meta book:author" : "meta author");
  }
  if (!izdavac) {
    izdavac = metaSadrzaj(doc, 'meta[property="og:site_name"]');
    if (izdavac) izv.izdavac = "og:site_name";
  }
  if (!autori.length && ogPretpostavka) (autori = [ogPretpostavka]), (izv.autor = "og:title (pretpostavka)"); // apsolutno poslednji pokušaj
  if (!isbn) {
    isbn = uIsbn13(metaSadrzaj(doc, 'meta[property="book:isbn"]'));
    if (isbn) izv.isbn = "meta book:isbn";
  }
  if (!godina) {
    godina = godinaIz(metaSadrzaj(doc, 'meta[property="book:release_date"]'));
    if (godina) izv.godina = "meta book:release_date";
  }

  // 4) Dekontaminacija naslova preko <h1>: neki sajtovi (npr. Laguna) trpaju
  // „Sajt - Naslov - Autor - Slogan" i u JSON-LD „name", ne samo u og:title.
  // Ako je čist <h1> sadržan u naslovu, naslov je „h1 + SEO smeće".
  const h1 = (doc.querySelector("h1")?.textContent || "").trim();
  if (h1 && naslov && naslov.length > h1.length && naslov.toLowerCase().includes(h1.toLowerCase())) (naslov = h1), (izv.naslov = "<h1> (očišćeno od naziva sajta)");

  // 5) NOVO: <title> kao poslednja rezerva, da se ne vrati prazan rezultat.
  if (!naslov) {
    const p = parseOgNaslov(doc.querySelector("title")?.textContent ?? "");
    naslov = p.naslov;
    if (!autori.length && p.autorPretpostavka) (autori = [p.autorPretpostavka]), (izv.autor = "<title> (pretpostavka)");
    if (naslov) (izvor = "title"), (izv.naslov = "<title>");
  }

  // 6) goli domen kao izdavač → bez nastavka
  izdavac = skiniNastavakDomena(izdavac);

  // 7) poznati preprodavci: uvek imaju prednost nad JSON-LD izdavačem
  const fiksni = izdavacZaDomen(host);
  if (fiksni) (izdavac = fiksni), (izv.izdavac = `poznati preprodavac (${host})`);

  // Korica: svi kandidati sa stranice se dopunjuju prema konačnoj adresi stranice, pa tek onda
  // proveravaju (slike-stranice.js).
  const slike = proceniKandidate(skupiKandidate(doc, jsonLdSlike), urlStr);

  const rezultat = { naslov, autori, izdavac, godina, isbn, korica: slike.korica, izvorPodataka: izvor || null };
  if (dijagnostika) {
    rezultat.dijagnostika = {
      izvor: "html",
      stranica: urlStr,
      polja: { naslov: izv.naslov ?? null, autor: izv.autor ?? null, izdavac: izv.izdavac ?? null, godina: izv.godina ?? null, isbn: izv.isbn ?? null, korica: slike.izvor },
      kandidati: slike.kandidati,
      izabrana: slike.korica,
    };
  }
  return rezultat;
}

// Normalizovan oblik, isti kao za Google Books; sve je ograničeno po dužini.
export function urediRezultat(sirovo, urlStr) {
  const godina = Number.isInteger(sirovo.godina) && sirovo.godina >= 1400 && sirovo.godina <= 2200 ? sirovo.godina : null;
  return {
    naslov: urediTekst(sirovo.naslov).slice(0, 300),
    autori: (sirovo.autori ?? []).map((a) => urediTekst(a).slice(0, 200)).filter(Boolean).slice(0, 10),
    izdavac: urediTekst(sirovo.izdavac).slice(0, 150),
    godina,
    isbn: sirovo.isbn ?? null,
    // predlog adrese slike (ne preuzima se ovde); nevažeća adresa se odbacuje
    korica: jeJavnaHttpsAdresa(sirovo.korica) ? sirovo.korica : null,
    izvor: "link",
    url: urlStr,
    izvorPodataka: sirovo.izvorPodataka ?? null,
    // dijagnostika (iz kog izvora je pročitano svako polje i svi kandidati za koricu) vidi samo
    // bibliotekar: api/iz-linka.js je skida iz odgovora ostalima
    ...(sirovo.dijagnostika ? { dijagnostika: sirovo.dijagnostika } : {}),
  };
}

async function izDelfijaApija(u, preuzmiFn) {
  const id = u.pathname.match(/\/(\d+)-/)?.[1];
  if (!id) return null;
  const { telo } = await preuzmiFn(`https://delfi.rs/api/pc-frontend-api/overview/${id}`, {
    accept: "application/json",
    tipovi: ["application/json"],
    najviseBajtova: 500_000,
  });
  const proizvod = JSON.parse(telo)?.data?.product;
  if (!proizvod) return null;
  const autori = (proizvod.authors || []).map((a) => a.authorName).filter(Boolean);
  // ISBN: polje isbn ili ean; barcode samo ako je ispravan ISBN-13 (978 ili 979), da se ne uzme EAN
  // proizvoda koji nije knjiga.
  let isbn = uIsbn13(proizvod.isbn ?? proizvod.ean ?? "");
  let izvorIsbn = isbn ? (proizvod.isbn ? "Delfi API isbn" : "Delfi API ean") : null;
  if (!isbn && /^97[89]/.test(String(proizvod.barcode ?? ""))) {
    isbn = uIsbn13(String(proizvod.barcode));
    if (isbn) izvorIsbn = "Delfi API barcode";
  }

  // Slika: HTML Delfija je prazna ljuska (SPA), pa ni og:image ni JSON-LD ne postoje. Sama slika je u
  // odgovoru API-ja: product.images je objekat sa relativnim putanjama po veličinama (xl, xxl, l, m, s).
  // Redosled: xl (srednje velika), xxl (original, može biti velik), pa manje. Relativna putanja se
  // dopunjuje prema adresi stranice, tek onda proverava (slike-stranice.js).
  const slike = proceniKandidate(
    ["xl", "xxl", "l", "m", "s"].map((velicina) => ({ izvor: `Delfi API images.${velicina}`, sirova: proizvod.images?.[velicina], predlog: true })).filter((c) => typeof c.sirova === "string" && c.sirova.trim()),
    u.href
  );

  return {
    naslov: proizvod.title || "",
    autori,
    izdavac: "Delfi",
    isbn,
    korica: slike.korica,
    izvorPodataka: "delfi-api",
    dijagnostika: {
      izvor: "delfi-api",
      stranica: u.href,
      polja: {
        naslov: "Delfi API title",
        autor: autori.length ? "Delfi API authors" : null,
        izdavac: "poznati preprodavac (delfi.rs)",
        godina: null,
        isbn: izvorIsbn,
        korica: slike.izvor,
      },
      kandidati: slike.kandidati,
      izabrana: slike.korica,
    },
  };
}

// Ulaz je adresa koju je član zalepio. Baca ApiGreska (neispravan link, domen
// van liste, sajt ne odgovara). Kad ima stranice ali ne i podataka o knjizi,
// vraća bar naslov iz <title>; samo ako ni njega nema, baca nema_podataka.
export async function izvuciIzLinka(ulaz, { preuzmiFn = preuzmi } = {}) {
  const u = proveriUrl(ulaz);
  const host = u.hostname.toLowerCase();

  if (jeDelfi(host)) {
    try {
      const preko = await izDelfijaApija(u, preuzmiFn);
      if (preko?.naslov) return urediRezultat(preko, u.href);
    } catch {
      /* padamo na generičku HTML logiku ispod kao rezervu */
    }
  }

  const { url, telo } = await preuzmiFn(u.href);
  const sirovo = izvuciIzHtmla(telo, url.href, { dijagnostika: true });
  if (!urediTekst(sirovo.naslov)) {
    throw new ApiGreska(422, "nema_podataka", "Na stranici nema podataka o knjizi.");
  }
  return urediRezultat(sirovo, url.href);
}
