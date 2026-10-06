// Test api/ funkcija: potpuno van mreže i bez ikakvih pravih ključeva.
//
//   npm run test:api
//
// Šta se proverava:
//   - bezbednosna pravila iz-linka (https, bela lista, privatne adrese, DNS
//     zaštita, preusmeravanja);
//   - parser stranica na uzorcima po obrascima iz starog parsera;
//   - normalizacija Google Books odgovora;
//   - sami handleri (api/pretraga-google.js, api/iz-linka.js) protiv lažnog
//     Supabase-a u ovom fajlu: 401/403/429, ograničenje, keš, zatvoreno kad
//     baza nije dostupna.
// Spoljni sajtovi i Google se ne zovu: odgovori se podmeću.

import http from "node:http";
import { randomUUID } from "node:crypto";

// ───────────────────────── lažni Supabase ─────────────────────────

const KLJUC_ANON = "lazni-anon-kljuc-xyz";
const KLJUC_SERVIS = "lazni-servisni-kljuc-xyz";
const KLJUC_GOOGLE = "lazni-google-kljuc-xyz";
const TAJNE = [KLJUC_ANON, KLJUC_SERVIS, KLJUC_GOOGLE];

const CLANOVI = {
  "tok-a": { id: randomUUID(), aktivan: true },
  "tok-b": { id: randomUUID(), aktivan: true },
  "tok-neaktivan": { id: randomUUID(), aktivan: false },
};
const stanje = { brojac: new Map(), kes: new Map(), zahteviKaBazi: 0, rpcGreska: false, rpcPozivi: 0 };

const lazniSupabase = http.createServer((req, res) => {
  let telo = "";
  req.on("data", (d) => (telo += d));
  req.on("end", () => {
    stanje.zahteviKaBazi++;
    const url = new URL(req.url, "http://x");
    const odgovori = (kod, o) => {
      res.writeHead(kod, { "Content-Type": "application/json" });
      res.end(o === undefined ? "" : JSON.stringify(o));
    };
    const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1];
    const clan = CLANOVI[token];
    const objekat = (req.headers.accept ?? "").includes("vnd.pgrst.object");

    if (url.pathname === "/auth/v1/user") {
      return clan
        ? odgovori(200, { id: clan.id, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() })
        : odgovori(401, { code: 401, error_code: "bad_jwt", msg: "invalid JWT" });
    }
    if (url.pathname === "/rest/v1/clanovi") {
      const id = (url.searchParams.get("id") ?? "").replace("eq.", "");
      const red = Object.values(CLANOVI).find((c) => c.id === id);
      const odgovor = red ? { id: red.id, aktivan: red.aktivan } : null;
      return objekat ? (odgovor ? odgovori(200, odgovor) : odgovori(406, { code: "PGRST116" })) : odgovori(200, odgovor ? [odgovor] : []);
    }
    if (url.pathname === "/rest/v1/rpc/uzmi_zahtev") {
      stanje.rpcPozivi++;
      // Samo servisni ključ sme da zove ovu funkciju (kao u bazi).
      if (!(req.headers.authorization ?? "").includes(KLJUC_SERVIS)) return odgovori(401, { code: "42501", message: "permission denied" });
      if (stanje.rpcGreska) return odgovori(500, { code: "XX000", message: "baza ne radi" });
      const b = JSON.parse(telo);
      const n = stanje.brojac.get(b.p_clan) ?? 0;
      if (n >= b.p_najvise) return odgovori(200, { dozvoljeno: false, preostalo: 0, ponovo_za_sekundi: 1234 });
      stanje.brojac.set(b.p_clan, n + 1);
      return odgovori(200, { dozvoljeno: true, preostalo: b.p_najvise - n - 1, ponovo_za_sekundi: 0 });
    }
    if (url.pathname === "/rest/v1/kes_linkova") {
      if (!(req.headers.authorization ?? "").includes(KLJUC_SERVIS)) return odgovori(401, { code: "42501", message: "permission denied" });
      if (req.method === "POST") {
        const b = JSON.parse(telo);
        stanje.kes.set(b.url, b.odgovor);
        return odgovori(201);
      }
      if (req.method === "DELETE") return odgovori(204);
      const kljuc = decodeURIComponent((url.searchParams.get("url") ?? "").replace("eq.", ""));
      const odgovor = stanje.kes.has(kljuc) ? { odgovor: stanje.kes.get(kljuc) } : null;
      return objekat ? (odgovor ? odgovori(200, odgovor) : odgovori(406, { code: "PGRST116" })) : odgovori(200, odgovor ? [odgovor] : []);
    }
    return odgovori(404, { message: `nije implementirano: ${url.pathname}` });
  });
});
await new Promise((r) => lazniSupabase.listen(0, "127.0.0.1", r));
const PORT = lazniSupabase.address().port;

// Okruženje se postavlja PRE uvoza modula; ni jedna prava vrednost se ne koristi.
process.env.VITE_SUPABASE_URL = `http://127.0.0.1:${PORT}`;
process.env.SUPABASE_ANON_KEY = KLJUC_ANON;
process.env.SUPABASE_SERVICE_ROLE_KEY = KLJUC_SERVIS;
delete process.env.VITE_SUPABASE_ANON_KEY;
delete process.env.GOOGLE_BOOKS_API_KEY;
delete process.env.ZAHTEVI_BEZ_BAZE;
delete process.env.VERCEL_ENV;

