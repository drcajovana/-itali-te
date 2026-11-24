// Nalazi stranicu knjige kod izdavača i preuzima koricu u NAŠ Storage, za knjige iz fonda bez korice.
//
//   npm run admin:obogati-korice -- --izdavac=laguna                    probno (podrazumevano): ništa se ne upisuje
//   npm run admin:obogati-korice -- --izdavac=laguna --uzorak=20        samo prvih 20 knjiga koje čekaju (isto: --limit=20)
//   npm run admin:obogati-korice -- --izdavac=laguna --upisi            preuzima slike u Storage i upisuje korice_url
//   --open-library                                                      za knjige koje izdavač ne daje: Open Library po ISBN-u (13, pa 10)
//   --ponovo                                                            ignoriše zapamćeno stanje (keš odgovora ostaje)
//
//   npm run admin:obogati-korice -- --izdavac=sve --limit=30            SVE knjige iz fonda bez korice sa ISBN-om, svaka svojim redom izvora:
//                                                                       1) sajt njenog izdavača (ako je izdavač uključen), 2) [--delfi] Delfi knjižare,
//                                                                       3) Open Library (ISBN-13, pa ISBN-10; isključuje se sa --bez-open-library)
//
// Pravila (vidi docs/korice-izdavaci.md i CLAUDE.md): jedan zahtev u sekundi (Open Library: jedan na 3.5 s), robots.txt se poštuje, jasan User-Agent,
// prekid na 429 i 403, svaki odgovor se kešira na disku (uvoz/kes-korice/), nastavlja se gde je stalo (uvoz/korice-<izdavac>.json; za „sve":
// uvoz/korice-sve.json). Sa stranice se čita samo naslov, ISBN i adresa slike (parser-knjige.js), nikad opis. Link se prihvata samo ako se poklapa ISBN ili
// naslov. Slika mora da dolazi sa domena iz bele liste (ili covers.openlibrary.org), da je jpeg/png/webp i veća od 1 KB (Open Library: samo jpeg);
// čuva se u bucket „korice" kao 'preuzeto' (korice_poreklo = adresa slike). Ostala polja knjige se ne menjaju, a postojeća korica se nikad ne prepisuje.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { izvuciIzLinka } from "../api/_lib/parser-knjige.js";
import { ApiGreska } from "../api/_lib/greska.js";
import { DOZVOLJENI_DOMENI_KORICA, koricaJeDozvoljena } from "../api/_lib/bela-lista.js";
import { jeDozvoljeno, ucitajRobots } from "../api/_lib/robots.js";
import { tipSlike } from "../api/_lib/slika.js";
import { preuzmi } from "../api/_lib/bezbedan-fetch.js";
import { BUCKET_KORICE, putanjaKorice } from "../src/lib/korica-slika.js";
import {
  DELFI_NAJVISE_STRANICA, DELFI_PO_STRANI, IZDAVACI, KORISNICKI_AGENT, OL_PAUZA_MS, PAUZA_MS, VERZIJA_PRAVILA, adreseIzRezultata, adreseIzSitemapa, adreseOpenLibrary, adreseSitemapa, adreseZaKnjigu, alternativneKorice, imeIzdavacaZaIzvestaj, indeksSitemapa, izdavacKljuc, izdavacOdgovara, jeKonacno, jePrekid, prosireneAdrese,
  adreseSlikaDelfi, izaberiProizvodDelfi, slikaDomenIzdavaca, slikaJeUpotrebljiva, statusIzGreske, stranicaOdgovara, upitZaDelfi,
} from "../src/lib/korice-izdavaci.js";

const URL_ = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !SERVICE) {
  console.error("Nedostaju VITE_SUPABASE_URL i/ili SUPABASE_SERVICE_ROLE_KEY u .env");
  process.exit(2);
}
const bezTajni = (t) => String(t ?? "").split(SERVICE).join("***");

const arg = (ime) => process.argv.find((a) => a === `--${ime}` || a.startsWith(`--${ime}=`));
const vrednost = (ime, podrazumevano = null) => {
  const a = arg(ime);
  return a?.includes("=") ? a.slice(a.indexOf("=") + 1) : podrazumevano;
};
const IZDAVAC = vrednost("izdavac");
const SVE = IZDAVAC === "sve"; // sve knjige bez korice, svaka kod svog izdavača, pa Open Library
const UPISI = Boolean(arg("upisi"));
const OPEN_LIBRARY = Boolean(arg("open-library")) || (SVE && !arg("bez-open-library"));
const DELFI = SVE && Boolean(arg("delfi"));
const PONOVO = Boolean(arg("ponovo"));
const UZORAK = vrednost("uzorak") ?? vrednost("limit") ? Math.max(1, Number(vrednost("uzorak") ?? vrednost("limit"))) : null;
const PRIMERA = 10;
const KES_DIR = "uvoz/kes-korice";

