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
  "tok-a": { id: randomUUID(), aktivan: true, uloga: "citalac" },
  "tok-b": { id: randomUUID(), aktivan: true, uloga: "citalac" },
  "tok-c": { id: randomUUID(), aktivan: true, uloga: "citalac" },
  "tok-bib": { id: randomUUID(), aktivan: true, uloga: "bibliotekar" },
  "tok-admin": { id: randomUUID(), aktivan: true, uloga: "administrator" },
  "tok-neaktivan": { id: randomUUID(), aktivan: false, uloga: "citalac" },
};
// brojac je po (član, kanta), kao public.uzmi_zahtev posle migracije 0012
const stanje = {
  brojac: new Map(), kes: new Map(), zahteviKaBazi: 0, rpcGreska: false, rpcPozivi: 0,
  pozivi: [], citanjaUloge: 0, ulogaGreska: false,
  // knjige i Storage za api/korica-iz-linka.js
  knjige: new Map(), patchevi: [], patchGreska: false, otpremljeno: [], obrisano: [], storageGreska: false,
};
const kljucB = (clanId, kanta = "api") => `${clanId}|${kanta}`;

const lazniSupabase = http.createServer((req, res) => {
  let telo = "";
  const delovi = [];
  req.on("data", (d) => {
    telo += d;
    delovi.push(d);
  });
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
      const trazeno = (url.searchParams.get("select") ?? "").split(",");
      const samoAktivan = url.searchParams.get("aktivan") === "eq.true";
      // Čitanje uloge (select=uloga) sme samo servisni ključ, kao u funkciji (RLS se zaobilazi).
      if (trazeno.includes("uloga")) {
        stanje.citanjaUloge++;
        if (!(req.headers.authorization ?? "").includes(KLJUC_SERVIS)) return odgovori(401, { code: "42501", message: "permission denied" });
        if (stanje.ulogaGreska) return odgovori(500, { code: "XX000", message: "baza ne radi" });
      }
      const odgovor = red && !(samoAktivan && !red.aktivan) ? Object.fromEntries(trazeno.map((k) => [k, red[k]])) : null;
      return objekat ? (odgovor ? odgovori(200, odgovor) : odgovori(406, { code: "PGRST116" })) : odgovori(200, odgovor ? [odgovor] : []);
    }
    if (url.pathname === "/rest/v1/rpc/uzmi_zahtev") {
      stanje.rpcPozivi++;
      // Samo servisni ključ sme da zove ovu funkciju (kao u bazi).
      if (!(req.headers.authorization ?? "").includes(KLJUC_SERVIS)) return odgovori(401, { code: "42501", message: "permission denied" });
      if (stanje.rpcGreska) return odgovori(500, { code: "XX000", message: "baza ne radi" });
      const b = JSON.parse(telo);
      stanje.pozivi.push({ clan: b.p_clan, kanta: b.p_akcija, najvise: b.p_najvise });
      const n = stanje.brojac.get(kljucB(b.p_clan, b.p_akcija)) ?? 0;
      if (n >= b.p_najvise) return odgovori(200, { dozvoljeno: false, preostalo: 0, ponovo_za_sekundi: 1234 });
      stanje.brojac.set(kljucB(b.p_clan, b.p_akcija), n + 1);
      return odgovori(200, { dozvoljeno: true, preostalo: b.p_najvise - n - 1, ponovo_za_sekundi: 0 });
    }
    if (url.pathname === "/rest/v1/knjige" || url.pathname.startsWith("/storage/v1/object/korice")) {
      // samo servisni ključ (korica-iz-linka piše kao service_role)
      if (!(req.headers.authorization ?? "").includes(KLJUC_SERVIS)) return odgovori(401, { code: "42501", message: "permission denied" });
    }
    if (url.pathname === "/rest/v1/knjige") {
      const id = (url.searchParams.get("id") ?? "").replace("eq.", "");
      const red = stanje.knjige.get(id);
      if (req.method === "PATCH") {
        stanje.patchevi.push({ id, telo: JSON.parse(telo) });
        if (stanje.patchGreska) return odgovori(500, { code: "XX000", message: "baza ne radi" });
        if (!red) return objekat ? odgovori(406, { code: "PGRST116" }) : odgovori(200, []);
        Object.assign(red, JSON.parse(telo));
        return objekat ? odgovori(200, { id }) : odgovori(200, [{ id }]);
      }
      return objekat ? (red ? odgovori(200, red) : odgovori(406, { code: "PGRST116" })) : odgovori(200, red ? [red] : []);
    }
    if (req.method === "POST" && url.pathname.startsWith("/storage/v1/object/korice/")) {
      if (stanje.storageGreska) return odgovori(500, { statusCode: "500", error: "x", message: "storage ne radi" });
      stanje.otpremljeno.push({ putanja: decodeURIComponent(url.pathname.slice("/storage/v1/object/korice/".length)), tip: req.headers["content-type"], bajtovi: Buffer.concat(delovi) });
      return odgovori(200, { Id: randomUUID(), Key: "korice/x" });
    }
    if (req.method === "DELETE" && url.pathname === "/storage/v1/object/korice") {
      stanje.obrisano.push(...(JSON.parse(telo).prefixes ?? []));
      return odgovori(200, []);
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
const { urediPotvrdu, redZaUpis } = await import("../src/lib/red-knjige.js");
const unos = await import("../src/lib/unos-knjiga.js");
const googleHandler = (await import("../api/pretraga-google.js")).default;
const linkHandler = (await import("../api/iz-linka.js")).default;
const koricaHandler = (await import("../api/korica-iz-linka.js")).default;
const { tipSlike } = await import("../api/_lib/slika.js");

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
provera("JSON-LD Book: naslov, autor, izdavač, ISBN-13, godina",
  p.naslov === "Na Drini ćuprija" && p.autori.join() === "Ivo Andrić" && p.isbn === "9788652126033" && p.godina === 2019 && p.izvorPodataka === "json-ld", p);
provera("JSON-LD sa opisom i slikom: bibliotekarska polja i PREDLOG korice; opis se ne čita",
  JSON.stringify(Object.keys(p).sort()) === JSON.stringify(["autori", "godina", "isbn", "izdavac", "izvorPodataka", "korica", "naslov"]) && p.korica === "https://cdn.laguna.rs/k.jpg" && !("opis" in p), p);
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
provera("Open Graph: „Naslov - Autor | Sajt” se razdvaja, goli domen kao izdavač gubi nastavak; relativna og:image postaje https predlog; og:description se ne čita",
  p.naslov === "Gospođica" && p.autori.join() === "Ivo Andrić" && p.izdavac === "laguna" && p.korica === "https://www.laguna.rs/slike/g.jpg" && !("opis" in p), p);

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
  const n = parser.urediRezultat({ naslov: dugacak, autori: Array(30).fill("A"), izdavac: dugacak, opis: dugacak, godina: 3000, isbn: null, korica: "https://cdn.laguna.rs/k.jpg" }, U);
  provera("rezultat je ograničen po dužini (naslov 300, izdavač 150, najviše 10 autora, godina van opsega se odbacuje)",
    n.naslov.length === 300 && n.autori.length === 10 && n.godina === null && n.izdavac.length === 150, { naslov: n.naslov.length, autori: n.autori.length, godina: n.godina });
  provera("urediRezultat ne propušta opis čak ni kad stigne u sirovim podacima; ispravna korica ostaje", !("opis" in n) && n.korica === "https://cdn.laguna.rs/k.jpg", n);
  for (const losa of ["http://cdn.laguna.rs/k.jpg", "https://127.0.0.1/k.jpg", "https://localhost/k.jpg", "https://u:p@cdn.laguna.rs/k.jpg", "https://cdn.laguna.rs:8443/k.jpg", "https://cdn.laguna.rs/a b.jpg", `https://cdn.laguna.rs/${"a".repeat(500)}.jpg`, "javascript:alert(1)", "data:image/png;base64,AAAA", "", null]) {
    provera(`predlog korice se odbacuje: ${String(losa).slice(0, 50)}`, parser.urediRezultat({ naslov: "N", autori: [], korica: losa }, U).korica === null);
  }
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

// ───────────────────────── 7b. korice i ISBN ─────────────────────────
faza("7b. Korice (samo https i samo dozvoljeni domeni) i ISBN");

const bl = await import("../api/_lib/bela-lista.js");
const KORICE = {
  "https://covers.openlibrary.org/b/isbn/9788652126033-M.jpg": true,
  "https://jrmzgulxvxtpghwbhmrc.supabase.co/storage/v1/object/public/korice/1.jpg": true, // naš Storage
  // Google se NE čuva (uslovi: nema trajnih kopija sadržaja iz API-ja)
  "https://books.google.com/books/content?id=a&zoom=1": false,
  "https://books.googleusercontent.com/x": false,
  "https://tudji-projekat.supabase.co/storage/v1/object/public/korice/1.jpg": false,
  "https://supabase.co/x.jpg": false,
  "https://cdn.laguna.rs/k.jpg": true,
  "https://LAGUNA.RS/k.jpg": true,
  "https://geopoetika.com/k.jpg": true,
  "http://books.google.com/x": false,
  "https://evil.com/k.jpg": false,
  "https://d111.cloudfront.net/k.jpg": false,
  "https://laguna.rs.evil.com/k.jpg": false,
  "https://evil-laguna.rs/k.jpg": false,
  "https://books.google.com@evil.com/k.jpg": false,
  "https://books.google.com:443/k.jpg": false,
  "https://127.0.0.1/k.jpg": false,
  "https://laguna.rs./k.jpg": false,
  "https://laguna.rs/a b.jpg": false,
  "HTTPS://laguna.rs/k.jpg": false,
  "//laguna.rs/k.jpg": false,
  "javascript:alert(1)": false,
  [`https://laguna.rs/${"a".repeat(500)}`]: false, // preko 500 znakova
};
for (const [adresa, ocekivano] of Object.entries(KORICE)) {
  provera(`korica ${ocekivano ? "dozvoljena" : "odbijena"}: ${adresa.slice(0, 60)}`, bl.koricaJeDozvoljena(adresa) === ocekivano);
}
provera("lista domena za korice = domeni linkova + Open Library + naš Supabase Storage (2 dodatna)", bl.DOZVOLJENI_DOMENI_KORICA.length === bl.DOZVOLJENI_DOMENI.length + 2, bl.DOMENI_KORICA_DODATNI);
provera("Google nije na listi domena za korice (ne sme da se čuva)", !bl.DOZVOLJENI_DOMENI_KORICA.some((d) => d.includes("google")), bl.DOZVOLJENI_DOMENI_KORICA.filter((d) => d.includes("google")));
for (const slika of ["https://d111.cloudfront.net/k.jpg", "https://cdn.laguna.rs/k.jpg", "https://covers.openlibrary.org/b/isbn/9788652126033-M.jpg"]) {
  p = parser.izvuciIzHtmla(`<html><head><meta property="og:title" content="Knjiga"><meta property="og:image" content="${slika}"></head></html>`, U);
  provera(`parser: og:image sa bilo kog javnog https domena je predlog korice (${new URL(slika).hostname}); domen nije ograničen listom`, p.korica === slika, p);
}
for (const [naziv, slika] of [["http", "http://cdn.laguna.rs/k.jpg"], ["IP adresa", "https://93.184.216.34/k.jpg"], ["localhost", "https://localhost/k.jpg"], ["korisnik u adresi", "https://a:b@cdn.laguna.rs/k.jpg"], ["port", "https://cdn.laguna.rs:8443/k.jpg"], ["data:", "data:image/png;base64,AAAA"]]) {
  p = parser.izvuciIzHtmla(`<html><head><meta property="og:title" content="Knjiga"><meta property="og:image" content="${slika}"></head></html>`, U);
  provera(`parser: predlog korice se ne daje za nebezbednu adresu (${naziv})`, p.korica === null, p.korica);
}
p = parser.izvuciIzHtmla(`<html><head>${jsonLd({ "@type": "Book", name: "Knjiga", image: [{ "@type": "ImageObject", url: "/slike/prva.jpg" }, "https://cdn.laguna.rs/druga.jpg"] })}<meta property="og:image" content="https://cdn.laguna.rs/og.jpg"></head></html>`, U);
provera("parser: JSON-LD image (objekat ili niz, relativna adresa) ima prednost nad og:image", p.korica === "https://www.laguna.rs/slike/prva.jpg", p.korica);
p = parser.izvuciIzHtmla(`<html><head>${jsonLd({ "@type": "Book", name: "Knjiga", image: "http://cdn.laguna.rs/nesigurna.jpg" })}<meta property="og:image" content="https://cdn.laguna.rs/og.jpg"></head></html>`, U);
provera("parser: nebezbedna JSON-LD slika se preskače, uzima se og:image", p.korica === "https://cdn.laguna.rs/og.jpg", p.korica);
n = gb.normalizujStavku({ volumeInfo: { title: "T", imageLinks: { thumbnail: "http://books.googleusercontent.com/x.jpg" } } });
provera("Google: korica sa books.googleusercontent.com se PRIKAZUJE (prebacuje se na https), ali nije za čuvanje", n.korica === "https://books.googleusercontent.com/x.jpg" && bl.koricaJeDozvoljena(n.korica) === false, { korica: n.korica, zaCuvanje: bl.koricaJeDozvoljena(n.korica) });
n = gb.normalizujStavku({ volumeInfo: { title: "T", imageLinks: { thumbnail: "https://www.google.com/x.jpg" } } });
provera("Google: korica sa drugog Google domena (nije books.*) se odbacuje", n.korica === null, n.korica);

for (const [ulaz, ocekivano] of [
  ["978-86-521-2603-3", "9788652126033"], ["978 86 521 2603 3", "9788652126033"], ["9788652126033", "9788652126033"],
  ["0-306-40615-2", "9780306406157"], ["0306406152", "9780306406157"], ["0-8044-2957-x", "9780804429573"], ["080442957X", "9780804429573"],
  ["ISBN 0-306-40615-2", "9780306406157"], ["978-86-521-2603-4", null], ["97886521260", null], ["123", null], ["", null], ["abc", null],
  ["0306406153", null], ["03064061520", null],
]) {
  provera(`uIsbn13(${JSON.stringify(ulaz)}) = ${JSON.stringify(ocekivano)}`, uIsbn13(ulaz) === ocekivano, uIsbn13(ulaz));
}

// ───────────────────────── 7c. šta se trajno upisuje ─────────────────────────
faza("7c. Trajno se čuva samo ono što član potvrdi (red-knjige.js)");

let u = urediPotvrdu({ naslov: "  Na   Drini  ćuprija ", autor: " Ivo Andrić ", izdavac: " Laguna ", godina: " 2019 ", isbn: "0-306-40615-2" });
provera("potvrda: razmaci se sređuju, godina je broj, ISBN-10 postaje ISBN-13",
  u.ok && u.podaci.naslov === "Na Drini ćuprija" && u.podaci.autor === "Ivo Andrić" && u.podaci.izdavac === "Laguna" && u.podaci.godina === 2019 && u.podaci.isbn === "9780306406157", u);
u = urediPotvrdu({ naslov: "Samo naslov", autor: "", izdavac: "  ", godina: "", isbn: "" });
provera("potvrda: prazna polja postaju null (naslov je jedini obavezan)", u.ok && u.podaci.autor === null && u.podaci.izdavac === null && u.podaci.godina === null && u.podaci.isbn === null, u);
for (const [unos, polje, razlog] of [
  [{ naslov: "  " }, "naslov", "prazno"],
  [{ naslov: "x".repeat(301) }, "naslov", "predugo"],
  [{ naslov: "N", autor: "x".repeat(201) }, "autor", "predugo"],
  [{ naslov: "N", izdavac: "x".repeat(151) }, "izdavac", "predugo"],
  [{ naslov: "N", godina: "1399" }, "godina", "neispravno"],
  [{ naslov: "N", godina: "2201" }, "godina", "neispravno"],
  [{ naslov: "N", godina: "19xx" }, "godina", "neispravno"],
  [{ naslov: "N", godina: "20190" }, "godina", "neispravno"],
  [{ naslov: "N", isbn: "978-86-521-2603-4" }, "isbn", "neispravno"],
  [{ naslov: "N", isbn: "123" }, "isbn", "neispravno"],
]) {
  u = urediPotvrdu(unos);
  provera(`potvrda odbija: ${JSON.stringify(unos).slice(0, 55)} → ${polje} (${razlog})`, u.ok === false && u.polje === polje && u.razlog === razlog, u);
}

const POTVRDJENO = { naslov: "Na Drini ćuprija", autor: "Ivo Andrić", izdavac: "Laguna", godina: 2019, isbn: "9788652126033" };
const KLJUCEVI = ["autor", "godina", "isbn", "izdavac", "naslov"];
let red = redZaUpis({ ...POTVRDJENO, opis: "Opis sa sajta ili Google-a", korice_url: "https://books.google.com/x", korica: "https://cdn.laguna.rs/k.jpg", izvor: "link" });
provera("red za upis ima tačno naslov, autor, izdavač, godinu i ISBN; nema opisa, korice ni izvora (ni kad su stigli u podacima)",
  JSON.stringify(Object.keys(red).sort()) === JSON.stringify(KLJUCEVI), red);
red = redZaUpis({ naslov: "Samo naslov" });
provera("nedostajuća polja postaju null, ne undefined", red.autor === null && red.izdavac === null && red.godina === null && red.isbn === null, red);
provera("nedostajuća polja postaju null, ne undefined", red.autor === null && red.izdavac === null && red.godina === null && red.isbn === null, red);

// ───────────────────────── 7d. fotografije korica ─────────────────────────
faza("7d. Korica: samo naša fotografija → Open Library → pločica (korica-slika.js)");
{
  const kf = await import("../src/lib/korica-slika.js");
  const { readFileSync } = await import("node:fs");
  const izvor = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
  const greskaKoda = (fn) => {
    try {
      fn();
      return null;
    } catch (e) {
      return e.kod ?? e.message;
    }
  };

  // ── smanjivanje: najviše 600 px širine ──
  for (const [s, v, os, ov] of [[4000, 3000, 600, 450], [3024, 4032, 600, 800], [1200, 1600, 600, 800], [600, 900, 600, 900], [300, 400, 300, 400], [800, 4000, 180, 900], [1, 1, 1, 1], [10000, 1, 600, 1]]) {
    const d = kf.dimenzijePosleSmanjenja(s, v);
    provera(`smanjivanje ${s}x${v} → ${os}x${ov}`, d.sirina === os && d.visina === ov, d);
  }
  {
    let lose = null;
    for (let i = 0; i < 2000 && !lose; i++) {
      const s = 1 + Math.floor(Math.random() * 12000);
      const v = 1 + Math.floor(Math.random() * 12000);
      const d = kf.dimenzijePosleSmanjenja(s, v);
      if (d.sirina > 600 || d.visina > 900 || d.sirina < 1 || d.visina < 1 || d.sirina > s || d.visina > v) lose = { s, v, d };
    }
    provera("smanjivanje: nikad šire od 600 px, više od 900 px, ni veće od originala (2000 slučajnih veličina)", lose === null, lose);
  }
  provera("smanjivanje: razmera ostaje (4:3 → 600x450, kvadrat → 600x600)", kf.dimenzijePosleSmanjenja(2400, 1800).visina === 450 && kf.dimenzijePosleSmanjenja(1000, 1000).visina === 600);
  provera("smanjivanje: neispravne dimenzije su greška slika_neispravna", greskaKoda(() => kf.dimenzijePosleSmanjenja(0, 10)) === "slika_neispravna" && greskaKoda(() => kf.dimenzijePosleSmanjenja(NaN, 10)) === "slika_neispravna" && greskaKoda(() => kf.dimenzijePosleSmanjenja(10, -1)) === "slika_neispravna");

  // ── imena fajlova: ista pravila kao politika u migraciji 0013 ──
  const KID = "123e4567-e89b-42d3-a456-426614174000";
  provera("ime fajla: <id knjige>/<vreme>.<ekstenzija> po tipu (webp, jpg, png)",
    kf.putanjaKorice(KID, 1700000000000, "image/webp") === `${KID}/1700000000000.webp` && kf.putanjaKorice(KID, 1, "image/jpeg").endsWith(".jpg") && kf.putanjaKorice(KID, 1, "image/png").endsWith(".png"));
  provera("ime fajla: tip koji nije jpeg/png/webp (svg, html, gif) je greška slika_tip", ["image/svg+xml", "text/html", "image/gif", ""].every((t) => greskaKoda(() => kf.putanjaKorice(KID, 1, t)) === "slika_tip"));
  provera("ime fajla: id knjige koji nije uuid je greška knjiga_neispravna", ["1", "../x", `${KID}/x`, ""].every((id) => greskaKoda(() => kf.putanjaKorice(id, 1, "image/webp")) === "knjiga_neispravna"));
  {
    const sql = izvor("supabase/migrations/0013_storage_korice.sql").replace(/^--.*$/gm, "");
    const uzorak = /name ~ '([^']+)'/.exec(sql)?.[1];
    const re = uzorak && new RegExp(uzorak);
    provera("0013 sadrži obrazac imena fajla", Boolean(re), uzorak);
    const dobra = ["image/webp", "image/jpeg", "image/png"].map((t) => kf.putanjaKorice(KID, Date.now(), t));
    provera("sva imena iz putanjaKorice prolaze obrazac iz migracije 0013 (JS i SQL su isto pravilo)", Boolean(re) && dobra.every((p) => re.test(p)), dobra);
    const losa = ["slika.webp", `${KID}/a/b.webp`, `${KID}/../x.webp`, `${KID}/1.svg`, `${KID}/1.html`, `${KID}/.webp`, `${KID.toUpperCase()}/1.webp`, `${KID}/1 2.webp`];
    provera("loša imena ne prolaze obrazac iz migracije 0013", Boolean(re) && losa.every((p) => !re.test(p)), losa.filter((p) => re?.test(p)));
    provera("migracija 0013: bucket je javan, 1 MB, samo jpeg, png i webp; upis i brisanje samo za bibliotekare, izmena nikome",
      /'korice', 'korice', true, 1048576, array\['image\/jpeg', 'image\/png', 'image\/webp'\]/.test(sql) &&
        (sql.match(/privatno\.je_bibliotekar\(\)/g) ?? []).length === 2 && !/for update/i.test(sql) && !/for all/i.test(sql) && /for select to anon, authenticated/.test(sql));
  }

  // ── javna adresa → putanja (brisanje stare korice) ──
  const JAVNA = `https://jrmzgulxvxtpghwbhmrc.supabase.co/storage/v1/object/public/korice/${KID}/1700000000000.webp`;
  provera("javna adresa → putanja u bucket-u", kf.putanjaIzAdrese(JAVNA) === `${KID}/1700000000000.webp` && kf.putanjaIzAdrese(`${JAVNA}?t=1`) === `${KID}/1700000000000.webp`);
  for (const losa of [
    "https://covers.openlibrary.org/b/isbn/9788652126033-M.jpg",
    "https://cdn.laguna.rs/k.jpg",
    JAVNA.replace("https:", "http:"),
    JAVNA.replace("/public/korice/", "/public/drugi/"),
    JAVNA.replace("/object/public/", "/object/sign/"),
    JAVNA.replace(KID, "../../x"),
    JAVNA.replace(KID, "nije-uuid"),
    JAVNA.replace(KID + "/", ""),
    JAVNA.replace(".webp", ".svg"),
    JAVNA.replace(KID, `${KID}%2F..%2Fx`),
    "", null, undefined, "nije adresa",
  ]) {
    provera(`putanjaIzAdrese vraća null (nikad se ne briše tuđe): ${String(losa).slice(0, 70)}`, kf.putanjaIzAdrese(losa) === null, kf.putanjaIzAdrese(losa));
  }

  {
    const PREFIKS = "https://jrmzgulxvxtpghwbhmrc.supabase.co/storage/v1/object/public/korice/";
    const ime = `${KID}/1700000000000.webp`;
    provera("putanjaIzAdrese sa prefiksom: adresa sa našeg bucket-a (i http prefiks lažnog Supabase-a) vraća putanju", kf.putanjaIzAdrese(PREFIKS + ime, PREFIKS) === ime && kf.putanjaIzAdrese(`http://127.0.0.1:1/x/korice/${ime}?v=1`, "http://127.0.0.1:1/x/korice/") === ime);
    provera("putanjaIzAdrese sa prefiksom: tuđ server ili drugi bucket → null", kf.putanjaIzAdrese(PREFIKS.replace("jrmzgulxvxtpghwbhmrc", "xxxxxxxxxxxxxxxxxxxx") + ime, PREFIKS) === null && kf.putanjaIzAdrese(`https://evil.example/storage/v1/object/public/korice/${ime}`, PREFIKS) === null && kf.putanjaIzAdrese(PREFIKS.replace("korice/", "drugi/") + ime, PREFIKS) === null);
    provera("putanjaIzAdrese sa prefiksom: i dalje samo ispravan oblik imena", kf.putanjaIzAdrese(`${PREFIKS}${KID}/../x.webp`, PREFIKS) === null && kf.putanjaIzAdrese(`${PREFIKS}${KID}/a.svg`, PREFIKS) === null && kf.putanjaIzAdrese(`${PREFIKS}nije-uuid/a.webp`, PREFIKS) === null);
  }

  // ── lanac prikaza ──
  const ISBN = "9788652126033";
  const OL = `https://covers.openlibrary.org/b/isbn/${ISBN}-M.jpg?default=false`;
  provera("lanac: naša fotografija pa Open Library", JSON.stringify(kf.adreseKorica({ isbn: ISBN, korice_url: JAVNA, korice_izvor: "fotografija" })) === JSON.stringify([JAVNA, OL]), kf.adreseKorica({ isbn: ISBN, korice_url: JAVNA, korice_izvor: "fotografija" }));
  provera("lanac: bez fotografije samo Open Library po ISBN-u (za pločicu se pada kad i on ne postoji)", JSON.stringify(kf.adreseKorica({ isbn: "978-86-521-2603-3" })) === JSON.stringify([OL]));
  provera("lanac: ISBN-10 se pretvara u ISBN-13 za Open Library", kf.adreseKorica({ isbn: "0-306-40615-2" })[0] === "https://covers.openlibrary.org/b/isbn/9780306406157-M.jpg?default=false");
  provera("lanac: bez fotografije i bez ISBN-a nema nijedne adrese (prikazuje se pločica)", kf.adreseKorica({ naslov: "Bez ISBN-a" }).length === 0 && kf.adreseKorica({ isbn: "123" }).length === 0);
  for (const izvorKorice of ["og_slika", "google_books", "open_library", "fond", null]) {
    const a = kf.adreseKorica({ isbn: ISBN, korice_url: "https://cdn.laguna.rs/k.jpg", korice_izvor: izvorKorice });
    provera(`lanac: stara adresa sa izvorom ${izvorKorice} se ne prikazuje (korica sa tuđeg sajta se ne uzima)`, JSON.stringify(a) === JSON.stringify([OL]), a);
  }
  provera("lanac: Google rezultat (pretraga uživo) prikazuje svoju sličicu pa Open Library", JSON.stringify(kf.adreseKorica({ isbn: ISBN, izvor: "google_books", korica: "https://books.google.com/x.jpg" })) === JSON.stringify(["https://books.google.com/x.jpg", OL]));
  provera("lanac: rezultat sa linka ne nosi sliku sa sajta (čak ni ako bi stigla)", JSON.stringify(kf.adreseKorica({ isbn: ISBN, izvor: "link", korica: "https://cdn.laguna.rs/k.jpg" })) === JSON.stringify([OL]));
  provera("naša kopija preuzeta sa linka (izvor 'preuzeto') prikazuje se kao naša slika, pre Open Library", JSON.stringify(kf.adreseKorica({ isbn: ISBN, korice_url: JAVNA, korice_izvor: "preuzeto" })) === JSON.stringify([JAVNA, OL]));
  provera("fotografija samo uz izvor 'fotografija' i https adresu", kf.nasaFotografija({ korice_url: JAVNA, korice_izvor: "fotografija" }) === JAVNA && kf.nasaFotografija({ korice_url: JAVNA.replace("https:", "http:"), korice_izvor: "fotografija" }) === null && kf.nasaFotografija({ korice_url: null, korice_izvor: "fotografija" }) === null && kf.nasaFotografija(null) === null);

  // ── brzi tok: „Sledeća knjiga” ──
  {
    const stavke = [
      { id: "1", forma: {}, sacuvano: { id: "k1", uFondu: true, korica: "https://x/1" } }, // gotova (sačuvana i sa koricom)
      { id: "2", forma: {}, sacuvano: { id: "k2", uFondu: true, korica: null } }, // čeka koricu
      { id: "3", status: "nije_uspelo" }, // bez forme: ne čeka ništa
      { id: "4", forma: {} }, // čeka pregled
      { id: "5", forma: {}, sacuvano: { id: "k5", uFondu: false, korica: null } }, // za nabavku: korica se ne nudi
      { id: "6", forma: {} },
    ];
    provera("sledeća knjiga posle 1 je 2 (sačuvana u fond, čeka koricu)", unos.sledecaZaObradu(stavke, "1")?.id === "2");
    provera("sledeća posle 2 preskače karticu bez podataka (3) i staje na 4 (čeka pregled)", unos.sledecaZaObradu(stavke, "2")?.id === "4");
    provera("sledeća posle 4 preskače „za nabavku” bez korice (5) i staje na 6", unos.sledecaZaObradu(stavke, "4")?.id === "6");
    provera("posle poslednje vraća se na prvu preskočenu kojoj treba pažnja (6 → 2)", unos.sledecaZaObradu(stavke, "6")?.id === "2");
    provera("kad ništa drugo ne čeka, nema sledeće", unos.sledecaZaObradu([{ id: "1", forma: {}, sacuvano: { uFondu: true, korica: "x" } }, { id: "2", status: "nije_uspelo" }], "1") === undefined && unos.sledecaZaObradu([{ id: "1", forma: {} }], "1") === undefined);
    provera("nepoznat id nema sledeću", unos.sledecaZaObradu(stavke, "nema") === undefined);
    provera("kartica koja je sačuvana u fond i dobila koricu više ne traži pažnju", unos.trebaPaznju(stavke[0]) === false && unos.trebaPaznju(stavke[1]) === true && unos.trebaPaznju(stavke[4]) === false);
  }
  // ── greške pri slanju u Storage ──
  for (const [greska, kod] of [
    [{ statusCode: "413", message: "The object exceeded the maximum allowed size" }, "slika_velika"],
    [{ message: "Payload too large" }, "slika_velika"],
    [{ statusCode: "415", message: "mime type text/html is not supported" }, "slika_tip"],
    [{ statusCode: "400", error: "invalid_mime_type", message: "invalid_mime_type" }, "slika_tip"],
    [{ statusCode: "403", message: "new row violates row-level security policy" }, "nema_dozvole"],
    [{ status: 401, message: "Unauthorized" }, "nema_dozvole"],
    [{ message: "Failed to fetch" }, "korica_upload"],
    [{ statusCode: "500", message: "x" }, "korica_upload"],
    [null, "korica_upload"],
  ]) {
    provera(`kodGreskeSlanja: ${JSON.stringify(greska)} → ${kod}`, kf.kodGreskeSlanja(greska) === kod, kf.kodGreskeSlanja(greska));
  }
  provera("„Bez korice” je odluka: kartica sačuvana u fond sa bezKorice više ne traži pažnju, a bez odluke traži",
    unos.trebaPaznju({ forma: {}, sacuvano: { uFondu: true, korica: null, bezKorice: true } }) === false && unos.trebaPaznju({ forma: {}, sacuvano: { uFondu: true, korica: null, bezKorice: false } }) === true);
  provera("„Otvori” vodi na stranicu knjige kad postoji id, a bez id-a na pretragu", unos.adresaZaOtvaranje({ id: KID, naslov: "X" }) === `/knjiga/${KID}` && unos.adresaZaOtvaranje({ naslov: "X" }) === "/pretraga?upit=X");

  // ── korica uz čuvanje knjige (korica-tok.js): klijentska logika bez mreže ──
  {
    const tok = await import("../src/lib/korica-tok.js");
    const KOR = "https://cdn.laguna.rs/slike/k.jpg";
    const greskaSaKodom = (kod, dodatno = {}) => Object.assign(new Error(kod), { kod, ...dodatno });
    const nova = () => {
      const s = { baza: [], preuzmi: [], otpremi: [], stanja: [] };
      s.upisi = (status = "sacuvano") => async () => {
        if (status === "sacuvano") s.baza.push(`k${s.baza.length + 1}`);
        return status === "sacuvano" ? { status, id: s.baza.at(-1) } : { status };
      };
      return s;
    };

    // izbor korice
    provera("izbor korice: podrazumevano 'preuzmi' kad link daje predlog, inače 'bez'", tok.izborKorice({ rezultat: { korica: KOR } }) === "preuzmi" && tok.izborKorice({ rezultat: {} }) === "bez" && tok.izborKorice({}) === "bez");
    provera("izbor korice: 'bez' i 'slika' se poštuju; 'slika' bez slike i 'preuzmi' bez predloga se ne računaju",
      tok.izborKorice({ koricaIzbor: "bez", rezultat: { korica: KOR } }) === "bez" && tok.izborKorice({ koricaIzbor: "slika", slika: { blob: {} }, rezultat: { korica: KOR } }) === "slika" &&
        tok.izborKorice({ koricaIzbor: "slika", rezultat: { korica: KOR } }) === "preuzmi" && tok.izborKorice({ koricaIzbor: "preuzmi", rezultat: {} }) === "bez");

    // upis, pa korica
    let s = nova();
    let r = await tok.sacuvajPaKoricu({ upisi: s.upisi(), izbor: "preuzmi", predlog: KOR, preuzmi: async (id, url) => (s.preuzmi.push([id, url]), { korica_url: `https://nas/${id}.jpg` }), otpremi: async () => "x", naKorici: (st) => s.stanja.push(st) });
    provera("upis pa korica: knjiga se prvo upiše, korica se preuzima sa dobijenim ID-jem i nalepljenom adresom", r.upis === "sacuvano" && s.baza.length === 1 && s.preuzmi.length === 1 && s.preuzmi[0][0] === "k1" && s.preuzmi[0][1] === KOR && r.korica.ishod === "preuzeta" && r.korica.korica === "https://nas/k1.jpg" && s.stanja.join() === "radi", { r, preuzmi: s.preuzmi });

    // greška pri preuzimanju NE poništava upis
    for (const [kod, ocekivano] of [["ne_mogu_da_procitam", "Sajt ne daje sliku"], ["prevelika_slika", "prevelika"], ["slika_nije_podrzana", "Pogrešan tip"], ["nije_bibliotekar", "dozvolu"], ["nije_slika", "ne vodi do slike"], ["preusmerenje_van_liste", "preusmerava"], ["mreza", "povežem"]]) {
      s = nova();
      r = await tok.sacuvajPaKoricu({ upisi: s.upisi(), izbor: "preuzmi", predlog: KOR, preuzmi: async () => { throw greskaSaKodom(kod); }, otpremi: async () => "x" });
      provera(`neuspelo preuzimanje (${kod}) ne poništava upis: knjiga ostaje sačuvana, razlog je čitljiv`, r.upis === "sacuvano" && s.baza.length === 1 && r.korica.ishod === "greska" && r.korica.razlog.toLowerCase().includes(ocekivano.toLowerCase()) && r.korica.kod === kod, r);
    }
    s = nova();
    r = await tok.sacuvajPaKoricu({ upisi: s.upisi(), izbor: "preuzmi", predlog: KOR, preuzmi: async () => { throw new TypeError("neočekivano"); }, otpremi: async () => "x" });
    provera("i neočekivana greška (nije ApiGreska) ne poništava upis i ne ruši tok", r.upis === "sacuvano" && s.baza.length === 1 && r.korica.ishod === "greska" && typeof r.korica.razlog === "string" && r.korica.razlog.length > 5, r);
    s = nova();
    r = await tok.sacuvajPaKoricu({ upisi: s.upisi(), izbor: "preuzmi", predlog: KOR, preuzmi: async () => { throw greskaSaKodom("previse_zahteva", { ponovoZaSekundi: 1234 }); }, otpremi: async () => "x" });
    provera("ograničenje (previse_zahteva): upis ostaje, ishod 'limit', razlog sadrži minute (1234 s → 21 min)", r.upis === "sacuvano" && r.korica.ishod === "limit" && r.korica.razlog.includes("21 min"), r);

    // isključena kvačica ne šalje zahtev
    s = nova();
    r = await tok.sacuvajPaKoricu({ upisi: s.upisi(), izbor: "bez", predlog: KOR, preuzmi: async () => { s.preuzmi.push("x"); return {}; }, otpremi: async () => { s.otpremi.push("x"); return "x"; } });
    provera("isključena kvačica („Bez korice”): knjiga se upiše, a zahtev za koricu se NE šalje", r.upis === "sacuvano" && s.baza.length === 1 && s.preuzmi.length === 0 && s.otpremi.length === 0 && r.korica.ishod === "bez", r);
    s = nova();
    r = await tok.sacuvajPaKoricu({ upisi: s.upisi(), izbor: "preuzmi", predlog: null, preuzmi: async () => { s.preuzmi.push("x"); return {}; }, otpremi: async () => "x" });
    provera("bez predloga nema zahteva ni kad je izbor 'preuzmi'", s.preuzmi.length === 0 && r.korica.ishod === "bez");

    // upis nije uspeo (duplikat ili greška): korica se ne pokušava
    for (const status of ["duplikat", "greska"]) {
      s = nova();
      r = await tok.sacuvajPaKoricu({ upisi: s.upisi(status), izbor: "preuzmi", predlog: KOR, preuzmi: async () => { s.preuzmi.push("x"); return {}; }, otpremi: async () => "x" });
      provera(`upis '${status}': korica se ne preuzima`, r.upis === status && s.preuzmi.length === 0 && r.korica === null, r);
    }

    // druga slika
    s = nova();
    const BLOB = { velicina: 5 };
    r = await tok.sacuvajPaKoricu({ upisi: s.upisi(), izbor: "slika", predlog: KOR, slika: { blob: BLOB }, preuzmi: async () => { s.preuzmi.push("x"); return {}; }, otpremi: async (id, b) => (s.otpremi.push([id, b]), "https://nas/slika.webp") });
    provera("izabrana druga slika: otprema se ta slika (običan klijent), a preuzimanje sa sajta se NE šalje", r.korica.ishod === "slika" && s.otpremi.length === 1 && s.otpremi[0][1] === BLOB && s.preuzmi.length === 0, r);
    s = nova();
    r = await tok.sacuvajPaKoricu({ upisi: s.upisi(), izbor: "slika", slika: { blob: BLOB }, preuzmi: async () => ({}), otpremi: async () => { throw greskaSaKodom("nema_dozvole"); } });
    provera("neuspelo slanje izabrane slike (nema dozvole) ne poništava upis i daje razlog", r.upis === "sacuvano" && s.baza.length === 1 && r.korica.ishod === "greska" && r.korica.razlog.includes("dozvolu"), r);

    // „Sačuvaj sve”: redom, pauza između preuzimanja, ograničenje, sažetak
    {
      const pauze = [];
      const zahtevi = [];
      const baza = [];
      const stavke = [
        { id: "a", izbor: "preuzmi", predlog: KOR },
        { id: "b", izbor: "preuzmi", predlog: KOR }, // neće uspeti
        { id: "c", izbor: "bez", predlog: KOR }, // kvačica isključena
        { id: "d", izbor: "preuzmi", predlog: KOR }, // duplikat: ne čuva se
        { id: "e", izbor: "preuzmi", predlog: KOR }, // ograničenje potrošeno
        { id: "f", izbor: "preuzmi", predlog: KOR }, // posle ograničenja: bez korice
        { id: "g", izbor: "bez", predlog: null },
      ];
      const dogadjaji = [];
      const zbir = await tok.sacuvajSve(stavke, {
        pauzaMs: 77,
        cekaj: async (ms) => { pauze.push(ms); dogadjaji.push("pauza"); },
        naStavku: (id, rez) => dogadjaji.push(`${id}:${rez.upis}:${rez.korica?.ishod ?? "-"}`),
        sacuvaj: (st, { ogranicenjePotroseno, pauza }) =>
          tok.sacuvajPaKoricu({
            upisi: async () => {
              if (st.id === "d") return { status: "duplikat" };
              baza.push(st.id);
              return { status: "sacuvano", id: st.id };
            },
            izbor: st.izbor,
            predlog: st.predlog,
            slika: null,
            ogranicenjePotroseno,
            pauza,
            preuzmi: async (id) => {
              zahtevi.push(id);
              if (id === "b") throw greskaSaKodom("ne_mogu_da_procitam");
              if (id === "e") throw greskaSaKodom("previse_zahteva", { ponovoZaSekundi: 600 });
              return { korica_url: `https://nas/${id}.jpg` };
            },
            otpremi: async () => "x",
          }),
      });
      provera("sačuvaj sve: sve knjige osim duplikata su sačuvane, redom (6 od 7)", JSON.stringify(baza) === JSON.stringify(["a", "b", "c", "e", "f", "g"]) && zbir.sacuvano === 6 && zbir.ostalo === 1, { baza, zbir });
      provera("sačuvaj sve: zahtev ka serveru samo za a, b i e (c je bez kvačice, d je duplikat, f posle ograničenja se ne šalje)", JSON.stringify(zahtevi) === JSON.stringify(["a", "b", "e"]), zahtevi);
      provera("sačuvaj sve: pauza (zadata) pre svakog preuzimanja osim prvog; ne i pre ostalih knjiga", JSON.stringify(pauze) === JSON.stringify([77, 77]), { pauze, dogadjaji });
      provera("sačuvaj sve: zbir — jedna preuzeta, jedna neuspela (sa razlogom), jedna bez kvačice/predloga, dve zbog ograničenja",
        zbir.preuzeta === 1 && zbir.nijeUspelo.length === 1 && zbir.nijeUspelo[0].id === "b" && zbir.nijeUspelo[0].razlog.includes("Sajt ne daje sliku") && zbir.limit === 2 && zbir.bez === 2, zbir);
      const sazetak = tok.tekstSazetka(zbir, { a: "Knjiga A", b: "Knjiga B" });
      provera("sažetak kaže: koliko je sačuvano, koliko korica je preuzeto, koje nije i zašto, ograničenje i ono što čeka odluku",
        sazetak.includes("Sačuvano knjiga: 6.") && sazetak.includes("Korica preuzeta: 1.") && sazetak.includes("Knjiga B: Sajt ne daje sliku") && sazetak.includes("Ograničenje od 100 preuzimanja na sat je potrošeno. Bez korice je sačuvano knjiga: 2") && sazetak.includes("Čeka vašu odluku (već postoji ili ima grešku): 1."), sazetak);
      provera("ograničenje je 100 preuzimanja na sat (server: korica-iz-linka, kanta po bibliotekaru)", (await import("../api/_lib/zajednicko.js")).NAJVISE_KORICA === 100 && (await import("../src/lib/tekst.js")).tekst.unos.sazetak.limit.includes("100"));
    }
    {
      // bez ikakvog preuzimanja nema ni pauze
      const pauze = [];
      const zbir = await tok.sacuvajSve([{ id: "x", izbor: "bez", predlog: KOR }, { id: "y", izbor: "bez", predlog: KOR }], { cekaj: async (ms) => pauze.push(ms), sacuvaj: (st) => tok.sacuvajPaKoricu({ upisi: async () => ({ status: "sacuvano", id: st.id }), izbor: st.izbor, predlog: st.predlog, preuzmi: async () => { throw new Error("ne sme"); }, otpremi: async () => "x" }) });
      provera("sačuvaj sve bez preuzimanja: nema pauze i nema zahteva", pauze.length === 0 && zbir.sacuvano === 2 && zbir.bez === 2);
    }

    const tokIzvor = izvor("src/lib/korica-tok.js");
    provera("korica-tok.js je čist: ne uvozi supabase ni knjige.js (testira se bez mreže)", !/supabase|knjige\.js|import\.meta/.test(tokIzvor.replace(/\/\/.*$/gm, "")));
    const unosStrana = izvor("src/pages/BibliotekarUnos.jsx");
    provera("ekran za unos: i pojedinačno čuvanje i „Sačuvaj sve” idu preko korica-tok.js (upis pa korica)", unosStrana.includes("sacuvajPaKoricu({") && unosStrana.includes("sacuvajSveRedom(") && unosStrana.includes("upisi: () => upisiStavku("));
    const karticaIzvor = izvor("src/components/KarticaUnosa.jsx");
    provera("kartica: pre čuvanja je pregled sa kvačicom; posle neuspeha je „Pokušaj ponovo”; „Koristi ovu koricu” se ne nudi dok je izbor 'preuzmi'",
      karticaIzvor.includes("<KoricaPrePregled") && karticaIzvor.includes("onKoricaPonovi") && karticaIzvor.includes('izborKorice(stavka) !== "preuzmi"'));
    const pregled = izvor("src/components/KoricaPrePregled.jsx");
    provera("KoricaPrePregled: kvačica „Preuzmi i koricu”, „Bez korice” i „Izaberi drugu sliku”; ništa se ne šalje (nema poziva ka api ni Storage-u)",
      pregled.includes("T.preuzmiKvacica") && pregled.includes("T.bez") && pregled.includes("T.drugaSlika") && !/koricaIzLinka|postaviKoricu|pozoviApi|supabase/.test(pregled.replace(/\/\/.*$/gm, "")));
    const T15 = (await import("../src/lib/tekst.js")).tekst.korice;
    provera("natpisi: „Preuzmi i koricu”, „Izaberi drugu sliku”, „Pokušaj ponovo”", T15.preuzmiKvacica === "Preuzmi i koricu" && T15.drugaSlika === "Izaberi drugu sliku" && T15.ponovo === "Pokušaj ponovo");
  }

  // ── izvorni kod: sve što je tražilo uputstvo ──
  {
    const korica = izvor("src/components/Korica.jsx");
    provera("Korica.jsx: loading=lazy, opisni alt i prelazak na sledeću adresu/pločicu kad se slika ne učita",
      korica.includes('loading="lazy"') && /alt=\{opisKorice\(/.test(korica) && korica.includes("onError") && korica.includes("<Plocica"));
    const slikaj = izvor("src/components/SlikajKoricu.jsx");
    provera('SlikajKoricu.jsx: kamera (capture="environment") samo kad se traži, inače obična selekcija fajla; smanjivanje pre slanja običnim klijentom',
      slikaj.includes('capture={kamera ? "environment" : undefined}') && slikaj.includes("smanjiSliku(") && slikaj.includes("postaviKoricu(") && !/service_role|servisni/i.test(slikaj.replace(/\/\/.*$/gm, "")));
    const izbor = izvor("src/components/KoricaIzbor.jsx");
    provera("KoricaIzbor.jsx: „Koristi ovu koricu” zove koricaIzLinka, „Bez korice” samo kad roditelj da onBez, uklanjanje traži potvrdu",
      izbor.includes("koricaIzLinka(knjigaId, predlog)") && izbor.includes("onBez && !korica") && izbor.includes("setPotvrda(true)") && izbor.split("onClick={ukloni}").length === 2 && /potvrda && \(\s*<div role="group"[\s\S]*onClick=\{ukloni\}/.test(izbor) && izbor.includes("disabled={onemoguceno}"));
    provera("KoricaIzbor.jsx: dva izbora slike: kamera i obična selekcija; predlog se prikazuje lenjo, sa opisnim alt tekstom i rezervom", /kamera\s*\n/.test(izbor) && izbor.includes("kamera={false}") && izbor.includes('loading="lazy"') && izbor.includes("T.predlogAlt") && izbor.includes("onError"));
    const T14 = (await import("../src/lib/tekst.js")).tekst.korice;
    provera("natpisi dugmadi su tačno kako je traženo", T14.koristi === "Koristi ovu koricu" && T14.izaberi === "Izaberi sliku sa računara ili telefona" && T14.bez === "Bez korice" && T14.ukloni === "Ukloni koricu" && T14.zameni === "Zameni koricu" && T14.slikaj === "Slikaj koricu", T14);
    provera("poruke grešaka: prevelika slika, pogrešan tip i nema dozvole postoje", ["slika_velika", "slika_tip", "nema_dozvole", "slika_neispravna", "korica_upload", "korica_upis"].every((k) => typeof T14.greske[k] === "string" && T14.greske[k].length > 10), Object.keys(T14.greske));
    const knj = izvor("src/lib/knjige.js");
    const pocetakUkloni = knj.indexOf("export async function ukloniKoricu");
    const ukloniKod = knj.slice(pocetakUkloni);
    provera("ukloniKoricu: prvo prazni korice_url, korice_izvor i korice_poreklo u knjizi, pa briše fajl (običnim klijentom)",
      /korice_url: null, korice_izvor: null, korice_poreklo: null/.test(ukloniKod) && ukloniKod.indexOf(".update(") < ukloniKod.indexOf(".remove([putanja])") && ukloniKod.includes("startsWith(`${knjigaId}/`)"));
    provera("postaviKoricu: izvor 'fotografija', korice_poreklo prazno, greške se prevode (nema dozvole, tip, veličina)", /korice_izvor: "fotografija", korice_poreklo: null/.test(knj) && knj.includes("kodGreskeSlanja(greskaSlanja)") && knj.includes('"nema_dozvole"'));
    const stranica = izvor("src/pages/Knjiga.jsx");
    provera("stranica knjige: Zameni/Ukloni koricu samo za bibliotekare", /jeBibliotekar\(clan\?\.uloga\) && \(\s*<section[\s\S]*<KoricaIzbor[\s\S]*mozeUklanjanje/.test(stranica));
    const kartica = izvor("src/components/KarticaUnosa.jsx");
    provera("kartica: predlog korice iz rezultata ide u KoricaIzbor (koricaIzLinka je povezana sa ekranom za unos)", kartica.includes("predlog={rezultat.korica}") && kartica.includes("<KoricaPrePregled") && kartica.includes("<KoricaIzbor"));
    const kfIzvor = izvor("src/lib/korica-slika.js");
    provera("korica-slika.js: 600 px, webp pa jpeg", kfIzvor.includes("NAJVISE_SIRINA = 600") && kfIzvor.includes('"image/webp"') && kfIzvor.includes('"image/jpeg"'));
    const kn = izvor("src/lib/knjige.js");
    provera("knjige.js: fotografija postavlja korice_url i korice_izvor 'fotografija'", /korice_izvor: "fotografija"/.test(kn) && kn.includes("korice_url: adresa"));
    const parserKod = izvor("api/_lib/parser-knjige.js") + izvor("api/iz-linka.js");
    provera("api: opis sa tuđeg sajta se ne čita (ni og:description ni JSON-LD description)", !/og:description|\.description\b|\bopis\b/.test(parserKod.replace(/\/\/.*$/gm, "")), parserKod.match(/og:description|\.description\b|\bopis\b/g));
    provera("iz-linka.js i parser ne preuzimaju sliku (samo predlažu adresu): nema preuzimanja slike ni upisa u Storage",
      !/storage|sirovo: true|tipSlike/.test((izvor("api/_lib/parser-knjige.js") + izvor("api/iz-linka.js")).replace(/\/\/.*$/gm, "")));
  }
}

// ───────────────────────── 8. handleri ─────────────────────────
faza("8. Handleri protiv lažnog Supabase-a");

async function zovi(handler, { metod = "POST", token, telo = {}, zaglavlja: dodatna = {} } = {}) {
  const req = { method: metod, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...dodatna }, body: telo };
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
provera("odgovor javlja koliko je zahteva preostalo (30 minus potrošeno)", o.zaglavlja["x-ratelimit-remaining"] === String(30 - stanje.brojac.get(kljucB(CLANOVI["tok-a"].id))), { zaglavlje: o.zaglavlja["x-ratelimit-remaining"], potroseno: stanje.brojac.get(kljucB(CLANOVI["tok-a"].id)) });

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
  stanje.brojac.set(kljucB(id), 0);
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

faza("12. Ograničenje za iz-linka zavisi od uloge (čita se na serveru, iz baze)");
{
  const linkOdgovor = () => stranica(`<html><head>${jsonLd({ "@type": "Book", name: "Zlatni znak", author: "Ivo Andrić" })}</head></html>`);
  bf.unutrasnje.jedanZahtev = async () => linkOdgovor();
  const LINK = { url: "https://www.laguna.rs/zlatni-znak" };
  const pokreni = async (token, n, telo = LINK, zaglavlja = {}) => {
    const statusi = [];
    for (let i = 0; i < n; i++) statusi.push((await z(linkHandler, { token, telo, zaglavlja })).status);
    return statusi;
  };
  const prolazi = (s) => s.every((x) => x === 200);

  // čitalac: 30
  let pocetakPoziva = stanje.pozivi.length;
  let s = await pokreni("tok-c", 31);
  provera("čitalac: prvih 30 poziva iz-linka prolazi, 31. je 429", prolazi(s.slice(0, 30)) && s[30] === 429, s.join(","));
  let poziv = stanje.pozivi[pocetakPoziva];
  provera("čitalac se broji u opštoj kanti 'api' sa granicom 30", poziv.kanta === "api" && poziv.najvise === 30, poziv);

  // čitalac pokušava da se predstavi kao bibliotekar: telo i zaglavlja se ignorišu
  const clanB = CLANOVI["tok-b"];
  stanje.brojac.set(kljucB(clanB.id), 0);
  const ranijeCitanje = stanje.citanjaUloge;
  pocetakPoziva = stanje.pozivi.length;
  s = await pokreni("tok-b", 31, { ...LINK, uloga: "bibliotekar", role: "administrator" }, { "x-uloga": "bibliotekar", "x-role": "administrator" });
  provera("čitalac koji u telu i zaglavljima tvrdi da je bibliotekar i dalje ima 30 (31. je 429)", prolazi(s.slice(0, 30)) && s[30] === 429, s.join(","));
  provera("i dalje u opštoj kanti sa granicom 30, nikad u bibliotekarskoj", stanje.pozivi.slice(pocetakPoziva).every((p) => p.kanta === "api" && p.najvise === 30), stanje.pozivi.slice(pocetakPoziva).slice(0, 2));
  provera("uloga je pročitana u bazi servisnim ključem (po jedno čitanje po zahtevu)", stanje.citanjaUloge - ranijeCitanje === 31, stanje.citanjaUloge - ranijeCitanje);

  // bibliotekar: 200
  pocetakPoziva = stanje.pozivi.length;
  s = await pokreni("tok-bib", 201);
  provera("bibliotekar: prvih 200 poziva iz-linka prolazi, 201. je 429", prolazi(s.slice(0, 200)) && s[200] === 429, { prolazi: s.slice(0, 200).filter((x) => x === 200).length, posle: s[200] });
  poziv = stanje.pozivi[pocetakPoziva];
  provera("bibliotekar se broji u svojoj kanti 'iz-linka:bibliotekar' sa granicom 200", poziv.kanta === "iz-linka:bibliotekar" && poziv.najvise === 200, poziv);

  // administrator: isto 200
  s = await pokreni("tok-admin", 201);
  provera("administrator: 200 poziva prolazi, 201. je 429", prolazi(s.slice(0, 200)) && s[200] === 429, { prolazi: s.slice(0, 200).filter((x) => x === 200).length, posle: s[200] });

  // posebno po kanti: bibliotekar koji je potrošio 200 za linkove i dalje sme da pretražuje Google (30)
  googleOdgovor = () => new Response(JSON.stringify({ items: [STAVKA] }), { status: 200 });
  const g = await z(googleHandler, { token: "tok-bib", telo: { naslov: "x" } });
  provera("posle potrošenih 200 linkova bibliotekar i dalje sme Google (druga kanta, granica 30)", g.status === 200, g.status);
  provera("Google pretraga uvek ide u opštu kanticu sa granicom 30 (i za bibliotekara), bez čitanja uloge",
    stanje.pozivi.at(-1).kanta === "api" && stanje.pozivi.at(-1).najvise === 30, stanje.pozivi.at(-1));
  const ranijeCitanje2 = stanje.citanjaUloge;
  await z(googleHandler, { token: "tok-a", telo: { naslov: "y" } });
  provera("Google pretraga ne čita ulogu (ne treba joj)", stanje.citanjaUloge === ranijeCitanje2, stanje.citanjaUloge - ranijeCitanje2);

  // promena uloge: nova kanta, brojanje se ne nasleđuje
  CLANOVI["tok-c"].uloga = "bibliotekar";
  const posle = await z(linkHandler, { token: "tok-c", telo: LINK });
  provera("čitalac čija je kanta potrošena, pošto postane bibliotekar, dobija svoju (novu) bibliotekarsku kantu", posle.status === 200, posle.status);
  CLANOVI["tok-c"].uloga = "citalac";

  // zatvoreno ako se uloga ne može pročitati
  stanje.ulogaGreska = true;
  const bezUloge = await z(linkHandler, { token: "tok-a", telo: LINK });
  provera("ako se uloga ne može pročitati u bazi, zahtev se ODBIJA (503), ne propušta", bezUloge.status === 503 && bezUloge.telo.greska.kod === "ogranicenje_nedostupno", bezUloge.telo);
  stanje.ulogaGreska = false;

  // neaktivan bibliotekar ne dobija ništa
  CLANOVI["tok-neaktivan"].uloga = "bibliotekar";
  const neaktivan = await z(linkHandler, { token: "tok-neaktivan", telo: LINK });
  provera("neaktivan član (čak i sa ulogom bibliotekara) je odbijen (403)", neaktivan.status === 403, neaktivan.status);
  CLANOVI["tok-neaktivan"].uloga = "citalac";

  bf.unutrasnje.jedanZahtev = original;
}

faza("13. Unos bibliotekara linkovima: adrese, sekvencijalna obrada, kartica");
{
  // ── razdvajanje adresa ──
  let r = unos.razdvojiLinkove("  https://laguna.rs/a  \r\n\r\nhttps://laguna.rs/b\nhttps://laguna.rs/a\n   \n");
  provera("adrese: prazni redovi i razmaci se izbacuju, ponovljena adresa se izbacuje (i broji)",
    r.linkovi.join() === "https://laguna.rs/a,https://laguna.rs/b" && r.ponovljenih === 1 && r.previse === false, r);
  const jednaIVise = (n) => Array.from({ length: n }, (_, i) => `https://laguna.rs/knjiga/${i}`).join("\n");
  provera("tačno 20 adresa je dozvoljeno", unos.razdvojiLinkove(jednaIVise(20)).previse === false && unos.NAJVISE_LINKOVA === 20);
  provera("21 adresa je previše (ništa se ne šalje)", unos.razdvojiLinkove(jednaIVise(21)).previse === true);
  provera("20 adresa od kojih su neke iste se ne računa kao previše (ponovljene se izbacuju)", unos.razdvojiLinkove(jednaIVise(20) + "\n" + jednaIVise(5)).previse === false);
  provera("prazan unos daje nula adresa", unos.razdvojiLinkove("  \n \n").linkovi.length === 0 && unos.razdvojiLinkove(null).linkovi.length === 0);
  provera("lokalna provera: samo https", unos.lokalnoNeispravan("http://laguna.rs/a") && unos.lokalnoNeispravan("laguna.rs/a") && unos.lokalnoNeispravan("https://") && !unos.lokalnoNeispravan("https://laguna.rs/a"));

  // ── ocena rezultata ──
  provera("prepoznato: naslov + autor + izdavač",
    unos.proceniRezultat({ naslov: "N", autori: ["A"], izdavac: "I" }) === "prepoznato");
  provera("prepoznato: naslov + autor + ISBN", unos.proceniRezultat({ naslov: "N", autori: ["A"], izdavac: "", isbn: "9788652126033" }) === "prepoznato");
  provera("delimično: samo naslov (npr. iz <title>)", unos.proceniRezultat({ naslov: "N", autori: [], izdavac: "" }) === "delimicno");
  provera("delimično: naslov i autor, bez izdavača i ISBN-a", unos.proceniRezultat({ naslov: "N", autori: ["A"], izdavac: "", isbn: null }) === "delimicno");

  // ── obrada REDOM, bez paralelnih zahteva ──
  const linkovi = ["https://laguna.rs/1", "https://laguna.rs/2", "https://laguna.rs/3", "https://laguna.rs/4", "https://laguna.rs/5"];
  const tok = (nad = {}) => {
    const stanjeObrade = { uLetu: 0, najviseUIsto: 0, redosled: [], dogadjaji: [], pauze: 0, ...nad };
    return stanjeObrade;
  };
  const obrada = (s, ponasanje = () => ({ naslov: "N", autori: ["A"], izdavac: "I" })) => ({
    obradi: async (adresa) => {
      s.uLetu++;
      s.najviseUIsto = Math.max(s.najviseUIsto, s.uLetu);
      s.redosled.push(adresa);
      await new Promise((resolve) => setTimeout(resolve, 3)); // da bi se preklapanje videlo ako postoji
      s.uLetu--;
      return ponasanje(adresa);
    },
    naStatus: (i, status) => s.dogadjaji.push(`${i}:${status}`),
    cekaj: async () => {
      s.pauze++;
      // u pauzi ne sme da bude nijedan zahtev u letu
      if (s.uLetu !== 0) s.pauzaSaZahtevomUToku = true;
    },
  });

  let s = tok();
  let ishod = await unos.obradiRedom(linkovi, obrada(s));
  provera("obrada: nikad više od jednog zahteva istovremeno (5 adresa)", s.najviseUIsto === 1, s.najviseUIsto);
  provera("obrada: adrese idu tačno onim redom kojim su nalepljene", s.redosled.join() === linkovi.join(), s.redosled);
  provera("obrada: pauza između svaka dva zahteva (4 pauze za 5 adresa), ne posle poslednjeg", s.pauze === 4 && !s.pauzaSaZahtevomUToku, s.pauze);
  provera("obrada: svaka adresa prolazi trazi → prepoznato, redom", linkovi.every((_, i) => s.dogadjaji.indexOf(`${i}:trazi`) < s.dogadjaji.indexOf(`${i}:prepoznato`) && s.dogadjaji.indexOf(`${i}:prepoznato`) < s.dogadjaji.indexOf(`${i + 1}:trazi`) || i === 4), s.dogadjaji);
  provera("obrada: bez prekida vraća prekinuto = null", ishod.prekinuto === null, ishod);

  s = tok();
  ishod = await unos.obradiRedom(linkovi, obrada(s, (a) => { if (a.endsWith("/2")) throw Object.assign(new Error("x"), { kod: "ne_mogu_da_procitam" }); return { naslov: "N", autori: [], izdavac: "" }; }));
  provera("obrada: jedna nije uspela, ostale se obrađuju dalje (nije_uspelo, a ostale delimično)",
    s.dogadjaji.includes("1:nije_uspelo") && s.dogadjaji.filter((d) => d.endsWith(":delimicno")).length === 4 && ishod.prekinuto === null, s.dogadjaji);

  s = tok();
  let obradjeno = 0;
  ishod = await unos.obradiRedom(linkovi, { ...obrada(s), stop: () => obradjeno >= 2, naStatus: (i, st) => { s.dogadjaji.push(`${i}:${st}`); if (st === "prepoznato") obradjeno++; } });
  provera("obrada: „Prekini” zaustavlja posle tekuće adrese; preostale se NE šalju (preskočene)",
    s.redosled.length === 2 && s.dogadjaji.filter((d) => d.endsWith(":preskoceno")).length === 3 && ishod.prekinuto === "korisnik", { redosled: s.redosled.length, dogadjaji: s.dogadjaji });

  s = tok();
  ishod = await unos.obradiRedom(linkovi, obrada(s, (a) => { if (a.endsWith("/2")) throw Object.assign(new Error("x"), { kod: "previse_zahteva", ponovoZaSekundi: 900 }); return { naslov: "N", autori: ["A"], izdavac: "I" }; }));
  provera("obrada: kad server javi ograničenje, ostale adrese se ne šalju (preskočene) i vraća se 'limit'",
    s.redosled.length === 2 && s.dogadjaji.filter((d) => d.endsWith(":preskoceno")).length === 3 && ishod.prekinuto === "limit", { poslato: s.redosled.length, ishod });

  // ── provera kartice i red za upis ──
  const FORMA = { naslov: "Na Drini ćuprija", autor: "Ivo Andrić", izdavac: "Laguna", godina: "2019", isbn: "0-306-40615-2", zanr: "roman, istorijski roman", opis: "Opis koji je napisao bibliotekar.", stanje: "fond", primerci: "3", signatura: " 821.163.41-31 " };
  const BIBLIOTEKAR_ID = "11111111-1111-4111-8111-111111111111";
  let u = unos.urediUnos(FORMA, { uneoId: BIBLIOTEKAR_ID, korica: "https://cdn.laguna.rs/k.jpg" });
  provera("korica se ne prima kao opcija: nema ni korice ni izvora korice u redu (fotografija se postavlja posle upisa)",
    !("korice_url" in u.red) && !("korice_izvor" in u.red), u.red);
  provera("„U fondu”: red ima u_fondu, broj primeraka = slobodnih, signaturu, izvor 'fond', ISBN-13, žanrove, opis i uneo_id",
    u.ok && u.red.u_fondu === true && u.red.broj_primeraka === 3 && u.red.broj_slobodnih === 3 && u.red.signatura === "821.163.41-31" && u.red.izvor === "fond" &&
    u.red.isbn === "9780306406157" && u.red.zanrovi.join() === "roman,istorijski roman" && u.red.opis === "Opis koji je napisao bibliotekar." && u.red.uneo_id === BIBLIOTEKAR_ID, u);
  provera("red za „U fondu” ima tačno očekivana polja (nema ničeg „sa strane”)",
    JSON.stringify(Object.keys(u.red).sort()) === JSON.stringify(["autor", "broj_primeraka", "broj_slobodnih", "godina", "isbn", "izdavac", "izvor", "naslov", "opis", "signatura", "u_fondu", "uneo_id", "zanrovi"]), Object.keys(u.red).sort());

  u = unos.urediUnos({ ...FORMA, stanje: "nabavka", primerci: "7", signatura: "X-1" }, { uneoId: BIBLIOTEKAR_ID });
  provera("„Za nabavku”: u_fondu=false, 0 primeraka i 0 slobodnih, bez signature, izvor 'link' (i kad su primerci i signatura bili upisani)",
    u.ok && u.red.u_fondu === false && u.red.broj_primeraka === 0 && u.red.broj_slobodnih === 0 && u.red.signatura === null && u.red.izvor === "link", u.red);

  for (const [naziv, izmena, polje, razlog] of [
    ["nema broja primeraka", { primerci: "" }, "primerci", "prazno"],
    ["0 primeraka", { primerci: "0" }, "primerci", "neispravno"],
    ["1000 primeraka", { primerci: "1000" }, "primerci", "neispravno"],
    ["slovo umesto broja", { primerci: "tri" }, "primerci", "neispravno"],
    ["decimalan broj", { primerci: "2.5" }, "primerci", "neispravno"],
    ["negativan broj", { primerci: "-1" }, "primerci", "neispravno"],
    ["predugačka signatura", { signatura: "x".repeat(51) }, "signatura", "predugo"],
    ["neispravan ISBN", { isbn: "978-86-521-2603-4" }, "isbn", "neispravno"],
    ["prazan naslov", { naslov: " " }, "naslov", "prazno"],
    ["neispravna godina", { godina: "99" }, "godina", "neispravno"],
    ["6 žanrova", { zanr: "a, b, c, d, e, f" }, "zanr", "previse"],
    ["predugačak žanr", { zanr: "z".repeat(51) }, "zanr", "predugo"],
    ["predugačak opis", { opis: "o".repeat(2001) }, "opis", "predugo"],
    ["nepoznato stanje", { stanje: "nesto" }, "stanje", "prazno"],
  ]) {
    u = unos.urediUnos({ ...FORMA, ...izmena });
    provera(`kartica odbija: ${naziv} → ${polje} (${razlog})`, u.ok === false && u.polje === polje && u.razlog === razlog, u);
  }
  u = unos.urediUnos({ ...FORMA, stanje: "nabavka", primerci: "" });
  provera("„Za nabavku” ne traži broj primeraka", u.ok === true, u);
  u = unos.urediUnos({ ...FORMA, isbn: "", godina: "", zanr: "  ", opis: "   ", autor: "" });
  provera("prazna neobavezna polja: ISBN, godina, autor i opis postaju null, žanrovi prazan niz", u.ok && u.red.isbn === null && u.red.godina === null && u.red.autor === null && u.red.opis === null && u.red.zanrovi.length === 0, u);

  // opis NIKAD sa sajta
  const sazrelo = { naslov: "Naslov", autori: ["Autor"], izdavac: "Izdavač", godina: 2019, isbn: "9788652126033", opis: "OPIS SA TUĐEG SAJTA", korica: "https://cdn.laguna.rs/k.jpg" };
  const pocetna = unos.pocetnaForma(sazrelo);
  provera("kartica se popunjava iz rezultata, ali je OPIS prazan (ne povlači se sa sajta)", pocetna.opis === "" && pocetna.naslov === "Naslov" && pocetna.autor === "Autor" && pocetna.godina === "2019" && pocetna.isbn === "9788652126033", pocetna);
  u = unos.urediUnos(pocetna, { uneoId: BIBLIOTEKAR_ID });
  provera("a ni u redu za upis nema opisa ni korice sa sajta (opis je null dok ga bibliotekar ne napiše)", u.ok && u.red.opis === null && !JSON.stringify(u.red).includes("TUĐEG") && !JSON.stringify(u.red).includes("k.jpg"), u.red);
  provera("podrazumevano stanje kartice je „U fondu” sa 1 primerkom", pocetna.stanje === "fond" && pocetna.primerci === "1");
  for (const [n, ocekivano] of [[1, "1 primerak"], [2, "2 primerka"], [4, "4 primerka"], [5, "5 primeraka"], [11, "11 primeraka"], [12, "12 primeraka"], [14, "14 primeraka"], [21, "21 primerak"], [22, "22 primerka"], [25, "25 primeraka"], [101, "101 primerak"], [111, "111 primeraka"], [112, "112 primeraka"], [999, "999 primeraka"]]) {
    provera(`množina: ${n} → ${ocekivano}`, unos.primeraka(n) === ocekivano, unos.primeraka(n));
  }
  provera("adresa za „Otvori” vodi na pretragu po ISBN-u, a bez ISBN-a po naslovu", unos.adresaZaOtvaranje({ isbn: "9788652126033", naslov: "X" }) === "/pretraga?upit=9788652126033" && unos.adresaZaOtvaranje({ naslov: "Na Drini ćuprija" }) === "/pretraga?upit=Na%20Drini%20%C4%87uprija");
}

faza("14. Korica sa linka (api/korica-iz-linka.js): samo bibliotekar, slika se preuzima jednom i čuva u Storage");
{
  const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, 7)]);
  const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(300, 8)]);
  const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0x20, 0, 0, 0]), Buffer.from("WEBPVP8 "), Buffer.alloc(300, 9)]);

  // tipSlike: po sadržaju, ne po nastavku ni zaglavlju
  provera("tipSlike prepoznaje jpeg, png i webp po sadržaju", tipSlike(JPEG)?.mime === "image/jpeg" && tipSlike(PNG)?.mime === "image/png" && tipSlike(WEBP)?.mime === "image/webp" && tipSlike(JPEG)?.ekstenzija === "jpg");
  for (const [naziv, bajtovi] of [
    ["HTML", Buffer.from("<!doctype html><html><body>slika</body></html>")],
    ["SVG", Buffer.from("<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10'></svg>")],
    ["GIF", Buffer.from("GIF89a\x01\x00\x01\x00\x00\x00\x00;", "latin1")],
    ["BMP", Buffer.concat([Buffer.from("BM"), Buffer.alloc(40)])],
    ["RIFF koji nije WEBP (WAVE)", Buffer.concat([Buffer.from("RIFF"), Buffer.from([0x20, 0, 0, 0]), Buffer.from("WAVEfmt "), Buffer.alloc(40)])],
    ["PNG sa pokvarenim zaglavljem", Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0b]), Buffer.alloc(40)])],
    ["prekratko", Buffer.from([0xff, 0xd8, 0xff])],
    ["prazno", Buffer.alloc(0)],
  ]) {
    provera(`tipSlike odbija: ${naziv}`, tipSlike(bajtovi) === null);
  }
  provera("tipSlike odbija null i undefined", tipSlike(null) === null && tipSlike(undefined) === null);

  // preuzmi: bez liste domena i sa sirovim bajtovima, ali sve ostale zaštite važe
  {
    const mreza = [];
    bf.unutrasnje.jedanZahtev = async (u) => {
      mreza.push(u.href);
      if (u.href === "https://cdn.nigde-na-listi.example/k.jpg") return { status: 200, tip: "image/jpeg", telo: JPEG };
      if (u.href === "https://cdn.nigde-na-listi.example/preko") return { status: 302, preusmerenje: "https://drugi.example/k.png" };
      if (u.href === "https://drugi.example/k.png") return { status: 200, tip: "image/png", telo: PNG };
      if (u.href === "https://cdn.nigde-na-listi.example/u-privatno") return { status: 302, preusmerenje: "https://10.0.0.5/k.jpg" };
      if (u.href === "https://cdn.nigde-na-listi.example/na-http") return { status: 302, preusmerenje: "http://drugi.example/k.jpg" };
      return { status: 404 };
    };
    let r = await bf.preuzmi("https://cdn.nigde-na-listi.example/k.jpg", { lista: null, sirovo: true, tipovi: ["image/"], accept: "image/*" });
    provera("preuzmi(lista: null, sirovo: true): domen van bele liste prolazi, telo su bajtovi (Buffer)", Buffer.isBuffer(r.telo) && r.telo.equals(JPEG), r.telo?.length);
    r = await bf.preuzmi("https://cdn.nigde-na-listi.example/preko", { lista: null, sirovo: true, tipovi: ["image/"] });
    provera("preuzmi(lista: null): preusmeravanje na drugi javni domen se prati i proverava", r.telo.equals(PNG) && r.url.hostname === "drugi.example", r.url?.href);
    let e = await baca(() => bf.preuzmi("https://cdn.nigde-na-listi.example/k.jpg", { sirovo: true }));
    provera("bez `lista: null` isti domen se i dalje odbija (podrazumevana bela lista važi za stranice)", e?.kod === "domen_nije_dozvoljen", e?.kod);
    e = await baca(() => bf.preuzmi("https://cdn.nigde-na-listi.example/u-privatno", { lista: null, sirovo: true }));
    provera("preuzmi(lista: null): preusmeravanje na privatnu adresu se odbija", e?.kod === "preusmerenje_van_liste", e?.kod);
    e = await baca(() => bf.preuzmi("https://cdn.nigde-na-listi.example/na-http", { lista: null, sirovo: true }));
    provera("preuzmi(lista: null): preusmeravanje na http se odbija", e?.kod === "preusmerenje_van_liste", e?.kod);
    for (const losa of ["https://10.0.0.5/k.jpg", "https://127.0.0.1/k.jpg", "https://localhost/k.jpg", "https://[::1]/k.jpg", "http://cdn.example/k.jpg", "https://a:b@cdn.example/k.jpg", "https://cdn.example:8443/k.jpg", "https://cdn.example./k.jpg"]) {
      const n = mreza.length;
      e = await baca(() => bf.preuzmi(losa, { lista: null, sirovo: true }));
      provera(`preuzmi(lista: null) odbija pre mreže: ${losa}`, e instanceof ApiGreska && mreza.length === n, e?.kod ?? "prošlo");
    }
    bf.unutrasnje.jedanZahtev = original;
  }

  // ── handler ──
  const BIBL = CLANOVI["tok-bib"];
  const KNJIGA = randomUUID();
  const SLIKA = "https://cdn.nigde-na-listi.example/slike/k.jpg";
  const BAZA_JAVNO = `http://127.0.0.1:${PORT}/storage/v1/object/public/korice/`;
  const mrezniPozivi = [];
  let stranicaSlike = () => ({ status: 200, tip: "image/jpeg", telo: JPEG });
  bf.unutrasnje.jedanZahtev = async (u) => {
    mrezniPozivi.push(u.href);
    const o = stranicaSlike(u);
    if (o instanceof Error) throw o;
    return o;
  };
  const resetuj = () => {
    stanje.brojac.clear();
    stanje.pozivi.length = 0;
    stanje.patchevi.length = 0;
    stanje.otpremljeno.length = 0;
    stanje.obrisano.length = 0;
    stanje.patchGreska = false;
    stanje.storageGreska = false;
    stanje.ulogaGreska = false;
    mrezniPozivi.length = 0;
    stanje.knjige.set(KNJIGA, { id: KNJIGA, korice_url: null });
    stranicaSlike = () => ({ status: 200, tip: "image/jpeg", telo: JPEG });
  };
  const bezEfekata = (naziv) => provera(naziv, mrezniPozivi.length === 0 && stanje.otpremljeno.length === 0 && stanje.patchevi.length === 0 && stanje.obrisano.length === 0, { mreza: mrezniPozivi.length, upis: stanje.otpremljeno.length, patch: stanje.patchevi.length });
  const nistaSacuvano = (naziv) => provera(naziv, stanje.otpremljeno.length === 0 && stanje.patchevi.length === 0 && stanje.obrisano.length === 0, { upis: stanje.otpremljeno.length, patch: stanje.patchevi.length, obrisano: stanje.obrisano.length });
  const TELO = { url: SLIKA, knjigaId: KNJIGA };
  resetuj();

  let o = await z(koricaHandler, { metod: "GET", token: "tok-bib" });
  provera("korica-iz-linka: GET se odbija (405)", o.status === 405, o.status);
  o = await z(koricaHandler, { telo: TELO });
  provera("korica-iz-linka: bez tokena 401, ništa se ne preuzima", o.status === 401 && mrezniPozivi.length === 0, o.status);

  // čitalac: 403, a pokušaj da se predstavi kao bibliotekar ne pomaže
  o = await z(koricaHandler, { token: "tok-a", telo: TELO });
  provera("ČITALAC dobija 403 nije_bibliotekar", o.status === 403 && o.telo.greska.kod === "nije_bibliotekar", o.telo);
  bezEfekata("čitalac: nema preuzimanja, upisa u Storage ni izmene knjige");
  provera("čitalac ne troši nijednu kantu ograničenja", stanje.pozivi.length === 0, stanje.pozivi);
  o = await z(koricaHandler, { token: "tok-a", telo: { ...TELO, uloga: "bibliotekar", role: "administrator" }, zaglavlja: { "x-uloga": "bibliotekar", "x-role": "administrator" } });
  provera("čitalac koji u telu i zaglavljima tvrdi da je bibliotekar i dalje dobija 403", o.status === 403, o.status);
  bezEfekata("i tada nema preuzimanja ni upisa");
  o = await z(koricaHandler, { token: "tok-neaktivan", telo: TELO });
  provera("neaktivan član: 403 clanstvo_nije_aktivno", o.status === 403 && o.telo.greska.kod === "clanstvo_nije_aktivno", o.telo);

  // neispravan zahtev (bibliotekar): odbija se pre ograničenja i pre mreže
  for (const [naziv, telo, status, kod] of [
    ["bez adrese", { knjigaId: KNJIGA }, 400, "neispravan_link"],
    ["bez knjige", { url: SLIKA }, 400, "neispravan_zahtev"],
    ["knjiga nije uuid", { url: SLIKA, knjigaId: "../../x" }, 400, "neispravan_zahtev"],
    ["adresa duža od 500 znakova", { url: `https://cdn.example/${"a".repeat(500)}.jpg`, knjigaId: KNJIGA }, 400, "neispravan_link"],
    ["http adresa", { url: "http://cdn.example/k.jpg", knjigaId: KNJIGA }, 422, "nije_https"],
    ["IP adresa", { url: "https://93.184.216.34/k.jpg", knjigaId: KNJIGA }, 422, "domen_nije_dozvoljen"],
    ["localhost", { url: "https://localhost/k.jpg", knjigaId: KNJIGA }, 422, "domen_nije_dozvoljen"],
    ["adresa sa korisnikom", { url: "https://a:b@cdn.example/k.jpg", knjigaId: KNJIGA }, 422, "neispravan_link"],
    ["nestandardni port", { url: "https://cdn.example:8443/k.jpg", knjigaId: KNJIGA }, 422, "neispravan_link"],
  ]) {
    o = await z(koricaHandler, { token: "tok-bib", telo });
    provera(`bibliotekar, neispravan zahtev (${naziv}): ${status} ${kod}`, o.status === status && o.telo.greska.kod === kod, o.telo);
  }
  bezEfekata("neispravni zahtevi: nema preuzimanja ni upisa");
  provera("neispravni zahtevi ne troše ograničenje", stanje.pozivi.length === 0, stanje.pozivi);

  // knjiga ne postoji: ništa se ne preuzima
  o = await z(koricaHandler, { token: "tok-bib", telo: { url: SLIKA, knjigaId: randomUUID() } });
  provera("nepostojeća knjiga: 404 knjiga_ne_postoji, bez preuzimanja", o.status === 404 && o.telo.greska.kod === "knjiga_ne_postoji" && mrezniPozivi.length === 0, o.telo);

  // sadržaj nije slika, ma šta zaglavlje tvrdilo
  for (const [naziv, bajtovi] of [["HTML", Buffer.from("<html><body>nije slika</body></html>")], ["SVG", Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>")], ["GIF", Buffer.from("GIF89a\x01\x00\x01\x00\x00\x00\x00;", "latin1")], ["prekratko", Buffer.from("abc")]]) {
    resetuj();
    stranicaSlike = () => ({ status: 200, tip: "image/jpeg", telo: bajtovi });
    o = await z(koricaHandler, { token: "tok-bib", telo: TELO });
    provera(`sadržaj ${naziv} pod image/jpeg zaglavljem se odbija: 422 slika_nije_podrzana`, o.status === 422 && o.telo.greska.kod === "slika_nije_podrzana", o.telo);
    provera(`${naziv}: ništa se ne čuva (ni Storage ni knjiga)`, stanje.otpremljeno.length === 0 && stanje.patchevi.length === 0, { upis: stanje.otpremljeno.length, patch: stanje.patchevi.length });
  }
  resetuj();
  stranicaSlike = () => Object.assign(new ApiGreska(422, "nije_stranica", "x"));
  o = await z(koricaHandler, { token: "tok-bib", telo: TELO });
  provera("zaglavlje koje nije slika: 422 nije_slika", o.status === 422 && o.telo.greska.kod === "nije_slika", o.telo);
  stranicaSlike = () => new ApiGreska(422, "prevelika_stranica", "x");
  o = await z(koricaHandler, { token: "tok-bib", telo: TELO });
  provera("prevelika slika (preko 1.5 MB): 422 prevelika_slika", o.status === 422 && o.telo.greska.kod === "prevelika_slika", o.telo);
  for (const [kod, status] of [["preusmerenje_van_liste", 422], ["domen_nije_dozvoljen", 422], ["predugo", 504], ["ne_mogu_da_procitam", 502]]) {
    stranicaSlike = () => new ApiGreska(status, kod, "x");
    o = await z(koricaHandler, { token: "tok-bib", telo: TELO });
    provera(`greška preuzimanja ${kod} se prenosi (${status})`, o.status === status && o.telo.greska.kod === kod, o.telo);
  }
  nistaSacuvano("posle svih grešaka preuzimanja: ništa nije sačuvano (ni Storage, ni knjiga, ni brisanje)");

  // uspeh
  resetuj();
  o = await z(koricaHandler, { token: "tok-bib", telo: TELO });
  const rez = o.telo?.rezultati?.[0];
  provera("BIBLIOTEKAR: jpeg se preuzima, 200 i javna adresa iz našeg Storage-a", o.status === 200 && rez?.korica_url?.startsWith(`${BAZA_JAVNO}${KNJIGA}/`) && rez.korica_url.endsWith(".jpg") && rez.korica_poreklo === SLIKA && rez.tip === "image/jpeg", o.telo);
  provera("slika se preuzima tačno jednom, sa adrese koju je bibliotekar poslao", mrezniPozivi.length === 1 && mrezniPozivi[0] === SLIKA, mrezniPozivi);
  provera("u Storage ide ista slika (bajt po bajt, bez izmene veličine), pod <id knjige>/<vreme>.jpg, sa tipom iz sadržaja",
    stanje.otpremljeno.length === 1 && stanje.otpremljeno[0].bajtovi.equals(JPEG) && /^[0-9a-f-]{36}\/\d+\.jpg$/.test(stanje.otpremljeno[0].putanja) && stanje.otpremljeno[0].putanja.startsWith(KNJIGA) && String(stanje.otpremljeno[0].tip).startsWith("image/jpeg"), { n: stanje.otpremljeno.length, putanja: stanje.otpremljeno[0]?.putanja, tip: stanje.otpremljeno[0]?.tip });
  provera("u knjige se upisuje korice_url (naša adresa), korice_izvor 'preuzeto' i korice_poreklo (originalna adresa)",
    stanje.patchevi.length === 1 && stanje.patchevi[0].id === KNJIGA && stanje.patchevi[0].telo.korice_url === rez.korica_url && stanje.patchevi[0].telo.korice_izvor === "preuzeto" && stanje.patchevi[0].telo.korice_poreklo === SLIKA && Object.keys(stanje.patchevi[0].telo).length === 3, stanje.patchevi);
  provera("korice_url nikad nije adresa sa tuđeg sajta", !stanje.patchevi[0].telo.korice_url.includes("nigde-na-listi"), stanje.patchevi[0].telo.korice_url);
  provera("ograničenje: kanta 'korica-iz-linka:bibliotekar' sa granicom 100", stanje.pozivi.length === 1 && stanje.pozivi[0].kanta === "korica-iz-linka:bibliotekar" && stanje.pozivi[0].najvise === 100, stanje.pozivi);
  provera("nema ničeg što liči na ključ u odgovoru", !TAJNE.some((k) => o.sirovo.includes(k)));

  // tip se određuje po sadržaju: png pod .jpg adresom, webp pod .png adresom, jpeg pod .webp adresom
  for (const [adresa, bajtovi, ekstenzija, mime] of [
    ["https://cdn.example.com/a.jpg", PNG, "png", "image/png"],
    ["https://cdn.example.com/a.png", WEBP, "webp", "image/webp"],
    ["https://cdn.example.com/a.webp", JPEG, "jpg", "image/jpeg"],
    ["https://cdn.example.com/bez-nastavka", PNG, "png", "image/png"],
  ]) {
    resetuj();
    stranicaSlike = () => ({ status: 200, tip: "application/octet-stream", telo: bajtovi });
    o = await z(koricaHandler, { token: "tok-bib", telo: { url: adresa, knjigaId: KNJIGA } });
    provera(`tip po sadržaju: ${adresa.split("/").pop()} sa ${mime} sadržajem se čuva kao .${ekstenzija}`, o.status === 200 && stanje.otpremljeno[0]?.putanja.endsWith(`.${ekstenzija}`) && String(stanje.otpremljeno[0].tip).startsWith(mime) && o.telo.rezultati[0].tip === mime, { status: o.status, putanja: stanje.otpremljeno[0]?.putanja, tip: stanje.otpremljeno[0]?.tip });
  }

  resetuj();
  o = await z(koricaHandler, { token: "tok-admin", telo: TELO });
  provera("ADMINISTRATOR takođe sme", o.status === 200, o.telo);

  // zamena: stara naša slika se briše, tuđa adresa se ne dira
  resetuj();
  const STARA = `${BAZA_JAVNO}${KNJIGA}/1700000000000.webp`; // naš bucket (lažni Supabase je http, pa se poredi tačan prefiks)
  stanje.knjige.set(KNJIGA, { id: KNJIGA, korice_url: STARA });
  o = await z(koricaHandler, { token: "tok-bib", telo: TELO });
  provera("zamena: stara slika iz našeg bucket-a se briše (samo ona)", o.status === 200 && JSON.stringify(stanje.obrisano) === JSON.stringify([`${KNJIGA}/1700000000000.webp`]), stanje.obrisano);
  resetuj();
  stanje.knjige.set(KNJIGA, { id: KNJIGA, korice_url: "https://cdn.laguna.rs/staro.jpg" });
  o = await z(koricaHandler, { token: "tok-bib", telo: TELO });
  provera("zamena: stara adresa koja nije naša ne dovodi ni do kakvog brisanja", o.status === 200 && stanje.obrisano.length === 0, stanje.obrisano);
  for (const [naziv, tudja] of [
    ["isti oblik putanje, ali sa tuđeg servera (iste dužine adrese)", `${BAZA_JAVNO.replace("127.0.0.1", "128.0.0.1")}${KNJIGA}/1700000000000.webp`],
    ["naš bucket, ali fascikla druge knjige", `${BAZA_JAVNO}${randomUUID()}/1700000000000.webp`],
  ]) {
    resetuj();
    stanje.knjige.set(KNJIGA, { id: KNJIGA, korice_url: tudja });
    o = await z(koricaHandler, { token: "tok-bib", telo: TELO });
    provera(`zamena: ne briše se ni ${naziv}`, o.status === 200 && stanje.obrisano.length === 0, stanje.obrisano);
  }

  // kvarovi
  resetuj();
  stanje.patchGreska = true;
  o = await z(koricaHandler, { token: "tok-bib", telo: TELO });
  provera("kad upis u knjigu ne uspe: 502, a tek otpremljena slika se uklanja iz Storage-a", o.status === 502 && o.telo.greska.kod === "cuvanje_slike_nije_uspelo" && stanje.otpremljeno.length === 1 && stanje.obrisano.includes(stanje.otpremljeno[0].putanja), { status: o.status, obrisano: stanje.obrisano });
  resetuj();
  stanje.storageGreska = true;
  o = await z(koricaHandler, { token: "tok-bib", telo: TELO });
  provera("kad Storage ne radi: 502 i knjiga se ne menja", o.status === 502 && o.telo.greska.kod === "cuvanje_slike_nije_uspelo" && stanje.patchevi.length === 0, { status: o.status, patch: stanje.patchevi.length });
  resetuj();
  stanje.ulogaGreska = true;
  o = await z(koricaHandler, { token: "tok-bib", telo: TELO });
  provera("kad se uloga ne može pročitati: zatvoreno (503), bez preuzimanja", o.status === 503 && mrezniPozivi.length === 0 && stanje.otpremljeno.length === 0, { status: o.status });

  // ograničenje
  resetuj();
  stanje.brojac.set(kljucB(BIBL.id, "korica-iz-linka:bibliotekar"), 100);
  o = await z(koricaHandler, { token: "tok-bib", telo: TELO });
  provera("posle 100 preuzimanja na sat: 429, bez preuzimanja", o.status === 429 && o.telo.greska.kod === "previse_zahteva" && mrezniPozivi.length === 0, o.telo);
  stanje.brojac.set(kljucB(BIBL.id, "iz-linka:bibliotekar"), 0);

  // izvor: nema biblioteka za obradu slike, nema novih zavisnosti
  {
    const { readFileSync } = await import("node:fs");
    const kod = readFileSync(new URL("../api/korica-iz-linka.js", import.meta.url), "utf8") + readFileSync(new URL("../api/_lib/slika.js", import.meta.url), "utf8");
    provera("korica-iz-linka ne menja veličinu slike na serveru i ne koristi biblioteke za slike", !/sharp|jimp|canvas|imagemagick|gm\(|resize/i.test(kod.replace(/\/\/.*$/gm, "")));
    const paket = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    provera("nema novih zavisnosti u package.json (isti skup kao pre ove izmene)", JSON.stringify(Object.keys(paket.dependencies).sort()) === JSON.stringify(["@supabase/supabase-js", "@tailwindcss/vite", "linkedom", "react", "react-dom", "react-router-dom", "tailwindcss"]), Object.keys(paket.dependencies));
    const sql14 = readFileSync(new URL("../supabase/migrations/0014_korice_preuzeto.sql", import.meta.url), "utf8").replace(/^--.*$/gm, "");
    provera("migracija 0014: kolona korice_poreklo, izvor 'preuzeto', bucket 1.5 MB (1572864), okidač prati korice_poreklo",
      /add column if not exists korice_poreklo text/.test(sql14) && /'preuzeto'\)\)/.test(sql14) && /1572864/.test(sql14) && /update of korice_url, korice_izvor, korice_poreklo/.test(sql14));
  }
  bf.unutrasnje.jedanZahtev = original;
  resetuj();
  stanje.brojac.clear();
}

faza("11. Tajne");
provera("ni u jednom odgovoru (telo i zaglavlja) nema ključeva", sviOdgovori.every((t) => !TAJNE.some((k) => t.includes(k))), "neki odgovor sadrži ključ");

globalThis.fetch = pravi;
lazniSupabase.close();
console.log(`\nPASS: ${pass}   FAIL: ${fail}`);
process.exit(fail ? 1 : 0);