const { ApiGreska } = await import("../api/_lib/greska.js");
const bf = await import("../api/_lib/bezbedan-fetch.js");
const parser = await import("../api/_lib/parser-knjige.js");
const gb = await import("../api/_lib/google-books.js");
const { kljucKesa } = await import("../api/_lib/kes.js");
const { uIsbn13, ocistiIsbn } = await import("../src/lib/isbn.js");
const googleHandler = (await import("../api/pretraga-google.js")).default;
const linkHandler = (await import("../api/iz-linka.js")).default;

// ───────────────────────── ispis ─────────────────────────

let pass = 0;
let fail = 0;
const bezTajni = (t) => TAJNE.reduce((s, k) => s.split(k).join("***"), String(t));
function provera(naziv, uslov, detalj) {
  if (uslov) {
    pass++;
    console.log(`PASS  ${naziv}`);
  } else {
    fail++;
    console.log(`FAIL  ${naziv}`);
    if (detalj !== undefined) console.log(`        -> ${bezTajni(typeof detalj === "string" ? detalj : JSON.stringify(detalj)).slice(0, 400)}`);
  }
}
const faza = (n) => console.log(`\n── ${n}`);
async function baca(fn) {
  try {
    await fn();
    return null;
  } catch (e) {
    return e;
  }
}

// ───────────────────────── 1. adrese i domeni ─────────────────────────
faza("1. Adrese: samo https i samo bela lista");

const OBAVEZNO_ODBIJENO = {
  "http://laguna.rs/x": "nije_https",
  "ftp://laguna.rs/x": "nije_https",
  "javascript:alert(1)": "nije_https",
  "https://localhost/x": "domen_nije_dozvoljen",
  "https://127.0.0.1/x": "domen_nije_dozvoljen",
  "https://10.0.0.5/x": "domen_nije_dozvoljen",
  "https://169.254.169.254/latest/meta-data": "domen_nije_dozvoljen",
  "https://[::1]/x": "domen_nije_dozvoljen",
  "https://[::ffff:127.0.0.1]/x": "domen_nije_dozvoljen",
  "https://2130706433/x": "domen_nije_dozvoljen", // 127.0.0.1 kao jedan broj
  "https://0x7f000001/x": "domen_nije_dozvoljen", // heksadecimalno
  "https://user:lozinka@laguna.rs/x": "neispravan_link",
  "https://laguna.rs@evil.com/x": "neispravan_link", // userinfo trik: pravi domen je evil.com
  "https://laguna.rs:8443/x": "neispravan_link",
  "https://evil-laguna.rs/x": "domen_nije_dozvoljen",
  "https://laguna.rs.evil.com/x": "domen_nije_dozvoljen",
  "https://evil.com/laguna.rs": "domen_nije_dozvoljen",
  "https://evil.com#@laguna.rs": "domen_nije_dozvoljen",
  "https://example.com/": "domen_nije_dozvoljen",
  "https://laguna.rs./x": "domen_nije_dozvoljen", // domen sa tačkom na kraju
  "": "neispravan_link",
  "nije adresa": "neispravan_link",
};
for (const [adresa, kod] of Object.entries(OBAVEZNO_ODBIJENO)) {
  const e = await baca(() => bf.proveriUrl(adresa));
  provera(`odbijeno: ${JSON.stringify(adresa)} (${kod})`, e instanceof ApiGreska && e.kod === kod, e ? `${e.kod}` : "propušteno");
}
for (const adresa of [
  "https://laguna.rs/knjiga/1", "https://www.laguna.rs/knjiga/1", "https://LAGUNA.RS/x", "https://shop.vulkani.rs/x?a=1",
  "https://laguna.rs:443/x", "https://www.delfi.rs/knjige/123-naslov", "https://geopoetika.com/x",
]) {
  const e = await baca(() => bf.proveriUrl(adresa));
  provera(`propušteno: ${adresa}`, e === null, e?.kod);
}

faza("2. IP adrese: javne se propuštaju, sve ostalo ne");
const JAVNE = ["8.8.8.8", "93.86.100.1", "172.15.0.1", "172.32.0.1", "100.63.0.1", "100.128.0.1", "2a00:1450:4001::1", "2606:4700::1111"];
const PRIVATNE = [
  "0.0.0.0", "10.1.2.3", "127.0.0.1", "127.255.255.255", "169.254.169.254", "172.16.0.1", "172.31.255.255", "192.168.1.1",
  "100.64.0.1", "100.127.255.255", "192.0.0.1", "192.0.2.1", "198.18.0.1", "198.51.100.1", "203.0.113.1", "224.0.0.1", "255.255.255.255",
  "::", "::1", "fe80::1", "fc00::1", "fd12:3456::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "64:ff9b::7f00:1", "2001:db8::1", "2001::1", "2002:7f00:1::",
  "nije-ip", "",
];
for (const ip of JAVNE) provera(`javna: ${ip}`, bf.jeJavnaAdresa(ip) === true);
for (const ip of PRIVATNE) provera(`nije javna: ${JSON.stringify(ip)}`, bf.jeJavnaAdresa(ip) === false);

faza("3. DNS zaštita (pravi lookup: localhost se razrešava na 127.0.0.1)");
{
  const odgovor = await new Promise((resolve) => bf.lookupZasticen("localhost", {}, (err, a) => resolve({ err, a })));
  provera("lookupZasticen odbija domen koji se razrešava na privatnu adresu", odgovor.err instanceof ApiGreska && odgovor.err.kod === "domen_nije_dozvoljen" && !odgovor.a, odgovor.err?.message);
  // Pravi zahtev ka localhost: mora da pukne na lookup-u, pre nego što se otvori veza.
  const e = await baca(() => bf.unutrasnje.jedanZahtev(new URL("https://localhost/"), { accept: "text/html", tipovi: ["text/html"], najviseBajtova: 1000 }, 3000));
  provera("jedanZahtev ka localhost se odbija pre povezivanja", e instanceof ApiGreska && e.kod === "domen_nije_dozvoljen", e?.kod ?? e?.message);
}