if (UPISI && arg("probno")) {
  console.error("--probno i --upisi se međusobno isključuju.");
  process.exit(2);
}
if (!SVE && (!IZDAVAC || !IZDAVACI[IZDAVAC])) {
  console.error(`Navedite izdavača: --izdavac=<${Object.keys(IZDAVACI).join("|")}|sve>. Uključen je samo onaj kome piše podrzan (vidi docs/korice-izdavaci.md).`);
  process.exit(2);
}
const GLAVNI = SVE ? null : IZDAVACI[IZDAVAC];
if (GLAVNI && !GLAVNI.podrzan) {
  console.error(`${GLAVNI.naziv}: ${GLAVNI.razlog}`);
  process.exit(3);
}

const S = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
mkdirSync(KES_DIR, { recursive: true });
const FAJL_STANJA = `uvoz/korice-${IZDAVAC}.json`;
const stanje = !PONOVO && existsSync(FAJL_STANJA) ? JSON.parse(readFileSync(FAJL_STANJA, "utf8")) : {};
const sacuvajStanje = () => writeFileSync(FAJL_STANJA, JSON.stringify(stanje, null, 1));
// „nije nađeno" je konačno samo za verziju pravila kojom je dobijeno; u režimu „sve" i samo ako je Open Library već probana (ili je isključena)
const konacno = (z) => jeKonacno(z) && (!SVE || !OPEN_LIBRARY || z.ol === true || z.stanje === "upisano");

// ───────────── mreža: keš na disku, pauza, robots, prekid ─────────────
class Prekid extends Error {}
// pauza po sajtu (Crawl-delay iz njegovog robots.txt) važi samo za taj sajt, ne za ostale; opšte pravilo od 1 zahteva u sekundi važi uvek
const mreza = { zahteva: 0, izKesa: 0, poslednji: 0, poslednjiOL: 0, poslednjiPoSajtu: new Map(), robots: new Map() };

const kesPutanja = (url, accept) => path.join(KES_DIR, `${createHash("sha1").update(`${url}|${accept}`).digest("hex")}.json`);
const spavaj = (ms) => new Promise((r) => setTimeout(r, ms));

// Isti oblik kao preuzmi() iz api/_lib/bezbedan-fetch.js, pa ga parser-knjige.js koristi bez izmena (preuzmiFn).
async function preuzmiPoliticno(ulaz, opcije = {}) {
  const url = new URL(ulaz);
  const accept = opcije.accept ?? "text/html,application/xhtml+xml";
  const kes = kesPutanja(url.href, accept);
  if (existsSync(kes)) {
    const k = JSON.parse(readFileSync(kes, "utf8"));
    mreza.izKesa++;
    if (k.greska) throw new ApiGreska(k.greska.status, k.greska.kod, k.greska.poruka);
    return { url: new URL(k.url), tip: k.tip, telo: opcije.sirovo ? Buffer.from(k.telo, "base64") : k.telo };
  }

  // robots.txt domena (osim samog robots.txt-a): jednom po domenu, pa za svaku adresu
  if (!url.pathname.endsWith("/robots.txt")) {
    let r = mreza.robots.get(url.hostname);
    if (!r) {
      r = await ucitajRobots(url, { preuzmiFn: preuzmiPoliticno });
      mreza.robots.set(url.hostname, r);
    }
    if (!jeDozvoljeno(r.pravila, `${url.pathname}${url.search}`)) throw new ApiGreska(403, "robots", `robots.txt zabranjuje ${url.pathname}`);
  }

  // najviše jedan zahtev u sekundi uopšte, a ka Open Library najviše jedan na 3.5 s (njihov limit je oko 100 zahteva na 5 minuta po IP adresi)
  const jeOL = url.hostname === "covers.openlibrary.org";
  const pauzaSajta = (mreza.robots.get(url.hostname)?.pauzaSekundi ?? 0) * 1000;
  const sacekaj = Math.max(mreza.poslednji + PAUZA_MS, (mreza.poslednjiPoSajtu.get(url.hostname) ?? 0) + pauzaSajta, jeOL ? mreza.poslednjiOL + OL_PAUZA_MS : 0) - Date.now();
  if (sacekaj > 0) await spavaj(sacekaj);
  mreza.poslednji = Date.now();
  mreza.poslednjiPoSajtu.set(url.hostname, mreza.poslednji);
  if (jeOL) mreza.poslednjiOL = mreza.poslednji;
  mreza.zahteva++;

  try {
    // stranice: podrazumevana bela lista za čitanje; slike: lista domena za korice (ili Open Library), vidi preuzmiSliku
    const o = await preuzmi(url.href, { ...opcije, korisnickiAgent: KORISNICKI_AGENT });
    const zapis = JSON.stringify({ url: o.url.href, tip: o.tip, telo: opcije.sirovo ? o.telo.toString("base64") : o.telo });
    writeFileSync(kes, zapis);
    // preusmerenje (npr. pretraga po ISBN-u koja vodi pravo na stranicu knjige): ta stranica je već preuzeta, pa je drugi zahtev suvišan
    if (!opcije.sirovo && o.url.href !== url.href) writeFileSync(kesPutanja(o.url.href, accept), zapis);
    return o;
  } catch (e) {
    const s = statusIzGreske(e);
    if (jePrekid(s)) throw new Prekid(`HTTP ${s} sa ${url.hostname}: sajt traži da stanemo. Rad se prekida (stanje je sačuvano).`);
    if (e instanceof ApiGreska && (s === 404 || s === 410)) writeFileSync(kes, JSON.stringify({ greska: { status: e.status, kod: e.kod, poruka: e.message } })); // „nema te stranice" se pamti
    throw e;
  }
}

