// Izvoz iz COBISS-a (xlsx, kolone na ćirilici: COBISS.SR-ID, Наслов, Аутор, Издавач, Година издавања, ISBN, Број примерака (998c)...) →
// CSV koji čita scripts/uvezi-fond.mjs (cobiss_id, naslov, autor, izdavac, godina, isbn, primeraka, zanrovi). Čista logika, bez fajlova i mreže
// (proverava je npm run test:api); raspakivanje xlsx-a (zip) je u scripts/cobiss-xlsx-u-csv.mjs.
import { uIsbn13 } from "../src/lib/isbn.js";
import { zanroviIzUdk } from "./udk-zanrovi.mjs";

const ent = (s) =>
  String(s)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");

// Tekst ćelije iz <si> ili <is>: spojeni svi <t> (obogaćen tekst ima više delova).
const tekstovi = (xml) => ent([...String(xml).matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(""));

// A, B, ..., Z, AA → 0, 1, ..., 25, 26
const indeksKolone = (ref) => [...String(ref).replace(/\d+/g, "")].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;

// sharedStrings.xml + xl/worksheets/sheet1.xml → niz redova (niz tekstova; prazne ćelije su "").
export function redoviIzXlsx(sharedXml, sheetXml) {
  const zajednicki = [...String(sharedXml ?? "").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => tekstovi(m[1]));
  const redovi = [];
  for (const r of String(sheetXml ?? "").matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const red = [];
    for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = /\br="([A-Z]+\d+)"/.exec(c[1])?.[1];
      if (!ref) continue;
      const tip = /\bt="(\w+)"/.exec(c[1])?.[1];
      const telo = c[2] ?? "";
      let v = /<v>([\s\S]*?)<\/v>/.exec(telo)?.[1] ?? "";
      if (tip === "s") v = zajednicki[Number(v)] ?? "";
      else if (tip === "inlineStr") v = tekstovi(telo);
      else v = ent(v);
      red[indeksKolone(ref)] = v;
    }
    redovi.push(Array.from(red, (x) => x ?? ""));
  }
  return redovi;
}

// „Gudović Parađina, Savka = Гудовић Парађина, Савка" i „Арден, Кетрин = Arden, Katherine" → „Савка Гудовић Парађина" i „Кетрин Арден": u izvozu je
// jedna ili obe varijante pisma (redosled nije stalan), uzima se ona sa ćirilicom (kao u ranijim uvozima), a ako je nema, prva. Zatim „Prezime, Ime" →
// „Ime Prezime", ali samo kad iza zareza nema cifara („Мокрањчеви дани, 57 , 2023, Неготин" ostaje kakav jeste).
export function autorIzCobissa(sirov) {
  const svi = String(sirov ?? "").replace(/\s+/g, " ").trim();
  if (!svi) return "";
  const delovi = svi.split(" = ").map((x) => x.trim()).filter(Boolean);
  const a = delovi.find((x) => /[Ѐ-ӿ]/.test(x)) ?? delovi[0] ?? "";
  const z = a.indexOf(",");
  if (z > 0) {
    const prezime = a.slice(0, z).trim();
    const ime = a.slice(z + 1).trim();
    if (prezime && ime && !/\d/.test(a)) return `${ime} ${prezime}`;
  }
  return a;
}

// „978-86-7818-742-1 (PortaLibris; брош.)" → 9788678187421. Prva vrednost, bez napomena u zagradama; neispravan ISBN se ne briše
// (uvoz ga prijavi kao upozorenje), samo se čisti od crtica ako je ispravan.
export function isbnIzCobissa(sirov) {
  const bez = String(sirov ?? "").replace(/\([^)]*\)/g, " ");
  const m = /\d[\d-]{8,}[\dXx]?/.exec(bez);
  if (!m) return "";
  return uIsbn13(m[0]) ?? m[0];
}

// Polje 998c, npr. „?b70826?c2/0,0/0,0,0,0,+0-0,0/0,0,0" → 2 (broj primeraka); nepoznato → 0.
export const primerakaIz998c = (sirov) => Number(/\?c(\d+)/.exec(String(sirov ?? ""))?.[1] ?? 0);

const KOLONE = {
  cobiss_id: "COBISS.SR-ID",
  naslov: "Наслов",
  autor: "Аутор",
  izdavac: "Издавач",
  godina: "Година издавања",
  isbn: "ISBN",
  primeraka: "Број примерака (998c)",
};
// Nije obavezna (stariji izvozi je mogu nemati): iz nje se prave žanrovi (scripts/udk-zanrovi.mjs).
const KOLONA_UDK = "УДК за претраживање";
export const ZAGLAVLJE_CSV = ["cobiss_id", "naslov", "autor", "izdavac", "godina", "isbn", "primeraka", "zanrovi"];

const cisto = (v) => String(v ?? "").normalize("NFC").replace(/\s+/g, " ").trim();

// Redovi iz xlsx-a (prvi je zaglavlje) → { knjige, preskoceno, greska }. Preskaču se samo redovi bez naslova.
export function knjigeIzCobissa(redovi) {
  const zaglavlje = (redovi[0] ?? []).map((x) => cisto(x));
  const ind = {};
  for (const [k, ime] of Object.entries(KOLONE)) {
    const i = zaglavlje.indexOf(ime);
    if (i < 0) return { greska: `u zaglavlju nema kolone „${ime}"` };
    ind[k] = i;
  }
  const udk = zaglavlje.indexOf(KOLONA_UDK);
  const knjige = [];
  const preskoceno = [];
  for (const [n, red] of redovi.slice(1).entries()) {
    if (red.every((x) => cisto(x) === "")) continue;
    const naslov = cisto(red[ind.naslov]);
    if (!naslov) {
      preskoceno.push({ red: n + 2, razlog: "prazan naslov" });
      continue;
    }
    const g = cisto(red[ind.godina]).replace(/\.0+$/, "");
    knjige.push({
      cobiss_id: cisto(red[ind.cobiss_id]).replace(/\.0+$/, ""),
      naslov,
      autor: autorIzCobissa(red[ind.autor]),
      izdavac: cisto(red[ind.izdavac]),
      godina: /^\d{4}$/.test(g) ? g : "",
      isbn: isbnIzCobissa(red[ind.isbn]),
      primeraka: String(primerakaIz998c(red[ind.primeraka])),
      zanrovi: udk >= 0 ? zanroviIzUdk(red[udk]).join("; ") : "",
    });
  }
  return { knjige, preskoceno };
}

const navodnici = (v) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

// Isti oblik kao uvoz/fond-2025-2026.csv: UTF-8 sa BOM-om, zaglavlje, polja sa zarezom ili navodnicima pod navodnicima.
export function csvIzKnjiga(knjige) {
  return `\uFEFF${[ZAGLAVLJE_CSV.join(","), ...knjige.map((k) => ZAGLAVLJE_CSV.map((c) => navodnici(String(k[c] ?? ""))).join(","))].join("\r\n")}\r\n`;
}