// ───────────────────────── 4. preusmeravanja i ograničenja ─────────────────────────
faza("4. Preusmeravanja, rok i veličina");

const original = bf.unutrasnje.jedanZahtev;
function podmetni(odgovori) {
  const pozivi = [];
  bf.unutrasnje.jedanZahtev = async (u) => {
    pozivi.push(u.href);
    const o = odgovori[u.href];
    if (!o) throw new Error(`neočekivan zahtev: ${u.href}`);
    return typeof o === "function" ? o() : o;
  };
  return pozivi;
}
const stranica = (html) => ({ status: 200, tip: "text/html; charset=utf-8", telo: Buffer.from(html) });

let pozivi = podmetni({ "https://laguna.rs/a": { status: 302, preusmerenje: "/b" }, "https://laguna.rs/b": stranica("<title>Cilj</title>") });
let r = await baca(() => bf.preuzmi("https://laguna.rs/a"));
provera("preusmeravanje unutar iste bele liste se prati (relativna adresa)", r === null && pozivi.join() === "https://laguna.rs/a,https://laguna.rs/b", pozivi);

podmetni({ "https://laguna.rs/a": { status: 302, preusmerenje: "https://evil.com/steal" } });
r = await baca(() => bf.preuzmi("https://laguna.rs/a"));
provera("preusmeravanje van bele liste se odbija", r?.kod === "preusmerenje_van_liste", r?.kod);

pozivi = podmetni({ "https://laguna.rs/a": { status: 302, preusmerenje: "http://laguna.rs/b" } });
r = await baca(() => bf.preuzmi("https://laguna.rs/a"));
provera("preusmeravanje na http se odbija (i ne ide mreža)", r?.kod === "preusmerenje_van_liste" && pozivi.length === 1, r?.kod);

podmetni({ "https://laguna.rs/a": { status: 302, preusmerenje: "https://127.0.0.1/admin" } });
r = await baca(() => bf.preuzmi("https://laguna.rs/a"));
provera("preusmeravanje na IP adresu se odbija", r?.kod === "preusmerenje_van_liste", r?.kod);

podmetni({ "https://laguna.rs/a": { status: 302, preusmerenje: "https://laguna.rs@evil.com/" } });
r = await baca(() => bf.preuzmi("https://laguna.rs/a"));
provera("preusmeravanje sa userinfo trikom se odbija", r?.kod === "preusmerenje_van_liste", r?.kod);

pozivi = podmetni(Object.fromEntries([0, 1, 2, 3, 4, 5].map((i) => [`https://laguna.rs/${i}`, { status: 302, preusmerenje: `/${i + 1}` }])));
r = await baca(() => bf.preuzmi("https://laguna.rs/0"));
provera("više od 3 preusmeravanja se prekida", r?.kod === "previse_preusmeravanja" && pozivi.length === 4, { kod: r?.kod, pozivi: pozivi.length });

podmetni({ "https://laguna.rs/x": { status: 404 } });
r = await baca(() => bf.preuzmi("https://laguna.rs/x"));
provera("HTTP 404 sajta daje ne_mogu_da_procitam", r?.kod === "ne_mogu_da_procitam", r?.kod);

podmetni({ "https://laguna.rs/x": () => { throw new ApiGreska(422, "nije_stranica", "pdf"); } });
r = await baca(() => bf.preuzmi("https://laguna.rs/x"));
provera("neočekivan tip sadržaja se prosleđuje kao greška", r?.kod === "nije_stranica", r?.kod);

const dugacko = (ms) => () => new Promise((resolve, reject) => setTimeout(() => reject(new ApiGreska(504, "predugo", "rok")), ms));
podmetni({ "https://laguna.rs/x": dugacko(5) });
r = await baca(() => bf.preuzmi("https://laguna.rs/x"));
provera("rok se prosleđuje kao 504 predugo", r?.kod === "predugo" && r.status === 504, r?.kod);

provera("ograničenja: rok 8 s, najviše 3 preusmeravanja, 1.5 MB", bf.OGRANICENJA.rokMs === 8000 && bf.OGRANICENJA.najvisePreusmeravanja === 3 && bf.OGRANICENJA.najviseBajtova === 1_500_000, bf.OGRANICENJA);

{
  const w1250 = Buffer.from([0x3c, 0x74, 0x69, 0x74, 0x6c, 0x65, 0x3e, 0xe8, 0xe6, 0x9a, 0x9e, 0xf0, 0x3c, 0x2f, 0x74, 0x69, 0x74, 0x6c, 0x65, 0x3e]); // <title>čćšžđ</title> u windows-1250
  provera("windows-1250 stranica se ispravno dekoduje (zaglavlje)", bf.dekodujTelo(w1250, "text/html; charset=windows-1250") === "<title>čćšžđ</title>", bf.dekodujTelo(w1250, "text/html; charset=windows-1250"));
  const sMeta = Buffer.concat([Buffer.from('<meta charset="windows-1250">'), w1250]);
  provera("windows-1250 se prepoznaje i iz <meta charset>", bf.dekodujTelo(sMeta, "text/html").includes("čćšžđ"));
  provera("nepoznat charset pada na utf-8, ne baca grešku", typeof bf.dekodujTelo(Buffer.from("abc"), "text/html; charset=nema-tog") === "string");
}
bf.unutrasnje.jedanZahtev = original;