// Indeks adresa knjiga izdavača iz jednog ili više sitemap-ova (svaki se preuzima jednom, pa iz keša).
async function ucitajIndeks(CFG) {
  const adrese = [];
  for (const s of adreseSitemapa(CFG)) {
    const sitemap = await preuzmiPoliticno(s, { accept: "application/xml,text/xml", tipovi: ["application/xml", "text/xml"], najviseBajtova: 20_000_000 });
    adrese.push(...adreseIzSitemapa(sitemap.telo));
  }
  return indeksSitemapa(adrese, CFG.uzorakAdrese);
}

// ───────────── knjige koje čekaju ─────────────
async function ucitajKandidate() {
  const sve = [];
  for (let od = 0; ; od += 1000) {
    let upit = S.from("knjige")
      .select("id, naslov, autor, izdavac, godina, isbn")
      .eq("izvor", "fond")
      .eq("u_fondu", true)
      .is("korice_url", null)
      .is("spojena_sa_id", null);
    if (SVE) upit = upit.not("isbn", "is", null); // režim „sve": samo knjige sa ISBN-om
    const { data, error } = await upit.order("id").range(od, od + 999);
    if (error) throw new Error(`čitanje knjiga: ${error.message}`);
    sve.push(...data);
    if (data.length < 1000) break;
  }
  return SVE ? sve : sve.filter((k) => izdavacOdgovara(k.izdavac, IZDAVAC));
}

const skrati = (t, n = 64) => (String(t).length > n ? `${String(t).slice(0, n - 1)}…` : String(t));

// ───────────── jedna knjiga ─────────────
// Izdavači bez sitemap-a: pretraga po ISBN-u (jedan zahtev), pa se čitaju samo adrese knjiga iz rezultata.
async function adreseIzPretrage(k, CFG) {
  if (!k.isbn) return [];
  try {
    const o = await preuzmiPoliticno(CFG.pretraga(k.isbn));
    // jedan rezultat: sajt preusmerava pravo na stranicu knjige (ona je već u kešu pod svojom adresom, vidi preuzmiPoliticno)
    if (CFG.uzorakStranice?.test(o.url.href)) return [o.url.href];
    return adreseIzRezultata(o.telo, CFG.uzorakRezultata);
  } catch (e) {
    if (e instanceof Prekid) throw e;
    return [];
  }
}

