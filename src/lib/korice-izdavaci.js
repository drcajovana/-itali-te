// Čista logika skripte scripts/obogati-korice.mjs (bez mreže i bez fajlova, da je proverava npm run test:api):
// spisak izdavača sa onim što je o svakom proveri (robots.txt, kako sajt dozvoljava traženje knjige po ISBN-u ili naslovu),
// pravljenje adrese stranice iz naslova, provera da stranica odgovara knjizi i da je slika upotrebljiva.
//
// Pravila (CLAUDE.md, „Šta se ne radi" i „Korice i ISBN"): samo knjige iz fonda bez korice; jedan zahtev u sekundi, robots.txt, jasan
// User-Agent, prekid na 429 i 403; sa stranice se čita samo naslov, ISBN i adresa slike (nikad opis); slika se preuzima u NAŠ Storage
// (izvor 'preuzeto', korice_poreklo = adresa slike), jer se slika sa tuđeg servera ne prikazuje.
import { uIsbn13 } from "./isbn.js";
import { normTekst } from "./uvoz-fonda.js";

export const KORISNICKI_AGENT = "Citaliste-NBDN/1.0 (biblioteka Negotin)";
export const NAJMANJE_BAJTOVA_SLIKE = 1024; // manje od 1 KB nije prava korica (prazna ili zamenska slika)
export const PAUZA_MS = 1000; // najviše jedan zahtev u sekundi