// ───────────────────────── 5. parser ─────────────────────────
faza("5. Parser stranica (obrasci iz starog parsera)");

const U = "https://www.laguna.rs/knjiga/1";
const jsonLd = (o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`;

let p = parser.izvuciIzHtmla(
  `<html><head>${jsonLd({ "@context": "https://schema.org", "@type": "Book", name: "Na Drini ćuprija", author: { "@type": "Person", name: "Ivo Andrić" },
    publisher: { "@type": "Organization", name: "Vulkan" }, isbn: "978-86-521-2603-3", datePublished: "2019-05-01", description: "Roman o mostu.", image: "https://cdn.laguna.rs/k.jpg" })}</head><body></body></html>`,
  "https://www.vulkani.rs/knjiga/1"
);
provera("JSON-LD Book: naslov, autor, izdavač, ISBN-13, godina, opis, korica",
  p.naslov === "Na Drini ćuprija" && p.autori.join() === "Ivo Andrić" && p.isbn === "9788652126033" && p.godina === 2019 && p.opis === "Roman o mostu." && p.korica === "https://cdn.laguna.rs/k.jpg" && p.izvorPodataka === "json-ld", p);
provera("poznati preprodavac (vulkani.rs) ima prednost nad izdavačem iz JSON-LD-a", p.izdavac === "Vulkan izdavaštvo", p.izdavac);

p = parser.izvuciIzHtmla(`<html><head>${jsonLd({ "@graph": [{ "@type": "WebSite", name: "Sajt" }, { "@type": ["Product", "Book"], name: "Seobe", author: [{ name: "Miloš Crnjanski" }, "Drugi Autor"], workExample: [{ isbn: "0-306-40615-2" }] }] })}</head></html>`, U);
provera("JSON-LD u @graph, @type kao niz, više autora, ISBN-10 iz workExample se pretvara u ISBN-13",
  p.naslov === "Seobe" && p.autori.join("|") === "Miloš Crnjanski|Drugi Autor" && p.isbn === "9780306406157", p);

p = parser.izvuciIzHtmla(
  `<html><head>${jsonLd({ "@type": "Book", name: "Laguna - Prokleta avlija - Ivo Andrić - Knjige za sve" })}<title>x</title></head><body><h1>Prokleta avlija</h1></body></html>`, U);
provera("naslov „sajt - naslov - autor - slogan” se čisti preko <h1> (Laguna obrazac)", p.naslov === "Prokleta avlija", p.naslov);

p = parser.izvuciIzHtmla(
  `<html><head><title>Bajka</title></head><body><h1>Bajka</h1><div class="info"><span>Autor: Desanka Maksimović<br>Ilustrator: Neko Drugi<br>Izdavač: Kreativni centar</span></div></body></html>`,
  "https://kreativnicentar.rs/bajka");
provera("oznake „Autor:” i „Izdavač:” (vrednost kao tekst) u istom elementu razdvojene sa <br>", p.autori.join() === "Desanka Maksimović" && p.izdavac === "Kreativni centar", p);

p = parser.izvuciIzHtmla(
  `<html><body><h1>Bajka</h1><div><span>Autor: <a href="/a">Desanka Maksimović</a><br>Ilustrator: <a href="/i">Neko Drugi</a><br>Izdavač: <a href="/z">Dereta</a></span></div></body></html>`,
  "https://www.laguna.rs/bajka");
provera("kreativnicentar obrazac: „Autor: <a>…</a><br>Ilustrator: <a>…</a>” uzima autora, ne ilustratora", p.autori.join() === "Desanka Maksimović" && p.izdavac === "Dereta", p);

p = parser.izvuciIzHtmla(`<html><body><h1>Pesme</h1><div><span>Аутор:</span> <a href="/a">Јован Дучић</a></div></body></html>`, U);
provera("ćirilična oznaka „Аутор:” sa vrednošću u susednom <a>", p.autori.join() === "Јован Дучић", p.autori);

p = parser.izvuciIzHtmla(`<html><body><h1>Zlatni znak</h1><h3 class="product-authors"><a title="Ivo Andrić" href="/a">I. A.</a></h3></body></html>`, U);
provera("autor preko CSS klase product-authors (title atributa ima prednost)", p.autori.join() === "Ivo Andrić", p.autori);

p = parser.izvuciIzHtmla(
  `<html><head><meta property="og:title" content="Gospođica - Ivo Andrić | Delfi"><meta property="og:site_name" content="laguna.rs"><meta property="og:image" content="/slike/g.jpg"><meta property="og:description" content="Opis knjige."></head><body></body></html>`, U);
provera("Open Graph: „Naslov - Autor | Sajt” se razdvaja, goli domen kao izdavač gubi nastavak, relativna og:image postaje https",
  p.naslov === "Gospođica" && p.autori.join() === "Ivo Andrić" && p.izdavac === "laguna" && p.korica === "https://www.laguna.rs/slike/g.jpg" && p.opis === "Opis knjige.", p);

p = parser.izvuciIzHtmla(`<html><head><meta property="og:title" content="Knjiga"><meta property="og:image" content="http://cdn.laguna.rs/nesigurno.jpg"></head></html>`, U);
provera("http korica se odbacuje (samo https)", p.korica === null, p.korica);

p = parser.izvuciIzHtmla(`<html><head><title>Seobe | Laguna</title></head><body><p>Nema ničeg drugog.</p></body></html>`, U);
provera("samo <title>: vraća bar naslov, nikad prazan rezultat", p.naslov === "Seobe" && p.izvorPodataka === "title", p);

p = parser.izvuciIzHtmla(`<html><head><title>Pčelica - Branko Ćopić</title></head><body></body></html>`, "https://pcelica.rs/p");
provera("<title> „Naslov - Autor” daje i autora; pcelica.rs fiksira izdavača", p.naslov === "Pčelica" && p.autori.join() === "Branko Ćopić" && p.izdavac === "Pčelica Izdavaštvo", p);

{
  const e = await baca(() => parser.izvuciIzLinka("https://www.laguna.rs/x", { preuzmiFn: async () => ({ url: new URL("https://www.laguna.rs/x"), telo: "<html><body></body></html>" }) }));
  provera("stranica bez ikakvih podataka daje nema_podataka (ne prazan rezultat)", e?.kod === "nema_podataka", e?.kod);
  const ok = await parser.izvuciIzLinka("https://www.laguna.rs/x", { preuzmiFn: async () => ({ url: new URL("https://www.laguna.rs/x"), telo: "<title>Samo naslov</title>" }) });
  provera("izvuciIzLinka vraća normalizovan oblik (izvor 'link', autori niz)", ok.izvor === "link" && Array.isArray(ok.autori) && ok.naslov === "Samo naslov" && ok.url === "https://www.laguna.rs/x", ok);
}
{
  const dugacak = "x".repeat(5000);
  const n = parser.urediRezultat({ naslov: dugacak, autori: Array(30).fill("A"), izdavac: dugacak, opis: dugacak, godina: 3000, isbn: null, korica: null }, U);
  provera("rezultat je ograničen po dužini (naslov 300, opis 2000, najviše 10 autora, godina van opsega se odbacuje)",
    n.naslov.length === 300 && n.opis.length === 2000 && n.autori.length === 10 && n.godina === null && n.izdavac.length === 150, { naslov: n.naslov.length, opis: n.opis.length, autori: n.autori.length, godina: n.godina });
}
{
  // Delfi: API put (JSON), pa rezerva na HTML
  const putevi = [];
  const delfi = await parser.izvuciIzLinka("https://www.delfi.rs/knjige/321-prokleta-avlija", {
    preuzmiFn: async (adresa) => {
      putevi.push(adresa);
      return { url: new URL(adresa), telo: JSON.stringify({ data: { product: { title: "Prokleta avlija", authors: [{ authorName: "Ivo Andrić" }], isbn: "9788652126033" } } }) };
    },
  });
  provera("Delfi: čita se JSON API (ne HTML), izdavač je Delfi", putevi[0] === "https://delfi.rs/api/pc-frontend-api/overview/321" && delfi.naslov === "Prokleta avlija" && delfi.autori.join() === "Ivo Andrić" && delfi.izdavac === "Delfi" && delfi.isbn === "9788652126033", { putevi, delfi });
  const delfiRezerva = await parser.izvuciIzLinka("https://www.delfi.rs/knjige/321-prokleta-avlija", {
    preuzmiFn: async (adresa) => {
      if (adresa.includes("/api/")) throw new ApiGreska(502, "ne_mogu_da_procitam", "api pao");
      return { url: new URL(adresa), telo: "<title>Prokleta avlija - Ivo Andrić | Delfi</title>" };
    },
  });
  provera("Delfi: ako API padne, pada se na HTML (rezerva kao u starom parseru)", delfiRezerva.naslov === "Prokleta avlija" && delfiRezerva.izvor === "link", delfiRezerva);
}

// ───────────────────────── 6. ISBN i ključ keša ─────────────────────────
faza("6. ISBN i ključ keša");
provera("ISBN-13 sa crticama se čisti", ocistiIsbn("978-86-521-2603-3") === "9788652126033");
provera("ISBN-10 se pretvara u ISBN-13", uIsbn13("0-306-40615-2") === "9780306406157", uIsbn13("0-306-40615-2"));
provera("ISBN-10 sa X na kraju je ispravan (0-8044-2957-X)", uIsbn13("0-8044-2957-X") === "9780804429573", uIsbn13("0-8044-2957-X"));
provera("neispravan kontrolni broj se odbija", uIsbn13("978-86-521-2603-4") === null);
provera("vodeća nula ISBN-a se čuva kao tekst", uIsbn13("0306406152")?.startsWith("978030") && typeof uIsbn13("0306406152") === "string");
provera("prazno i smeće nisu ISBN", uIsbn13("") === null && uIsbn13(null) === null && uIsbn13("abc") === null);
provera("ključ keša: bez # i praćenja (utm_, fbclid), host malim slovima, isti redosled parametara",
  kljucKesa("https://LAGUNA.rs/k?b=2&utm_source=x&a=1&fbclid=z#deo") === "https://laguna.rs/k?a=1&b=2", kljucKesa("https://LAGUNA.rs/k?b=2&utm_source=x&a=1&fbclid=z#deo"));

// ───────────────────────── 7. Google Books ─────────────────────────
faza("7. Google Books: upit i normalizacija");

const bacaUpit = (ulaz) => { try { return gb.napraviUpit(ulaz); } catch (e) { return e; } };
provera("ISBN ima prednost i postaje ISBN-13", bacaUpit({ isbn: "0-306-40615-2", naslov: "x" }) === "isbn:9780306406157", bacaUpit({ isbn: "0-306-40615-2", naslov: "x" }));
provera("slobodan upit koji je ISBN ide kao ISBN", bacaUpit({ q: "978-86-521-2603-3" }) === "isbn:9788652126033");
provera("naslov i autor su fraze u navodnicima", bacaUpit({ naslov: "Na Drini ćuprija", autor: "Andrić" }) === 'intitle:"Na Drini ćuprija" inauthor:"Andrić"', bacaUpit({ naslov: "Na Drini ćuprija", autor: "Andrić" }));
provera("navodnici i kontrolni znaci iz unosa se uklanjaju (ne mogu da razbiju upit)", bacaUpit({ naslov: 'a" OR intitle:"b\nc' }) === 'intitle:"a OR intitle: b c"', bacaUpit({ naslov: 'a" OR intitle:"b\nc' }));
provera("ispravan ISBN koji nije ISBN daje neispravan_isbn", bacaUpit({ isbn: "12345" })?.kod === "neispravan_isbn");
provera("prazan upit daje prazan_upit", bacaUpit({ naslov: "  ", autor: "" })?.kod === "prazan_upit");
provera("predugačak unos se odbija", bacaUpit({ naslov: "x".repeat(151) })?.kod === "neispravan_upit");

const STAVKA = {
  id: "abc",
  volumeInfo: {
    title: "Na Drini ćuprija", subtitle: "roman", authors: ["Ivo Andrić"], publisher: "Laguna", publishedDate: "2019-03",
    description: "<p>Roman o <b>mostu</b> &amp; ljudima.</p><br>Drugi red.",
    industryIdentifiers: [{ type: "ISBN_10", identifier: "8652126035" }, { type: "ISBN_13", identifier: "9788652126033" }],
    imageLinks: { smallThumbnail: "http://books.google.com/small.jpg", thumbnail: "http://books.google.com/books/content?id=abc&printsec=frontcover&img=1&zoom=1&edge=curl&source=gbs_api" },
    infoLink: "https://books.google.com/books?id=abc",
  },
};
let n = gb.normalizujStavku(STAVKA);
provera("normalizacija: naslov+podnaslov, autori, izdavač, godina, ISBN-13, https korica bez 'edge', veza ka Google zapisu",
  n.naslov === "Na Drini ćuprija: roman" && n.autori.join() === "Ivo Andrić" && n.izdavac === "Laguna" && n.godina === 2019 && n.isbn === "9788652126033" &&
  n.korica === "https://books.google.com/books/content?id=abc&printsec=frontcover&img=1&zoom=1&source=gbs_api" && n.url === "https://books.google.com/books?id=abc" && n.izvor === "google_books", n);
provera("opis je bez HTML oznaka i sa raspakovanim entitetima", n.opis === "Roman o mostu & ljudima. Drugi red.", n.opis);
n = gb.normalizujStavku({ volumeInfo: { title: "Samo naslov", imageLinks: { thumbnail: "https://evil.com/slika.jpg" } } });
provera("korica sa tuđeg domena se odbacuje; nedostajuća polja su prazna, ne greška", n.korica === null && n.isbn === null && n.godina === null && n.autori.length === 0 && n.izdavac === "", n);
provera("stavka bez naslova se preskače", gb.normalizujStavku({ volumeInfo: {} }) === null);

// ───────────────────────── 8. handleri ─────────────────────────
faza("8. Handleri protiv lažnog Supabase-a");

async function zovi(handler, { metod = "POST", token, telo = {} } = {}) {
  const req = { method: metod, headers: token ? { authorization: `Bearer ${token}` } : {}, body: telo };
  const zaglavlja = {};
  let kod = 0;
  let sadrzaj = "";
  const res = {
    set statusCode(v) { kod = v; },
    get statusCode() { return kod; },
    setHeader(k, v) { zaglavlja[k.toLowerCase()] = v; },
    end(t) { sadrzaj = t ?? ""; },
  };
  await handler(req, res);
  return { status: kod, zaglavlja, telo: sadrzaj ? JSON.parse(sadrzaj) : null, sirovo: sadrzaj };
}
const sviOdgovori = [];
const z = async (...a) => { const o = await zovi(...a); sviOdgovori.push(o.sirovo + JSON.stringify(o.zaglavlja)); return o; };

// Google: podmetnut fetch; sve ostalo (lažni Supabase) ide dalje na pravi fetch.
const pravi = globalThis.fetch;
const googleZahtevi = [];
let googleOdgovor = () => new Response(JSON.stringify({ items: [STAVKA, STAVKA] }), { status: 200 });
globalThis.fetch = (ulaz, ...ostalo) => {
  const adresa = String(ulaz?.url ?? ulaz);
  if (adresa.startsWith("https://www.googleapis.com/")) {
    googleZahtevi.push(adresa);
    return Promise.resolve(googleOdgovor());
  }
  return pravi(ulaz, ...ostalo);
};

let o = await z(googleHandler, { metod: "GET", token: "tok-a" });
provera("GET daje 405 sa Allow: POST", o.status === 405 && o.zaglavlja.allow === "POST", o.status);

let pre = stanje.zahteviKaBazi;
o = await z(googleHandler, { telo: { naslov: "x" } });
provera("bez Authorization zaglavlja: 401, i baza se uopšte ne zove", o.status === 401 && o.telo.greska.kod === "nije_prijavljen" && stanje.zahteviKaBazi === pre, { status: o.status, baza: stanje.zahteviKaBazi - pre });
o = await z(linkHandler, { telo: { url: "https://laguna.rs/x" } });
provera("iz-linka bez prijave: 401", o.status === 401, o.status);
for (const zaglavlje of ["Basic abc", "Bearer", "Bearer ", "bearer tok a", "Token tok-a"]) {
  const req = { method: "POST", headers: { authorization: zaglavlje }, body: { naslov: "x" } };
  let kod = 0;
  await googleHandler(req, { set statusCode(v) { kod = v; }, setHeader() {}, end() {} });
  provera(`neispravno zaglavlje ${JSON.stringify(zaglavlje)}: 401`, kod === 401, kod);
}
o = await z(googleHandler, { token: KLJUC_ANON, telo: { naslov: "x" } });
provera("sam anon ključ kao token nije prijava: 401", o.status === 401 && o.telo.greska.kod === "nije_prijavljen", o.status);
o = await z(googleHandler, { token: "istekao.ili.lazan", telo: { naslov: "x" } });
provera("nevažeći token: 401", o.status === 401, o.status);
o = await z(googleHandler, { token: "tok-neaktivan", telo: { naslov: "x" } });
provera("prijavljen, ali neaktivan član: 403", o.status === 403 && o.telo.greska.kod === "clanstvo_nije_aktivno", o.status);
provera("do ovog mesta ni jedan zahtev nije potrošio ograničenje", stanje.rpcPozivi === 0, stanje.rpcPozivi);

o = await z(googleHandler, { token: "tok-a", telo: {} });
provera("prazno telo: 400, a ograničenje se ne troši", o.status === 400 && o.telo.greska.kod === "prazan_upit" && stanje.rpcPozivi === 0, { status: o.status, rpc: stanje.rpcPozivi });
o = await z(googleHandler, { token: "tok-a", telo: { naslov: 5 } });
provera("polje koje nije tekst: 400", o.status === 400 && o.telo.greska.kod === "neispravan_zahtev", o.status);
o = await z(googleHandler, { token: "tok-a", telo: { isbn: "12345" } });
provera("neispravan ISBN: 400 i ne zove se Google", o.status === 400 && o.telo.greska.kod === "neispravan_isbn" && googleZahtevi.length === 0, { status: o.status, google: googleZahtevi.length });

o = await z(googleHandler, { token: "tok-a", telo: { naslov: "Na Drini ćuprija" } });
provera("Google pretraga: 200, rezultati su normalizovani i bez duplikata", o.status === 200 && o.telo.rezultati.length === 1 && o.telo.rezultati[0].izvor === "google_books" && o.telo.rezultati[0].isbn === "9788652126033", o.telo);
provera("bez ključa se ne šalje parametar key", !googleZahtevi.at(-1).includes("key="), googleZahtevi.at(-1));
provera("odgovor javlja koliko je zahteva preostalo (30 minus potrošeno)", o.zaglavlja["x-ratelimit-remaining"] === String(30 - stanje.brojac.get(CLANOVI["tok-a"].id)), { zaglavlje: o.zaglavlja["x-ratelimit-remaining"], potroseno: stanje.brojac.get(CLANOVI["tok-a"].id) });

process.env.GOOGLE_BOOKS_API_KEY = KLJUC_GOOGLE;
o = await z(googleHandler, { token: "tok-a", telo: { isbn: "9788652126033" } });
provera("sa ključem se šalje key=, a ključ nikad ne dospeva u odgovor", googleZahtevi.at(-1).includes(`key=${KLJUC_GOOGLE}`) && !o.sirovo.includes(KLJUC_GOOGLE), googleZahtevi.at(-1)?.replace(KLJUC_GOOGLE, "***"));
delete process.env.GOOGLE_BOOKS_API_KEY;

googleOdgovor = () => new Response(JSON.stringify({ error: { code: 429 } }), { status: 429 });
o = await z(googleHandler, { token: "tok-a", telo: { naslov: "x" } });
provera("Google 429 bez ključa: google_nije_podeseno (kvota za anonimne je 0, treba ključ)", o.status === 503 && o.telo.greska.kod === "google_nije_podeseno", o.telo);
process.env.GOOGLE_BOOKS_API_KEY = KLJUC_GOOGLE;
o = await z(googleHandler, { token: "tok-a", telo: { naslov: "x" } });
provera("Google 429 sa ključem: google_zauzet", o.status === 503 && o.telo.greska.kod === "google_zauzet", o.telo);
delete process.env.GOOGLE_BOOKS_API_KEY;
googleOdgovor = () => new Response("nije json", { status: 200 });
o = await z(googleHandler, { token: "tok-a", telo: { naslov: "x" } });
provera("Google vraća smeće: 502, bez pada", o.status === 502 && o.telo.greska.kod === "google_greska", o.telo);
googleOdgovor = () => new Response(JSON.stringify({ totalItems: 0 }), { status: 200 });
o = await z(googleHandler, { token: "tok-a", telo: { naslov: "nepostojeca knjiga" } });
provera("nema rezultata: 200 i prazan niz", o.status === 200 && Array.isArray(o.telo.rezultati) && o.telo.rezultati.length === 0, o.telo);

// iz-linka
let pre2 = stanje.rpcPozivi;
o = await z(linkHandler, { token: "tok-b", telo: { url: "http://laguna.rs/x" } });
provera("iz-linka: http se odbija (422) pre ograničenja i pre mreže", o.status === 422 && o.telo.greska.kod === "nije_https" && stanje.rpcPozivi === pre2, o.telo);
o = await z(linkHandler, { token: "tok-b", telo: { url: "https://evil.com/knjiga" } });
provera("iz-linka: domen van liste se odbija (422)", o.status === 422 && o.telo.greska.kod === "domen_nije_dozvoljen", o.telo);
o = await z(linkHandler, { token: "tok-b", telo: { url: "https://127.0.0.1/" } });
provera("iz-linka: IP adresa se odbija", o.status === 422, o.status);
o = await z(linkHandler, { token: "tok-b", telo: {} });
provera("iz-linka: bez adrese 400", o.status === 400 && o.telo.greska.kod === "neispravan_link", o.status);
o = await z(linkHandler, { token: "tok-b", telo: { url: `https://laguna.rs/${"a".repeat(2100)}` } });
provera("iz-linka: predugačka adresa 400", o.status === 400, o.status);

let preuzimanja = 0;
bf.unutrasnje.jedanZahtev = async () => {
  preuzimanja++;
  return stranica(`<html><head>${jsonLd({ "@type": "Book", name: "Zlatni znak", author: "Ivo Andrić" })}</head></html>`);
};
o = await z(linkHandler, { token: "tok-b", telo: { url: "https://www.laguna.rs/zlatni-znak?utm_source=mejl" } });
provera("iz-linka: čita stranicu i vraća normalizovan rezultat", o.status === 200 && o.telo.rezultati[0].naslov === "Zlatni znak" && o.telo.rezultati[0].izvor === "link" && !o.telo.rezultati[0].izKesa, o.telo);
o = await z(linkHandler, { token: "tok-a", telo: { url: "https://www.laguna.rs/zlatni-znak#deo" } });
provera("isti link (drugi član, bez praćenja u adresi): iz keša, bez novog preuzimanja", o.status === 200 && o.telo.rezultati[0].izKesa === true && preuzimanja === 1, { izKesa: o.telo?.rezultati?.[0]?.izKesa, preuzimanja });
bf.unutrasnje.jedanZahtev = async () => { throw new ApiGreska(502, "ne_mogu_da_procitam", "sajt ne radi"); };
o = await z(linkHandler, { token: "tok-b", telo: { url: "https://www.laguna.rs/drugi" } });
provera("sajt ne odgovara: 502 ne_mogu_da_procitam", o.status === 502 && o.telo.greska.kod === "ne_mogu_da_procitam", o.telo);
bf.unutrasnje.jedanZahtev = original;

// ograničenje broja zahteva (30 na sat), po članu
faza("9. Ograničenje 30 zahteva na sat");
{
  const id = CLANOVI["tok-b"].id;
  stanje.brojac.set(id, 0);
  const statusi = [];
  let poslednji;
  for (let i = 0; i < 31; i++) {
    poslednji = await z(googleHandler, { token: "tok-b", telo: { naslov: "x" } });
    statusi.push(poslednji.status);
  }
  googleOdgovor = () => new Response(JSON.stringify({ items: [] }), { status: 200 });
  provera("prvih 30 prolazi, 31. je 429", statusi.slice(0, 30).every((s) => s === 200 || s === 502) && statusi[30] === 429, statusi.join(","));
  provera("429 sadrži Retry-After i ponovoZaSekundi", poslednji.zaglavlja["retry-after"] === "1234" && poslednji.telo.greska.ponovoZaSekundi === 1234 && poslednji.telo.greska.kod === "previse_zahteva", { zaglavlja: poslednji.zaglavlja, telo: poslednji.telo });
  const drugi = await z(googleHandler, { token: "tok-a", telo: { naslov: "x" } });
  provera("ograničenje je po članu: drugi član i dalje prolazi", drugi.status !== 429, drugi.status);

  stanje.rpcGreska = true;
  const a = await z(googleHandler, { token: "tok-a", telo: { naslov: "x" } });
  provera("baza za ograničenje ne radi: zahtev se ODBIJA (503), ne propušta", a.status === 503 && a.telo.greska.kod === "ogranicenje_nedostupno", a.telo);
  stanje.rpcGreska = false;
}

faza("10. Bez servisnog ključa");
{
  const ukljucen = process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  process.env.VERCEL_ENV = "production";
  let a = await z(googleHandler, { token: "tok-a", telo: { naslov: "x" } });
  provera("produkcija bez servisnog ključa: 500, zahtev se ne izvršava", a.status === 500 && a.telo.greska.kod === "greska_servera", a.telo);
  process.env.ZAHTEVI_BEZ_BAZE = "1";
  a = await z(googleHandler, { token: "tok-a", telo: { naslov: "x" } });
  provera("ZAHTEVI_BEZ_BAZE=1 se ignoriše na Vercel-u (VERCEL_ENV=production)", a.status === 500, a.status);
  process.env.VERCEL_ENV = "preview";
  a = await z(googleHandler, { token: "tok-a", telo: { naslov: "x" } });
  provera("ZAHTEVI_BEZ_BAZE=1 se ignoriše i u preview okruženju", a.status === 500, a.status);

  delete process.env.VERCEL_ENV;
  const pre3 = stanje.rpcPozivi;
  a = await z(googleHandler, { token: "tok-a", telo: { naslov: "x" } });
  provera("lokalno (bez VERCEL_ENV) sa ZAHTEVI_BEZ_BAZE=1: radi bez baze, ali prijava se i dalje proverava", a.status === 200 && stanje.rpcPozivi === pre3, a.status);
  a = await z(googleHandler, { token: "nevazeci", telo: { naslov: "x" } });
  provera("lokalni režim ne preskače proveru prijave: nevažeći token je 401", a.status === 401, a.status);

  delete process.env.ZAHTEVI_BEZ_BAZE;
  process.env.SUPABASE_SERVICE_ROLE_KEY = ukljucen;
}

faza("11. Tajne");
provera("ni u jednom odgovoru (telo i zaglavlja) nema ključeva", sviOdgovori.every((t) => !TAJNE.some((k) => t.includes(k))), "neki odgovor sadrži ključ");

globalThis.fetch = pravi;
lazniSupabase.close();
console.log(`\nPASS: ${pass}   FAIL: ${fail}`);
process.exit(fail ? 1 : 0);