// Delfi knjižare: jedan zahtev (najviše dva) po knjizi vraća proizvode sa ISBN-om i adresama slika; prihvata se samo isti ISBN.
async function obradiDelfi(k, CFG) {
  const upit = upitZaDelfi(k.naslov);
  if (!upit) return { stanje: "nije_nadjeno", razlog: "naslov je prekratak za pretragu" };
  let proizvodi = [];
  let izbor = { ok: false, razlog: "nema rezultata kod Delfija za naslov" };
  for (let strana = 0; strana < DELFI_NAJVISE_STRANICA; strana++) {
    let odgovor;
    try {
      const o = await preuzmiPoliticno(CFG.pretraga(upit, strana * DELFI_PO_STRANI), { accept: "application/json", tipovi: ["application/json"], najviseBajtova: 1_500_000 });
      odgovor = JSON.parse(o.telo)?.data;
    } catch (e) {
      if (e instanceof Prekid) throw e;
      return { stanje: "greska", razlog: `pretraga ne odgovara (${String(e?.message ?? e).slice(0, 80)})` };
    }
    const stranica = odgovor?.products ?? [];
    proizvodi = proizvodi.concat(stranica);
    izbor = izaberiProizvodDelfi(k, proizvodi);
    if (izbor.ok || stranica.length < DELFI_PO_STRANI) break;
  }
  if (!izbor.ok) return { stanje: proizvodi.length ? "ne_odgovara" : "nije_nadjeno", razlog: izbor.razlog };

  const adrese = adreseSlikaDelfi(izbor.proizvod);
  const oznaka = `Delfi: ${skrati(izbor.proizvod.title, 40)} (${izbor.proizvod.publisher ?? "—"})`;
  if (!adrese.length) return { stanje: "bez_korice", stranica: oznaka, po: izbor.po };
  let slika = null;
  let koricaUrl = adrese[0];
  for (const a of adrese) {
    koricaUrl = a;
    slika = await preuzmiSliku(a, false, CFG);
    if (slika.ok) break;
  }
  if (!slika?.ok) return { stanje: "slika_neupotrebljiva", stranica: oznaka, po: izbor.po, korica: koricaUrl, razlog: slika?.razlog };
  return { stanje: "nadjeno", stranica: oznaka, po: izbor.po, korica: koricaUrl, tip: slika.tip, bajtova: slika.telo.length, telo: slika.telo };
}

// Open Library po ISBN-u: prvo ISBN-13, pa ISBN-10 (tek kad prvi nema koricu). Prihvata se samo odgovor 200 sa image/jpeg većim od 1 KB.
async function obradiOpenLibrary(k) {
  const adrese = adreseOpenLibrary(k.isbn);
  if (!adrese.length) return { stanje: "nije_nadjeno", razlog: "Open Library: ISBN nije ISBN-13 sa prefiksom 978 ili 979" };
  for (const adresa of adrese) {
    const slika = await preuzmiSliku(adresa, true);
    if (slika.ok && slika.tip.mime === "image/jpeg" && /^image\/jpeg\b/i.test(slika.tipOdgovora ?? "")) {
      return { stanje: "nadjeno", izvor: "open-library", po: "isbn", stranica: null, korica: adresa, tip: slika.tip, bajtova: slika.telo.length, telo: slika.telo };
    }
  }
  return { stanje: "nije_nadjeno", razlog: `Open Library nema korice za ISBN ${k.isbn}${adrese.length > 1 ? " ni za ISBN-10" : ""}` };
}