// Šta je proveravano za svakog izdavača (stanje 2026-11-20, vidi docs/korice-izdavaci.md).
//   podrzan: skripta sme da ga obrađuje; razlog (ako nije): šta je nađeno, da se ne zaobilazi.
//   strategija "sitemap": adresa knjige se pravi iz naslova i traži u sitemap-u (jedan zahtev za ceo spisak, pa po jedna stranica);
//   pretraga po ISBN-u se NE koristi tamo gde je robots.txt zabranjuje ili gde je sajt ne nudi kao običnu adresu.
export const IZDAVACI = {
  laguna: {
    naziv: "Laguna",
    prepoznaj: ["laguna"],
    domen: "laguna.rs",
    robots: "https://laguna.rs/robots.txt",
    podrzan: true,
    strategija: "sitemap",
    sitemap: "https://laguna.rs/sitemap/products/1/",
    uzorakAdrese: /^https:\/\/laguna\.rs\/proizvodi\/knjige\/([^/]+)\/$/,
    // Dodatni domeni sa kojih OVA skripta sme da preuzme sliku (odluka vlasnice, 2026-11-20). NISU u opštoj beloj listi
    // (api/_lib/bela-lista.js): slika se preuzima u naš Storage, a u korice_url ide naša adresa, ne ova.
    slikeDomeni: ["laguna.oozmi-cdn.com"],
    napomena: "robots.txt dozvoljava (zabranjeno je samo /auth*?* i /*?qfunc=); pretraga sajta je klijentska (Qwik), pa se koristi sitemap proizvoda",
  },
  vulkan: {
    naziv: "Vulkan",
    prepoznaj: ["vulkan"],
    domen: "vulkani.rs",
    robots: "https://www.vulkani.rs/robots.txt",
    podrzan: true,
    strategija: "sitemap",
    sitemap: "https://www.vulkani.rs/files/sitemap/SRB_rs/product.xml",
    // adrese su /<kategorija>/<broj>-<naslov>: slug je druga grupa (broj ispred naslova se ne zna iz naslova)
    uzorakAdrese: /^https:\/\/www\.vulkani\.rs\/[a-z0-9-]+\/\d+-([^/?#]+)$/,
    napomena: "robots.txt zabranjuje samo pretragu (/*?search=), *.php i upitne parametre; pretraga po ISBN-u se NE koristi, nego sitemap proizvoda (3574 adrese); ISBN i korica (vulkani.rs, webp) su na stranici",
  },
  kreativni: {
    naziv: "Kreativni centar",
    prepoznaj: ["kreativni"],
    domen: "kreativnicentar.rs",
    robots: "https://kreativnicentar.rs/robots.txt",
    podrzan: true,
    strategija: "sitemap",
    sitemap: "https://kreativnicentar.rs/sitemaps/proizvodi.php",
    uzorakAdrese: /^https:\/\/kreativnicentar\.rs\/p\/knjiga\/([^/?#]+)\/?$/,
    napomena: "robots.txt zabranjuje samo /pretraga.php?q= i administraciju; pretraga se NE koristi, nego sitemap proizvoda (/p/knjiga/<naslov>/, XML sa prefiksom n1:)",
  },
  pcelica: {
    naziv: "Pčelica",
    prepoznaj: ["pcelica"],
    domen: "pcelica.rs",
    robots: "https://pcelica.rs/robots.txt",
    podrzan: true,
    // Nema sitemap-a (adresa vraća HTML). robots.txt je prazan (sve je dozvoljeno, pa i pretraga), a pretraga po ISBN-u je obična adresa
    // (OpenCart): jedan zahtev za pretragu i jedan za stranicu knjige, najviše dve stranice po knjizi.
    strategija: "pretraga",
    pretraga: (isbn) => `https://pcelica.rs/index.php?route=product/search&search=${isbn}`,
    // adrese pronađenih knjiga u rezultatima nose ?search=; ostali linkovi na stranici (meni, kategorije) ga nemaju
    uzorakRezultata: /href="(https:\/\/pcelica\.rs\/[^"?#]+)\?search=/g,
    napomena: "robots.txt je prazan; pretraga po ISBN-u (route=product/search&search=<isbn>), pa stranica knjige",
  },
  publik: {
    naziv: "Publik Praktikum",
    prepoznaj: ["publik"],
    domen: "publikpraktikum.rs",
    podrzan: false,
    razlog: "Proveren 2026-11-20: nema robots.txt ni sitemap-a (oba 404). Pretraga (/proizvodi?search=<isbn>) vraća praznu ljusku, a rezultate učitava JavaScript preko njihovog internog POST API-ja (/api, uz Auth). Takav API se ne koristi (nije običan zahtev za stranicu, a adrese stranica proizvoda se ne mogu pogoditi bez sitemap-a). Nije uključen; korice se dodaju ručno uz knjigu.",
  },
  booka: {
    naziv: "Booka",
    prepoznaj: ["booka"],
    domen: "booka.rs",
    robots: "https://booka.rs/robots.txt",
    podrzan: true,
    strategija: "sitemap",
    sitemap: "https://booka.rs/product-sitemap.xml",
    // adrese su /knjige/<kategorija>/<naslov>/ (sitemap proizvoda ima i /shop/ i druge stranice, one ne ulaze)
    uzorakAdrese: /^https:\/\/booka\.rs\/knjige\/[a-z0-9-]+\/([^/?#]+)\/$/,
    napomena: "robots.txt zabranjuje pretragu (/?s=, /search/), pa se ona NE koristi; sitemap proizvoda ima samo oko 280 adresa, pa je pokrivenost mala",
  },
  // Uključen po potvrdi vlasnice 2026-11-24 (domen je dodat na belu listu, migracija 0028).
  prometej: {
    naziv: "Prometej",
    prepoznaj: ["prometej"],
    domen: "prometej.rs",
    robots: "https://www.prometej.rs/robots.txt",
    podrzan: true,
    strategija: "sitemap",
    // proizvodi su u dva sitemap-a (product-sitemap.xml i product-sitemap2.xml; treći ne postoji), u njima su i /prodavnica/ i druge stranice
    sitemapi: ["https://www.prometej.rs/product-sitemap.xml", "https://www.prometej.rs/product-sitemap2.xml"],
    // adrese su /prodavnica/<kategorija>/<naslov>/ (sam /prodavnica/ nema naslov, pa ne ulazi)
    uzorakAdrese: /^https:\/\/www\.prometej\.rs\/prodavnica\/[a-z0-9-]+\/([^/?#]+)\/$/,
    napomena: "robots.txt zabranjuje samo poznate SEO botove, za ostale nema zabrana; pretraga se NE koristi, nego dva sitemap-a proizvoda (oko 1900 adresa); ISBN (sa crticama) i slika (og:image) su na stranici",
  },
  datastatus: {
    naziv: "Data Status",
    prepoznaj: ["data status", "datastatus"],
    domen: "datastatus.rs",
    robots: "https://datastatus.rs/robots.txt",
    podrzan: true,
    // Sitemap proizvoda ima oko 365 fajlova (uz Crawl-delay od 10 s to je sat vremena samo za spisak), pa se NE koristi. Pretraga po ISBN-u
    // (WooCommerce) nije zabranjena i kad ima tačno jedan rezultat preusmerava pravo na stranicu knjige; inače vraća stranicu sa rezultatima.
    strategija: "pretraga",
    pretraga: (isbn) => `https://datastatus.rs/?s=${isbn}&post_type=product`,
    uzorakStranice: /^https:\/\/datastatus\.rs\/knjige\/[^/?#]+\/$/,
    uzorakRezultata: /href="(https:\/\/datastatus\.rs\/knjige\/[^"?#]+\/)"/g,
    napomena: "robots.txt: Crawl-delay 10 s (poštuje se samo za ovaj sajt), zabranjeni su samo parametri filtera; pretraga po ISBN-u (/?s=<isbn>&post_type=product) preusmerava na /knjige/<naslov>/",
  },
  // Uključeni po potvrdi vlasnice 2026-11-24 (domeni su dodati na belu listu, migracija 0029).
  pravoslavna: {
    naziv: "Pravoslavna reč",
    prepoznaj: ["pravoslavna rec"],
    domen: "pravoslavnarec.com",
    robots: "https://pravoslavnarec.com/robots.txt",
    podrzan: true,
    strategija: "sitemap",
    sitemap: "https://pravoslavnarec.com/product-sitemap.xml",
    uzorakAdrese: /^https:\/\/pravoslavnarec\.com\/proizvod\/([^/?#]+)\/$/,
    napomena: "robots.txt zabranjuje samo /wp-admin/, wc-logs i ?add-to-cart=; sitemap proizvoda ima samo 54 adrese /proizvod/<naslov>/, pa je pokrivenost mala; ISBN i slika (og:image) su na stranici",
  },
  portalibris: {
    naziv: "PortaLibris",
    prepoznaj: ["portalibris"],
    domen: "portalibris.rs",
    robots: "https://portalibris.rs/robots.txt",
    podrzan: true,
    strategija: "sitemap",
    sitemap: "https://portalibris.rs/product-sitemap.xml",
    // adrese su /<naslov>-<autor>/ (autor je u adresi), pa ceo naslov retko pogodi; knjiga se nalazi prošireno (adresa koja počinje naslovom), uz obavezan ISBN
    uzorakAdrese: /^https:\/\/portalibris\.rs\/([a-z0-9-]+)\/$/,
    napomena: "robots.txt zabranjuje samo /wp-admin/, wc-logs i ?add-to-cart=; sitemap proizvoda ima oko 980 adresa /<naslov>-<autor>/; ISBN i slika (og:image) su na stranici",
  },
};

// Adrese sitemap-ova izdavača: jedan (sitemap) ili više njih (sitemapi).
export const adreseSitemapa = (cfg) => cfg.sitemapi ?? (cfg.sitemap ? [cfg.sitemap] : []);

// Delfi knjižare (delfi.rs) nisu izdavač nego knjižara: probni režim po odluci vlasnice (2026-11-20), samo za knjige iz FONDA koje i posle
// izdavača ostaju bez korice (sviIzdavaci: nema filtera po izdavaču). Sajt je JavaScript aplikacija bez običnog HTML-a, sitemap-a i robots.txt-a
// (404), pa se koristi ista adresa pretrage koju zove njihova stranica (GET, JSON). Jedan zahtev vraća do 20 proizvoda SA ISBN-om (barcode ili
// atribut ISBN), autorima i adresama slika, pa nema drugog zahteva po knjizi. Pretraga po ISBN-u ne radi (vraća 0), po naslovu radi
// (neosetljiva na kvačice, ne razume ćirilicu), pa se traži normalizovan naslov, a prihvata se samo isti ISBN.
IZDAVACI.delfi = {
  naziv: "Delfi knjižare",
  prepoznaj: [],
  sviIzdavaci: true,
  domen: "delfi.rs",
  robots: "https://delfi.rs/robots.txt",
  podrzan: true,
  strategija: "delfi",
  pretraga: (upit, preskoci = 0) => `https://delfi.rs/api/pc-frontend-api/search/advance-search/${encodeURIComponent(upit)}?sort=order_asc&limit=${DELFI_PO_STRANI}&skip=${preskoci}`,
  // slika se preuzima u naš Storage (delfi.rs je već na beloj listi domena, a ovde je naveden i izričito za ovu skriptu)
  slikeDomeni: ["delfi.rs"],
  napomena: "nema robots.txt-a (404) ni sitemap-a; pretraga po naslovu (interni JSON, isti poziv kao njihova pretraga), poklapanje samo po ISBN-u",
};

export const nazivIzdavaca = (k) => IZDAVACI[k]?.naziv ?? k;

// Da li se izdavač iz baze ("Laguna", "LAGUNA d.o.o.", ćirilicom) odnosi na izabranog izdavača skripte.
export function izdavacOdgovara(izdavacUBazi, kljuc) {
  const cfg = IZDAVACI[kljuc];
  if (!cfg) return false;
  if (cfg.sviIzdavaci) return true; // knjižara: sve knjige iz fonda bez korice, bez obzira na izdavača
  const k = normTekst(String(izdavacUBazi ?? "")).replace(/\s+/g, " ").trim();
  return cfg.prepoznaj.some((p) => k.includes(p));
}

// "Prokleta avlija: Djordje!" daje "prokleta-avlija-djordje" (ćirilica u latinicu, bez kvačica, sve osim slova i cifara u crtice).
export const slug = (t) =>
  normTekst(String(t ?? "").normalize("NFC"))
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

// Slug adrese iz naslova: ceo naslov, pa deo pre „ : " ili „ / " (podnaslov se često ne nalazi u adresi). Bez ponavljanja.
export function kandidatiSlugova(naslov) {
  const n = String(naslov ?? "");
  const delovi = [n, n.split(/\s+[:/]\s+/)[0]];
  return [...new Set(delovi.map(slug).filter((s) => s.length >= 3))];
}

// Sitemap (XML) → niz adresa iz <loc>.
// Podržava i sitemap sa prefiksom imenskog prostora (<n1:loc>, kod Kreativnog centra).
export const adreseIzSitemapa = (xml) => [...String(xml ?? "").matchAll(/<(?:[A-Za-z0-9]+:)?loc>\s*([^<\s]+)\s*<\/(?:[A-Za-z0-9]+:)?loc>/g)].map((m) => m[1].replace(/&amp;/g, "&"));

// Adrese knjiga iz sitemap-a → Map(slug → adresa), samo adrese koje odgovaraju uzorku izdavača.
export function indeksSitemapa(adrese, uzorak) {
  const m = new Map();
  for (const a of adrese) {
    const x = uzorak.exec(a);
    if (x && !m.has(x[1])) m.set(x[1], a);
  }
  return m;
}

// Adrese knjiga iz stranice sa rezultatima pretrage: samo linkovi koji odgovaraju uzorku izdavača, bez ponavljanja, najviše dva.
export function adreseIzRezultata(html, uzorak) {
  const nadjene = [];
  for (const m of String(html ?? "").matchAll(new RegExp(uzorak.source, uzorak.flags.includes("g") ? uzorak.flags : `${uzorak.flags}g`))) if (!nadjene.includes(m[1])) nadjene.push(m[1]);
  return nadjene.slice(0, 2);
}

// Adrese stranice za knjigu: najviše dve (ceo naslov i naslov bez podnaslova), samo ako postoje u sitemap-u.
export function adreseZaKnjigu(naslov, indeks) {
  const nadjene = [];
  for (const s of kandidatiSlugova(naslov)) if (indeks.has(s) && !nadjene.includes(indeks.get(s))) nadjene.push(indeks.get(s));
  return nadjene;
}

// ───── prošireno pogađanje adresa (verzija pravila 2) ─────
// Za knjige čiju adresu ne pogodi ceo naslov: serije sa brojem („Od mama za mame. Knj. 3, Materinstvo" → od-mama-za-mame-3-materinstvo),
// „Deo 1" i „Deo 2" (…-deo-prvi, …-deo-drugi) i varijante po pismu (…-cirilica, …-latinica). Adresa se uzima samo ako POSTOJI u sitemap-u, a
// stranica se prihvata samo ako se poklopi ISBN (ne naslov): knjige iz iste serije imaju skoro isti naslov, pa naslov nije dovoljan.
export const VERZIJA_PRAVILA = 3; // 3: dodate duže adrese koje počinju naslovom ili se njime završavaju
const REDNI = ["prvi", "drugi", "treci", "cetvrti", "peti", "sesti", "sedmi", "osmi", "deveti", "deseti"];
export const NAJVISE_PROSIRENIH = 3;

export function prosireneAdrese(naslov, indeks, vecProbane = []) {
  const n = String(naslov ?? "");
  const m = /^(.*?)[.,]?\s+(?:knj(?:iga)?\.?|deo|dio|tom|sv\.?)\s*(\d{1,2})\b/i.exec(n);
  const osnova = slug(m ? m[1] : n.split(/\s+[:/]\s+/)[0]);
  if (osnova.length < 5) return [];
  const broj = m ? Number(m[2]) : null;
  const pismo = /[\u0400-\u04FF]/.test(n) ? "cirilica" : "latinica";
  const trazeni = new Set();
  const tacno = [`${osnova}-${pismo}`];
  if (broj) {
    const redni = REDNI[broj - 1];
    tacno.push(`${osnova}-${broj}`, `${osnova}-deo-${broj}`);
    if (redni) tacno.push(`${osnova}-deo-${redni}`, `${osnova}-${redni}`);
  } else {
    tacno.push(`${osnova}-1`);
  }
  for (const s of tacno) if (indeks.has(s)) trazeni.add(indeks.get(s));
  // „…-3-materinstvo": broj pa naslov toma
  if (broj) for (const [s, a] of indeks) if (s.startsWith(`${osnova}-${broj}-`)) trazeni.add(a);
  // Naslov koji je na sajtu deo duže adrese: „Manifestuj" → manifestuj-7-koraka-…, „Dar Mračnog dola" → pet-kraljevstava-dar-mracnog-dola
  // (podnaslov ili serija u adresi). Samo za knjige bez broja toma (tomovi iste serije su različite knjige), najkraće adrese prve; ISBN odlučuje.
  if (!broj) {
    const duze = [...indeks].filter(([s]) => s.startsWith(`${osnova}-`) || s.endsWith(`-${osnova}`)).sort((x, y) => x[0].length - y[0].length);
    for (const [, a] of duze) trazeni.add(a);
  }
  return [...trazeni].filter((a) => !vecProbane.includes(a)).slice(0, NAJVISE_PROSIRENIH);
}

const reci = (t) => normTekst(String(t ?? "").normalize("NFC")).replace(/[^a-z0-9]+/g, " ").trim();

// Pravilo 6: stranica odgovara knjizi samo ako se poklapa ISBN ILI naslov (normalizovan: pismo, kvačice, znaci; podnaslov
// posle „ : " se ne traži na obe strane). Vraća { ok, po } (po: "isbn" | "naslov") ili { ok: false, razlog }.
export function stranicaOdgovara(knjiga, stranica) {
  if (knjiga.isbn && stranica.isbn && knjiga.isbn === stranica.isbn) return { ok: true, po: "isbn" };
  const a = reci(knjiga.naslov);
  const b = reci(stranica.naslov);
  if (a && b) {
    const glavni = (t) => reci(String(t).split(/\s+[:/]\s+/)[0]);
    if (a === b || glavni(knjiga.naslov) === glavni(stranica.naslov) || a.startsWith(`${b} `) || b.startsWith(`${a} `)) return { ok: true, po: "naslov" };
  }
  return { ok: false, razlog: stranica.isbn && knjiga.isbn ? "ISBN i naslov na stranici su drugačiji" : "naslov na stranici je drugačiji, a ISBN se ne može uporediti" };
}

// Slika je upotrebljiva ako je prepoznata po sadržaju (jpeg, png, webp) i veća od 1 KB.
export function slikaJeUpotrebljiva(tip, bajtova) {
  if (!tip) return { ok: false, razlog: "nije jpeg, png ni webp" };
  if (bajtova < NAJMANJE_BAJTOVA_SLIKE) return { ok: false, razlog: `slika je manja od 1 KB (${bajtova} bajtova)` };
  return { ok: true };
}

// Da li skripta sme da preuzme sliku sa ove adrese: https i tačno domen iz liste izdavača (ili njegov poddomen). Opšta bela lista
// (koricaJeDozvoljena) se proverava posebno, pa je dovoljan jedan od dva uslova.
export function slikaDomenIzdavaca(url, domeni = []) {
  const m = typeof url === "string" && url.length <= 500 && !/[\s\p{Cc}]/u.test(url) ? /^https:\/\/([A-Za-z0-9.-]+)(?:[/?#]|$)/.exec(url) : null;
  if (!m) return false;
  const host = m[1].toLowerCase();
  return domeni.some((d) => host === d || host.endsWith(`.${d}`));
}

// Kad izabrana slika ne može da se preuzme (npr. prevelika: neki sajtovi daju najveću varijantu), probaju se druge adrese koje je
// parser prihvatio kao PREDLOG korice (og:image, JSON-LD, itemprop...), ne i obične <img> sa stranice (mogu da budu druge knjige).
// Najviše dve dodatne.
export function alternativneKorice(dijagnostika, izabrana) {
  return [...new Set((dijagnostika?.kandidati ?? []).filter((c) => c.ishod === "prihvacena" && !String(c.izvor ?? "").startsWith("<img>") && c.dopunjena && c.dopunjena !== izabrana).map((c) => c.dopunjena))].slice(0, 2);
}

// ───── Delfi knjižare ─────
export const DELFI_PO_STRANI = 20;
export const DELFI_NAJVISE_STRANICA = 2; // najviše dva zahteva po knjizi (prva i druga strana rezultata)

const glavniNaslov = (t) => String(t ?? "").split(/\s+[:/]\s+/)[0];

// Upit za pretragu: glavni naslov (bez podnaslova), latinica bez kvačica i znakova, do 80 znakova; prekratak naslov ne daje upit.
export function upitZaDelfi(naslov) {
  const u = normTekst(glavniNaslov(naslov).normalize("NFC")).replace(/[^a-z0-9]+/g, " ").trim().slice(0, 80).trim();
  return u.length >= 3 ? u : "";
}

// ISBN-13 proizvoda: atribut ISBN i/ili barcode (samo ako je ispravan ISBN-13 koji počinje sa 978 ili 979; ostali barkodovi su EAN-i drugih artikala).
export function isbnoviProizvodaDelfi(p) {
  const izlaz = [];
  const atribut = uIsbn13(String((p?.attributes ?? []).find((a) => a?.k === "ISBN")?.v ?? ""));
  if (atribut) izlaz.push(atribut);
  const bar = String(p?.barcode ?? "");
  if (/^97[89]\d{10}$/.test(bar)) {
    const b = uIsbn13(bar);
    if (b && !izlaz.includes(b)) izlaz.push(b);
  }
  return izlaz;
}

// Koji proizvod iz rezultata je ova knjiga. Knjiga sa ISBN-om: samo proizvod sa ISTIM ISBN-om (Delfi ima više izdanja istog naslova, pa naslov nije
// dovoljan). Knjiga bez ISBN-a: samo ako tačno jedan proizvod ima isti glavni naslov i sve reči autora. Vraća { ok, proizvod, po } ili { ok: false, razlog }.
export function izaberiProizvodDelfi(knjiga, proizvodi) {
  const lista = Array.isArray(proizvodi) ? proizvodi : [];
  if (knjiga?.isbn) {
    const p = lista.find((x) => isbnoviProizvodaDelfi(x).includes(knjiga.isbn));
    if (p) return { ok: true, proizvod: p, po: "isbn" };
    return { ok: false, razlog: lista.length ? `kod Delfija ima ${lista.length} rezultata za naslov, nijedan sa ISBN-om ${knjiga.isbn}` : "nema rezultata kod Delfija za naslov" };
  }
  const naslov = reci(glavniNaslov(knjiga?.naslov));
  const autorReci = reci(knjiga?.autor).split(" ").filter((r) => r.length > 2);
  if (!naslov || !autorReci.length) return { ok: false, razlog: "knjiga nema ISBN, a za poklapanje treba i naslov i autor" };
  const kandidati = lista.filter((x) => reci(glavniNaslov(x?.title)) === naslov && autorReci.every((r) => reci((x?.authors ?? []).map((a) => a?.authorName).join(" ")).includes(r)));
  if (kandidati.length === 1) return { ok: true, proizvod: kandidati[0], po: "naslov+autor" };
  return { ok: false, razlog: kandidati.length ? "više izdanja istog naslova i autora, a knjiga nema ISBN" : "nema proizvoda sa istim naslovom i autorom kod Delfija" };
}

// Adrese slika proizvoda (xl, l, m), samo relativne putanje /_img/... na delfi.rs; zamenske slike se izostavljaju.
export function adreseSlikaDelfi(p) {
  const izlaz = [];
  for (const velicina of ["xl", "l", "m"]) {
    const t = typeof p?.images?.[velicina] === "string" ? p.images[velicina].trim() : "";
    if (!/^\/_img\/[A-Za-z0-9_\-./]+$/.test(t) || t.includes("..") || /placeholder|no[-_]?image|nema[-_]?slik/i.test(t)) continue;
    const a = `https://delfi.rs${t}`;
    if (!izlaz.includes(a)) izlaz.push(a);
  }
  return izlaz;
}

// Open Library: adresa po ISBN-u; default=false daje 404 kad korice nema (isto kao u src/lib/korica-slika.js).
export const adresaOpenLibrary = (isbn) => `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg?default=false`;

// Open Library dozvoljava oko 100 zahteva na 5 minuta po IP adresi: najviše jedan zahtev na 3.5 s (među zahtevima ka covers.openlibrary.org).
export const OL_PAUZA_MS = 3500;

// ISBN-13 sa prefiksom 978 → ISBN-10 (devet cifara bez prefiksa i kontrolni znak, može i X); 979 nema ISBN-10, pa vraća null.
export function isbn10Iz13(isbn13) {
  const m = /^978(\d{9})\d$/.exec(String(isbn13 ?? ""));
  if (!m) return null;
  const zbir = [...m[1]].reduce((s, c, i) => s + (10 - i) * Number(c), 0);
  const kontrolni = (11 - (zbir % 11)) % 11;
  return `${m[1]}${kontrolni === 10 ? "X" : kontrolni}`;
}

// Adrese korice na Open Library: prvo ISBN-13, pa (samo ako ima ISBN-10) ISBN-10. Drugi se proba tek kad prvi nema koricu.
export function adreseOpenLibrary(isbn13) {
  if (!/^97[89]\d{10}$/.test(String(isbn13 ?? ""))) return [];
  const deset = isbn10Iz13(isbn13);
  return [adresaOpenLibrary(isbn13), ...(deset ? [adresaOpenLibrary(deset)] : [])];
}

// Izdavač iz baze → ključ izdavača skripte (laguna, vulkan, ...), ili null kad ga skripta ne poznaje. Delfi (knjižara, sviIzdavaci) se ne računa.
export function izdavacKljuc(izdavacUBazi) {
  return Object.keys(IZDAVACI).find((k) => !IZDAVACI[k].sviIzdavaci && izdavacOdgovara(izdavacUBazi, k)) ?? null;
}

// Ime izdavača za izveštaj o izdavačima bez podrške: sabrani razmaci; prazno je „(bez izdavača)".
export const imeIzdavacaZaIzvestaj = (t) => String(t ?? "").replace(/\s+/g, " ").trim() || "(bez izdavača)";

// Odluka za jednu knjigu → red u izveštaju; stanje u fajlu je mapa id → { stanje, ... }.
// bez_korice i slika_neupotrebljiva NISU konačna: zavise od pravila (npr. dozvoljenih domena slika), pa se pri sledećem pokretanju ponovo pokušavaju (odgovori su u kešu).
export const KONACNA_STANJA = ["upisano", "nije_nadjeno", "ne_odgovara"];
// Stanja „nije nađeno" i „ne odgovara" važe samo za verziju pravila kojom su dobijena: kad se pravilo proširi, ponovo se pokušavaju.
// „upisano" je uvek konačno.
export const jeKonacno = (z) => Boolean(z && KONACNA_STANJA.includes(z.stanje) && (z.stanje === "upisano" || z.pravilo === VERZIJA_PRAVILA));

// Statusi 429 i 403 prekidaju ceo rad (sajt traži da stanemo); 404 znači samo „nema te stranice".
export function statusIzGreske(e) {
  const m = /HTTP (\d{3})/.exec(String(e?.message ?? ""));
  return m ? Number(m[1]) : null;
}
export const jePrekid = (status) => status === 429 || status === 403;