// Kod jednog izdavača. bezOpenLibrary: u režimu „sve" Open Library se probava posle svih izvora, ne ovde.
async function obradi(k, CFG, indeks, { bezOpenLibrary = false } = {}) {
  if (CFG.strategija === "delfi") return obradiDelfi(k, CFG);
  const poPretrazi = CFG.strategija === "pretraga";
  const tacne = poPretrazi ? await adreseIzPretrage(k, CFG) : adreseZaKnjigu(k.naslov, indeks);
  // prošireno pogađanje (serije, deo prvi/drugi, ćirilica/latinica) samo za sitemap, i samo ako ceo naslov nije dao prihvaćenu stranicu; traži ISBN
  const prosirene = !poPretrazi && k.isbn ? prosireneAdrese(k.naslov, indeks, tacne) : [];
  const adrese = [...tacne, ...prosirene];
  let razlogNeodgovara = null;

  for (const adresa of adrese) {
    const pogodjena = prosirene.includes(adresa);
    let stranica;
    try {
      stranica = await izvuciIzLinka(adresa, { preuzmiFn: preuzmiPoliticno });
    } catch (e) {
      if (e instanceof Prekid) throw e;
      continue; // stranica se ne čita (404, nema podataka): sledeći kandidat
    }
    let p = stranicaOdgovara(k, stranica);
    if (p.ok && pogodjena && p.po !== "isbn") p = { ok: false, razlog: "pogođena adresa se poklapa samo po naslovu (za nju je potreban ISBN)" };
    if (!p.ok) {
      razlogNeodgovara = `${adresa}: ${p.razlog}`;
      continue;
    }
    if (!stranica.korica) return { stanje: "bez_korice", stranica: adresa, po: p.po };
    if (!koricaJeDozvoljena(stranica.korica) && !slikaDomenIzdavaca(stranica.korica, CFG.slikeDomeni)) return { stanje: "bez_korice", stranica: adresa, po: p.po, razlog: `adresa slike nije sa dozvoljenog domena (${new URL(stranica.korica).hostname})` };
    // izabrana slika, pa (ako se ne može preuzeti, npr. prevelika) najviše dve druge predložene sa iste stranice
    const adreseSlika = [stranica.korica, ...alternativneKorice(stranica.dijagnostika, stranica.korica)].filter((a) => koricaJeDozvoljena(a) || slikaDomenIzdavaca(a, CFG.slikeDomeni));
    let slika = null;
    let koricaUrl = stranica.korica;
    for (const a of adreseSlika) {
      koricaUrl = a;
      slika = await preuzmiSliku(a, false, CFG);
      if (slika.ok) break;
    }
    if (!slika?.ok) return { stanje: "slika_neupotrebljiva", stranica: adresa, po: p.po, korica: koricaUrl, razlog: slika?.razlog };
    return { stanje: "nadjeno", stranica: adresa, po: p.po, korica: koricaUrl, tip: slika.tip, bajtova: slika.telo.length, telo: slika.telo };
  }

  if (razlogNeodgovara) return { stanje: "ne_odgovara", razlog: razlogNeodgovara };

  if (OPEN_LIBRARY && !bezOpenLibrary && k.isbn) {
    const ol = await obradiOpenLibrary(k);
    if (ol.stanje === "nadjeno") return { ...ol, izvorSlike: "open-library" };
  }
  return { stanje: "nije_nadjeno", razlog: adrese.length ? "stranica se ne može pročitati" : poPretrazi ? (k.isbn ? "pretraga po ISBN-u nema rezultat" : "nema ISBN za pretragu") : "adrese nema u sitemap-u izdavača" };
}

async function preuzmiSliku(adresa, openLibrary = false, CFG = null) {
  try {
    const o = await preuzmiPoliticno(adresa, {
      sirovo: true,
      accept: "image/jpeg,image/png,image/webp",
      tipovi: ["image/", "application/octet-stream", "binary/octet-stream"],
      najviseBajtova: 1_500_000,
      // Open Library preusmerava na archive.org (njihov CDN); samo to preusmeravanje je dozvoljeno
      lista: openLibrary ? ["covers.openlibrary.org", "archive.org"] : [...DOZVOLJENI_DOMENI_KORICA, ...(CFG?.slikeDomeni ?? [])],
    });
    const tip = tipSlike(o.telo);
    const p = slikaJeUpotrebljiva(tip, o.telo.length);
    return p.ok ? { ok: true, tip, telo: o.telo, tipOdgovora: o.tip } : p;
  } catch (e) {
    if (e instanceof Prekid) throw e;
    return { ok: false, razlog: `slika se ne preuzima (${String(e?.message ?? e).slice(0, 80)})` };
  }
}

// ───────────── režim „sve": izdavač po izdavač, pa Delfi (--delfi), pa Open Library ─────────────
// Robots.txt i sitemap izdavača se pripremaju jednom, kad prva knjiga tog izdavača dođe na red (sve ostalo je iz keša).
const spremni = new Map();
async function pripremi(kljuc) {
  if (spremni.has(kljuc)) return spremni.get(kljuc);
  const CFG = IZDAVACI[kljuc];
  const r = await ucitajRobots(new URL(CFG.robots), { preuzmiFn: preuzmiPoliticno });
  mreza.robots.set(new URL(CFG.robots).hostname, r);
  const indeks = CFG.strategija === "sitemap" ? await ucitajIndeks(CFG) : null;
  console.log(`\n   [${CFG.naziv}] robots.txt ${r.procitan ? "pročitan" : "nije pročitan"}${r.pauzaSekundi ? `, Crawl-delay ${r.pauzaSekundi} s` : ""}; ${CFG.strategija === "sitemap" ? `sitemap: ${indeks.size} adresa knjiga` : "pretraga po ISBN-u"}`);
  const spreman = { CFG, indeks };
  spremni.set(kljuc, spreman);
  return spreman;
}

// Vraća ishod za knjigu: { stanje, izvor: "izdavac" | "delfi" | "open-library", grupa, ... }. Izdavači koje skripta ne poznaje (ili nisu uključeni)
// odmah idu na sledeći izvor, a njihov naziv ulazi u izveštaj „izdavači bez podrške".
async function obradiSve(k) {
  const kljuc = izdavacKljuc(k.izdavac);
  const CFG = kljuc ? IZDAVACI[kljuc] : null;
  const grupa = CFG ? CFG.naziv : imeIzdavacaZaIzvestaj(k.izdavac);
  const razlozi = [];
  if (CFG?.podrzan) {
    const { indeks } = await pripremi(kljuc);
    const o = await obradi(k, CFG, indeks, { bezOpenLibrary: true });
    if (o.stanje === "nadjeno") return { ...o, izvor: "izdavac", grupa, podrzan: true };
    razlozi.push(`${CFG.naziv}: ${o.razlog ?? o.stanje}`);
  } else {
    razlozi.push(CFG ? `${CFG.naziv}: nije uključen` : "izdavač nije na spisku");
  }
  if (DELFI) {
    const o = await obradiDelfi(k, IZDAVACI.delfi);
    if (o.stanje === "nadjeno") return { ...o, izvor: "delfi", grupa, podrzan: Boolean(CFG?.podrzan) };
    razlozi.push(`Delfi: ${o.razlog ?? o.stanje}`);
  }
  if (OPEN_LIBRARY) {
    const o = await obradiOpenLibrary(k);
    if (o.stanje === "nadjeno") return { ...o, grupa, podrzan: Boolean(CFG?.podrzan) };
    razlozi.push(o.razlog);
  }
  return { stanje: "nije_nadjeno", razlog: razlozi.join("; "), grupa, podrzan: Boolean(CFG?.podrzan) };
}

// ───────────── upis ─────────────
async function upisi(k, r) {
  const skladiste = S.storage.from(BUCKET_KORICE);
  const putanja = putanjaKorice(k.id, Date.now(), r.tip.mime);
  const { error } = await skladiste.upload(putanja, r.telo, { contentType: r.tip.mime, cacheControl: "31536000", upsert: false });
  if (error) throw new Error(`Storage: ${bezTajni(error.message)}`);
  const koricaUrl = skladiste.getPublicUrl(putanja).data.publicUrl;
  // samo ako knjiga još nema koricu (idempotentno, nikad se ne prepisuje tuđa korica)
  const { data, error: e2 } = await S.from("knjige").update({ korice_url: koricaUrl, korice_izvor: "preuzeto", korice_poreklo: r.korica }).eq("id", k.id).is("korice_url", null).select("id");
  if (e2 || data?.length !== 1) {
    await skladiste.remove([putanja]).catch(() => {});
    throw new Error(`upis korice: ${bezTajni(e2?.message ?? "knjiga već ima koricu ili ne postoji")}`);
  }
  return koricaUrl;
}

async function main() {
  console.log(`Korice — ${SVE ? "sve knjige iz fonda bez korice (sa ISBN-om)" : `izdavač: ${GLAVNI.naziv}`} | projekat: ${new URL(URL_).host}`);
  console.log(`Režim: ${UPISI ? "UPISUJE SE (--upisi)" : "PROBNO (ništa se ne upisuje u bazu ni u Storage)"}${OPEN_LIBRARY ? " | Open Library uključen" : ""}${DELFI ? " | Delfi uključen" : ""}`);
  console.log(`User-Agent: ${KORISNICKI_AGENT} | najviše 1 zahtev u sekundi (Open Library: 1 na ${OL_PAUZA_MS / 1000} s) | keš: ${KES_DIR}`);

  const kandidati = await ucitajKandidate();
  const cekaju = kandidati.filter((k) => PONOVO || !konacno(stanje[k.id]));
  const izabrani = UZORAK ? cekaju.slice(0, UZORAK) : cekaju;
  console.log(`Knjiga iz fonda bez korice${SVE ? " (sa ISBN-om)" : " za ovog izdavača"}: ${kandidati.length}; čeka: ${cekaju.length}; obrađuje se: ${izabrani.length}${UZORAK ? ` (uzorak ${UZORAK})` : ""}`);
  if (!izabrani.length) {
    console.log("Nema šta da se radi.");
    return 0;
  }

  // robots.txt i sitemap: jednom, pa iz keša (u režimu „sve" za svakog izdavača kad dođe na red, vidi pripremi)
  let indeks = null;
  if (!SVE) {
    const r = await ucitajRobots(new URL(GLAVNI.robots), { preuzmiFn: preuzmiPoliticno });
    mreza.robots.set(new URL(GLAVNI.robots).hostname, r);
    console.log(`robots.txt: ${r.procitan ? "pročitan" : "nije pročitan (nastavlja se uz pauzu)"}${r.pauzaSekundi ? `, Crawl-delay ${r.pauzaSekundi} s` : ""}`);
    if (GLAVNI.strategija === "delfi") {
      console.log("Strategija: pretraga naslova kod Delfija (1 do 2 zahteva po knjizi), prihvata se samo isti ISBN");
    } else if (GLAVNI.strategija === "pretraga") {
      console.log("Strategija: pretraga po ISBN-u (jedan zahtev), pa stranica knjige");
    } else {
      indeks = await ucitajIndeks(GLAVNI);
      console.log(`Sitemap: ${indeks.size} adresa knjiga`);
    }
  } else {
    console.log("Redosled izvora po knjizi: sajt izdavača (ako je uključen)" + (DELFI ? ", Delfi" : "") + (OPEN_LIBRARY ? ", Open Library (ISBN-13, pa ISBN-10)" : ""));
  }

  const ishodi = [];
  let prekid = null;
  for (const [i, k] of izabrani.entries()) {
    try {
      const o = SVE ? await obradiSve(k) : await obradi(k, GLAVNI, indeks);
      ishodi.push({ k, o });
      if (UPISI && o.stanje === "nadjeno") {
        const koricaUrl = await upisi(k, o);
        stanje[k.id] = { stanje: "upisano", stranica: o.stranica ?? null, korica: o.korica, korice_url: koricaUrl, izvor: o.izvor ?? null };
      } else if (o.stanje !== "nadjeno") {
        stanje[k.id] = { stanje: o.stanje, razlog: o.razlog ?? null, stranica: o.stranica ?? null, pravilo: VERZIJA_PRAVILA, ol: OPEN_LIBRARY };
      }
    } catch (e) {
      if (e instanceof Prekid) {
        prekid = e.message;
        break;
      }
      ishodi.push({ k, o: { stanje: "greska", razlog: bezTajni(e?.message ?? e) } });
    }
    if ((i + 1) % 10 === 0) {
      sacuvajStanje();
      process.stdout.write(`   obrađeno ${i + 1}/${izabrani.length}\r`);
    }
  }
  sacuvajStanje();

  // ───── ispis ─────
  const po = (s) => ishodi.filter((x) => x.o.stanje === s);
  console.log(`\n── Zbir (${ishodi.length} obrađenih; zahteva ka mreži: ${mreza.zahteva}, iz keša: ${mreza.izKesa})`);
  console.log(`   NAĐENO (stranica odgovara, korica upotrebljiva):  ${po("nadjeno").length}${UPISI ? " (upisano)" : " (probno, ništa upisano)"}`);
  console.log(`   NIJE NAĐENO (nema stranice u sitemap-u):          ${po("nije_nadjeno").length}`);
  console.log(`   NE ODGOVARA (stranica je druga knjiga):           ${po("ne_odgovara").length}`);
  console.log(`   BEZ KORICE na stranici (ili van bele liste):      ${po("bez_korice").length}`);
  console.log(`   SLIKA NEUPOTREBLJIVA (nije slika / manja od 1 KB): ${po("slika_neupotrebljiva").length}`);
  console.log(`   GREŠKE:                                           ${po("greska").length}`);

  if (SVE) {
    // po izvoru i po izdavaču
    const nadjeno = po("nadjeno");
    const poIzvoru = (z) => nadjeno.filter((x) => x.o.izvor === z).length;
    console.log("\n── Po izvoru korice");
    console.log(`   sajt izdavača:  ${poIzvoru("izdavac")}`);
    if (DELFI) console.log(`   Delfi knjižare: ${poIzvoru("delfi")}`);
    console.log(`   Open Library:   ${poIzvoru("open-library")}${OPEN_LIBRARY ? "" : " (isključen)"}`);
    console.log(`   nije nađeno:    ${po("nije_nadjeno").length}${po("greska").length ? ` (+ ${po("greska").length} grešaka)` : ""}`);

    const grupe = new Map();
    for (const { k, o } of ishodi) {
      const g = o.grupa ?? imeIzdavacaZaIzvestaj(k.izdavac);
      const z = grupe.get(g) ?? { n: 0, sajt: 0, delfi: 0, ol: 0, nije: 0, podrzan: o.podrzan === true };
      z.n++;
      if (o.stanje === "nadjeno") z[o.izvor === "izdavac" ? "sajt" : o.izvor === "delfi" ? "delfi" : "ol"]++;
      else z.nije++;
      grupe.set(g, z);
    }
    const redom = [...grupe].sort((a, b) => b[1].n - a[1].n);
    console.log("\n── Po izdavaču (obrađeno | sajt izdavača | Delfi | Open Library | nije nađeno)");
    for (const [g, z] of redom.slice(0, 25)) console.log(`   ${skrati(g, 38).padEnd(38)} ${String(z.n).padStart(4)} | ${String(z.sajt).padStart(4)} | ${String(z.delfi).padStart(4)} | ${String(z.ol).padStart(4)} | ${String(z.nije).padStart(4)}${z.podrzan ? "" : "   (izdavač bez podrške u skripti)"}`);
    if (redom.length > 25) console.log(`   … još ${redom.length - 25} izdavača`);
    const bez = redom.filter(([, z]) => !z.podrzan);
    console.log(`\n── Izdavači BEZ podrške u skripti, u ovom uzorku (${bez.length}): kandidati za proveru robots.txt-a i pretrage po ISBN-u`);
    if (!bez.length) console.log("   nijedan");
    for (const [g, z] of bez.slice(0, 20)) console.log(`   ${skrati(g, 50)}: ${z.n} knjiga`);
  }

  // ista slika kod više knjiga je verovatno zamenska slika (npr. „nema korice“): proveriti pre upisa
  const poSlici = new Map();
  for (const { o } of po("nadjeno")) poSlici.set(o.korica, (poSlici.get(o.korica) ?? 0) + 1);
  const ponovljene = [...poSlici].filter(([, n]) => n > 1);
  if (ponovljene.length) {
    console.log(`\n── UPOZORENJE: ista slika kod više knjiga (moguća zamenska slika), proverite pre upisa (${ponovljene.length})`);
    for (const [a, n] of ponovljene.slice(0, PRIMERA)) console.log(`   ${n}× ${a}`);
  }

  console.log(`\n── Primeri nađenog (prvih ${PRIMERA})`);
  if (!po("nadjeno").length) console.log("   nijedan");
  for (const { k, o } of po("nadjeno").slice(0, PRIMERA)) console.log(`   ${skrati(k.naslov)}${SVE ? ` | ${o.grupa}` : ""}\n      izvor: ${o.izvor ?? o.izvorSlike ?? "izdavac"} | stranica: ${o.stranica ?? "—"} (poklapanje: ${o.po ?? "isbn"})\n      korica:   ${o.korica} (${o.tip.mime}, ${o.bajtova} B)`);

  for (const [s, naslov] of [["nije_nadjeno", "Nije nađeno"], ["ne_odgovara", "Stranica ne odgovara knjizi (preskočeno)"], ["bez_korice", "Stranica bez upotrebljive korice"], ["slika_neupotrebljiva", "Slika neupotrebljiva"], ["greska", "Greške"]]) {
    const l = po(s);
    if (!l.length) continue;
    console.log(`\n── ${naslov} (${l.length})${l.length > PRIMERA * 2 ? `, prvih ${PRIMERA * 2}` : ""}`);
    for (const { k, o } of l.slice(0, PRIMERA * 2)) console.log(`   ${skrati(k.naslov)} | ISBN ${k.isbn ?? "—"}${o.razlog ? ` | ${o.razlog}` : ""}`);
  }

  if (prekid) {
    console.error(`\nPREKINUTO: ${prekid}`);
    return 4;
  }
  if (!UPISI) console.log("\nPROBNI REŽIM: ništa nije upisano. Za upis pokrenite sa --upisi.");
  return 0;
}

let kod = 1;
try {
  kod = await main();
} catch (e) {
  sacuvajStanje();
  console.error(`Greška: ${bezTajni(e?.message ?? e)}`);
}
process.exitCode = kod;
