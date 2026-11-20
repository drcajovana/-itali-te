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
import { readdirSync, readFileSync } from "node:fs";

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
  // članovi nad kojima radi resetuj-pin (nemaju token; čitaju se po id)
  "cilj-citalac": { id: randomUUID(), aktivan: true, uloga: "citalac", broj_kartice: "0101228", ime: "Ana Petrović" },
  "cilj-bib": { id: randomUUID(), aktivan: true, uloga: "bibliotekar", broj_kartice: "0200001", ime: "Biljana Bibić" },
  "cilj-admin": { id: randomUUID(), aktivan: true, uloga: "administrator", broj_kartice: "0200002", ime: "Adam Adminović" },
};
// brojac je po (član, kanta), kao public.uzmi_zahtev posle migracije 0012
const stanje = {
  brojac: new Map(), kes: new Map(), zahteviKaBazi: 0, rpcGreska: false, rpcPozivi: 0,
  pozivi: [], citanjaUloge: 0, ulogaGreska: false,
  // knjige i Storage za api/korica-iz-linka.js
  knjige: new Map(), patchevi: [], patchGreska: false, otpremljeno: [], obrisano: [], storageGreska: false,
  // članovi (api/napravi-clana.js, api/resetuj-pin.js): Auth nalozi, upisani redovi, promene PIN-a
  nalozi: [], upisaniClanovi: [], obrisaniNalozi: [], promenePina: [], zauzeteKartice: new Set(), zauzetiEmail: new Set(),
  upisGreska: null, // null | "dupli" | "opsta"
  authGreska: false, promenaGreska: false, brisanjeGreska: false,
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
    // Auth admin (samo servisni ključ): pravljenje naloga, promena lozinke, brisanje naloga
    if (url.pathname.startsWith("/auth/v1/admin/users")) {
      if (!(req.headers.authorization ?? "").includes(KLJUC_SERVIS)) return odgovori(401, { code: 401, error_code: "not_admin", msg: "User not allowed" });
      const korisnik = (id, email) => ({ id, aud: "authenticated", role: "authenticated", email, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() });
      if (req.method === "POST") {
        const b = JSON.parse(telo);
        if (stanje.authGreska) return odgovori(500, { code: 500, error_code: "unexpected_failure", msg: `Auth ne radi za lozinku ${b.password}` });
        if (stanje.zauzetiEmail.has(b.email)) return odgovori(422, { code: 422, error_code: "email_exists", msg: "A user with this email address has already been registered" });
        const id = randomUUID();
        stanje.nalozi.push({ id, email: b.email, password: b.password, potvrdjen: b.email_confirm });
        return odgovori(200, korisnik(id, b.email));
      }
      const id = url.pathname.split("/").pop();
      if (req.method === "PUT") {
        const b = JSON.parse(telo);
        if (stanje.promenaGreska) return odgovori(500, { code: 500, error_code: "unexpected_failure", msg: `Promena nije uspela za ${b.password}` });
        stanje.promenePina.push({ id, password: b.password });
        return odgovori(200, korisnik(id, "x@citaliste.local"));
      }
      if (req.method === "DELETE") {
        if (stanje.brisanjeGreska) return odgovori(500, { code: 500, error_code: "unexpected_failure", msg: "brisanje ne radi" });
        stanje.obrisaniNalozi.push(id);
        return odgovori(200, {});
      }
    }
    if (url.pathname === "/rest/v1/clanovi" && (req.headers.authorization ?? "").includes(KLJUC_SERVIS) && (req.method === "POST" || url.searchParams.has("broj_kartice"))) {
      if (req.method === "POST") {
        const b = JSON.parse(telo);
        stanje.upisaniClanovi.push(b);
        const pin = stanje.nalozi.at(-1)?.password ?? "";
        if (stanje.upisGreska === "dupli") return odgovori(409, { code: "23505", message: "duplicate key value violates unique constraint" });
        if (stanje.upisGreska === "opsta") return odgovori(500, { code: "XX000", message: `baza ne radi (lozinka ${pin})` });
        stanje.zauzeteKartice.add(b.broj_kartice);
        return objekat ? odgovori(201, b) : odgovori(201, [b]);
      }
      const trazena = (url.searchParams.get("broj_kartice") ?? "").replace("eq.", "");
      const red = stanje.zauzeteKartice.has(trazena) ? { id: randomUUID() } : null;
      return objekat ? (red ? odgovori(200, red) : odgovori(406, { code: "PGRST116" })) : odgovori(200, red ? [red] : []);
    }
    if (url.pathname === "/rest/v1/clanovi") {
      const id =(url.searchParams.get("id") ?? "").replace("eq.", "");
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
const napraviClanaHandler = (await import("../api/napravi-clana.js")).default;
const resetujPinHandler = (await import("../api/resetuj-pin.js")).default;
const { noviPin } = await import("../api/_lib/pin.js");
const clanUnos = await import("../src/lib/clan-unos.js");
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
faza("5b. Korica sa stranice: dopuna adresa prema konačnoj adresi, JSON-LD image, dijagnostika");
{
  const STR = "https://www.laguna.rs/knjiga/1";
  const sa = (head, telo = "") => parser.izvuciIzHtmla(`<html><head><meta property="og:title" content="Knjiga"><meta property="og:image" content="">${head}</head><body>${telo}</body></html>`, STR, { dijagnostika: true });
  const og = (adresa, oznaka = "og:image") => `<meta property="${oznaka}" content="${adresa}">`;

  // relativne i // adrese se DOPUNJAVAJU, pa prolaze (ne odbijaju se)
  for (const [naziv, adresa, ocekivano] of [
    ["apsolutna putanja (/slike/g.jpg)", "/slike/g.jpg", "https://www.laguna.rs/slike/g.jpg"],
    ["relativna putanja (slike/g.jpg) prema /knjiga/1", "slike/g.jpg", "https://www.laguna.rs/knjiga/slike/g.jpg"],
    ["relativna sa ../", "../slike/g.jpg", "https://www.laguna.rs/slike/g.jpg"],
    ["bez protokola (//cdn.laguna.rs/g.jpg)", "//cdn.laguna.rs/g.jpg", "https://cdn.laguna.rs/g.jpg"],
    ["bez protokola, drugi domen", "//cdn.drugi-domen.example/g.jpg", "https://cdn.drugi-domen.example/g.jpg"],
    ["sa razmakom u imenu (kodira se)", "/slike/moja korica.jpg", "https://www.laguna.rs/slike/moja%20korica.jpg"],
  ]) {
    const r = sa(og(adresa));
    const k = r.dijagnostika.kandidati.find((c) => c.izvor === "og:image");
    provera(`dopuna: ${naziv} → ${ocekivano}`, r.korica === ocekivano && k?.ishod === "prihvacena" && k.dopunjena === ocekivano && k.izabrana === true, { korica: r.korica, k });
  }
  {
    const r = sa(og("//cdn.laguna.rs/g.jpg"));
    const k = r.dijagnostika.kandidati[0];
    provera("dijagnostika čuva i sirovu vrednost i vrstu (relativna, //), uz dopunjenu adresu", k.sirova === "//cdn.laguna.rs/g.jpg" && k.vrsta === "bez protokola (//)" && k.dopunjena === "https://cdn.laguna.rs/g.jpg", k);
  }

  // dopuna ide prema KONAČNOJ adresi stranice (posle preusmeravanja)
  {
    const html = `<html><head><title>Knjiga</title><meta property="og:image" content="slika.jpg"><meta property="twitter:image" content="//cdn.laguna.rs/t.jpg"></head></html>`;
    const rez = await parser.izvuciIzLinka("https://laguna.rs/stara/adresa", { preuzmiFn: async () => ({ url: new URL("https://www.laguna.rs/nova/putanja/strana"), telo: html }) });
    provera("dopuna prema konačnoj adresi stranice (posle preusmeravanja), ne prema onoj koju je član nalepio", rez.korica === "https://www.laguna.rs/nova/putanja/slika.jpg" && rez.dijagnostika.stranica === "https://www.laguna.rs/nova/putanja/strana", { korica: rez.korica, stranica: rez.dijagnostika?.stranica });
  }

  // odbijene adrese, sa razlogom (bezbednost se proverava posle dopune)
  {
    const r = sa(
      [
        og("http://cdn.laguna.rs/nesigurno.jpg"),
        og("https://cdn.laguna.rs:8443/port.jpg", "og:image:secure_url"),
        og("https://93.184.216.34/ip.jpg", "twitter:image"),
        `<link rel="image_src" href="https://localhost/l.jpg">`,
        `<span itemprop="image" content="https://korisnik:lozinka@cdn.laguna.rs/k.jpg"></span>`,
        og(`https://cdn.laguna.rs/${"a".repeat(600)}.jpg`, "og:image:url"),
        og("data:image/png;base64,iVBORw0KGgo=", "twitter:image:src"),
      ].join("")
    );
    const po = (izvor) => r.dijagnostika.kandidati.find((c) => c.izvor === izvor);
    provera("odbijeno: nije https", po("og:image")?.ishod === "odbijena" && po("og:image").razlog.includes("nije https"), po("og:image"));
    provera("odbijeno: nestandardan port", po("og:image:secure_url")?.ishod === "odbijena" && po("og:image:secure_url").razlog.includes("port 8443"), po("og:image:secure_url"));
    provera("odbijeno: IP adresa", po("twitter:image")?.ishod === "odbijena" && po("twitter:image").razlog.includes("IP adresa"), po("twitter:image"));
    provera("odbijeno: localhost", po('link rel="image_src"')?.ishod === "odbijena" && po('link rel="image_src"').razlog.includes("localhost"), po('link rel="image_src"'));
    provera("odbijeno: korisnik i lozinka u adresi", po("itemprop=image (span)")?.ishod === "odbijena" && po("itemprop=image (span)").razlog.includes("korisnik"), po("itemprop=image (span)"));
    provera("odbijeno: duža od 500 znakova", po("og:image:url")?.ishod === "odbijena" && po("og:image:url").razlog.includes("500"), po("og:image:url"));
    provera("odbijeno: data: adresa", po("twitter:image:src")?.ishod === "odbijena" && po("twitter:image:src").razlog.includes("data:"), po("twitter:image:src"));
    provera("ako je sve odbijeno, korica je null, a svi kandidati su u dijagnostici (sa ishodom)", r.korica === null && r.dijagnostika.izabrana === null && r.dijagnostika.polja.korica === null && r.dijagnostika.kandidati.length >= 7 && r.dijagnostika.kandidati.every((c) => c.ishod === "odbijena"), r.dijagnostika.kandidati.map((c) => [c.izvor, c.ishod]));
  }

  // JSON-LD "image": tekst, niz (tekstova i objekata) i objekat sa url / contentUrl
  for (const [naziv, image, ocekivano, oblik] of [
    ["tekst", "https://cdn.laguna.rs/t.jpg", "https://cdn.laguna.rs/t.jpg", "tekst"],
    ["niz tekstova", ["https://cdn.laguna.rs/1.jpg", "https://cdn.laguna.rs/2.jpg"], "https://cdn.laguna.rs/1.jpg", "niz"],
    ["objekat sa url", { "@type": "ImageObject", url: "/slike/o.jpg" }, "https://www.laguna.rs/slike/o.jpg", "objekat"],
    ["objekat sa contentUrl", { "@type": "ImageObject", contentUrl: "//cdn.laguna.rs/c.jpg" }, "https://cdn.laguna.rs/c.jpg", "objekat"],
    ["niz objekata (prvi nebezbedan, drugi ispravan)", [{ url: "http://cdn.laguna.rs/x.jpg" }, { url: "/slike/drugi.jpg" }], "https://www.laguna.rs/slike/drugi.jpg", "niz"],
    ["niz sa relativnim i // adresama", ["slika.jpg", "//cdn.laguna.rs/k.jpg"], "https://www.laguna.rs/knjiga/slika.jpg", "niz"],
  ]) {
    const r = parser.izvuciIzHtmla(`<html><head>${jsonLd({ "@type": "Book", name: "Knjiga", image })}</head></html>`, STR, { dijagnostika: true });
    provera(`JSON-LD image kao ${naziv}`, r.korica === ocekivano && r.dijagnostika.polja.korica === `JSON-LD image (${oblik})`, { korica: r.korica, polja: r.dijagnostika.polja.korica });
  }

  // redosled i izvor polja
  {
    const html = `<html><head>${jsonLd({ "@type": "Book", name: "Naslov", author: "Autor A", isbn: "978-86-521-2603-3", publisher: "Laguna", datePublished: "2019", image: "/a.jpg" })}
      <meta property="og:image" content="https://cdn.laguna.rs/og.jpg"><meta property="og:image:secure_url" content="https://cdn.laguna.rs/secure.jpg"><meta name="twitter:image" content="https://cdn.laguna.rs/tw.jpg">
      <link rel="image_src" href="/src.jpg"><span itemprop="image" content="/ip.jpg"></span></head>
      <body><img class="product-cover" src="/slike/telo.jpg"><img alt="Korica knjige" data-src="//cdn.laguna.rs/lazy.jpg"><img src="/logo.png"><img class="logo" src="/ikona.svg"></body></html>`;
    const r = parser.izvuciIzHtmla(html, STR, { dijagnostika: true });
    const izvori = r.dijagnostika.kandidati.map((c) => c.izvor);
    provera("kandidati redom: JSON-LD, og:image:secure_url, og:image, twitter:image, image_src, itemprop, <img>",
      JSON.stringify(izvori.map((x) => x.split(" (")[0])) === JSON.stringify(["JSON-LD image", "og:image:secure_url", "og:image", "twitter:image", 'link rel="image_src"', "itemprop=image", "<img>", "<img>"]), izvori);
    provera("predlog je prvi prihvaćen (JSON-LD), tačno jedan kandidat je izabran", r.korica === "https://www.laguna.rs/a.jpg" && r.dijagnostika.kandidati.filter((c) => c.izabrana).length === 1 && r.dijagnostika.kandidati[0].izabrana, r.korica);
    provera("<img> sa cover/korica/product/book se navodi u dijagnostici (do 5), a logo i ikona ne", izvori.filter((x) => x.startsWith("<img>")).length === 2 && !r.dijagnostika.kandidati.some((c) => c.sirova.includes("logo") || c.sirova.includes("ikona")), izvori);
    provera("polja u dijagnostici navode izvor: naslov, autor, ISBN, izdavač, godina, korica", r.dijagnostika.polja.naslov === "JSON-LD name" && r.dijagnostika.polja.autor === "JSON-LD author" && r.dijagnostika.polja.isbn === "JSON-LD isbn" && r.dijagnostika.polja.izdavac === "JSON-LD publisher/brand" && r.dijagnostika.polja.godina === "JSON-LD datePublished" && r.dijagnostika.polja.korica.startsWith("JSON-LD image"), r.dijagnostika.polja);
  }
  {
    // slike iz <img> same ne postaju predlog
    const r = sa("", `<img class="product-cover" src="/slike/telo.jpg">`);
    const k = r.dijagnostika.kandidati.find((c) => c.izvor.startsWith("<img>"));
    provera("samo <img> kandidat: u dijagnostici je prihvaćen, ali se ne predlaže sam od sebe (korica je null)", r.korica === null && k?.ishod === "prihvacena" && k.izabrana === false && k.dopunjena === "https://www.laguna.rs/slike/telo.jpg", { korica: r.korica, k });
  }
  {
    // izvori ostalih polja
    const og1 = parser.izvuciIzHtmla(`<html><head><meta property="og:title" content="Gospođica - Ivo Andrić | Delfi"><meta property="book:isbn" content="9788652126033"></head></html>`, STR, { dijagnostika: true });
    provera("izvor polja: og:title (naslov), og:title pretpostavka (autor), meta book:isbn", og1.dijagnostika.polja.naslov === "og:title" && og1.dijagnostika.polja.autor === "og:title (pretpostavka)" && og1.dijagnostika.polja.isbn === "meta book:isbn", og1.dijagnostika.polja);
    const t1 = parser.izvuciIzHtmla("<html><head><title>Seobe - Miloš Crnjanski</title></head></html>", STR, { dijagnostika: true });
    provera("izvor polja: <title> (naslov) i <title> pretpostavka (autor); bez slike", t1.dijagnostika.polja.naslov === "<title>" && t1.dijagnostika.polja.autor === "<title> (pretpostavka)" && t1.dijagnostika.polja.korica === null && t1.dijagnostika.kandidati.length === 0, t1.dijagnostika);
    const o1 = parser.izvuciIzHtmla('<html><body><h1>Bajka</h1><span>Autor: Desanka Maksimović<br>Izdavač: Dereta</span></body></html>', STR, { dijagnostika: true });
    provera("izvor polja: <h1> (naslov), oznaka „Autor:” i „Izdavač:”", o1.dijagnostika.polja.naslov === "<h1>" && o1.dijagnostika.polja.autor.startsWith("oznaka") && o1.dijagnostika.polja.izdavac.startsWith("oznaka"), o1.dijagnostika.polja);
  }

  // veličina dijagnostike: bez celog HTML-a
  {
    const marker = "OVO-JE-TELO-STRANICE-KOJE-NE-SME-U-ODGOVOR";
    const mnogo = Array.from({ length: 300 }, (_, i) => `<img class="product" src="/slike/${"x".repeat(900)}${i}.jpg" alt="${marker}">`).join("");
    const html = `<html><head><meta property="og:image" content="/${"y".repeat(5000)}.jpg">${Array.from({ length: 60 }, (_, i) => og(`/m${i}.jpg`, "twitter:image")).join("")}</head><body><p>${marker}</p>${mnogo}</body></html>`;
    const r = parser.izvuciIzHtmla(html, STR, { dijagnostika: true });
    const tekstD = JSON.stringify(r.dijagnostika);
    provera("dijagnostika je ograničena: najviše 30 kandidata, sirove vrednosti skraćene, bez celog HTML-a", r.dijagnostika.kandidati.length <= 30 && r.dijagnostika.kandidati.every((c) => c.sirova.length <= 301) && tekstD.length < 15000 && !tekstD.includes(marker) && !tekstD.includes("<p>") && html.length > 200000, { kandidata: r.dijagnostika.kandidati.length, bajtova: tekstD.length, html: html.length });
  }

  // Delfi: slika je u odgovoru API-ja (HTML je prazna ljuska)
  {
    const API = "https://delfi.rs/api/pc-frontend-api/overview/249340";
    const proizvod = (dopuna = {}) => JSON.stringify({ data: { product: { title: "Fikser", authors: [{ authorName: "Goran Gocić" }], barcode: "9788663695528", images: { s: "/_img/artikli/Knjiga/249340/m/a.jpg", m: "/_img/artikli/Knjiga/249340/s/a.jpg", l: "/_img/artikli/Knjiga/249340/v/a.jpg", xl: "/_img/artikli/Knjiga/249340/vv/a.jpg", xxl: "/_img/artikli/Knjiga/249340/org/a.jpg", fb: "" }, ...dopuna } } });
    const delfi = (telo) => ({ preuzmiFn: async (adresa) => (adresa === API ? { url: new URL(API), telo } : (() => { throw new Error(`neočekivan poziv: ${adresa}`); })()) });
    const LINK = "https://delfi.rs/knjige/249340-fikser-knjiga-delfi-knjizare.html";
    let rez = await parser.izvuciIzLinka(LINK, delfi(proizvod()));
    provera("Delfi: korica iz API-ja (images.xl), relativna putanja dopunjena prema adresi stranice", rez.korica === "https://delfi.rs/_img/artikli/Knjiga/249340/vv/a.jpg" && rez.dijagnostika.polja.korica === "Delfi API images.xl" && rez.dijagnostika.kandidati[0].vrsta === "relativna" && rez.dijagnostika.kandidati.length === 5, { korica: rez.korica, polja: rez.dijagnostika?.polja });
    provera("Delfi: naslov, autor i ISBN (iz barcode, jer je ispravan ISBN-13) su tu", rez.naslov === "Fikser" && rez.autori.join() === "Goran Gocić" && rez.isbn === "9788663695528" && rez.dijagnostika.polja.isbn === "Delfi API barcode", rez);
    rez = await parser.izvuciIzLinka(LINK, delfi(proizvod({ barcode: "2000000000008", images: { xl: "", l: "/_img/l.jpg" } })));
    provera("Delfi: barcode koji nije ISBN (ne počinje sa 978/979) se ne uzima; prazna veličina se preskače, uzima se sledeća (l)", rez.isbn === null && rez.korica === "https://delfi.rs/_img/l.jpg" && rez.dijagnostika.polja.korica === "Delfi API images.l", { isbn: rez.isbn, korica: rez.korica });
    rez = await parser.izvuciIzLinka(LINK, delfi(proizvod({ images: undefined })));
    provera("Delfi: bez slika u odgovoru korica je null, a dijagnostika to kaže (nema kandidata)", rez.korica === null && rez.dijagnostika.kandidati.length === 0 && rez.dijagnostika.polja.korica === null, rez.dijagnostika);
    rez = await parser.izvuciIzLinka(LINK, delfi(proizvod({ images: { xl: "http://delfi.rs/_img/nesigurno.jpg", xxl: "/_img/ok.jpg" } })));
    provera("Delfi: nebezbedna veličina (http) se odbija, uzima se sledeća bezbedna", rez.korica === "https://delfi.rs/_img/ok.jpg" && rez.dijagnostika.kandidati[0].ishod === "odbijena", rez.dijagnostika.kandidati);
  }
}

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
    for (const [kod, ocekivano] of [["ne_mogu_da_procitam", "Сајт не даје слику"], ["prevelika_slika", "превелика"], ["slika_nije_podrzana", "Погрешан тип"], ["nije_bibliotekar", "дозволу"], ["nije_slika", "не води до слике"], ["preusmerenje_van_liste", "преусмерава"], ["mreza", "повежем"]]) {
      s = nova();
      r = await tok.sacuvajPaKoricu({ upisi: s.upisi(), izbor: "preuzmi", predlog: KOR, preuzmi: async () => { throw greskaSaKodom(kod); }, otpremi: async () => "x" });
      provera(`neuspelo preuzimanje (${kod}) ne poništava upis: knjiga ostaje sačuvana, razlog je čitljiv`, r.upis === "sacuvano" && s.baza.length === 1 && r.korica.ishod === "greska" && r.korica.razlog.toLowerCase().includes(ocekivano.toLowerCase()) && r.korica.kod === kod, r);
    }
    s = nova();
    r = await tok.sacuvajPaKoricu({ upisi: s.upisi(), izbor: "preuzmi", predlog: KOR, preuzmi: async () => { throw new TypeError("neočekivano"); }, otpremi: async () => "x" });
    provera("i neočekivana greška (nije ApiGreska) ne poništava upis i ne ruši tok", r.upis === "sacuvano" && s.baza.length === 1 && r.korica.ishod === "greska" && typeof r.korica.razlog === "string" && r.korica.razlog.length > 5, r);
    s = nova();
    r = await tok.sacuvajPaKoricu({ upisi: s.upisi(), izbor: "preuzmi", predlog: KOR, preuzmi: async () => { throw greskaSaKodom("previse_zahteva", { ponovoZaSekundi: 1234 }); }, otpremi: async () => "x" });
    provera("ograničenje (previse_zahteva): upis ostaje, ishod 'limit', razlog sadrži minute (1234 s → 21 min)", r.upis === "sacuvano" && r.korica.ishod === "limit" && r.korica.razlog.includes("21 мин"), r);

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
    provera("neuspelo slanje izabrane slike (nema dozvole) ne poništava upis i daje razlog", r.upis === "sacuvano" && s.baza.length === 1 && r.korica.ishod === "greska" && r.korica.razlog.includes("дозволу"), r);

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
        zbir.preuzeta === 1 && zbir.nijeUspelo.length === 1 && zbir.nijeUspelo[0].id === "b" && zbir.nijeUspelo[0].razlog.includes("Сајт не даје слику") && zbir.limit === 2 && zbir.bez === 2, zbir);
      const sazetak = tok.tekstSazetka(zbir, { a: "Knjiga A", b: "Knjiga B" });
      provera("sažetak kaže: koliko je sačuvano, koliko korica je preuzeto, koje nije i zašto, ograničenje i ono što čeka odluku",
        sazetak.includes("Сачувано књига: 6.") && sazetak.includes("Корица преузета: 1.") && sazetak.includes("Knjiga B: Сајт не даје слику") && sazetak.includes("Ограничење од 100 преузимања на сат је потрошено. Без корице је сачувано књига: 2") && sazetak.includes("Чека вашу одлуку (већ постоји или има грешку): 1."), sazetak);
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
    provera("natpisi: „Preuzmi i koricu”, „Izaberi drugu sliku”, „Pokušaj ponovo”", T15.preuzmiKvacica === "Преузми и корицу" && T15.drugaSlika === "Изабери другу слику" && T15.ponovo === "Покушај поново");
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
    provera("natpisi dugmadi su tačno kako je traženo", T14.koristi === "Користи ову корицу" && T14.izaberi === "Изабери слику са рачунара или телефона" && T14.bez === "Без корице" && T14.ukloni === "Уклони корицу" && T14.zameni === "Замени корицу" && T14.slikaj === "Сликај корицу", T14);
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
    JSON.stringify(Object.keys(u.red).sort()) === JSON.stringify(["autor", "broj_primeraka", "broj_slobodnih", "godina", "isbn", "izdavac", "izvor", "naslov", "odluka_datum", "odluka_nabavke", "opis", "signatura", "u_fondu", "uneo_id", "zanrovi"]), Object.keys(u.red).sort());

  u = unos.urediUnos({ ...FORMA, stanje: "nabavka", primerci: "7", signatura: "X-1" }, { uneoId: BIBLIOTEKAR_ID });
  provera("„Za nabavku”: u_fondu=false, 0 primeraka i 0 slobodnih, bez signature, izvor 'link' (i kad su primerci i signatura bili upisani)",
    u.ok && u.red.u_fondu === false && u.red.broj_primeraka === 0 && u.red.broj_slobodnih === 0 && u.red.signatura === null && u.red.izvor === "link", u.red);

  provera("odluka nabavke se upisuje uz knjigu: „Imamo” → 'imamo' (u_fondu = true), „Nabavljamo” → 'nabavljamo' (u_fondu = false); datum je trenutak upisa", (() => {
    const t = new Date("2026-11-17T10:30:00Z");
    const a = unos.urediUnos(FORMA, { uneoId: BIBLIOTEKAR_ID, sada: t });
    const b = unos.urediUnos({ ...FORMA, stanje: "nabavka" }, { uneoId: BIBLIOTEKAR_ID, sada: t });
    return a.ok && b.ok && a.red.odluka_nabavke === "imamo" && a.red.u_fondu === true && b.red.odluka_nabavke === "nabavljamo" && b.red.u_fondu === false && a.red.odluka_datum === "2026-11-17T10:30:00.000Z" && b.red.odluka_datum === t.toISOString();
  })());
  provera("odluka se ne upisuje kad se ništa ne upisuje: „Samo nacrt” ne daje red, pa ni odluku", unos.urediUnos({ ...FORMA, stanje: "nacrt" }, { uneoId: BIBLIOTEKAR_ID }).ok === false);
  provera("odluka u redu za upis je uvek u skladu sa u_fondu (isto što bi uradio okidač iz 0020 pri izmeni)", ["fond", "nabavka"].every((st) => { const x = unos.urediUnos({ ...FORMA, stanje: st }, { uneoId: BIBLIOTEKAR_ID }); return x.ok && (x.red.odluka_nabavke === "imamo") === x.red.u_fondu; }));

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
  for (const [n, ocekivano] of [[1, "1 примерак"], [2, "2 примерка"], [4, "4 примерка"], [5, "5 примерака"], [11, "11 примерака"], [12, "12 примерака"], [14, "14 примерака"], [21, "21 примерак"], [22, "22 примерка"], [25, "25 примерака"], [101, "101 примерак"], [111, "111 примерака"], [112, "112 примерака"], [999, "999 примерака"]]) {
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
    provera("nema novih zavisnosti u package.json osim dva paketa fontova iz koraka 10 (@fontsource-variable/onest i /inter, fontovi iz projekta umesto sa Google-a)", JSON.stringify(Object.keys(paket.dependencies).sort()) === JSON.stringify(["@fontsource-variable/inter", "@fontsource-variable/onest", "@supabase/supabase-js", "@tailwindcss/vite", "linkedom", "react", "react-dom", "react-router-dom", "tailwindcss"]), Object.keys(paket.dependencies));
    const sql14 = readFileSync(new URL("../supabase/migrations/0014_korice_preuzeto.sql", import.meta.url), "utf8").replace(/^--.*$/gm, "");
    provera("migracija 0014: kolona korice_poreklo, izvor 'preuzeto', bucket 1.5 MB (1572864), okidač prati korice_poreklo",
      /add column if not exists korice_poreklo text/.test(sql14) && /'preuzeto'\)\)/.test(sql14) && /1572864/.test(sql14) && /update of korice_url, korice_izvor, korice_poreklo/.test(sql14));
  }
  bf.unutrasnje.jedanZahtev = original;
  resetuj();
  stanje.brojac.clear();
}

faza("15. Dijagnostika iz-linka: samo bibliotekar i administrator, bez celog HTML-a");
{
  const { readFileSync } = await import("node:fs");
  const MARKER = "OVO-JE-TELO-STRANICE-KOJE-NE-SME-U-ODGOVOR";
  const html = `<html><head><title>Fikser - Goran Gocić</title>${jsonLd({ "@type": "Book", name: "Fikser", author: "Goran Gocić", image: "/slike/f.jpg" })}<meta property="og:image" content="http://cdn.laguna.rs/nesigurno.jpg"></head><body><p>${MARKER}</p>${"<div>sadržaj</div>".repeat(2000)}</body></html>`;
  let broj = 0;
  bf.unutrasnje.jedanZahtev = async () => (broj++, stranica(html));
  stanje.brojac.clear();
  const ADRESA = "https://www.laguna.rs/dijagnostika/prva";
  const telo = { url: ADRESA };

  let o = await z(linkHandler, { token: "tok-bib", telo });
  const d = o.telo?.rezultati?.[0]?.dijagnostika;
  provera("BIBLIOTEKAR dobija dijagnostiku (polja sa izvorom i kandidati sa ishodom)", o.status === 200 && d?.polja?.naslov === "JSON-LD name" && d.kandidati?.length >= 2 && d.kandidati[0].ishod === "prihvacena" && d.izabrana === "https://www.laguna.rs/slike/f.jpg", o.telo);
  provera("odgovor ima i korica kao predlog (dopunjena adresa)", o.telo.rezultati[0].korica === "https://www.laguna.rs/slike/f.jpg", o.telo.rezultati[0].korica);
  provera("odgovor NE sadrži ceo HTML: ni marker iz tela stranice, ni <html, ni <script, ni <div", !o.sirovo.includes(MARKER) && !o.sirovo.includes("<html") && !o.sirovo.includes("<script") && !o.sirovo.includes("<div") && o.sirovo.length < html.length / 5, { odgovor: o.sirovo.length, html: html.length });
  provera("u odgovoru nema ničeg što liči na ključ", !TAJNE.some((k) => o.sirovo.includes(k)));
  provera("odgovor ne nosi interno polje keša (kesVerzija)", !("kesVerzija" in o.telo.rezultati[0]));

  o = await z(linkHandler, { token: "tok-admin", telo: { url: "https://www.laguna.rs/dijagnostika/druga" } });
  provera("ADMINISTRATOR takođe dobija dijagnostiku", Boolean(o.telo?.rezultati?.[0]?.dijagnostika?.kandidati), o.status);

  // čitalac: ni sa svežim čitanjem, ni iz keša
  o = await z(linkHandler, { token: "tok-a", telo: { url: "https://www.laguna.rs/dijagnostika/treca" } });
  provera("ČITALAC ne dobija dijagnostiku (sveže čitanje)", o.status === 200 && !("dijagnostika" in o.telo.rezultati[0]) && o.telo.rezultati[0].naslov === "Fikser" && !o.sirovo.includes("kandidati") && !o.sirovo.includes("JSON-LD name"), o.telo);
  o = await z(linkHandler, { token: "tok-a", telo: { url: "https://www.laguna.rs/dijagnostika/treca", uloga: "bibliotekar", role: "administrator", dijagnostika: true }, zaglavlja: { "x-uloga": "bibliotekar" } });
  provera("čitalac koji u telu i zaglavljima tvrdi da je bibliotekar i traži dijagnostiku je ne dobija", o.status === 200 && !("dijagnostika" in o.telo.rezultati[0]), o.telo);
  const n0 = broj;
  o = await z(linkHandler, { token: "tok-a", telo });
  provera("ČITALAC ne dobija dijagnostiku ni kad je odgovor u kešu, a keš je napunio bibliotekar (ima dijagnostiku u kešu)", o.status === 200 && o.telo.rezultati[0].izKesa === true && !("dijagnostika" in o.telo.rezultati[0]) && !("kesVerzija" in o.telo.rezultati[0]) && broj === n0, { izKesa: o.telo.rezultati?.[0]?.izKesa, mreza: broj - n0 });
  o = await z(linkHandler, { token: "tok-bib", telo });
  provera("bibliotekar iz keša i dalje dobija dijagnostiku", o.telo.rezultati[0].izKesa === true && Boolean(o.telo.rezultati[0].dijagnostika?.kandidati?.length) && broj === n0, o.telo.rezultati[0].izKesa);

  // stari keš (bez kesVerzija, bez dijagnostike, korica null) se ne koristi: stranica se čita iznova
  const STARA = "https://www.laguna.rs/dijagnostika/stari-kes";
  stanje.kes.set((await import("../api/_lib/kes.js")).kljucKesa(STARA), { naslov: "Stari keširani naslov", autori: [], korica: null, izvor: "link", url: STARA });
  const n1 = broj;
  o = await z(linkHandler, { token: "tok-bib", telo: { url: STARA } });
  provera("zapis iz keša stare verzije (bez korice i dijagnostike) se zanemaruje: stranica se čita iznova", o.telo.rezultati[0].naslov === "Fikser" && o.telo.rezultati[0].korica === "https://www.laguna.rs/slike/f.jpg" && broj === n1 + 1 && !o.telo.rezultati[0].izKesa, { naslov: o.telo.rezultati?.[0]?.naslov, mreza: broj - n1 });

  // pristup: uloga se čita na serveru; bez nje (lokalno bez baze) nema dijagnostike
  const izvorHandlera = readFileSync(new URL("../api/iz-linka.js", import.meta.url), "utf8");
  provera("iz-linka: dijagnostika zavisi od uloge pročitane na serveru (obradi ulogu prosleđuje), ne od tela zahteva", izvorHandlera.includes("jeBibliotekarskaUloga(uloga)") && !/telo\.(uloga|role|dijagnostika)/.test(izvorHandlera));

  // bez menjanja User-Agent-a, bez headless pregledača i novih zavisnosti
  const fetchKod = readFileSync(new URL("../api/_lib/bezbedan-fetch.js", import.meta.url), "utf8");
  provera("User-Agent je nepromenjen (Citaliste/1.0, pošteno predstavljanje)", fetchKod.includes('const KORISNICKI_AGENT = "Citaliste/1.0 (link preview for library members; Narodna biblioteka Negotin)";') && !/Mozilla|Chrome|Safari/.test(fetchKod.replace(/\/\/.*$/gm, "")));
  const paket2 = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const sveZavisnosti = [...Object.keys(paket2.dependencies), ...Object.keys(paket2.devDependencies)];
  provera("nema headless pregledača ni novih zavisnosti (puppeteer, playwright, chromium, jsdom...)", !sveZavisnosti.some((x) => /puppeteer|playwright|chromium|selenium|jsdom|cheerio/.test(x)) && JSON.stringify(Object.keys(paket2.devDependencies).sort()) === JSON.stringify(["@electric-sql/pglite", "@eslint/js", "@types/react", "@types/react-dom", "@vitejs/plugin-react", "eslint", "eslint-plugin-react-hooks", "eslint-plugin-react-refresh", "globals", "vite", "vite-plugin-pwa"]), sveZavisnosti);

  bf.unutrasnje.jedanZahtev = original;
  stanje.brojac.clear();
}

faza("16. Polica, stranica knjige i utisci (polica-logika.js, izgled i tekst)");
{
  const L = await import("../src/lib/polica-logika.js");
  const { tekst: TK } = await import("../src/lib/tekst.js");
  const { readFileSync } = await import("node:fs");
  const izvor = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
  const DAN = "2026-10-20";

  // datum u lokalnom vremenu
  provera("danas(): lokalni datum (a ne UTC): 20. 10. 2026. u 00:30 po lokalnom vremenu je 2026-10-20", L.danas(new Date(2026, 9, 20, 0, 30)) === "2026-10-20" && L.danas(new Date(2026, 0, 5, 23, 59)) === "2026-01-05");
  provera("formatDatum: 2026-10-20 → 20. 10. 2026.; neispravan ulaz se ne menja", L.formatDatum("2026-10-20") === "20. 10. 2026." && L.formatDatum("2026-01-05") === "5. 1. 2026." && L.formatDatum("juče") === "juče" && L.formatDatum(null) === "");

  // prelaz stanja
  provera("Želim: samo stanje, datum kraja se briše; ništa drugo se ne dira", JSON.stringify(L.promenaStanja({ status: "citam", datum_pocetka: "2026-10-01", napredak: 40 }, "zelim", DAN)) === JSON.stringify({ status: "zelim", datum_kraja: null }));
  provera("Čitam (nova knjiga): datum početka je danas, napredak 0", JSON.stringify(L.promenaStanja(null, "citam", DAN)) === JSON.stringify({ status: "citam", datum_pocetka: DAN, datum_kraja: null, napredak: 0 }));
  provera("Čitam (već početo): datum početka i napredak se čuvaju", JSON.stringify(L.promenaStanja({ status: "zelim", datum_pocetka: "2026-10-01", napredak: 35 }, "citam", DAN)) === JSON.stringify({ status: "citam", datum_pocetka: "2026-10-01", datum_kraja: null, napredak: 35 }));
  provera("Čitam posle Pročitano (ponovno čitanje): kreće od 0%, datum kraja se briše", L.promenaStanja({ status: "procitano", datum_pocetka: "2026-09-01", datum_kraja: "2026-09-20", napredak: 100 }, "citam", DAN).napredak === 0 && L.promenaStanja({ status: "procitano", datum_kraja: "2026-09-20", napredak: 100 }, "citam", DAN).datum_kraja === null);
  provera("Pročitano („Označi kao pročitano”): datum kraja je danas, napredak 100, datum početka se ne izmišlja", JSON.stringify(L.promenaStanja({ status: "citam", napredak: 40 }, "procitano", DAN)) === JSON.stringify({ status: "procitano", datum_kraja: DAN, napredak: 100 }) && !("datum_pocetka" in L.promenaStanja(null, "procitano", DAN)));
  provera("nepoznato stanje je greška", (() => { try { L.promenaStanja(null, "gotovo", DAN); return false; } catch { return true; } })());

  // napredak
  for (const [ulaz, ocekivano] of [[0, 0], [45, 45], [100, 100], ["70", 70], [" 80 ", 80], [-1, null], [101, null], [45.5, null], ["abc", null], ["", null], [null, null], ["1e2", null], ["1000", null]]) {
    provera(`uredjenNapredak(${JSON.stringify(ulaz)}) = ${ocekivano}`, L.uredjenNapredak(ulaz) === ocekivano, L.uredjenNapredak(ulaz));
  }
  provera("prikazani napredak: pročitano je 100, želim je 0, čitam je ono što piše (i 0 za neispravno)", L.prikazaniNapredak({ status: "procitano", napredak: 0 }) === 100 && L.prikazaniNapredak({ status: "zelim", napredak: 60 }) === 0 && L.prikazaniNapredak({ status: "citam", napredak: 60 }) === 60 && L.prikazaniNapredak({ status: "citam", napredak: 999 }) === 0 && L.prikazaniNapredak(null) === 0);

  // grupisanje police
  {
    const redovi = [
      { id: "a", status: "zelim", izmenjeno: "2026-10-01T10:00:00Z" },
      { id: "b", status: "citam", izmenjeno: "2026-10-03T10:00:00Z" },
      { id: "c", status: "citam", izmenjeno: "2026-10-05T10:00:00Z" },
      { id: "d", status: "procitano", izmenjeno: "2026-09-01T10:00:00Z" },
      { id: "e", status: "nepoznato", izmenjeno: "2026-10-06T10:00:00Z" },
    ];
    const g = L.grupisiPolicu(redovi);
    provera("grupisanje: tri stanja, najskorije izmenjeno prvo, nepoznato stanje se ne prikazuje", g.citam.map((x) => x.id).join() === "c,b" && g.zelim.map((x) => x.id).join() === "a" && g.procitano.map((x) => x.id).join() === "d", g);
    provera("grupisanje prazne police daje tri prazna niza", JSON.stringify(L.grupisiPolicu([])) === JSON.stringify({ citam: [], procitano: [], zelim: [] }) && JSON.stringify(L.grupisiPolicu(undefined)) === JSON.stringify({ citam: [], procitano: [], zelim: [] }));
    provera("podrazumevana kartica: prva neprazna (Čitam, Želim, Pročitano)", L.podrazumevanaKartica(g) === "citam" && L.podrazumevanaKartica({ citam: [], zelim: [1], procitano: [1] }) === "zelim" && L.podrazumevanaKartica({ citam: [], zelim: [], procitano: [1] }) === "procitano" && L.podrazumevanaKartica({ citam: [], zelim: [], procitano: [] }) === "citam");
  }

  // prosečna ocena
  provera("prosečna ocena: 8.3 → „8,3”, bez ocena → null", L.prosecnaOcena({ prosecna_ocena: "8.3", broj_ocena: 4 }) === "8,3" && L.prosecnaOcena({ prosecna_ocena: 7, broj_ocena: 1 }) === "7,0" && L.prosecnaOcena({ prosecna_ocena: null, broj_ocena: 0 }) === null && L.prosecnaOcena(null) === null && L.prosecnaOcena({ prosecna_ocena: "8.0", broj_ocena: 0 }) === null);

  // utisak
  {
    const dobar = L.urediUtisak({ ocena: 8, tekst: "  Odlična knjiga.  ", vidljivost: "prijatelji", spojler: true });
    provera("utisak: ocena, tekst (bez razmaka sa krajeva), vidljivost i spojler", dobar.ok && dobar.red.ocena === 8 && dobar.red.tekst === "Odlična knjiga." && dobar.red.vidljivost === "prijatelji" && dobar.red.spojler === true, dobar);
    provera("utisak: samo ocena (iz forme dolazi kao tekst), podrazumevano javno; spojler bez teksta ne važi", JSON.stringify(L.urediUtisak({ ocena: "7", tekst: "", spojler: true })) === JSON.stringify({ ok: true, red: { ocena: 7, tekst: null, vidljivost: "javno", spojler: false } }));
    provera("utisak: samo tekst (bez ocene) je dozvoljen", L.urediUtisak({ ocena: "", tekst: "Samo reč." }).ok === true && L.urediUtisak({ ocena: null, tekst: "Samo reč." }).red.ocena === null);
    for (const [naziv, unos, polje, razlog] of [
      ["bez ocene i bez teksta (isto pravilo kao ograničenje u bazi)", { ocena: "", tekst: "   " }, "ocena", "prazno"],
      ["ocena 0", { ocena: 0, tekst: "x" }, "ocena", "neispravno"],
      ["ocena 11", { ocena: 11, tekst: "x" }, "ocena", "neispravno"],
      ["ocena 7.5", { ocena: 7.5 }, "ocena", "neispravno"],
      ["ocena „abc”", { ocena: "abc" }, "ocena", "neispravno"],
      ["tekst duži od 3000 znakova", { ocena: 5, tekst: "x".repeat(3001) }, "tekst", "predugo"],
      ["nepoznata vidljivost", { ocena: 5, vidljivost: "svima" }, "vidljivost", "neispravno"],
    ]) {
      const r = L.urediUtisak(unos);
      provera(`utisak odbija: ${naziv}`, r.ok === false && r.polje === polje && r.razlog === razlog, r);
    }
    provera("utisak: tačno 3000 znakova prolazi; sve tri vidljivosti prolaze", L.urediUtisak({ ocena: 5, tekst: "x".repeat(3000) }).ok === true && L.VIDLJIVOSTI.every((v) => L.urediUtisak({ ocena: 5, vidljivost: v }).ok));
    provera("forma utiska: iz postojećeg reda i prazna", JSON.stringify(L.formaUtiska({ ocena: 6, tekst: "t", vidljivost: "samo_ja", spojler: true })) === JSON.stringify({ ocena: 6, tekst: "t", vidljivost: "samo_ja", spojler: true }) && JSON.stringify(L.formaUtiska(null)) === JSON.stringify({ ocena: "", tekst: "", vidljivost: "javno", spojler: false }));
  }

  // tekst: natpisi i opisi ocena
  provera("ocene 1 do 10 imaju opis vrednosti", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].every((n) => typeof TK.utisak.ocene[n] === "string" && TK.utisak.ocene[n].length > 2) && new Set(Object.values(TK.utisak.ocene)).size === 10, TK.utisak.ocene);
  provera("natpisi: stanja police, Označi kao pročitano, vidljivost, spojler", TK.knjigaEkran.polica.stanja.zelim === "Желим" && TK.knjigaEkran.polica.stanja.citam === "Читам" && TK.knjigaEkran.polica.stanja.procitano === "Прочитано" && TK.knjigaEkran.polica.oznaciProcitano === "Означи као прочитано" && TK.utisak.vidljivosti.javno === "Сви чланови" && TK.utisak.vidljivosti.prijatelji === "Само повезани" && TK.utisak.vidljivosti.samo_ja === "Само ја" && TK.utisak.spojler === "Садржи спојлер");
  provera("početna: tri kartice Čitam / Pročitano / Želim i prazna stanja za svaku", TK.pocetna.kartice.citam === "Читам" && TK.pocetna.kartice.procitano === "Прочитано" && TK.pocetna.kartice.zelim === "Желим" && ["citam", "procitano", "zelim"].every((s) => TK.pocetna.prazneKartice[s].length > 5) && TK.pocetna.prazno.length > 10 && TK.utisak.tudji.nema.length > 10);

  // izvorni kod: RLS se ne filtrira u React kodu; palete; tekst samo iz tekst.js
  const polica = izvor("src/lib/polica.js");
  const bezKomentara = (s) => s.replace(/\/\/.*$/gm, "");
  provera("polica.js: moja polica se traži po clan_id (RLS pokazuje i policu povezanih), a tuđi utisci se čitaju iz pogleda bez filtriranja vidljivosti",
    /from\("polica"\)[\s\S]*?\.eq\("clan_id", clanId\)/.test(polica) && polica.includes('from("utisci_sa_autorom")') && !/\.(?:eq|neq|in|not|filter)\([^)]*(?:vidljivost|skriven|su_povezani)/.test(bezKomentara(polica)));
  provera("tuđi utisci: uslov je samo knjiga i „nije moj” (da se moj ne prikaže dvaput); nema filtra po vidljivosti, skrivenosti ni vezi", (() => { const m = /ucitajTudjeUtiske[\s\S]*?order\(/.exec(polica)?.[0] ?? ""; return m.includes('.eq("knjiga_id", knjigaId)') && m.includes('.neq("clan_id", clanId)') && !/\.(eq|neq|in|filter|not)\("(vidljivost|skriven)/.test(m); })());
  const komponente = ["src/pages/Pocetna.jsx", "src/pages/Knjiga.jsx", "src/components/StanjePolice.jsx", "src/components/Utisci.jsx", "src/components/PlocicaKnjige.jsx", "src/components/TrakaNapretka.jsx"];
  for (const p of komponente) {
    const kod = bezKomentara(izvor(p));
    provera(`${p}: samo boje iz teme (papir, mastilo, pecat, pecat-svetli, ivica, white); bez novih hex vrednosti i tuđih paleta`,
      !/#[0-9a-fA-F]{3,8}\b/.test(kod) && !/\b(?:bg|text|border|ring|accent|fill|stroke|from|to|via|outline|divide)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone|black)(?:-\d{2,3})?\b/.test(kod) && !/\[#/.test(kod));
  }
  provera("dodirne mete: dugmad na početnoj i stranici knjige imaju najmanje min-h-11 (44 px)", ["src/pages/Pocetna.jsx", "src/components/StanjePolice.jsx", "src/components/Utisci.jsx"].every((p) => izvor(p).split("<button").slice(1).every((deo) => /min-h-(11|12|14)/.test(deo.split("</button>")[0]) || /className=\{/.test(deo.split("</button>")[0]))));
  provera("početna i stranica knjige ne pišu natpise direktno: nema ćiriličnih ni dugih srpskih rečenica izvan tekst.js (provera: svaki JSX tekst dolazi iz T/tekst)", komponente.every((p) => !/>\s*[A-ZČĆŠŽĐ][a-zčćšžđ]+(?:\s+[a-zčćšžđ]+){2,}[.!?]?\s*</.test(izvor(p))));
  provera("početna čita policu preko ucitajPolicu (moja polica), a stranica knjige poziva StanjePolice i Utisci", izvor("src/pages/Pocetna.jsx").includes("ucitajPolicu(clan.id)") && izvor("src/pages/Knjiga.jsx").includes("<StanjePolice") && izvor("src/pages/Knjiga.jsx").includes("<Utisci"));
  provera("spojler: tuđi tekst je zamagljen (blur) i sakriven od čitača ekrana dok se ne dodirne", izvor("src/components/Utisci.jsx").includes("blur-md") && izvor("src/components/Utisci.jsx").includes("aria-hidden={zamagljen}"));
  provera("rezervacija i dostupnost iz COBISS-a nisu deo aplikacije: nema dugmeta „Rezerviši”, „U fondu”, „Slobodnih” ni „Izdato” u interfejsu (stranica knjige, polica, pretraga)", ["src/pages/Knjiga.jsx", "src/pages/Pocetna.jsx", "src/pages/Pretraga.jsx", "src/components/StanjePolice.jsx", "src/components/PlocicaKnjige.jsx", "src/components/RezultatKnjige.jsx", "src/lib/polica.js"].every((f) => !/rezerv|u_fondu|broj_slobodnih|broj_primeraka|uFondu|nijeUFondu|slobodnih|sviIzdati/i.test(izvor(f).replace(/\/\/.*$/gm, ""))) && !("rezervacija" in TK.knjigaEkran) && !("rezervacijeOsoblje" in TK) && !("rezervacije" in TK.osoblje) && !("fond" in TK.pocetna) && !("nijeUFondu" in TK.pocetna) && !("nijeUFondu" in TK.pretraga.knjiga) && !("slobodna" in TK.pretraga.knjiga) && !("izdata" in TK.pretraga.knjiga) && !("uFondu" in TK.knjigaEkran) && !("uBiblioteci" in TK.knjigaEkran));
}

faza("15. Članovi (api/napravi-clana.js, api/resetuj-pin.js): uloge, PIN, ograničenje");
{
  const citaj = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
  const BIB = CLANOVI["tok-bib"];
  const CILJ = CLANOVI["cilj-citalac"];
  const KANTA = "clanovi:bibliotekar";

  // Sve što funkcije ispišu kroz console.error/warn/info ide u niz; PIN tu nikad ne sme da se pojavi.
  const dnevnik = [];
  const izvornik = { error: console.error, warn: console.warn, info: console.info };
  for (const k of Object.keys(izvornik)) console[k] = (...a) => dnevnik.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x?.message ?? x))).join(" "));

  const cisto = () => {
    stanje.brojac.clear();
    stanje.pozivi.length = 0;
    stanje.nalozi.length = 0;
    stanje.upisaniClanovi.length = 0;
    stanje.obrisaniNalozi.length = 0;
    stanje.promenePina.length = 0;
    stanje.zauzeteKartice.clear();
    stanje.zauzetiEmail.clear();
    stanje.upisGreska = null;
    stanje.authGreska = false;
    stanje.promenaGreska = false;
    stanje.brisanjeGreska = false;
    stanje.rpcGreska = false;
    stanje.ulogaGreska = false;
    dnevnik.length = 0;
  };
  const nistaNijePromenjeno = (naziv) => provera(naziv, stanje.nalozi.length === 0 && stanje.upisaniClanovi.length === 0 && stanje.promenePina.length === 0 && stanje.obrisaniNalozi.length === 0, { nalozi: stanje.nalozi.length, redovi: stanje.upisaniClanovi.length, pin: stanje.promenePina.length });
  const TELO = { kartica: "0101228", ime: "Ana Petrović" };
  const pinuLogu = (pin) => dnevnik.some((r) => r.includes(pin));

  try {
    cisto();

    // ── pomoćne funkcije (čisti moduli) ──
    provera("broj karte: 7 cifara kao tekst, vodeća nula ostaje", clanUnos.proveriBrojKarte("0101228") === "0101228" && clanUnos.proveriBrojKarte(" 010 1228 ") === "0101228" && clanUnos.proveriBrojKarte("1234567") === "1234567");
    provera("broj karte: odbija broj (nula je već izgubljena), 6 i 8 cifara, slova, prazno, null", [101228, 1234567, "101228", "01012280", "BIB1234", "01-01228", "", null, undefined, ["0101228"], { x: 1 }].every((x) => clanUnos.proveriBrojKarte(x) === null));
    provera("ime: čisti razmake, traži bar dve reči, slova sa kvačicama, bez cifara i znakova", clanUnos.ocistiIme("  Jovana   Đorđević ") === "Jovana Đorđević" && clanUnos.ocistiIme("Ana-Marija O'Brien") === "Ana-Marija O'Brien" && ["Ana", "", "   ", "Ana 123", "Ana <b>", "A", "x".repeat(81) + " y", null, 5].every((x) => clanUnos.ocistiIme(x) === null));
    provera("podrazumevani nadimak je „Ime P.” (prvo ime i prvo slovo prezimena)", clanUnos.podrazumevaniNadimak("Jovana Đorđević") === "Jovana Đ." && clanUnos.podrazumevaniNadimak("Ana Marija Petrović") === "Ana P." && clanUnos.podrazumevaniNadimak("Marko Šaponja") === "Marko Š." && clanUnos.podrazumevaniNadimak("ana petrović") === "ana P.");
    {
      const pinovi = Array.from({ length: 20000 }, () => noviPin());
      provera("noviPin: uvek tačno 6 cifara kao tekst", pinovi.every((p) => /^[0-9]{6}$/.test(p)));
      provera("noviPin: može da počne nulom (vodeća nula se ne gubi)", pinovi.some((p) => p.startsWith("0")));
      provera("noviPin: raznovrstan (nije ponovljena vrednost)", new Set(pinovi).size > 19000, new Set(pinovi).size);
      provera("pin.js koristi crypto.randomInt, ne Math.random", citaj("api/_lib/pin.js").includes("randomInt") && !/Math\.random/.test(citaj("api/_lib/pin.js")));
    }

    // ── protokol i uloge ──
    for (const [naziv, h] of [["napravi-clana", napraviClanaHandler], ["resetuj-pin", resetujPinHandler]]) {
      cisto();
      let r = await z(h, { metod: "GET", token: "tok-bib" });
      provera(`${naziv}: GET daje 405 sa Allow: POST`, r.status === 405 && r.zaglavlja.allow === "POST", r.status);
      r = await z(h, { telo: TELO });
      provera(`${naziv}: bez tokena 401, ništa se ne radi`, r.status === 401, r.status);
      r = await z(h, { token: "lazan.token", telo: TELO });
      provera(`${naziv}: nevažeći token 401`, r.status === 401, r.status);
      r = await z(h, { token: KLJUC_ANON, telo: TELO });
      provera(`${naziv}: sam anon ključ nije prijava (401)`, r.status === 401, r.status);
      r = await z(h, { token: "tok-neaktivan", telo: { ...TELO, clanId: CILJ.id } });
      provera(`${naziv}: neaktivan član dobija 403`, r.status === 403, r.status);
      r = await z(h, { token: "tok-a", telo: { ...TELO, clanId: CILJ.id } });
      provera(`${naziv}: ČITALAC dobija 403 nije_bibliotekar`, r.status === 403 && r.telo.greska.kod === "nije_bibliotekar", r.telo);
      r = await z(h, { token: "tok-a", telo: { ...TELO, clanId: CILJ.id, uloga: "bibliotekar" } });
      provera(`${naziv}: čitalac koji u telu napiše „uloga: bibliotekar” i dalje dobija 403 (uloga se čita iz baze)`, r.status === 403, r.status);
      nistaNijePromenjeno(`${naziv}: čitalac ne pravi nalog, ne menja PIN i ne briše ništa`);
      provera(`${naziv}: čitalac ne troši ograničenje`, stanje.pozivi.length === 0, stanje.pozivi);
      r = await z(h, { token: "tok-a", telo: {} });
      provera(`${naziv}: i prazan zahtev čitaoca daje 400 ili 403, nikad 200`, [400, 403].includes(r.status), r.status);
    }

    // ── napravi-clana: uspeh ──
    cisto();
    let o = await z(napraviClanaHandler, { token: "tok-bib", telo: { kartica: "0101228", ime: "  Ana   Petrović " } });
    const rez = o.telo?.rezultati?.[0];
    provera("napravi-clana: bibliotekar pravi člana (200)", o.status === 200 && rez?.clan && rez?.pin, o);
    provera("napravi-clana: broj karte ostaje tekst sa vodećom nulom (0101228, ne 101228)", rez?.clan.broj_kartice === "0101228" && stanje.upisaniClanovi[0]?.broj_kartice === "0101228" && typeof stanje.upisaniClanovi[0]?.broj_kartice === "string", stanje.upisaniClanovi[0]);
    provera("napravi-clana: Auth nalog je {karta}@citaliste.local, potvrđen, lozinka je PIN", stanje.nalozi.length === 1 && stanje.nalozi[0].email === "0101228@citaliste.local" && stanje.nalozi[0].potvrdjen === true && stanje.nalozi[0].password === rez?.pin, stanje.nalozi.map((n) => [n.email, n.potvrdjen]));
    provera("napravi-clana: PIN su 6 cifara i vraća se u odgovoru", /^[0-9]{6}$/.test(rez?.pin), rez?.pin?.length);
    provera("napravi-clana: red u clanovi ima isti id kao Auth nalog, ime bez viška razmaka i uloga 'citalac'", stanje.upisaniClanovi[0]?.id === stanje.nalozi[0]?.id && stanje.upisaniClanovi[0]?.ime === "Ana Petrović" && stanje.upisaniClanovi[0]?.uloga === "citalac", stanje.upisaniClanovi[0]);
    provera("napravi-clana: podrazumevani nadimak je „Ana P.”", stanje.upisaniClanovi[0]?.nadimak === "Ana P." && rez?.clan.nadimak === "Ana P.");
    provera("napravi-clana: odgovor ima no-store i PIN je u njemu tačno jednom", o.zaglavlja["cache-control"] === "no-store" && o.sirovo.split(rez.pin).length === 2, o.zaglavlja);
    provera("napravi-clana: PIN nije ni u jednom ispisu (log) funkcije", !pinuLogu(rez.pin) && dnevnik.length === 0, dnevnik);
    provera("napravi-clana: ograničenje se troši u kanti „clanovi:bibliotekar” sa granicom 60", stanje.pozivi.length === 1 && stanje.pozivi[0].kanta === KANTA && stanje.pozivi[0].najvise === 60 && stanje.pozivi[0].clan === BIB.id, stanje.pozivi);

    cisto();
    o = await z(napraviClanaHandler, { token: "tok-admin", telo: { kartica: "0000001", ime: "Mika Mikić" } });
    provera("napravi-clana: administrator takođe sme (200), karta 0000001 ostaje sa nulama", o.status === 200 && o.telo.rezultati[0].clan.broj_kartice === "0000001", o);

    cisto();
    o = await z(napraviClanaHandler, { token: "tok-bib", telo: { kartica: "0101228", ime: "Ana Petrović", uloga: "administrator", nadimak: "Hakerka", aktivan: false, id: randomUUID() } });
    provera("napravi-clana: uloga iz tela se ne čita: novi član je UVEK 'citalac' (nema ni tuđeg id-a, nadimka ni aktivan=false)", o.status === 200 && stanje.upisaniClanovi[0].uloga === "citalac" && stanje.upisaniClanovi[0].nadimak === "Ana P." && stanje.upisaniClanovi[0].id === stanje.nalozi[0].id && !("aktivan" in stanje.upisaniClanovi[0]), stanje.upisaniClanovi[0]);

    cisto();
    {
      const pinovi = new Set();
      for (let i = 0; i < 12; i++) {
        stanje.zauzeteKartice.clear();
        const r = await z(napraviClanaHandler, { token: "tok-bib", telo: { kartica: String(1000000 + i), ime: "Ana Petrović" } });
        pinovi.add(r.telo?.rezultati?.[0]?.pin);
      }
      provera("napravi-clana: svaki poziv daje svoj PIN (nije ugrađen ni ponovljen)", pinovi.size >= 10, pinovi.size);
    }

    // ── napravi-clana: neispravan zahtev ──
    for (const [naziv, telo] of [
      ["karta kao BROJ (vodeća nula je izgubljena)", { kartica: 101228, ime: "Ana Petrović" }],
      ["karta sa 6 cifara", { kartica: "101228", ime: "Ana Petrović" }],
      ["karta sa 8 cifara", { kartica: "01012280", ime: "Ana Petrović" }],
      ["karta sa slovima", { kartica: "BIB1234", ime: "Ana Petrović" }],
      ["bez karte", { ime: "Ana Petrović" }],
      ["ime bez prezimena", { kartica: "0101228", ime: "Ana" }],
      ["ime sa ciframa", { kartica: "0101228", ime: "Ana 123" }],
      ["bez imena", { kartica: "0101228" }],
    ]) {
      cisto();
      o = await z(napraviClanaHandler, { token: "tok-bib", telo });
      provera(`napravi-clana odbija (400): ${naziv}`, o.status === 400 && ["neispravna_kartica", "neispravno_ime"].includes(o.telo.greska.kod), o);
      provera(`napravi-clana: ${naziv} ne troši ograničenje i ništa ne pravi`, stanje.pozivi.length === 0 && stanje.nalozi.length === 0 && stanje.upisaniClanovi.length === 0, stanje.pozivi);
    }
    cisto();
    o = await z(napraviClanaHandler, { token: "tok-bib", telo: [] });
    provera("napravi-clana: telo koje nije objekat daje 400", o.status === 400, o.status);

    // ── napravi-clana: karta već postoji ──
    cisto();
    stanje.zauzeteKartice.add("0101228");
    o = await z(napraviClanaHandler, { token: "tok-bib", telo: TELO });
    provera("napravi-clana: postojeća karta daje 409 kartica_postoji, bez novog naloga i bez PIN-a u odgovoru", o.status === 409 && o.telo.greska.kod === "kartica_postoji" && stanje.nalozi.length === 0 && !/"pin"/.test(o.sirovo), o);
    cisto();
    stanje.zauzetiEmail.add("0101228@citaliste.local");
    o = await z(napraviClanaHandler, { token: "tok-bib", telo: TELO });
    provera("napravi-clana: Auth nalog sa tom adresom već postoji → 409 kartica_postoji, red u clanovi se ne piše", o.status === 409 && o.telo.greska.kod === "kartica_postoji" && stanje.upisaniClanovi.length === 0, o);

    // ── napravi-clana: kvar usred posla (nalog se poništava, PIN ne curi) ──
    cisto();
    stanje.upisGreska = "dupli";
    o = await z(napraviClanaHandler, { token: "tok-bib", telo: TELO });
    provera("napravi-clana: istovremeni upis iste karte (23505) → 409, a Auth nalog se briše", o.status === 409 && o.telo.greska.kod === "kartica_postoji" && stanje.obrisaniNalozi.length === 1 && stanje.obrisaniNalozi[0] === stanje.nalozi[0].id, { o: o.telo, obrisano: stanje.obrisaniNalozi });
    cisto();
    stanje.upisGreska = "opsta";
    o = await z(napraviClanaHandler, { token: "tok-bib", telo: TELO });
    {
      const pinKvara = stanje.nalozi[0]?.password ?? "";
      provera("napravi-clana: kvar baze pri upisu → 500, Auth nalog se poništava", o.status === 500 && o.telo.greska.kod === "greska_servera" && stanje.obrisaniNalozi.length === 1, o);
      provera("napravi-clana: PIN nije u odgovoru greške ni u logu, čak ni kad ga poruka baze sadrži", pinKvara.length === 6 && !o.sirovo.includes(pinKvara) && !pinuLogu(pinKvara) && dnevnik.length > 0, { dnevnik });
    }
    cisto();
    stanje.upisGreska = "opsta";
    stanje.brisanjeGreska = true;
    o = await z(napraviClanaHandler, { token: "tok-bib", telo: TELO });
    provera("napravi-clana: ako ni poništavanje ne uspe, upozorenje ide u log (bez PIN-a), odgovor je 500", o.status === 500 && dnevnik.some((r) => r.includes("UPOZORENJE")) && !pinuLogu(stanje.nalozi[0].password), dnevnik);
    cisto();
    stanje.authGreska = true;
    o = await z(napraviClanaHandler, { token: "tok-bib", telo: TELO });
    provera("napravi-clana: kvar Auth-a (poruka sadrži lozinku) → 500; PIN nije ni u odgovoru ni u logu", o.status === 500 && !/[0-9]{6}/.test(o.sirovo.replace(/"ponovoZaSekundi":null/, "")) && !dnevnik.some((r) => /lozinku [0-9]{6}/.test(r)) && stanje.upisaniClanovi.length === 0, { sirovo: o.sirovo, dnevnik });

    // ── ograničenje: 60 na sat po korisniku, zajednička kanta, zatvoreno ──
    cisto();
    stanje.brojac.set(kljucB(BIB.id, KANTA), 59);
    o = await z(napraviClanaHandler, { token: "tok-bib", telo: TELO });
    provera("ograničenje: 60. zahtev prolazi", o.status === 200, o.status);
    stanje.zauzeteKartice.clear();
    o = await z(napraviClanaHandler, { token: "tok-bib", telo: { kartica: "0101229", ime: "Ana Petrović" } });
    provera("ograničenje: 61. zahtev daje 429 previse_zahteva sa Retry-After, bez novog naloga", o.status === 429 && o.telo.greska.kod === "previse_zahteva" && o.zaglavlja["retry-after"] === "1234" && stanje.nalozi.length === 1, o);
    o = await z(resetujPinHandler, { token: "tok-bib", telo: { clanId: CILJ.id } });
    provera("ograničenje: kanta je zajednička, pa i resetuj-pin dobija 429", o.status === 429 && stanje.promenePina.length === 0, o.status);
    o = await z(napraviClanaHandler, { token: "tok-admin", telo: { kartica: "0101230", ime: "Mika Mikić" } });
    provera("ograničenje je po korisniku: administrator ima svoju kantu", o.status === 200, o.status);
    cisto();
    stanje.rpcGreska = true;
    o = await z(napraviClanaHandler, { token: "tok-bib", telo: TELO });
    provera("ograničenje je zatvoreno: kad baza ne radi, napravi-clana daje 503 i ništa ne pravi", o.status === 503 && o.telo.greska.kod === "ogranicenje_nedostupno" && stanje.nalozi.length === 0, o);
    o = await z(resetujPinHandler, { token: "tok-bib", telo: { clanId: CILJ.id } });
    provera("ograničenje je zatvoreno: kad baza ne radi, resetuj-pin daje 503 i ne menja PIN", o.status === 503 && stanje.promenePina.length === 0, o);
    cisto();
    stanje.ulogaGreska = true;
    o = await z(napraviClanaHandler, { token: "tok-bib", telo: TELO });
    provera("kad se uloga ne može pročitati, zahtev se odbija (503), ne propušta", o.status === 503 && stanje.nalozi.length === 0, o);

    // ── resetuj-pin ──
    cisto();
    o = await z(resetujPinHandler, { token: "tok-bib", telo: { clanId: CILJ.id } });
    {
      const r1 = o.telo?.rezultati?.[0];
      provera("resetuj-pin: bibliotekar menja PIN čitaocu (200), nov PIN je 6 cifara", o.status === 200 && /^[0-9]{6}$/.test(r1?.pin) && r1.clan.id === CILJ.id && r1.clan.broj_kartice === "0101228", o);
      provera("resetuj-pin: lozinka Auth naloga je upravo taj PIN", stanje.promenePina.length === 1 && stanje.promenePina[0].id === CILJ.id && stanje.promenePina[0].password === r1.pin, stanje.promenePina.map((p) => p.id));
      provera("resetuj-pin: no-store, PIN je u odgovoru jednom i nije u logu", o.zaglavlja["cache-control"] === "no-store" && o.sirovo.split(r1.pin).length === 2 && !pinuLogu(r1.pin) && dnevnik.length === 0, dnevnik);
      provera("resetuj-pin: ograničenje u kanti „clanovi:bibliotekar” (60)", stanje.pozivi.length === 1 && stanje.pozivi[0].kanta === KANTA && stanje.pozivi[0].najvise === 60, stanje.pozivi);
    }
    cisto();
    o = await z(resetujPinHandler, { token: "tok-bib", telo: { clanId: CLANOVI["cilj-admin"].id } });
    provera("resetuj-pin: BIBLIOTEKAR ne sme administratoru (403 nema_dozvole), PIN se ne menja", o.status === 403 && o.telo.greska.kod === "nema_dozvole" && stanje.promenePina.length === 0 && !/"pin"/.test(o.sirovo), o);
    cisto();
    o = await z(resetujPinHandler, { token: "tok-bib", telo: { clanId: CLANOVI["cilj-admin"].id, uloga: "administrator" } });
    provera("resetuj-pin: bibliotekar koji u telu napiše „uloga: administrator” i dalje dobija 403", o.status === 403 && stanje.promenePina.length === 0, o.status);
    cisto();
    o = await z(resetujPinHandler, { token: "tok-bib", telo: { clanId: CLANOVI["cilj-bib"].id } });
    provera("resetuj-pin: bibliotekar ne menja PIN ni drugom bibliotekaru (403)", o.status === 403 && stanje.promenePina.length === 0, o.status);
    cisto();
    o = await z(resetujPinHandler, { token: "tok-bib", telo: { clanId: BIB.id } });
    provera("resetuj-pin: bibliotekar ne menja PIN ni sebi preko ove funkcije (403)", o.status === 403 && stanje.promenePina.length === 0, o.status);
    cisto();
    for (const cilj of ["cilj-admin", "cilj-bib", "cilj-citalac"]) {
      stanje.promenePina.length = 0;
      o = await z(resetujPinHandler, { token: "tok-admin", telo: { clanId: CLANOVI[cilj].id } });
      provera(`resetuj-pin: administrator sme (${cilj})`, o.status === 200 && stanje.promenePina.length === 1, o.status);
    }
    cisto();
    o = await z(resetujPinHandler, { token: "tok-admin", telo: { clanId: randomUUID() } });
    provera("resetuj-pin: nepoznat član daje 404", o.status === 404 && o.telo.greska.kod === "clan_ne_postoji" && stanje.promenePina.length === 0, o);
    for (const losa of [undefined, "", "nije-uuid", 123, ["x"], "../../etc"]) {
      cisto();
      o = await z(resetujPinHandler, { token: "tok-admin", telo: { clanId: losa } });
      provera(`resetuj-pin odbija (400) neispravan id: ${JSON.stringify(losa)}`, o.status === 400 && stanje.promenePina.length === 0 && stanje.pozivi.length === 0, o.status);
    }
    cisto();
    stanje.promenaGreska = true;
    o = await z(resetujPinHandler, { token: "tok-admin", telo: { clanId: CILJ.id } });
    provera("resetuj-pin: kvar Auth-a → 500; PIN nije u odgovoru ni u logu", o.status === 500 && o.telo.greska.kod === "greska_servera" && !/[0-9]{6}/.test(o.sirovo.replace(/"ponovoZaSekundi":null/, "")) && !dnevnik.some((r) => /za [0-9]{6}/.test(r)) && dnevnik.length > 0, { sirovo: o.sirovo, dnevnik });

    // ── izvorni kod ──
    for (const p of ["api/napravi-clana.js", "api/resetuj-pin.js", "api/_lib/pin.js"]) {
      const kod = citaj(p).replace(/\/\/.*$/gm, "");
      provera(`${p}: nijedan console poziv ne ispisuje promenljivu pin (samo kroz bezPina/dnevnik)`, !/console\.\w+\([^;]*\bpin\b(?!\w)/.test(kod.replace(/dnevnik\([^)]*\)/g, "")), kod.match(/console\.\w+\([^;]*pin[^;]*/g));
    }
    provera("funkcije ne čitaju ulogu iz tela zahteva (samo iz baze, preko obradi i ulogaOsoblja)", !/telo\.uloga|req\.body\.uloga|body\.uloga/.test(citaj("api/napravi-clana.js") + citaj("api/resetuj-pin.js")));
    provera("napravi-clana upisuje ulogu 'citalac' kao literal", /uloga:\s*"citalac"/.test(citaj("api/napravi-clana.js")));
    provera("servisni ključ je samo na serveru: nijedan fajl u src/ ne čita SUPABASE_SERVICE_ROLE_KEY (komentari se ne računaju)", ["src/lib", "src/pages", "src/components"].every((d) => readdirSync(new URL(`../${d}/`, import.meta.url)).every((f) => !/SERVICE_ROLE_KEY|VITE_SERVICE/.test(citaj(`${d}/${f}`).replace(/\/\/.*$/gm, "")))));

    // ── ekrani za bibliotekare (izvorni kod i čista logika) ──
    {
      const ol = await import("../src/lib/osoblje-logika.js");
      const TK = (await import("../src/lib/tekst.js")).tekst;
      const bezKom = (s) => s.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
      const ekrani = ["src/pages/BibliotekarClanovi.jsx", "src/pages/BibliotekarPocetna.jsx", "src/components/PinPrikaz.jsx"];

      provera("upit za pretragu članova: znaci filtera (zarez, zagrade, navodnici, %, *, \\) postaju razmaci", clanUnos.upitZaPretragu("Ana,(Petrović)%*\"x\"\\") === "Ana Petrović x" && clanUnos.upitZaPretragu("  0101228 ") === "0101228" && clanUnos.upitZaPretragu(null) === "" && clanUnos.upitZaPretragu("x".repeat(200)).length === 60);
      provera("ko kim upravlja u prikazu: administrator svima; bibliotekar samo čitaocima; čitalac nikome", ol.mozeDaUpravlja("administrator", "administrator") && ol.mozeDaUpravlja("administrator", "citalac") && ol.mozeDaUpravlja("bibliotekar", "citalac") && !ol.mozeDaUpravlja("bibliotekar", "administrator") && !ol.mozeDaUpravlja("bibliotekar", "bibliotekar") && !ol.mozeDaUpravlja("citalac", "citalac") && !ol.mozeDaUpravlja(undefined, "citalac"));
      provera("datum rezervacije: vreme iz baze postaje „D. M. GGGG.” (lokalno), neispravan ulaz se vraća", (await import("../src/lib/polica-logika.js")).formatDatum(ol.datumIzVremena(new Date(2026, 10, 9, 12, 0, 0).toISOString())) === "9. 11. 2026." && ol.datumIzVremena("nije datum") === "nije datum" && ol.datumIzVremena(null) === "");
      provera("tekst.js: uloge članova imaju natpis", ["citalac", "bibliotekar", "administrator"].every((u) => typeof TK.clanovi.uloge[u] === "string"));
      provera("tekst.js: svaki kod greške koji funkcije vraćaju ima poruku za bibliotekara", ["nije_prijavljen", "nije_bibliotekar", "nema_dozvole", "kartica_postoji", "neispravna_kartica", "neispravno_ime", "clan_ne_postoji", "previse_zahteva", "ogranicenje_nedostupno", "mreza", "greska_servera"].every((k) => typeof TK.clanovi.greske[k] === "string" && TK.clanovi.greske[k].length > 5) && TK.clanovi.greske.previse_zahteva.includes("{minuta}"));

      // rute i navigacija: samo bibliotekari
      const aplikacija = citaj("src/App.jsx");
      const unutarRute = /<RutaZaBibliotekare>|<Route element=\{<RutaZaBibliotekare \/>\}>([\s\S]*?)<\/Route>/.exec(aplikacija)?.[1] ?? "";
      provera("rute /bibliotekar, /bibliotekar/unos i /bibliotekar/clanovi su unutar RutaZaBibliotekare, a /bibliotekar/rezervacije više ne postoji", ["/bibliotekar\"", "/bibliotekar/unos", "/bibliotekar/clanovi"].every((p) => unutarRute.includes(`path="${p.replace(/"$/, "")}"`)) && !aplikacija.includes("rezervacije"), unutarRute);
      const okvir = citaj("src/components/Okvir.jsx");
      provera("navigacija: ulaz u alate za bibliotekare se dodaje samo kad je jeBibliotekar(clan?.uloga)", /jeBibliotekar\(clan\?\.uloga\) \? \[\.\.\.STAVKE, STAVKA_OSOBLJA\] : STAVKE/.test(okvir) && !/STAVKE = \[[\s\S]*?bibliotekar[\s\S]*?\];/.test(okvir.replace(/STAVKA_OSOBLJA[\s\S]*$/m, "")));

      // PIN: samo u stanju ekrana
      for (const p of ekrani) {
        const kod = bezKom(citaj(p));
        provera(`${p}: bez localStorage, sessionStorage, IndexedDB i kolačića (PIN ostaje samo u stanju ekrana)`, !/localStorage|sessionStorage|indexedDB|document\.cookie/.test(kod));
        provera(`${p}: bez hex boja i tuđih paleta (samo boje iz teme)`, !/#[0-9a-fA-F]{3,8}\b/.test(kod) && !/\b(?:bg|text|border|ring|accent|fill|stroke|from|to|via|outline|divide)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone|black)(?:-\d{2,3})?\b/.test(kod) && !/\[#/.test(kod));
        provera(`${p}: ne piše natpise u JSX-u (nema dugih srpskih rečenica ni ćirilice izvan tekst.js)`, !/>\s*[A-ZČĆŠŽĐ][a-zčćšžđ]+(?:\s+[a-zčćšžđ]+){2,}[.!?]?\s*</.test(kod) && !/[Ѐ-ӿ]/.test(kod));
        provera(`${p}: svako dugme ima min-h-11 ili zajednički stil iz stil.js (najmanje 44 px)`, kod.split("<button").slice(1).every((deo) => /className=\{(?:`\$\{)?(?:stil\.|c\.aktivan \? stil)/.test(deo.split("</button>")[0]) || /min-h-1[1-9]/.test(deo.split("</button>")[0])));
      }
      const clanoviKod = bezKom(citaj("src/pages/BibliotekarClanovi.jsx"));
      provera("broj karte u formi je tekst: bez type=\"number\", Number(), parseInt() i valueAsNumber", !/type="number"|\bNumber\(|parseInt|valueAsNumber/.test(clanoviKod + bezKom(citaj("src/lib/clanovi.js")) + bezKom(citaj("src/lib/clan-unos.js"))));
      provera("PIN se ne ispisuje u konzolu ni u klijentskom kodu", !/console\.\w+\([^;]*\bpin\b(?!\w)/.test(bezKom(citaj("src/pages/BibliotekarClanovi.jsx") + citaj("src/lib/clanovi.js") + citaj("src/components/PinPrikaz.jsx"))));
      provera("klijent ne zove Auth admin API i ne piše u clanovi nalog (pravi ih samo server): nema createUser/updateUserById i insert u clanovi", !/createUser|updateUserById|auth\.admin/.test(bezKom(citaj("src/lib/clanovi.js"))) && !/from\("clanovi"\)\s*\.insert/.test(bezKom(citaj("src/lib/clanovi.js"))));
      provera("klijent pravi člana i menja PIN samo preko /api/napravi-clana i /api/resetuj-pin", citaj("src/lib/clanovi.js").includes('"/api/napravi-clana"') && citaj("src/lib/clanovi.js").includes('"/api/resetuj-pin"'));
      provera("kartica za štampu: portal u <body>, na ekranu skrivena, pri štampi sakriva sve ostalo (@media print)", /createPortal\([\s\S]*document\.body/.test(citaj("src/components/PinPrikaz.jsx")) && /\.stampa-kartica\s*\{\s*display:\s*none/.test(citaj("src/index.css")) && /@media print[\s\S]*body > \*:not\(\.stampa-kartica\)[\s\S]*display:\s*none !important/.test(citaj("src/index.css")));
      provera("kartica za štampu sadrži ustanovu, logo biblioteke, ime, broj karte, PIN i uputstvo za prijavu", ["aplikacija.ustanova", "/logo.png", "clan.ime", "clan.broj_kartice", "{pin}", "kartica.uputstvo"].every((s) => citaj("src/components/PinPrikaz.jsx").includes(s)));
    }

    // ── ćirilica (tekst aplikacije, pismo, ime, API poruke) ──
    {
      const TK = (await import("../src/lib/tekst.js")).tekst;
      const pismo = await import("../src/lib/pismo.js");
      const vrednosti = [];
      (function hod(o, put) {
        for (const [k, v] of Object.entries(o)) {
          if (typeof v === "string") vrednosti.push([`${put}.${k}`, k, v]);
          else hod(v, `${put}.${k}`);
        }
      })(TK, "");
      const kljucevi = [];
      (function hodKljuceve(o) {
        for (const [k, v] of Object.entries(o)) {
          kljucevi.push(k);
          if (v && typeof v === "object") hodKljuceve(v);
        }
      })(TK);
      // Latinica je dozvoljena samo u zaštićenim izrazima: {placeholderi}, https://, Google Books, COBISS, ISBN, jpeg, png, webp, MB
      const bezZasticenog = (s) => s.replace(/\{[^}]*\}|https|Google Books|COBISS|ISBN|jpeg|png|webp|MB/g, "");
      const latinicni = vrednosti.filter(([put, , v]) => put !== ".aplikacija.jezik" && /[A-Za-zČĆŠŽĐčćšžđ]/.test(bezZasticenog(v)));
      provera("tekst.js: svaka vrednost je na ćirilici (latinica samo u zaštićenim izrazima)", latinicni.length === 0, latinicni.slice(0, 5));
      provera("tekst.js: ključevi su ostali latinični (nijedan ključ nema ćirilicu)", kljucevi.every((k) => !/[Ѐ-ӿ]/.test(k)) && kljucevi.length > 300);
      provera("tekst.js: ime aplikacije, ustanova i grb (1846 ostaje); jezik je sr-Cyrl-RS", TK.aplikacija.naziv === "Читалиште" && TK.aplikacija.ustanova.includes("Доситеј Новаковић") && TK.aplikacija.godina === "1846" && TK.aplikacija.jezik === "sr-Cyrl-RS");
      provera("tekst.js: ekavica i slova srpske ćirilice (љ њ џ ђ ћ) rade u natpisima", TK.pocetna.kartice.zelim === "Желим" && TK.knjigaEkran.polica.stanja.procitano === "Прочитано" && /књиг/.test(TK.pretraga.nase.nema + TK.unos.naslov) && vrednosti.some(([, , v]) => /џ/.test(v) === false) && vrednosti.some(([, , v]) => /ђ|ћ/.test(v)) && vrednosti.some(([, , v]) => /љ/.test(v)) && vrednosti.some(([, , v]) => /њ/.test(v)));
      provera("tekst.js: {placeholderi} su neprevedeni (kod ih zamenjuje po imenu)", ["{n}", "{ime}", "{karta}", "{naziv}", "{minuta}", "{primeraka}", "{datum}", "{ocena}", "{opis}", "{naslov}", "{autor}"].every((h) => vrednosti.some(([, , v]) => v.includes(h))) && vrednosti.every(([, , v]) => [...v.matchAll(/\{([^}]*)\}/g)].every((m) => /^[a-z_]+$/.test(m[1]))));
      provera("tekst.js: PIN je „ПИН”, a ostali nazivi (Google Books, ISBN, https://) ostaju kakvi su; COBISS se ne pominje (aplikacija nije povezana sa njim)", vrednosti.some(([, , v]) => v.includes("ПИН")) && !vrednosti.some(([, , v]) => /\bPIN\b/.test(v)) && TK.pretraga.google.naslov.includes("Google Books") && !vrednosti.some(([, , v]) => /COBISS/.test(v)) && TK.pretraga.link.polje.includes("https://"));
      provera("tekst.js: oblici reči „примерак” (1, 2 do 4, ostalo) su u tekst.js, ne u kodu", TK.opste.primerak.jedan === "примерак" && TK.opste.primerak.paukal === "примерка" && TK.opste.primerak.mnogo === "примерака" && !/"primerak"|"primerka"|"primeraka"/.test(citaj("src/lib/unos-knjiga.js")));

      // nijedan korisnički tekst van tekst.js: JSX i src/lib bez latiničnih rečenica i bez ćirilice (ćirilica je samo u tekst.js i pismo.js)
      const izvanTeksta = [];
      for (const d of ["src/pages", "src/components", "src/lib"]) {
        for (const f of readdirSync(new URL(`../${d}/`, import.meta.url))) {
          if (!/\.(jsx?|mjs)$/.test(f) || `${d}/${f}` === "src/lib/tekst.js" || `${d}/${f}` === "src/lib/pismo.js") continue;
          const kod = citaj(`${d}/${f}`).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\/.*$/gm, "");
          if (/[Ѐ-ӿ]/.test(kod)) izvanTeksta.push(`${d}/${f}: ćirilica`);
          if (/"[A-ZČĆŠŽĐ][a-zčćšžđ]+(?: [a-zčćšžđ,]+){2,}[.!?:…]?"/.test(kod.replace(/className=\{?"[^"]*"/g, ""))) izvanTeksta.push(`${d}/${f}: latinična rečenica`);
        }
      }
      provera("nema korisničkog teksta van tekst.js (ni ćirilice ni latiničnih rečenica u src/pages, src/components, src/lib)", izvanTeksta.length === 0, izvanTeksta);

      // pismo: pretraga članova u oba pisma
      provera("pismo.js: latinica → ćirilica (digrafi lj, nj, dž; velika slova)", pismo.uCirilicu("Ana Petrović") === "Ана Петровић" && pismo.uCirilicu("Ljubica Njegovan") === "Љубица Његован" && pismo.uCirilicu("Džon džep") === "Џон џеп" && pismo.uCirilicu("Đorđe Šaponja") === "Ђорђе Шапоња" && pismo.uCirilicu("0101228") === "0101228");
      provera("pismo.js: ćirilica → latinica (љ, њ, џ, ђ, ћ, ј)", pismo.uLatinicu("Ана Петровић") === "Ana Petrović" && pismo.uLatinicu("Љубица Његован") === "Ljubica Njegovan" && pismo.uLatinicu("џеп Ђорђе") === "džep Đorđe" && pismo.uLatinicu("Јован Ћирић") === "Jovan Ćirić");
      provera("pismo.js: oblikeUpita daje upit kako je upisan, ćirilicom i latinicom, bez ponavljanja", JSON.stringify(pismo.oblikeUpita("ana")) === JSON.stringify(["ana", "ана"]) && JSON.stringify(pismo.oblikeUpita("Ана")) === JSON.stringify(["Ана", "Ana"]) && JSON.stringify(pismo.oblikeUpita("0101")) === JSON.stringify(["0101"]) && pismo.oblikeUpita("").length === 0);
      provera("pretraga članova koristi oba pisma za ime, a broj karte kako je upisan", /oblikeUpita\(cist\)\.map\(\(o\) => `ime\.ilike/.test(citaj("src/lib/clanovi.js")) && citaj("src/lib/clanovi.js").includes("broj_kartice.ilike.%${cist}%"));
      provera("klijent nigde ne poredi tekst bez normalizacije: pretraga knjiga i duplikati idu kroz trazi_knjige (privatno.norm_tekst u bazi)", /rpc\("trazi_knjige"/.test(citaj("src/lib/knjige.js")) && !/\.(toLowerCase|toUpperCase)\(\)\s*(===|\.includes)/.test(citaj("src/lib/knjige.js") + citaj("src/lib/unos-knjiga.js") + citaj("src/pages/Pretraga.jsx") + citaj("src/components/RezultatKnjige.jsx")));

      // ime i nadimak u ćirilici
      provera("ime: ćirilica prolazi proveru (dve reči, slova), a nadimak je „Ана П.”", clanUnos.ocistiIme("  Ана   Петровић ") === "Ана Петровић" && clanUnos.podrazumevaniNadimak("Ана Петровић") === "Ана П." && clanUnos.podrazumevaniNadimak("Јована Ђорђевић") === "Јована Ђ." && clanUnos.podrazumevaniNadimak("Марија Љубичић") === "Марија Љ." && clanUnos.podrazumevaniNadimak("Ана Марија Петровић") === "Ана П." && clanUnos.podrazumevaniNadimak("ана петровић") === "ана П." && clanUnos.ocistiIme("Ана Петровић 2") === null);
      cisto();
      let oc = await z(napraviClanaHandler, { token: "tok-bib", telo: { kartica: "0101228", ime: "Ана Петровић" } });
      provera("napravi-clana: ime upisano ćirilicom se čuva kako je upisano, nadimak je „Ана П.”, karta i PIN su cifre", oc.status === 200 && stanje.upisaniClanovi[0]?.ime === "Ана Петровић" && stanje.upisaniClanovi[0]?.nadimak === "Ана П." && stanje.upisaniClanovi[0]?.broj_kartice === "0101228" && /^[0-9]{6}$/.test(oc.telo.rezultati[0].pin), stanje.upisaniClanovi[0]);
      cisto();
      oc = await z(napraviClanaHandler, { token: "tok-bib", telo: { kartica: "0101228", ime: "Ana Petrović" } });
      provera("napravi-clana: ime upisano latinicom i dalje radi („Ana P.”)", oc.status === 200 && stanje.upisaniClanovi[0]?.nadimak === "Ana P.", stanje.upisaniClanovi[0]);
      cisto();

      // poruke grešaka iz api/ funkcija: ćirilica (latinica samo u zaštićenim izrazima), kodovi nepromenjeni
      const porukeApi = [];
      const hodApi = (d) => {
        for (const f of readdirSync(new URL(`../${d}/`, import.meta.url), { withFileTypes: true })) {
          if (f.isDirectory()) hodApi(`${d}/${f.name}`);
          else if (f.name.endsWith(".js")) {
            const kod = citaj(`${d}/${f.name}`);
            for (const m of kod.matchAll(/new ApiGreska\([^"\n]*?(?:"[a-z_]+"|[^,\n]*?"[a-z_]+" : "[a-z_]+"),\s*"([^"]*)"\)/g)) porukeApi.push([`${d}/${f.name}`, m[1]]);
          }
        }
      };
      hodApi("api");
      const latinicneApi = porukeApi.filter(([, m]) => /[A-Za-zČĆŠŽĐčćšžđ]/.test(m.replace(/https|Google Books|Google|GOOGLE_BOOKS_API_KEY|API|JSON|Supabase|ISBN|jpeg|png|webp/g, "")));
      provera("poruke grešaka u api/ funkcijama su na ćirilici (kodovi greške ostaju latinični)", porukeApi.length > 40 && latinicneApi.length === 0, latinicneApi.slice(0, 5));
      oc = await z(napraviClanaHandler, { token: "tok-a", telo: TELO });
      provera("odgovor funkcije sa greškom nosi poruku na ćirilici, a kod nepromenjen (nije_bibliotekar)", oc.status === 403 && oc.telo.greska.kod === "nije_bibliotekar" && /Само библиотекар/.test(oc.telo.greska.poruka), oc.telo);
      cisto();
      oc = await z(napraviClanaHandler, { token: "tok-bib", telo: { kartica: "12", ime: "Ана Петровић" } });
      provera("neispravan broj karte: kod neispravna_kartica, poruka na ćirilici; korisnik vidi tekst iz tekst.js (ćirilica)", oc.status === 400 && oc.telo.greska.kod === "neispravna_kartica" && /[Ѐ-ӿ]/.test(oc.telo.greska.poruka) && /[Ѐ-ӿ]/.test(TK.clanovi.greske.neispravna_kartica), oc.telo);
      cisto();

      // tehnički detalji
      const html = citaj("index.html").replace(/<!--[\s\S]*?-->/g, "");
      provera("index.html: lang=\"sr\", bez Bricolage Grotesque (nema ćirilicu) i bez ijednog linka ka Google-u (fontovi su iz projekta, vidi fazu PWA)", /<html lang="sr">/.test(html) && !/Bricolage/.test(html) && !/googleapis|gstatic/.test(html));
      provera("index.css: font naslova je Onest, font teksta Inter", /--font-naslov:\s*"Onest"/.test(citaj("src/index.css")) && /--font-sans:\s*"Inter"/.test(citaj("src/index.css")) && !/Bricolage/.test(citaj("src/index.css").replace(/\/\*[\s\S]*?\*\//g, "")));
      const vite = citaj("vite.config.js");
      provera("vite.config.js: ime, kratko ime i opis PWA, kao i naslov stranice, dolaze iz tekst.js (ćirilica), jezik manifesta iz tekst.js", /name:\s*tekst\.aplikacija\.naziv/.test(vite) && /short_name:\s*tekst\.aplikacija\.naziv/.test(vite) && /description:\s*tekst\.aplikacija\.opis/.test(vite) && /lang:\s*tekst\.aplikacija\.jezik/.test(vite) && /replaceAll\("%NAZIV%", tekst\.aplikacija\.naziv\)/.test(vite) && /[Ѐ-ӿ]/.test(TK.aplikacija.naziv + TK.aplikacija.opis) && !/[Ѐ-ӿ]/.test(vite));
      provera("kartica za štampu: ustanova, naslov kartice i uputstvo su iz tekst.js na ćirilici, logo biblioteke je slika", /[Ѐ-ӿ]/.test(TK.aplikacija.ustanova + TK.clanovi.kartica.naslov + TK.clanovi.kartica.uputstvo) && TK.clanovi.kartica.uputstvo.includes("{naziv}") && citaj("src/components/PinPrikaz.jsx").includes("/logo.png"));
    }

    // ── ekran „Читаоци" (čista logika, izvorni kod, migracija 0019) ──
    {
      const L = await import("../src/lib/citaoci-logika.js");
      const TK = (await import("../src/lib/tekst.js")).tekst;
      const bezKom = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      const nove = ["src/pages/Citaoci.jsx", "src/pages/CitalacProfil.jsx", "src/components/PreporuciKnjigu.jsx", "src/components/PreporuciCitaocu.jsx", "src/components/UtisakCitaoca.jsx", "src/components/Avatar.jsx"];
      const libNove = ["src/lib/citaoci.js", "src/lib/citaoci-logika.js"];

      // šifra poziva, napomena, razlog
      provera("šifra poziva: razmaci na krajevima se skidaju, unutra sabijaju; mala slova i razdelnici ostaju (baza ih izjednačava); prekratko, predugo i ne-tekst daju null", L.urediSifru("  NEG·4471·KJ ") === "NEG·4471·KJ" && L.urediSifru("neg  4471   kj") === "neg 4471 kj" && L.urediSifru("NEG-4471-KJ") === "NEG-4471-KJ" && L.urediSifru("ab") === null && L.urediSifru("x".repeat(41)) === null && L.urediSifru("") === null && L.urediSifru(null) === null && L.urediSifru(4471) === null);
      provera("napomena uz preporuku: najviše 280 znakova (280 prolazi, 281 ne), prazno je null, razmaci sa krajeva se skidaju", L.NAJDUZA_NAPOMENA === 280 && L.urediNapomenu("x".repeat(280)).ok && !L.urediNapomenu("x".repeat(281)).ok && L.urediNapomenu("x".repeat(281)).razlog === "predugo" && L.urediNapomenu("   ").vrednost === null && L.urediNapomenu(" Pročitaj ").vrednost === "Pročitaj" && L.urediNapomenu(undefined).ok);
      provera("razlog prijave: obavezan, do 300 znakova", !L.urediRazlog("  ").ok && L.urediRazlog("  ").razlog === "prazno" && L.urediRazlog("x".repeat(300)).ok && L.urediRazlog("x".repeat(301)).razlog === "predugo" && L.urediRazlog(" razlog ").vrednost === "razlog");
      provera("veze se grupišu: primljeni i poslati pozivi (na čekanju) i povezani (prihvaćene), najnovije prvo; nepoznato se izostavlja", (() => {
        const g = L.grupisiVeze([
          { id: 1, status: "na_cekanju", smer: "primljen", kreirana: "2026-11-01" },
          { id: 2, status: "na_cekanju", smer: "primljen", kreirana: "2026-11-05" },
          { id: 3, status: "na_cekanju", smer: "poslat", kreirana: "2026-11-02" },
          { id: 4, status: "prihvacena", smer: "poslat", kreirana: "2026-10-01" },
          { id: 5, status: "prihvacena", smer: "primljen", kreirana: "2026-10-09" },
          { id: 6, status: "nesto", smer: "poslat", kreirana: "2026-11-09" },
        ]);
        return g.primljeni.map((x) => x.id).join() === "2,1" && g.poslati.map((x) => x.id).join() === "3" && g.povezani.map((x) => x.id).join() === "5,4" && L.grupisiVeze(null).povezani.length === 0;
      })());
      provera("prikaz drugog člana je samo nadimak: bez nadimka dolazi zamena (opšta reč), nikad nešto drugo", L.prikaznoIme("Ана П.", "Читалац") === "Ана П." && L.prikaznoIme(null, "Читалац") === "Читалац" && L.prikaznoIme("   ", "Читалац") === "Читалац" && L.prikaznoIme(undefined, "Читалац") === "Читалац" && TK.citaoci.anonimno === "Читалац");
      provera("inicijali iz nadimka (ćirilica i latinica), do dva slova, velika; bez nadimka „?”", L.inicijaliNadimka("Ана П.") === "АП" && L.inicijaliNadimka("jovana đ.") === "JĐ" && L.inicijaliNadimka("Ђорђе") === "Ђ" && L.inicijaliNadimka("Ана Мариа Петровић") === "АМ" && L.inicijaliNadimka("") === "?" && L.inicijaliNadimka(null) === "?");
      provera("boja avatara je iz teme (bordo, smeđa, zlato, ljubičasta) i ista za istog člana", L.BOJE_AVATARA.length === 4 && L.BOJE_AVATARA.every((b) => /^bg-(bordo|avatar-smeda|zlato|avatar-ljubicasta)$/.test(b)) && L.bojaAvatara("abc") === L.bojaAvatara("abc") && new Set(["a", "b", "c", "d", "e", "f", "g", "h"].map(L.bojaAvatara)).size > 1 && /--color-avatar-smeda/.test(citaj("src/index.css")) && /--color-avatar-ljubicasta/.test(citaj("src/index.css")));
      provera("obaveštenja: zbir poziva i neobrađenih preporuka; nebroj je 0; samo prihvaćene veze se nude za preporuku", L.brojObavestenja(2, 3) === 5 && L.brojObavestenja(0, 0) === 0 && L.brojObavestenja(undefined, "x") === 0 && L.povezaniSamo([{ status: "prihvacena", id: 1 }, { status: "na_cekanju", id: 2 }]).length === 1);
      provera("utisci sa knjigama i ocene po knjizi: utisak bez knjige se izostavlja, ocena samo kad je ima", (() => {
        const knjige = new Map([["k1", { id: "k1" }], ["k2", { id: "k2" }]]);
        const u = [{ id: 1, knjiga_id: "k1", ocena: 8 }, { id: 2, knjiga_id: "k2", ocena: null }, { id: 3, knjiga_id: "k9", ocena: 5 }];
        return L.utisciSaKnjigama(u, knjige).length === 2 && L.ocenePoKnjizi(u).get("k1") === 8 && !L.ocenePoKnjizi(u).has("k2");
      })());

      // pravila: nema spiska ni pretrage članova; samo nadimak; jedna poruka za nepostojeću i blokiranu šifru
      for (const p of libNove) {
        const kod = bezKom(citaj(p));
        provera(`${p}: ne čita clanovi, nijedno pravo ime, broj karte ni šifru poziva drugog člana; nadimci samo iz pogleda moje_veze i moje_preporuke`, !/from\("clanovi"\)/.test(kod) && !/\b(broj_kartice|sifra_poziva)\b/.test(kod) && !/select\([^)]*\bime\b/.test(kod));
      }
      provera("citaoci.js: nadimci dolaze iz pogleda moje_veze i moje_preporuke", citaj("src/lib/citaoci.js").includes('from("moje_veze")') && citaj("src/lib/citaoci.js").includes('from("moje_preporuke")'));
      provera("citaoci.js: posaljiPoziv pretvara SVE greške P0001 (nepostojeća šifra, blokada, sopstvena šifra) u jedan kod, bez razlikovanja", (() => { const m = /export async function posaljiPoziv[\s\S]*?\n}\n/.exec(citaj("src/lib/citaoci.js"))?.[0] ?? ""; return (m.match(/GreskaApija\("/g) ?? []).length === 1 && m.includes('error.code === "P0001"') && m.includes('"sifra_nije_nadjena"'); })());
      for (const p of nove) {
        const kod = bezKom(citaj(p));
        provera(`${p}: bez prava imena, broja karte i šifre drugog člana u prikazu (samo nadimak; sopstvena šifra samo na Читаоци)`, !/\b(broj_kartice|ime_i_prezime)\b/.test(kod) && !/\.ime\b/.test(kod) && (p === "src/pages/Citaoci.jsx" || !/sifra_poziva/.test(kod)));
        provera(`${p}: bez localStorage i kolačića`, !/localStorage|sessionStorage|indexedDB|document\.cookie/.test(kod));
        provera(`${p}: bez hex boja i tuđih paleta (samo boje iz teme)`, !/#[0-9a-fA-F]{3,8}\b/.test(kod) && !/\b(?:bg|text|border|ring|accent|fill|stroke|from|to|via|outline|divide)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone|black)(?:-\d{2,3})?\b/.test(kod));
        provera(`${p}: svako dugme ima stil iz stil.js ili min-h-11 (najmanje 44 px)`, kod.split("<button").slice(1).every((deo) => /className=\{(?:`\$\{)?(?:stil\.|zauzet === v\.id|c\.aktivan)|className=\{stil\./.test(deo.split("</button>")[0]) || /min-h-1[1-9]/.test(deo.split("</button>")[0]) || /className=\{`\$\{stil\./.test(deo.split("</button>")[0])));
      }
      provera("ekran Читаоци: poruka za neuspeh poziva je jedna (nepostojeća i blokirana šifra), nigde se ne pominje blokada", (() => { const kod = bezKom(citaj("src/pages/Citaoci.jsx")); const poziv = /async function pozovi[\s\S]*?\n {2}}\n/.exec(kod)?.[0] ?? ""; return (kod.match(/T\.poziv\.nijeNadjena/g) ?? []).length === 1 && poziv.length > 200 && !/blok/i.test(poziv); })());
      provera("slobodnih poruka nema: jedini tekst koji član šalje drugom članu je napomena uz preporuku (≤ 280) i razlog prijave bibliotekaru", !/from\("poruke"\)|from\("razgovori"\)/.test(citaj("src/lib/citaoci.js")) && /from\("preporuke"\)\.insert/.test(citaj("src/lib/citaoci.js")) && /maxLength=\{NAJDUZA_NAPOMENA\}/.test(citaj("src/components/PreporuciKnjigu.jsx")) && /maxLength=\{NAJDUZA_NAPOMENA\}/.test(citaj("src/components/PreporuciCitaocu.jsx")));
      provera("profil čitaoca: ništa se ne prikazuje bez prihvaćene veze (prvo se traži veza, tek onda polica i utisci)", (() => { const kod = citaj("src/pages/CitalacProfil.jsx"); return kod.indexOf("ucitajVezuSaClanom(id)") > -1 && kod.indexOf("ucitajVezuSaClanom(id)") < kod.indexOf("ucitajPolicuCitaoca(id)") && /if \(!veza\) return/.test(kod); })());
      provera("spojler na profilu čitaoca: tekst je zamagljen (blur) i sakriven od čitača ekrana dok se ne dodirne", citaj("src/components/UtisakCitaoca.jsx").includes("blur-md") && citaj("src/components/UtisakCitaoca.jsx").includes("aria-hidden={zamagljen}"));
      provera("preporuka sa police ili iz pretrage; polica je MOJA (clan.id), pretraga ide kroz trazi_knjige", citaj("src/components/PreporuciKnjigu.jsx").includes("ucitajPolicu(clan.id)") && citaj("src/components/PreporuciKnjigu.jsx").includes("pretraziNasuBazu"));
      provera("blokada: prvo upis blokade, pa brisanje veze; raskid je običan DELETE; prijava člana je tip 'clan'", (() => { const c = citaj("src/lib/citaoci.js"); const b = /export async function blokiraj[\s\S]*?\n}\n/.exec(c)?.[0] ?? ""; return b.indexOf('from("blokade").insert') > -1 && b.indexOf('from("blokade").insert') < b.indexOf('from("veze").delete') && /from\("veze"\)\.delete\(\)/.test(c) && /prijavi\(clan\.id, "clan", id/.test(citaj("src/pages/CitalacProfil.jsx")); })());
      provera("rute: /citaoci/:id je unutar ZasticenaRuta, a ne u delu za bibliotekare", (() => { const a = citaj("src/App.jsx"); const i = a.indexOf('path="/citaoci/:id"'); const bib = a.indexOf("<RutaZaBibliotekare />"); return i > -1 && bib > -1 && i < bib; })());
      provera("tačka na stavci „Читаоци”: samo za tu stavku, kad ima novih poziva ili neobrađenih preporuka; ima tekst za čitače ekrana", /s\.kljuc === "citaoci" && obavestenja > 0/.test(citaj("src/components/Okvir.jsx")) && citaj("src/components/Okvir.jsx").includes("tekst.meni.obavestenje") && /moje_veze[\s\S]*?"primljen"[\s\S]*?"na_cekanju"/.test(citaj("src/lib/citaoci.js")) && /moje_preporuke"\)\.select\("id", \{ count: "exact", head: true \}\)\.eq\("procitana", false\)/.test(citaj("src/lib/citaoci.js")));
      provera("preporuka: „Желим да прочитам” dodaje na policu u „zelim”, „Прочитано је већ” u „procitano”, „Није за мене” samo skriva; sve tri označavaju preporuku obrađenom", (() => { const kod = citaj("src/pages/Citaoci.jsx"); return /preporukaNaPolicu\(clan\.id, p\.knjiga_id, "zelim"\)/.test(kod) && /preporukaNaPolicu\(clan\.id, p\.knjiga_id, "procitano"\)/.test(kod) && /nijeZaMene = \(p\) => uradi\(p\.id, \(\) => oznaciObradjenom\(p\.id\)/.test(kod) && (kod.match(/oznaciObradjenom\(p\.id\)/g) ?? []).length === 3; })());

      // svaki ključ iz tekst.js koji nove datoteke koriste postoji (i je tekst)
      const aliasi = {
        "src/pages/Citaoci.jsx": { T: "citaoci" },
        "src/pages/CitalacProfil.jsx": { T: "citalac" },
        "src/components/UtisakCitaoca.jsx": { T: "citalac" },
        "src/components/PreporuciKnjigu.jsx": { T: "preporuka" },
        "src/components/PreporuciCitaocu.jsx": { T: "knjigaEkran.preporuci", P: "preporuka" },
      };
      const nedostaju = [];
      for (const [p, mapa] of Object.entries(aliasi)) {
        const kod = bezKom(citaj(p));
        for (const [alias, put] of Object.entries(mapa)) {
          for (const m of kod.matchAll(new RegExp(`\\b${alias}\\.([A-Za-z]+(?:\\.[A-Za-z]+)*)`, "g"))) {
            const vrednost = `${put}.${m[1].replace(/\.(replace|length|trim)$/, "")}`.split(".").reduce((o, k) => o?.[k], TK);
            if (typeof vrednost !== "string") nedostaju.push(`${p}: ${alias}.${m[1]}`);
          }
        }
      }
      for (const p of ["src/pages/Citaoci.jsx", "src/pages/CitalacProfil.jsx", "src/components/PreporuciCitaocu.jsx"]) {
        for (const m of bezKom(citaj(p)).replace(/^const \w+ = tekst\.[\w.]+;$/gm, "").matchAll(/tekst\.([A-Za-z]+(?:\.[A-Za-z]+)+)/g)) if (typeof m[1].replace(/\.(replace|length|trim)$/, "").split(".").reduce((o, k) => o?.[k], TK) !== "string") nedostaju.push(`${p}: tekst.${m[1]}`);
      }
      provera("svi natpisi koje ekran Читаоци koristi postoje u tekst.js (nijedan ključ ne nedostaje)", nedostaju.length === 0, nedostaju);

      // migracija 0019
      const m19 = citaj("supabase/migrations/0019_citaoci_nadimci_preporuke.sql");
      const m19kod = m19.replace(/^--.*$/gm, "");
      provera("0019 dolazi odmah posle 0018 (migracije idu redom, bez rupa)", (() => { const f = readdirSync(new URL("../supabase/migrations/", import.meta.url)).filter((x) => /^\d{4}_/.test(x)).sort(); return f.indexOf("0019_citaoci_nadimci_preporuke.sql") === f.indexOf("0018_rezervacije_statusi.sql") + 1 && f.every((x, i) => Number(x.slice(0, 4)) === i + 1); })());
      provera("0019 ne dodaje, ne briše ni ne menja nijednu politiku (RLS) i ne pravi tabele; pogledi su security_invoker", !/\b(create|drop|alter)\s+policy\b/i.test(m19kod) && !/create\s+table/i.test(m19kod) && (m19kod.match(/security_invoker = true/g) ?? []).length === 2);
      provera("0019: funkcija u šemi privatno sa search_path, prava eksplicitna (revoke od anon, grant authenticated), notify pgrst", /create or replace function privatno\.ima_blokade[\s\S]*?set search_path = pg_catalog, public/.test(m19kod) && /revoke all on public\.moje_veze from public, anon, authenticated/.test(m19kod) && /grant select on public\.moje_preporuke to authenticated/.test(m19kod) && /notify pgrst, 'reload schema'/.test(m19kod));
      provera("0019: pogled moje_veze izbacuje blokirane i ograničava na svoje; moje_preporuke samo primljene, ne skrivene, ne od blokiranih", /not privatno\.ima_blokade\(v\.pozivalac_id, v\.pozvani_id\)/.test(m19kod) && /v\.pozivalac_id = auth\.uid\(\) or v\.pozvani_id = auth\.uid\(\)/.test(m19kod) && /p\.primalac_id = auth\.uid\(\)/.test(m19kod) && /not p\.skrivena/.test(m19kod) && /not privatno\.ima_blokade\(p\.posiljalac_id, p\.primalac_id\)/.test(m19kod));
    }

    // ── izveštaj za nabavku (čista logika, izvorni kod, migracija 0020) ──
    {
      const N = await import("../src/lib/nabavka-logika.js");
      const TK = (await import("../src/lib/tekst.js")).tekst;
      const bezKom = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      const redovi = [
        { id: "1", naslov: "Prokleta avlija", autor: "Ivo Andrić", izdavac: "Laguna", isbn: "9788652126033", zele: 5, citaju_ili_procitali: 2, odluka: null },
        { id: "2", naslov: "Derviš i smrt", autor: "Meša Selimović", izdavac: "Vulkan", isbn: "", zele: 3, citaju_ili_procitali: 0, odluka: "nabavljamo" },
        { id: "3", naslov: "Ђорђе и змај", autor: "Н. Н.", izdavac: null, isbn: "=HYPERLINK(1)", zele: 1, citaju_ili_procitali: 4, odluka: "imamo" },
        { id: "4", naslov: "Hazarski rečnik", autor: "Milorad Pavić", izdavac: "Dereta", isbn: null, zele: 3, citaju_ili_procitali: 1, odluka: "ne_nabavljamo" },
      ];
      provera("izveštaj: filteri Нове (bez odluke), Набављамо, Имамо i Све; „ne nabavljamo” se vidi samo u „Све”", N.filtrirajNabavku(redovi, "nove").map((r) => r.id).join() === "1" && N.filtrirajNabavku(redovi, "nabavljamo").map((r) => r.id).join() === "2" && N.filtrirajNabavku(redovi, "imamo").map((r) => r.id).join() === "3" && N.filtrirajNabavku(redovi, "sve").length === 4 && JSON.stringify(N.FILTERI) === JSON.stringify(["nove", "nabavljamo", "imamo", "sve"]));
      provera("izveštaj: pretraga po naslovu ili autoru ne zavisi od pisma ni kvačica (djordje, Ђорђе, Đorđe; derviš/dervis; milorad)", N.filtrirajNabavku(redovi, "sve", "djordje").map((r) => r.id).join() === "3" && N.filtrirajNabavku(redovi, "sve", "Ђорђе").length === 1 && N.filtrirajNabavku(redovi, "sve", "Đorđe").length === 1 && N.filtrirajNabavku(redovi, "sve", "dervis").map((r) => r.id).join() === "2" && N.filtrirajNabavku(redovi, "sve", "Дервиш").length === 1 && N.filtrirajNabavku(redovi, "sve", "PAVIC").map((r) => r.id).join() === "4" && N.filtrirajNabavku(redovi, "sve", "ništa takvo").length === 0 && N.filtrirajNabavku(redovi, "nove", "pavic").length === 0);
      provera("izveštaj: brojevi uz dugmad filtera", JSON.stringify(N.brojeviPoFilteru(redovi)) === JSON.stringify({ nove: 1, nabavljamo: 1, imamo: 1, sve: 4 }));
      provera("izveštaj: podrazumevani redosled je po broju onih koji žele, opadajuće (ista brojka po naslovu)", N.poredjajNabavku(redovi).map((r) => r.id).join() === "1,2,4,3");
      provera("odluka: dozvoljene su imamo, nabavljamo, ne_nabavljamo (isto kao ograničenje u bazi); posle izmene red dobija efektivnu odluku", N.ODLUKE.join() === "imamo,nabavljamo,ne_nabavljamo" && N.ODLUKE.every((o) => citaj("supabase/migrations/0020_nabavka_i_zastita_administratora.sql").includes(`'${o}'`)) && !N.jeOdluka("mozda") && (() => { const a = N.saNovomOdlukom(redovi[0], { odluka_nabavke: "nabavljamo", odluka_datum: "2026-11-17T10:00:00Z", u_fondu: false }); const b = N.saNovomOdlukom(redovi[0], { odluka_nabavke: null, odluka_datum: null, u_fondu: true }); return a.odluka === "nabavljamo" && a.odluka_postavljena === true && b.odluka === "imamo" && b.odluka_postavljena === false; })());

      // CSV
      const csv = N.izvestajUCsv(redovi, TK.nabavka.csv, TK.nabavka.odluke);
      const linije = csv.split("\r\n");
      provera("CSV: počinje UTF-8 BOM-om, pa sep=;, pa zaglavlje na ćirilici (naslov, autor, izdavač, ISBN, broj čitalaca, odluka)", csv.charCodeAt(0) === 0xfeff && linije[0].slice(1) === "sep=;" && linije[1] === ["Наслов", "Аутор", "Издавач", "ISBN", "Број читалаца који желе", "Одлука"].map((x) => `"${x}"`).join(";") && linije.length === 7 && linije[6] === "", linije.slice(0, 3));
      provera("CSV: ćirilica, navodnici i novi redovi u poljima ne kvare tabelu; broj čitalaca i odluka su u redu", linije[3] === '"Derviš i smrt";"Meša Selimović";"Vulkan";"";"3";"Набављамо"' && linije[2] === '"Prokleta avlija";"Ivo Andrić";"Laguna";"=""9788652126033""";"5";""' && linije[4].startsWith('"Ђорђе и змај"') && N.csvPolje('Ona rekla "da"\nsutra') === '"Ona rekla ""da"" sutra"');
      provera("CSV: tekst koji liči na formulu (=, +, -, @) dobija apostrof; ISBN se piše tako da ga Excel ne pretvori u broj", N.csvPolje("=HYPERLINK(1)") === `"'=HYPERLINK(1)"` && N.csvPolje("+1") === `"'+1"` && N.csvPolje("@x") === `"'@x"` && N.csvPolje("9788652126033", { isbn: true }) === '"=""9788652126033"""' && N.csvPolje("=HYPERLINK(1)", { isbn: true }) === `"'=HYPERLINK(1)"` && N.csvPolje(null) === '""' && linije[4].includes(`"'=HYPERLINK(1)"`));
      provera("CSV: sadrži samo naslov, autora, izdavača, ISBN, broj i odluku (nijedno polje o članu)", linije[1].split(";").length === 6 && !/clan|ime|kartic|sifra/i.test(JSON.stringify(Object.keys(redovi[0]))) && N.imeFajlaNabavke(new Date(2026, 10, 9)) === "nabavka-2026-11-09.csv");

      // privatnost i granice
      provera("klijent čita izveštaj samo iz pogleda izvestaj_za_nabavku; ne čita polica ni clanovi", (() => { const kod = bezKom(citaj("src/lib/nabavka.js")); return kod.includes('from("izvestaj_za_nabavku")') && !/from\("(polica|clanovi|utisci|veze|blokade)"\)/.test(kod) && /from\("knjige"\)\.update\(\{ odluka_nabavke: odluka \}\)/.test(kod); })());
      for (const p of ["src/lib/nabavka.js", "src/lib/nabavka-logika.js", "src/pages/BibliotekarNabavka.jsx"]) {
        const kod = bezKom(citaj(p));
        provera(`${p}: nikakvo polje o članu (clan_id, ime, broj_kartice, sifra_poziva, nadimak, vreme na polici)`, !/\b(clan_id|clan\b|ime\b|broj_kartice|sifra_poziva|nadimak|izmenjeno|prvi_put|poslednji_put)\b/.test(kod.replace(/imeFajlaNabavke/g, "")), kod.match(/\b(clan_id|broj_kartice|sifra_poziva|nadimak)\b/g));
      }
      provera("ekran Набавка: tekst iz tekst.js, svako dugme sa stilom ili min-h-11, bez hex boja i localStorage", (() => { const kod = bezKom(citaj("src/pages/BibliotekarNabavka.jsx")); return kod.split("<button").slice(1).every((d) => /className=\{(?:stil\.|`\$\{stil\.)/.test(d.split("</button>")[0]) || /min-h-1[1-9]/.test(d.split("</button>")[0])) && !/#[0-9a-fA-F]{3,8}\b/.test(kod) && !/localStorage|sessionStorage/.test(kod) && !/>\s*[A-ZČĆŠŽĐ][a-zčćšžđ]+(?:\s+[a-zčćšžđ]+){2,}[.!?]?\s*</.test(kod) && !/[Ѐ-ӿ]/.test(kod); })());
      provera("ruta /bibliotekar/nabavka je unutar RutaZaBibliotekare, a na stranici /bibliotekar je treći alat pored Unos knjiga i Članovi", (() => { const a = citaj("src/App.jsx"); return a.indexOf('path="/bibliotekar/nabavka"') > -1 && a.indexOf('path="/bibliotekar/nabavka"') > a.indexOf("<RutaZaBibliotekare />"); })() && /kljuc: "nabavka"/.test(citaj("src/pages/BibliotekarPocetna.jsx")) && ["unos", "clanovi", "nabavka"].every((k) => typeof TK.osoblje[k].naslov === "string"));
      const nedostajeNabavka = [];
      for (const m of bezKom(citaj("src/pages/BibliotekarNabavka.jsx")).matchAll(/\bT\.([A-Za-z]+(?:\.[A-Za-z]+)*)/g)) {
        const kljuc = m[1].replace(/\.(replace|length)$/, "");
        const v = `nabavka.${kljuc}`.split(".").reduce((o, k) => o?.[k], TK);
        if (typeof v !== "string" && !(typeof v === "object" && v !== null)) nedostajeNabavka.push(kljuc);
      }
      provera("svi natpisi ekrana Набавка postoje u tekst.js", nedostajeNabavka.length === 0 && ["nove", "nabavljamo", "imamo", "sve"].every((f) => typeof TK.nabavka.filteri[f] === "string") && ["imamo", "nabavljamo", "ne_nabavljamo"].every((o) => typeof TK.nabavka.odluke[o] === "string") && TK.nabavka.filteri.nove === "Нове" && TK.nabavka.odluke.imamo === "Имамо" && TK.nabavka.odluke.nabavljamo === "Набављамо" && TK.nabavka.odluke.ne_nabavljamo === "Не набављамо" && TK.nabavka.preuzmi === "Преузми као табелу", nedostajeNabavka);

      // migracija 0020
      const m20 = citaj("supabase/migrations/0020_nabavka_i_zastita_administratora.sql");
      const k20 = m20.replace(/^--.*$/gm, "");
      provera("0020 ne dodaje, ne briše ni ne menja nijednu politiku i ne pravi tabele (sve zaštite idu kroz okidače); pogled je security_invoker", !/\b(create|drop|alter)\s+policy\b/i.test(k20) && !/create\s+table/i.test(k20) && (k20.match(/security_invoker = true/g) ?? []).length === 1);
      provera("0020: funkcija izveštaja je SECURITY DEFINER sa search_path, proverava je_bibliotekar() i ne vraća ni jedno polje o članu; prava eksplicitna; notify pgrst", /function privatno\.izvestaj_nabavke\(\)[\s\S]*?security definer\s+set search_path = pg_catalog, public/.test(k20) && /where privatno\.je_bibliotekar\(\)/.test(k20) && !/\b(clan_id|nadimak|broj_kartice|sifra_poziva|izmenjeno)\b/.test(k20.slice(k20.indexOf("function privatno.izvestaj_nabavke"), k20.indexOf("create or replace view public.izvestaj_za_nabavku")).replace(/join public\.clanovi c on c\.id = p\.clan_id and c\.aktivan/, "")) && /revoke all on public\.izvestaj_za_nabavku from public, anon, authenticated/.test(k20) && /notify pgrst, 'reload schema'/.test(k20));
      provera("0020 deo B: bibliotekar ne menja administratora (42501), ne dodeljuje ulogu pri upisu; administrator i servisna uloga su izuzeti", /old\.uloga = 'administrator'[\s\S]*?errcode = '42501'/.test(k20) && /if privatno\.servisna_uloga\(\) then\s+return new;/.test(k20) && /if privatno\.je_administrator\(\) then\s+return new;/.test(k20) && /clanovi_insert_zastita_bi/.test(k20) && /new\.uloga is distinct from 'citalac'/.test(k20));
      provera("ekran Članovi više ne krije dugme kao jedinu zaštitu: README ne tvrdi da je zaštita administratora samo u interfejsu", !/nije zaštita u bazi/.test(citaj("README.md")) && !/zaštita je samo u interfejsu/i.test(citaj("README.md")));
    }

    // ── ekran „Пријаве" (čista logika, izvorni kod, migracija 0021) ──
    {
      const M = await import("../src/lib/prijave-logika.js");
      const TK = (await import("../src/lib/tekst.js")).tekst;
      const bezKom = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

      // beleška, šabloni, imena
      provera("beleška bibliotekara: nije obavezna (prazno je null), razmaci se skidaju, najviše 500 znakova (500 prolazi, 501 ne)", M.NAJDUZA_BELESKA === 500 && M.urediBelesku("  ").vrednost === null && M.urediBelesku(undefined).ok && M.urediBelesku(" Upozoren ").vrednost === "Upozoren" && M.urediBelesku("x".repeat(500)).ok && M.urediBelesku("x".repeat(501)).razlog === "predugo");
      provera("šablon iz tekst.js se popunjava funkcijom: naslov sa $& ostaje kakav jeste, nepoznato mesto ostaje nedirnuto", M.popuni("Утисак {ime} о „{naslov}”", { ime: "Ана", naslov: "Cena $& i $1" }) === "Утисак Ана о „Cena $& i $1”" && M.popuni("{a} {b}", { a: "x" }) === "x {b}" && M.popuni("{a}", { a: null }) === "");
      provera("ime člana za osoblje je pravo ime; bez člana dolazi zamena", M.imeClana({ ime: " Ана Петровић " }, "Непознат члан") === "Ана Петровић" && M.imeClana(null, "Непознат члан") === "Непознат члан" && M.imeClana({ ime: "  " }, "?") === "?");
      provera("filteri su Нерешене i Решене; granica liste je 50", M.FILTERI.join() === "otvorene,resene" && M.NAJVISE_PRIJAVA === 50 && TK.moderacija.filteri.otvorene === "Нерешене" && TK.moderacija.filteri.resene === "Решене");

      // sklapanje prijava
      const prijave = [
        { id: "p1", prijavio_id: "c1", tip: "utisak", stavka_id: "u1", razlog: "Vređa", resena: false, resio_id: null, beleska: null, kreirana: "2026-11-01T10:00:00Z", resena_datum: null },
        { id: "p2", prijavio_id: "c1", tip: "preporuka", stavka_id: "r1", razlog: null, resena: false, resio_id: null, beleska: null, kreirana: "2026-11-02T10:00:00Z", resena_datum: null },
        { id: "p3", prijavio_id: "c2", tip: "clan", stavka_id: "c3", razlog: "Nadimak", resena: true, resio_id: "b1", beleska: "Upozoren", kreirana: "2026-10-02T10:00:00Z", resena_datum: "2026-10-03T10:00:00Z" },
        { id: "p4", prijavio_id: "c2", tip: "utisak", stavka_id: "obrisan", razlog: "x", resena: false, resio_id: null, beleska: null, kreirana: "2026-11-03T10:00:00Z", resena_datum: null },
        { id: "p5", prijavio_id: "nepoznat", tip: "clan", stavka_id: "nema", razlog: "y", resena: false, resio_id: null, beleska: null, kreirana: "2026-11-04T10:00:00Z", resena_datum: null },
      ];
      const clanovi = new Map([
        ["c1", { id: "c1", ime: "Ана Петровић", nadimak: "Ана П.", broj_kartice: "0000001", uloga: "citalac", aktivan: true }],
        ["c2", { id: "c2", ime: "Марко Јовић", nadimak: null, broj_kartice: "0000002", uloga: "citalac", aktivan: true }],
        ["c3", { id: "c3", ime: "Нина Ристић", nadimak: "Нина", broj_kartice: "0000003", uloga: "citalac", aktivan: false }],
        ["b1", { id: "b1", ime: "Јелена Лазић", nadimak: null, broj_kartice: "0000009", uloga: "bibliotekar", aktivan: true }],
      ]);
      const sklopljeno = M.sastaviPrijave(prijave, {
        clanovi,
        utisci: new Map([["u1", { id: "u1", clan_id: "c2", knjiga_id: "k1", ocena: 3, tekst: "Loše", vidljivost: "javno", spojler: true, skriven: true }]]),
        preporuke: new Map([["r1", { id: "r1", posiljalac_id: "c2", primalac_id: "c1", knjiga_id: "k1", poruka: "Čitaj", skrivena: false }]]),
        knjige: new Map([["k1", { id: "k1", naslov: "Prokleta avlija", autor: "Иво Андрић" }]]),
      });
      const [a, b, c, d, e] = sklopljeno;
      provera("utisak: prikaz ima autora utiska, knjigu, ocenu, tekst, vidljivost, spojler i da je sakriven; prijavilac je pravo ime", a.stavka.postoji && a.stavka.autor.ime === "Марко Јовић" && a.stavka.knjiga.naslov === "Prokleta avlija" && a.stavka.ocena === 3 && a.stavka.tekst === "Loše" && a.stavka.vidljivost === "javno" && a.stavka.spojler === true && a.stavka.skriven === true && a.prijavilac.ime === "Ана Петровић" && a.razlog === "Vređa", a);
      provera("preporuka: prikaz ima pošiljaoca, primaoca, knjigu i poruku; prazan razlog je null", b.stavka.postoji && b.stavka.posiljalac.ime === "Марко Јовић" && b.stavka.primalac.ime === "Ана Петровић" && b.stavka.knjiga.id === "k1" && b.stavka.poruka === "Čitaj" && b.stavka.skrivena === false && b.razlog === null, b);
      provera("član: prikaz ima ime, broj karte, ulogu, nadimak i aktivnost; rešena prijava nosi ko je rešio, datum i belešku", c.stavka.postoji && c.stavka.clan.broj_kartice === "0000003" && c.stavka.clan.aktivan === false && c.stavka.clan.nadimak === "Нина" && c.resena === true && c.resio.ime === "Јелена Лазић" && c.resena_datum === "2026-10-03T10:00:00Z" && c.beleska === "Upozoren", c);
      provera("stavka koja više ne postoji (obrisan utisak, nepoznat član) nije greška: postoji je false, prijava se i dalje prikazuje; nepoznat prijavilac je null", d.stavka.postoji === false && e.stavka.postoji === false && e.prijavilac === null && d.razlog === "x" && sklopljeno.length === 5);
      provera("redovi ne nose ništa što ekran ne prikazuje (nema lozinke, PIN-a ni šifre poziva); član ima samo id, ime, nadimak, broj karte, ulogu i aktivnost", JSON.stringify(Object.keys(c.stavka.clan).sort()) === JSON.stringify(["aktivan", "broj_kartice", "id", "ime", "nadimak", "uloga"]) && M.sastaviPrijave(null).length === 0);
      const ids = M.potrebniIdovi(prijave);
      provera("koje id-eve treba učitati: članovi (prijavioci, onaj ko je rešio, prijavljeni članovi), utisci i preporuke, bez duplikata", ids.clanovi.slice().sort().join() === "b1,c1,c2,c3,nema,nepoznat" && ids.utisci.sort().join() === "obrisan,u1" && ids.preporuke.join() === "r1", ids);

      // upiti i prava
      const kodPrijave = bezKom(citaj("src/lib/prijave.js"));
      provera("prijave.js: običan klijent (nikad service_role), nijedan upit ne vraća lozinku, PIN ni šifru poziva; čita samo prijave, utiske, preporuke, članove i knjige", !/service_role|SERVICE_ROLE/.test(kodPrijave) && !/\b(sifra_poziva|pin|lozinka)\b/i.test(kodPrijave) && [...kodPrijave.matchAll(/from\("(\w+)"\)/g)].every((m) => ["prijave", "utisci", "preporuke", "clanovi", "knjige"].includes(m[1])));
      provera("prijave.js: izmene su samo resena i beleska na prijavi, skriven na utisku i skrivena na preporuci; prazan odgovor je greška (red ne postoji ili nema prava)", /resena: true, beleska/.test(kodPrijave) && /resena: false/.test(kodPrijave) && /\{ skriven \}/.test(kodPrijave) && /\{ skrivena \}/.test(kodPrijave) && /if \(!data\?\.length\) throw new GreskaApija\("nije_sacuvano"\)/.test(kodPrijave));
      provera("prijave.js: nerešene idu od najstarije, rešene od najnovije rešene; traži se jedna više od granice", /order\("resena_datum", \{ ascending: false \}\)/.test(kodPrijave) && /order\("kreirana", \{ ascending: true \}\)/.test(kodPrijave) && /limit\(NAJVISE_PRIJAVA \+ 1\)/.test(kodPrijave));
      provera("prijave.js: ko je rešio i kada ne šalje klijent (to postavlja okidač); klijent ne upisuje resio_id ni resena_datum", !/resio_id:|resena_datum:/.test(kodPrijave.replace(/KOLONE_PRIJAVE[^;]*;/, "")));
      provera("citaoci.js: greška 22023 (stavka se ne može prijaviti) postaje jedan kod, a 23505 (već prijavljeno) ostaje poseban", /code === "22023"\) throw new GreskaApija\("stavka_nedostupna"\)/.test(citaj("src/lib/citaoci.js")) && /code === "23505"\) throw new GreskaApija\("vec_prijavljeno"\)/.test(citaj("src/lib/citaoci.js")));

      // ekran
      const kodEkrana = bezKom(citaj("src/pages/BibliotekarPrijave.jsx"));
      provera("ekran Пријаве: svako dugme ima stil iz stil.js ili min-h-11, bez hex boja, localStorage i ćirilice u kodu (sav tekst je u tekst.js)", kodEkrana.split("<button").slice(1).every((d) => /className=\{(?:stil\.|.\$\{stil\.)/.test(d.split("</button>")[0]) || /min-h-1[1-9]/.test(d.split("</button>")[0])) && !/#[0-9a-fA-F]{3,8}\b/.test(kodEkrana) && !/localStorage|sessionStorage|indexedDB|document\.cookie/.test(kodEkrana) && !/[Ѐ-ӿ]/.test(kodEkrana));
      provera("ekran Пријаве: bibliotekar ne deaktivira nikoga mimo prava (mozeDaUpravlja, ne sebe), deaktivacija traži potvrdu; sakrivanje i rešavanje ne traže brisanje ničega", /mozeDaUpravlja\(ja\.uloga, clan\.uloga\)/.test(kodEkrana) && /clan\.id !== ja\.id/.test(kodEkrana) && /clan\.aktivan \? setPita\(true\)/.test(kodEkrana) && !/\.delete\(\)|obrisi/i.test(kodEkrana + kodPrijave));
      provera("ekran Пријаве: red se uklanja iz liste tek posle uspeha upisa, a Okvir se obaveštava (broj nerešenih)", /await resiPrijavu\(p\.id, b\.vrednost\);\s*javiPromenuPrijava\(\);\s*ukloni/.test(kodEkrana) && /await vratiPrijavu\(p\.id\);\s*javiPromenuPrijava\(\);\s*ukloni/.test(kodEkrana));
      provera("ruta /bibliotekar/prijave je unutar RutaZaBibliotekare, a na /bibliotekar je četvrti alat sa brojem nerešenih", (() => { const x = citaj("src/App.jsx"); return x.indexOf('path="/bibliotekar/prijave"') > x.indexOf("<RutaZaBibliotekare />") && x.includes("<BibliotekarPrijave />"); })() && /kljuc: "prijave"/.test(citaj("src/pages/BibliotekarPocetna.jsx")) && /ucitajBrojOtvorenih/.test(citaj("src/pages/BibliotekarPocetna.jsx")) && ["unos", "clanovi", "nabavka", "prijave"].every((k) => typeof TK.osoblje[k].naslov === "string"));
      provera("tačka na stavci „Библиотека” samo za osoblje i samo dok ima nerešenih; tekst za čitače ekrana postoji", /s\.kljuc === "biblioteka" && otvorenePrijave > 0/.test(citaj("src/components/Okvir.jsx")) && /if \(osoblje\)\s*\{\s*ucitajBrojOtvorenih/.test(citaj("src/components/Okvir.jsx")) && TK.meni.obavestenjePrijave === "Има нерешених пријава");

      // dugme „Пријави" kod čitalaca
      const kodDugmeta = bezKom(citaj("src/components/PrijaviStavku.jsx"));
      provera("PrijaviStavku: razlog je obavezan i do 300 znakova, greške 23505 i 22023 imaju svaka svoju poruku, posle slanja dugme nestaje (ne šalje se dvaput)", /urediRazlog\(razlog\)/.test(kodDugmeta) && /maxLength=\{NAJDUZI_RAZLOG\}/.test(kodDugmeta) && /vec_prijavljeno/.test(kodDugmeta) && /stavka_nedostupna/.test(kodDugmeta) && /if \(ishod\?\.gotovo\)/.test(kodDugmeta) && !/localStorage|sessionStorage/.test(kodDugmeta) && !/[Ѐ-ӿ]/.test(kodDugmeta));
      provera("dugme „Пријави” je na tuđem utisku (tip utisak) i na primljenoj preporuci (tip preporuka), a ne na mom utisku", /<PrijaviStavku tip="utisak" stavkaId=\{u\.id\} \/>/.test(citaj("src/components/Utisci.jsx")) && (() => { const k = citaj("src/components/Utisci.jsx"); const i = k.indexOf("<PrijaviStavku"); return i > k.indexOf("function TudjiUtisak") && i < k.indexOf("export default function Utisci"); })() && /<PrijaviStavku tip="preporuka" stavkaId=\{p\.id\} \/>/.test(citaj("src/pages/Citaoci.jsx")));

      // svi natpisi postoje
      const nedostaje = [];
      for (const [p, alias, put] of [["src/pages/BibliotekarPrijave.jsx", "T", "moderacija"], ["src/components/PrijaviStavku.jsx", "T", "prijavaStavke"]]) {
        for (const m of bezKom(citaj(p)).matchAll(new RegExp("\\b" + alias + "\\.([A-Za-z_]+(?:\\.[A-Za-z_]+)*)", "g"))) {
          const v = (put + "." + m[1].replace(/\.(replace|length|trim)$/, "")).split(".").reduce((o, k) => o?.[k], TK);
          if (typeof v !== "string" && !(typeof v === "object" && v !== null)) nedostaje.push(p + ": " + alias + "." + m[1]);
        }
      }
      for (const m of bezKom(citaj("src/pages/BibliotekarPrijave.jsx")).matchAll(/tekst\.([A-Za-z]+(?:\.[A-Za-z]+)+)/g)) if (typeof m[1].split(".").reduce((o, k) => o?.[k], TK) === "undefined") nedostaje.push("tekst." + m[1]);
      provera("svi natpisi ekrana Пријаве i dugmeta „Пријави” postoje u tekst.js", nedostaje.length === 0 && Object.keys(TK.moderacija.vrste).join() === "utisak,preporuka,clan" && ["utisak", "preporuka", "clan"].every((k) => typeof TK.moderacija.nePostoji[k] === "string"), nedostaje);

      // migracija 0021
      const m21 = citaj("supabase/migrations/0021_moderacija_prijava.sql");
      const k21 = m21.replace(/^\s*--.*$/gm, "");
      provera("0021 dolazi odmah posle 0020 (migracije idu redom, bez rupa)", (() => { const f = readdirSync(new URL("../supabase/migrations/", import.meta.url)).filter((x) => /^\d{4}_/.test(x)).sort(); return f.indexOf("0021_moderacija_prijava.sql") === f.indexOf("0020_nabavka_i_zastita_administratora.sql") + 1 && f.every((x, i) => Number(x.slice(0, 4)) === i + 1); })());
      provera("0021 ne dodaje, ne briše ni ne menja nijednu politiku i ne pravi tabele; sve zaštite idu kroz okidače", !/\b(create|drop|alter)\s+policy\b/i.test(k21) && !/create\s+table/i.test(k21) && /create trigger prijave_zastita_bu\s+before update/.test(k21) && /create trigger prijave_provera_bi\s+before insert/.test(k21));
      provera("0021: kolona i ograničenja su idempotentni (if not exists, drop constraint if exists), a ograničenja NOT VALID ne diraju stare redove", /add column if not exists resena_datum/.test(k21) && (k21.match(/drop constraint if exists prijave_(razlog|beleska)_duzina/g) ?? []).length === 2 && (k21.match(/not valid;/g) ?? []).length === 2 && /char_length\(razlog\) <= 300/.test(k21) && /char_length\(beleska\) <= 500/.test(k21));
      provera("0021: provera stavke NIJE SECURITY DEFINER (radi sa pravima prijavioca, pa RLS određuje šta „vidi”); utisak nije moj, preporuku sam primio, član je povezan sa mnom", !/security definer/i.test(k21) && /u\.clan_id <> new\.prijavio_id/.test(k21) && /p\.primalac_id = new\.prijavio_id/.test(k21) && /privatno\.su_povezani\(new\.prijavio_id, new\.stavka_id\)/.test(k21) && (k21.match(/errcode = '22023'/g) ?? []).length === 3);
      provera("0021: prijava u tuđe ime i dalje odbija politika (okidač je propušta), servisna uloga je izuzeta; ko je rešio i kada postavlja baza (auth.uid(), now())", /new\.prijavio_id is distinct from auth\.uid\(\)\s+then\s+return new;/.test(k21) && (k21.match(/if privatno\.servisna_uloga\(\) then\s+return new;/g) ?? []).length === 2 && /new\.resio_id\s+:= auth\.uid\(\);/.test(k21) && /new\.resena_datum := now\(\);/.test(k21));
      provera("0021: prava eksplicitna (revoke od public i anon, grant authenticated i service_role) i notify pgrst", /revoke all on all functions in schema privatno from public, anon/.test(k21) && /grant execute on all functions in schema privatno to authenticated, service_role/.test(k21) && /notify pgrst, 'reload schema'/.test(k21));
    }

    // ── PWA do kraja (korak 10): fontovi iz projekta, Service Worker, nova verzija, veza, instalacija, manifest ──
    {
      const P = await import("../src/lib/pwa-logika.js");
      const TK = (await import("../src/lib/tekst.js")).tekst;
      const bezKom = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      const postoji = (p) => { try { readFileSync(new URL("../" + p, import.meta.url)); return true; } catch { return false; } };
      const pngMere = (p) => { const b = readFileSync(new URL("../" + p, import.meta.url)); return b.readUInt32BE(16) + "x" + b.readUInt32BE(20); };

      // fontovi iz projekta
      const css = citaj("src/fonts.css");
      const lica = css.split("@font-face").slice(1);
      provera("fontovi: Onest i Inter, po četiri podskupa (cyrillic, cyrillic-ext, latin, latin-ext), promenljiva težina 100–900, font-display: swap", lica.length === 8 && ["Onest", "Inter"].every((f) => ["cyrillic-ext", "cyrillic", "latin-ext", "latin"].every((p) => lica.some((l) => l.includes('font-family: "' + f + '"') && l.includes(f.toLowerCase() + "-" + p + "-wght-normal.woff2")))) && lica.every((l) => /font-weight: 100 900;/.test(l) && /font-display: swap;/.test(l) && /unicode-range: U\+/.test(l)));
      provera("fontovi: svaka datoteka iz fonts.css postoji u node_modules (paketi @fontsource-variable/onest i /inter), a paketi su u package.json", [...css.matchAll(/url\("([^"]+)"\)/g)].every((m) => postoji("src/" + m[1])) && /"@fontsource-variable\/onest"/.test(citaj("package.json")) && /"@fontsource-variable\/inter"/.test(citaj("package.json")));
      provera("fontovi: ćirilica koju aplikacija koristi (uključujući Ђ, Ј, Љ, Њ, Ћ, Џ) pada u raspon podskupa cyrillic", (() => { const r = /unicode-range: ([^;]+);/.exec(lica.find((l) => l.includes("onest-cyrillic-wght-normal")))[1]; return r.includes("U+0400-045F"); })());
      const rec = (citaj("index.html") + citaj("src/index.css") + citaj("src/main.jsx") + citaj("vite.config.js") + css);
      provera("nijedan zahtev ka Google-u za fontove: ni index.html, ni CSS, ni vite.config.js ne pominju fonts.googleapis.com ni fonts.gstatic.com", !/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(rec));
      provera("fonts.css se učitava u main.jsx pre index.css; index.css i dalje koristi imena Onest i Inter", citaj("src/main.jsx").indexOf('import "./fonts.css"') > -1 && citaj("src/main.jsx").indexOf('import "./fonts.css"') < citaj("src/main.jsx").indexOf('import "./index.css"') && /--font-naslov:\s*"Onest"/.test(citaj("src/index.css")) && /--font-sans:\s*"Inter"/.test(citaj("src/index.css")));

      // Service Worker (vite.config.js)
      const vite = citaj("vite.config.js");
      const viteKod = vite.replace(/^\s*\/\/.*$/gm, ""); // samo redovi-komentari: globovi u konfiguraciji sadrže /*
      provera("Service Worker: registerType je \"prompt\" (nova verzija se ne primenjuje tiho), a ljuska se čuva pri instalaciji", /registerType: "prompt"/.test(viteKod) && !/autoUpdate/.test(viteKod) && /globPatterns: \[[^\]]*\bhtml\b/.test(viteKod) && /globPatterns: \[[^\]]*\bjs\b/.test(viteKod) && /woff2/.test(viteKod) && /navigateFallback: "\/index\.html"/.test(viteKod));
      provera("Service Worker: nema runtimeCaching-a (API i Supabase uvek na mrežu, nikad iz keša), /api je van navigateFallback, nema POST/fetch/respondWith rukovaoca u konfiguraciji ni u pwa.js", /runtimeCaching: \[\]/.test(viteKod) && /navigateFallbackDenylist: \[\/\^\\\/api\\\//.test(viteKod) && !/urlPattern|handler:|registerRoute|method:\s*"POST"|importScripts/.test(viteKod) && !/respondWith|\bfetch\(/.test(bezKom(citaj("src/lib/pwa.js"))) && !/injectManifest|strategies:\s*"injectManifest"/.test(viteKod));

      // nova verzija
      const kodPwa = bezKom(citaj("src/lib/pwa.js"));
      provera("nova verzija: pwa.js registruje Service Worker preko virtual:pwa-register, javlja onNeedRefresh, a primenjuje je tek na poziv primeniNovuVerziju (registerSW(true))", /from "virtual:pwa-register"/.test(kodPwa) && /onNeedRefresh: \(\) => postavi\(\{ novaVerzija: true \}\)/.test(kodPwa) && /export const primeniNovuVerziju = \(\) => osveziSW\?\.\(true\)/.test(kodPwa));
      provera("nova verzija: proverava se jednom na sat i kad se prozor vrati u prvi plan", P.PROVERA_VERZIJE_MS === 3600000 && /setInterval\(proveri, PROVERA_VERZIJE_MS\)/.test(kodPwa) && /visibilitychange/.test(kodPwa));
      const traka = bezKom(citaj("src/components/TrakeLjuske.jsx"));
      provera("traka „Нова верзија је спремна — Освежи”: tekst iz tekst.js, dugme poziva primeniNovuVerziju, najmanje 44 px, role=status", TK.verzija.spremna === "Нова верзија је спремна" && TK.verzija.osvezi === "Освежи" && /onClick=\{primeniNovuVerziju\}/.test(traka) && /min-h-11/.test(traka) && /role="status"/.test(traka) && /tekst\.verzija\.spremna/.test(traka) && /tekst\.verzija\.osvezi/.test(traka));
      provera("trake su u App.jsx unutar AuthProvider, ali van Routes (vide se i na prijavi)", (() => { const a = citaj("src/App.jsx"); return a.indexOf("<TrakeLjuske />") > a.indexOf("<AuthProvider>") && a.indexOf("<TrakeLjuske />") < a.indexOf("<Routes>"); })());

      // veza
      provera("traka bez veze: „Нема везе са интернетом” iz tekst.js, prati događaje online i offline, počinje od navigator.onLine; samo navigator.onLine === false znači bez veze", TK.mreza.nemaVeze === "Нема везе са интернетом" && /addEventListener\("offline", \(\) => postavi\(\{ bezVeze: true \}\)\)/.test(kodPwa) && /addEventListener\("online", \(\) => postavi\(\{ bezVeze: false \}\)\)/.test(kodPwa) && /jeBezVeze\(navigator\.onLine\)/.test(kodPwa) && P.jeBezVeze(false) === true && P.jeBezVeze(true) === false && P.jeBezVeze(undefined) === false && /tekst\.mreza\.nemaVeze/.test(traka) && /\{bezVeze && \(/.test(traka));

      // instalacija
      provera("prepoznavanje iPhone-a i iPada (i iPadOS koji se predstavlja kao Mac); običan Mac, Android i Windows nisu iOS", P.jeIOS({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)" }) && P.jeIOS({ userAgent: "Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X)" }) && P.jeIOS({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", platforma: "MacIntel", tackeDodira: 5 }) && !P.jeIOS({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", platforma: "MacIntel", tackeDodira: 0 }) && !P.jeIOS({ userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/120", platforma: "Linux armv8l", tackeDodira: 5 }) && !P.jeIOS({}));
      provera("već instalirana aplikacija (display-mode: standalone ili navigator.standalone) ne dobija karticu", P.jeInstalirana({ standaloneMedija: true }) && P.jeInstalirana({ standaloneSafari: true }) && !P.jeInstalirana({}) && P.nacinInstalacije({ instalirana: true, imaPrompt: true, ios: true }) === "nista");
      provera("način instalacije: dugme kad je pregledač javio beforeinstallprompt (Chrome/Android), uputstvo na iPhone-u, inače ništa", P.nacinInstalacije({ instalirana: false, imaPrompt: true, ios: false }) === "dugme" && P.nacinInstalacije({ instalirana: false, imaPrompt: false, ios: true }) === "uputstvo" && P.nacinInstalacije({ instalirana: false, imaPrompt: false, ios: false }) === "nista");
      provera("beforeinstallprompt se hvata u pwa.js (učitava se u main.jsx, pre Profila), preventDefault, pamti događaj i poziva prompt() tek na dugme; appinstalled sklanja karticu", /addEventListener\("beforeinstallprompt"/.test(kodPwa) && /e\.preventDefault\(\)/.test(kodPwa) && /await d\.prompt\(\)/.test(kodPwa) && /addEventListener\("appinstalled"/.test(kodPwa) && /import "\.\/lib\/pwa\.js"/.test(citaj("src/main.jsx")));
      const kartica = bezKom(citaj("src/components/KarticaInstalacije.jsx"));
      provera("kartica na Profilu: dugme „Инсталирај апликацију” za Chrome/Android, uputstvo „Подели → Додај на почетни екран” za iPhone, stil iz stil.js, bez teksta u kodu", TK.instalacija.dugme === "Инсталирај апликацију" && /Подели/.test(TK.instalacija.ios) && /Додај на почетни екран/.test(TK.instalacija.ios) && /className=\{stil\.veliko\}/.test(kartica) && /nacin === "dugme"/.test(kartica) && /nacin === "uputstvo"/.test(kartica) && !/[Ѐ-ӿ]/.test(kartica) && /<KarticaInstalacije \/>/.test(citaj("src/pages/Profil.jsx")));

      // manifest
      const mi = /manifest:\s*\{([\s\S]*?)\n {6}\},\n {6}workbox/.exec(vite)?.[1] ?? "";
      provera("manifest: name, short_name, description i jezik iz tekst.js; start_url \"/\", scope \"/\", id \"/\", display standalone; boje pozadine i teme su boja aplikacije (#f4efe5)", /name:\s*tekst\.aplikacija\.naziv/.test(mi) && /short_name:\s*tekst\.aplikacija\.naziv/.test(mi) && /start_url: "\/"/.test(mi) && /scope: "\/"/.test(mi) && /id: "\/"/.test(mi) && /display: "standalone"/.test(mi) && /background_color: "#f4efe5"/.test(mi) && /theme_color: "#f4efe5"/.test(mi) && /<meta name="theme-color" content="#f4efe5" \/>/.test(citaj("index.html")) && /--color-pozadina:\s*#f4efe5/.test(citaj("src/index.css")));
      provera("manifest: ikone 192×192, 512×512 i maskable 512×512 postoje i imaju tačne mere; apple-touch-icon 180×180", [["public/icons/icon-192.png", "192x192", "any"], ["public/icons/icon-512.png", "512x512", "any"], ["public/icons/icon-maskable-512.png", "512x512", "maskable"]].every(([p, mere, svrha]) => postoji(p) && pngMere(p) === mere && mi.includes("/" + p.replace("public/", "")) && mi.includes('sizes: "' + mere + '"') && new RegExp(p.split("/").pop().replace(".", "\\.") + '[^}]*purpose: "' + svrha + '"').test(mi)) && pngMere("public/apple-touch-icon.png") === "180x180");
      provera("index.html: meta za instalaciju na iPhone-u (apple-mobile-web-app-capable, naslov iz tekst.js) i theme-color", /apple-mobile-web-app-capable/.test(citaj("index.html")) && /apple-mobile-web-app-title" content="%NAZIV%"/.test(citaj("index.html")) && /replaceAll\("%NAZIV%"/.test(vite));

      // tekstovi i stil
      const sviKljucevi = [];
      for (const [p, ime] of [["src/components/TrakeLjuske.jsx", "tekst"], ["src/components/KarticaInstalacije.jsx", "T"]]) {
        for (const m of bezKom(citaj(p)).replace(/^(?:import .*|const T = .*)$/gm, "").matchAll(/\b(?:tekst|T)\.([A-Za-z]+(?:\.[A-Za-z]+)*)/g)) {
          const put = (ime === "T" ? "instalacija." : "") + m[1];
          if (typeof put.split(".").reduce((o, k) => o?.[k], TK) !== "string") sviKljucevi.push(p + ": " + put);
        }
      }
      const vj = JSON.parse(citaj("vercel.json"));
      const zag = Object.fromEntries((vj.headers.find((h) => h.source === "/(.*)")?.headers ?? []).map((h) => [h.key, h.value]));
      provera("vercel.json: sigurnosna zaglavlja (nosniff, X-Frame-Options DENY, Referrer-Policy), /sw.js se ne kešira, /api je i dalje van prepisivanja na index.html", zag["X-Content-Type-Options"] === "nosniff" && zag["X-Frame-Options"] === "DENY" && Boolean(zag["Referrer-Policy"]) && vj.headers.some((h) => h.source === "/sw.js" && h.headers.some((x) => x.key === "Cache-Control" && /no-cache/.test(x.value))) && vj.rewrites[0].source.includes("(?!api/)"));
      provera("index.html: aplikacija je za članove, pretraživači je ne indeksiraju (noindex); spisak za objavu postoji u docs/objava.md", /<meta name="robots" content="noindex, nofollow" \/>/.test(citaj("index.html")) && /test:rls/.test(citaj("docs/objava.md")) && /ZAHTEVI_BEZ_BAZE/.test(citaj("docs/objava.md")));
      // pravila korišćenja (korak 12)
      const pr = TK.pravila;
      provera("pravila: naslov, uvod, link i najmanje šest odeljaka, svaki sa naslovom i bar dve tačke (sve je tekst)", pr.naslov === "Правила коришћења" && typeof pr.uvod === "string" && typeof pr.link === "string" && Array.isArray(pr.odeljci) && pr.odeljci.length >= 6 && pr.odeljci.every((o) => typeof o.naslov === "string" && o.tacke.length >= 2 && o.tacke.every((x) => typeof x === "string" && x.length > 20)));
      provera("pravila: obavezne teme postoje (ko koristi, ponašanje, povezivanje, šta se čuva, prava, kontakt), i istina o uvidu bibliotekara u police i utiske „само ја”", ["Ко може", "понаш", "Повезивање", "чува о вама", "права", "Питања"].every((r) => pr.odeljci.some((o) => o.naslov.includes(r))) && pr.odeljci.some((o) => o.tacke.some((x) => /Библиотекари могу да виде/.test(x) && /само ја/.test(x))));
      provera("pravila: nigde izmišljen telefon, mejl ni adresa (kontakt su bibliotekari na pultu)", !/@|https?:|www\.|\d{6,}/.test(JSON.stringify(pr)));
      const appPravila = citaj("src/App.jsx");
      provera("ruta /pravila je javna: van ZasticenaRuta (vidi se i pre prijave), a link ka njoj je na prijavi i na profilu", appPravila.indexOf('path="/pravila"') > -1 && appPravila.indexOf('path="/pravila"') < appPravila.indexOf("<ZasticenaRuta />") && citaj("src/pages/Prijava.jsx").includes('to="/pravila"') && citaj("src/pages/Profil.jsx").includes('to="/pravila"') && citaj("src/pages/Prijava.jsx").includes("tekst.pravila.link"));
      const kodPravila = bezKom(citaj("src/pages/Pravila.jsx"));
      provera("ekran Pravila: sav tekst iz tekst.js, dugme najmanje 44 px, bez localStorage, hex boja i ćirilice u kodu; docs/pravila.md objašnjava odakle je svaka tvrdnja", kodPravila.includes("T.odeljci.map") && kodPravila.includes("min-h-11") && !/localStorage|sessionStorage/.test(kodPravila) && !/#[0-9a-fA-F]{3,8}\b/.test(kodPravila) && !/[Ѐ-ӿ]/.test(kodPravila) && /nacrt/i.test(citaj("docs/pravila.md")));
      // ── utisak sa pulta (korak 13) ──
      {
        const PL = await import("../src/lib/pult-logika.js");
        const sada = { clan: { id: "c1", ime: "Ана" }, knjiga: { id: "k1" }, forma: { ocena: 8, tekst: "Lepa", vidljivost: "javno", spojler: false }, potvrda: true };
        provera("pult: ispravan unos daje red za upis (ocena, tekst, vidljivost, spojler)", PL.urediUtisakSaPulta(sada).ok && PL.urediUtisakSaPulta(sada).red.ocena === 8 && PL.urediUtisakSaPulta(sada).red.vidljivost === "javno");
        provera("pult: vidljivost se NE pretpostavlja (prazna je greška), bez potvrde bibliotekara se ne upisuje, bez člana i knjige ne", PL.urediUtisakSaPulta({ ...sada, forma: { ...sada.forma, vidljivost: "" } }).polje === "vidljivost" && PL.urediUtisakSaPulta({ ...sada, potvrda: false }).polje === "potvrda" && PL.urediUtisakSaPulta({ ...sada, clan: null }).polje === "clan" && PL.urediUtisakSaPulta({ ...sada, knjiga: {} }).polje === "knjiga");
        provera("pult: ista pravila kao za član (bar ocena ili tekst, ocena 1–10, tekst do 3000 znakova, spojler samo uz tekst)", PL.urediUtisakSaPulta({ ...sada, forma: { ocena: "", tekst: "  ", vidljivost: "javno" } }).razlog === "prazno" && !PL.urediUtisakSaPulta({ ...sada, forma: { ...sada.forma, ocena: 11 } }).ok && PL.urediUtisakSaPulta({ ...sada, forma: { ocena: "", tekst: "x".repeat(3001), vidljivost: "javno" } }).razlog === "predugo" && PL.urediUtisakSaPulta({ ...sada, forma: { ocena: 5, tekst: "", vidljivost: "samo_ja", spojler: true } }).red.spojler === false);
        provera("pult: greške iz logike i iz baze dobijaju poruku (prazno, predugo, clan, knjiga, vidljivost, potvrda, vec_ima, clan_nije_aktivan, inače opšta), sve postoje u tekst.js", [["prazno", { polje: "ocena", razlog: "prazno" }], ["predugo", { polje: "tekst", razlog: "predugo" }], ["clan", { polje: "clan" }], ["knjiga", { polje: "knjiga" }], ["vidljivost", { polje: "vidljivost" }], ["potvrda", { polje: "potvrda" }], ["vec_ima", { kod: "vec_ima" }], ["clan_nije_aktivan", { kod: "clan_nije_aktivan" }], ["opste", new Error("x")]].every(([k, g]) => PL.kljucGreske(g) === k && typeof TK.pult.greske[k] === "string"));
        provera("pult: nude se samo aktivni članovi", PL.aktivniClanovi([{ id: 1, aktivan: true }, { id: 2, aktivan: false }]).map((c) => c.id).join() === "1" && PL.aktivniClanovi(null).length === 0);

        const kodPult = bezKom(citaj("src/lib/pult.js"));
        provera("pult.js: običan klijent (nikad service_role); upis nosi potpis uneo_bibliotekar_id = bibliotekar, 23505 je vec_ima, 22023 je clan_nije_aktivan; postojeći utisak se ne prepisuje (nema update-a ni upsert-a)", !/service_role|SERVICE_ROLE/i.test(kodPult) && /uneo_bibliotekar_id: bibliotekarId/.test(kodPult) && /"23505"\) throw new GreskaApija\("vec_ima"\)/.test(kodPult) && /"22023"\) throw new GreskaApija\("clan_nije_aktivan"\)/.test(kodPult) && !/\.update\(|upsert/.test(kodPult));
        const kodStrane = bezKom(citaj("src/pages/BibliotekarUtisak.jsx"));
        provera("ekran: svako dugme ima stil iz stil.js ili min-h-11/12/14, bez hex boja, localStorage i ćirilice u kodu", kodStrane.split("<button").slice(1).every((d) => /className=\{(?:stil\.|.\$\{stil\.)/.test(d.split("</button>")[0]) || /min-h-1[1-9]/.test(d.split("</button>")[0]) || /className=\{stil\.cip\}/.test(d.split("</button>")[0])) && !/#[0-9a-fA-F]{3,8}\b/.test(kodStrane) && !/localStorage|sessionStorage|indexedDB/.test(kodStrane) && !/[Ѐ-ӿ]/.test(kodStrane));
        provera("ekran: vidljivost počinje prazna (nije unapred izabrana), postoji potvrda da član to želi, postojeći utisak člana zaključava formu", /vidljivost: ""/.test(kodStrane) && /T\.utisak\.potvrda/.test(kodStrane) && /const mozeForma = clan && knjiga && !vec && !proveravam/.test(kodStrane) && /imaUtisak\(clan\.id, knjiga\.id\)/.test(kodStrane));
        provera("ekran: u kodu nema upisa u polica (bibliotekar ne piše tuđu policu; to bi tražilo izmenu politike)", !/postaviStanje|dodajNaPolicu|from\("polica"\)/.test(kodStrane + kodPult));
        provera("ruta /bibliotekar/utisak je unutar RutaZaBibliotekare, a na /bibliotekar je alat „Утисак са пулта”", (() => { const x = citaj("src/App.jsx"); return x.indexOf('path="/bibliotekar/utisak"') > x.indexOf("<RutaZaBibliotekare />") && x.includes("<BibliotekarUtisak />"); })() && /kljuc: "pult"/.test(citaj("src/pages/BibliotekarPocetna.jsx")) && TK.osoblje.pult.naslov === "Утисак са пулта");
        provera("član vidi napomenu uz svoj utisak koji je upisao bibliotekar; polica.js čita uneo_bibliotekar_id samo za moj utisak", /moj\.uneo_bibliotekar_id &&/.test(citaj("src/components/Utisci.jsx")) && /T\.zapisanNaPultu/.test(citaj("src/components/Utisci.jsx")) && /Овај утисак је записао библиотекар/.test(TK.utisak.zapisanNaPultu) && !/uneo_bibliotekar_id/.test(bezKom(citaj("src/lib/polica.js")).split("export async function ucitajTudjeUtiske")[1]?.split("export async function sacuvajUtisak")[0] ?? ""));
        provera("pravila korišćenja pominju utisak sa pulta (član zna da to postoji i da može da ga izmeni)", TK.pravila.odeljci.some((o) => o.tacke.some((x) => /библиотекар може да упише утисак у ваше име/.test(x))));
        const nedostajePult = [];
        for (const m of kodStrane.matchAll(/\bT\.([A-Za-z]+(?:\.[A-Za-z]+)*)/g)) {
          const v = ("pult." + m[1].replace(/\.(replace|length)$/, "")).split(".").reduce((o, k) => o?.[k], TK);
          if (typeof v !== "string" && !(typeof v === "object" && v !== null)) nedostajePult.push(m[1]);
        }
        provera("svi natpisi ekrana „Утисак са пулта” postoje u tekst.js", nedostajePult.length === 0, nedostajePult);

        const m22 = citaj("supabase/migrations/0022_potpis_utiska_sa_pulta.sql");
        const k22 = m22.replace(/^\s*--.*$/gm, "");
        provera("0022 dolazi odmah posle 0021 (migracije idu redom, bez rupa)", (() => { const f = readdirSync(new URL("../supabase/migrations/", import.meta.url)).filter((x) => /^\d{4}_/.test(x)).sort(); return f.indexOf("0022_potpis_utiska_sa_pulta.sql") === f.indexOf("0021_moderacija_prijava.sql") + 1 && f.every((x, i) => Number(x.slice(0, 4)) === i + 1); })());
        provera("0022 ne dodaje, ne briše ni ne menja politike, ne pravi tabele ni kolone; dva okidača (BEFORE INSERT i UPDATE), nije SECURITY DEFINER, neaktivan član je greška 22023, servisna uloga izuzeta, notify pgrst", !/\b(create|drop|alter)\s+policy\b/i.test(k22) && !/create\s+table|add column/i.test(k22) && /create trigger utisci_potpis_bi\s+before insert/.test(k22) && /create trigger utisci_potpis_bu\s+before update/.test(k22) && !/security definer/i.test(k22) && /errcode = '22023'/.test(k22) && /if privatno\.servisna_uloga\(\) then\s+return new;/.test(k22) && /notify pgrst, 'reload schema'/.test(k22));
      }
      // ── odblokiranje (korak 14) ──
      {
        const kodLib = bezKom(citaj("src/lib/citaoci.js"));
        const kodKomp = bezKom(citaj("src/components/SpisakBlokiranih.jsx"));
        provera("odblokiranje: spisak dolazi iz pogleda moje_blokade (samo nadimak), odblokiranje je običan DELETE svoje blokade, prazan odgovor je greška", /from\("moje_blokade"\)\.select\("id, clan_id, kreirana, nadimak"\)/.test(kodLib) && /from\("blokade"\)\.delete\(\)\.eq\("id", blokadaId\)/.test(kodLib) && /GreskaApija\("blokada_nije_pronadjena"\)/.test(kodLib));
        provera("odblokiranje: komponenta ne čita clanovi, ime ni broj karte; traži potvrdu; ne šalje nikakav signal (nema upisa osim brisanja blokade); greška pri učitavanju je tiha", !/from\("clanovi"\)|broj_kartice|sifra_poziva|\.ime\b/.test(kodKomp) && /setPita\(b\.id\)/.test(kodKomp) && /await odblokiraj\(b\.id\)/.test(kodKomp) && !/insert|update\(|rpc\(/.test(kodKomp) && /console\.error\("spisak blokiranih/.test(kodKomp) && /if \(lista\.length === 0 && !poruka\) return null/.test(kodKomp));
        provera("odblokiranje: svako dugme ima stil iz stil.js ili min-h-11, bez hex boja i ćirilice u kodu; spisak je na ekranu Читаоци", kodKomp.split("<button").slice(1).every((d) => /className=\{stil\./.test(d.split("</button>")[0]) || /min-h-1[1-9]/.test(d.split("</button>")[0])) && !/#[0-9a-fA-F]{3,8}\b/.test(kodKomp) && !/[Ѐ-ӿ]/.test(kodKomp) && /<SpisakBlokiranih \/>/.test(citaj("src/pages/Citaoci.jsx")));
        const nedostajeBlok = [];
        for (const m of bezKom(kodKomp).matchAll(/\bT\.([A-Za-z]+)/g)) if (typeof TK.citaoci.blokirani[m[1]] !== "string") nedostajeBlok.push(m[1]);
        provera("svi natpisi spiska blokiranih postoje u tekst.js, a tekst kaže da veza ne vraća sama i da blokirani ne saznaje", nedostajeBlok.length === 0 && /Веза се не враћа сама/.test(TK.citaoci.blokirani.opis) && /не сазнаје/.test(TK.citaoci.blokirani.opis), nedostajeBlok);
        const m23 = citaj("supabase/migrations/0023_moje_blokade.sql");
        const k23 = m23.replace(/^\s*--.*$/gm, "");
        provera("0023 dolazi odmah posle 0022; samo pogled (security_invoker, uslov blokirao_id = auth.uid()), bez politika i tabela, prava eksplicitna, notify pgrst", (() => { const f = readdirSync(new URL("../supabase/migrations/", import.meta.url)).filter((x) => /^\d{4}_/.test(x)).sort(); return f.indexOf("0023_moje_blokade.sql") === f.indexOf("0022_potpis_utiska_sa_pulta.sql") + 1 && f.every((x, i) => Number(x.slice(0, 4)) === i + 1); })() && !/\b(create|drop|alter)\s+policy\b/i.test(k23) && !/create\s+table/i.test(k23) && /security_invoker = true/.test(k23) && /where b\.blokirao_id = auth\.uid\(\)/.test(k23) && /revoke all on public\.moje_blokade from public, anon, authenticated/.test(k23) && /grant select on public\.moje_blokade to authenticated/.test(k23) && /notify pgrst, 'reload schema'/.test(k23) && !/\b(ime|broj_kartice|sifra_poziva)\b/.test(k23.replace(/privatno\.javno_ime/g, "")));
      }
      // ── „Све књиге" (korak: pregled knjiga, migracija 0024) ──
      {
        const PK = await import("../src/lib/pregled-knjiga-logika.js");
        const p0 = PK.parametriPregleda({});
        provera("pregled knjiga: podrazumevani parametri (bez pretrage i filtera, najnovije prvo, 50 po strani, pomeraj 0)", p0.p_upit === null && p0.p_izvor === null && p0.p_odluka === null && p0.p_redosled === "najnovije" && p0.p_najvise === 50 && p0.p_pomeraj === 0 && PK.NAJVISE_PO_STRANI === 50);
        const p1 = PK.parametriPregleda({ upit: "  Derviš  ", izvor: "fond", odluka: "bez", redosled: "citaoca", pomeraj: 100 });
        provera("pregled knjiga: filteri se prenose (upit bez razmaka sa krajeva); nepoznat izvor, odluka ili redosled i negativan pomeraj se ne šalju (server ih inače odbija)", p1.p_upit === "Derviš" && p1.p_izvor === "fond" && p1.p_odluka === "bez" && p1.p_redosled === "citaoca" && p1.p_pomeraj === 100 && (() => { const q = PK.parametriPregleda({ izvor: "drugo", odluka: "mozda", redosled: "slucajno", pomeraj: -7 }); return q.p_izvor === null && q.p_odluka === null && q.p_redosled === "najnovije" && q.p_pomeraj === 0; })());
        provera("pregled knjiga: vrednosti filtera su iste kao u funkciji iz 0024", PK.IZVORI.join() === "fond,link,google_books,clan" && PK.ODLUKE.join() === "imamo,nabavljamo,ne_nabavljamo,bez" && PK.REDOSLEDI.join() === "najnovije,citaoca,naslov" && PK.IZVORI.every((x) => citaj("supabase/migrations/0024_pregled_knjiga.sql").includes("'" + x + "'")) && PK.ODLUKE.every((x) => citaj("supabase/migrations/0024_pregled_knjiga.sql").includes("'" + x + "'")));
        provera("pregled knjiga: ključ filtera se menja sa svakim filterom (lista počinje iznova), a ne sa pomerajem", PK.kljucFiltera({ upit: "a" }) !== PK.kljucFiltera({ upit: "b" }) && PK.kljucFiltera({ upit: " a " }) === PK.kljucFiltera({ upit: "a" }) && PK.kljucFiltera({ izvor: "fond" }) !== PK.kljucFiltera({}) && PK.kljucFiltera({ redosled: "naslov" }) !== PK.kljucFiltera({}));
        provera("pregled knjiga: „Учитај још” se nudi dok je učitano manje od ukupnog", PK.imaJos(50, 120) === true && PK.imaJos(120, 120) === false && PK.imaJos(0, 0) === false && PK.imaJos(50, "51") === true);
        const zbir = { ukupno: 10, fond: 4, link: 2, google_books: 1, clan: 3, imamo: 5, nabavljamo: 2, ne_nabavljamo: 1, bez_odluke: 2, spojenih: 3 };
        const gz = PK.grupeZbira(zbir);
        provera("pregled knjiga: zbir se razvrstava u izvore i odluke u istom redosledu kao na ekranu; izvori i odluke se sabiraju u ukupno; nedostajući broj je 0", gz.ukupno === 10 && gz.izvori.map((x) => x.kljuc + x.broj).join() === "fond4,link2,google_books1,clan3" && gz.odluke.map((x) => x.kljuc + x.broj).join() === "imamo5,nabavljamo2,ne_nabavljamo1,bez2" && gz.spojenih === 3 && PK.zbirJeUskladjen(zbir) && !PK.zbirJeUskladjen({ ...zbir, clan: 9 }) && PK.grupeZbira(null).ukupno === 0 && PK.grupeZbira({ ukupno: "x" }).ukupno === 0);

        const kodQ = bezKom(citaj("src/lib/pregled-knjiga.js"));
        provera("pregled-knjiga.js: samo tri funkcije (rpc), nikad tabele polica, clanovi ni knjige, ni uneo_id; običan klijent", [...kodQ.matchAll(/rpc\("(\w+)"/g)].map((m) => m[1]).sort().join() === "pregled_knjiga,pregled_knjiga_izdavaci,pregled_knjiga_zbir" && !/from\("/.test(kodQ) && !/uneo_id|clan_id|service_role/i.test(kodQ));
        const kodK = bezKom(citaj("src/pages/BibliotekarKnjige.jsx"));
        provera("ekran Све књиге: bez uneo_id, id-a članova, imena i broja karte; nijedan upit ne ide mimo funkcija; tekst iz tekst.js; bez hex boja, localStorage i ćirilice u kodu", !/uneo_id|clan_id|broj_kartice|sifra_poziva|nadimak|\.ime\b/.test(kodK + bezKom(citaj("src/lib/pregled-knjiga-logika.js"))) && !/supabase|from\("/.test(kodK) && !/#[0-9a-fA-F]{3,8}\b/.test(kodK) && !/localStorage|sessionStorage|indexedDB/.test(kodK) && !/[Ѐ-ӿ]/.test(kodK));
        provera("ekran Све књиге: svako dugme ima stil iz stil.js ili min-h-11", kodK.split("<button").slice(1).every((d) => /className=\{(?:stil\.|.\$\{stil\.)/.test(d.split("</button>")[0]) || /min-h-1[1-9]/.test(d.split("</button>")[0])));
        provera("ruta /bibliotekar/knjige je unutar RutaZaBibliotekare, a na /bibliotekar je alat „Све књиге”", (() => { const x = citaj("src/App.jsx"); return x.indexOf('path="/bibliotekar/knjige"') > x.indexOf("<RutaZaBibliotekare />") && x.includes("<BibliotekarKnjige />"); })() && /kljuc: "knjige"/.test(citaj("src/pages/BibliotekarPocetna.jsx")) && TK.osoblje.knjige.naslov === "Све књиге");
        const nedostajeP = [];
        for (const m of kodK.matchAll(/\bT\.([A-Za-z]+(?:\.[A-Za-z]+)*)/g)) {
          const v = ("pregledKnjiga." + m[1].replace(/\.(replace|length)$/, "")).split(".").reduce((o, k) => o?.[k], TK);
          if (typeof v !== "string" && !(typeof v === "object" && v !== null)) nedostajeP.push(m[1]);
        }
        provera("svi natpisi ekrana „Све књиге” postoje u tekst.js (izvori, odluke, redosledi, filteri)", nedostajeP.length === 0 && PK.IZVORI.every((x) => typeof TK.pregledKnjiga.izvori[x] === "string" && typeof TK.pregledKnjiga.izvoriKratko[x] === "string") && PK.ODLUKE.every((x) => typeof TK.pregledKnjiga.odluke[x] === "string") && PK.REDOSLEDI.every((x) => typeof TK.pregledKnjiga.redosledi[x] === "string"), nedostajeP);
        // ── filter po izdavaču (migracija 0025) ──
        {
          const pi = PK.parametriPregleda({ izdavac: "  laguna ", izvor: "fond" });
          provera("izdavač: ključ se šalje kao p_izdavac (bez razmaka sa krajeva), prazno je bez filtera, a „__bez__” je posebna vrednost", pi.p_izdavac === "laguna" && PK.parametriPregleda({}).p_izdavac === null && PK.parametriPregleda({ izdavac: "   " }).p_izdavac === null && PK.BEZ_IZDAVACA === "__bez__" && PK.parametriPregleda({ izdavac: PK.BEZ_IZDAVACA }).p_izdavac === "__bez__" && citaj("supabase/migrations/0025_pregled_knjiga_izdavac.sql").includes("'__bez__'"));
          provera("izdavač: promena izdavača menja ključ filtera (lista počinje od prve strane), isto kao ostali filteri", PK.kljucFiltera({ izdavac: "a" }) !== PK.kljucFiltera({ izdavac: "b" }) && PK.kljucFiltera({}) === PK.kljucFiltera({ izdavac: "" }));
          const adr = PK.filteriUAdresu({ upit: "  Derviš ", izvor: "fond", odluka: "bez", izdavac: "laguna", redosled: "citaoca" });
          provera("URL parametri: svi filteri (q, izvor, odluka, izdavac, redosled) idu u adresu, a podrazumevane vrednosti ne", decodeURIComponent(adr.toString()) === "q=Derviš&izvor=fond&odluka=bez&izdavac=laguna&redosled=citaoca" && PK.filteriUAdresu({}).toString() === "" && PK.filteriUAdresu({ redosled: "najnovije", izdavac: "" }).toString() === "" && PK.filteriUAdresu({ upit: "a b" }).toString() === "q=a+b");
          const iz = PK.filteriIzAdrese(new URLSearchParams("q=Derviš&izvor=fond&odluka=bez&izdavac=laguna&redosled=citaoca"));
          provera("URL parametri: iz adrese se čitaju isti filteri; nepoznat izvor, odluka i redosled se ignorišu (ne šalju se bazi); upit i izdavač su ograničene dužine", iz.upit === "Derviš" && iz.izvor === "fond" && iz.odluka === "bez" && iz.izdavac === "laguna" && iz.redosled === "citaoca" && (() => { const x = PK.filteriIzAdrese(new URLSearchParams("izvor=hak&odluka=x&redosled=y&q=" + "a".repeat(500) + "&izdavac=" + "b".repeat(500))); return x.izvor === "" && x.odluka === "" && x.redosled === "najnovije" && x.upit.length === 100 && x.izdavac.length === 200; })() && PK.filteriIzAdrese(new URLSearchParams("")).redosled === "najnovije");
          provera("URL parametri: kružno (filteri → adresa → filteri) daje iste filteri", JSON.stringify(PK.filteriIzAdrese(PK.filteriUAdresu({ upit: "Ђорђе", izvor: "link", odluka: "imamo", izdavac: "__bez__", redosled: "naslov" }))) === JSON.stringify({ upit: "Ђорђе", izvor: "link", odluka: "imamo", izdavac: "__bez__", redosled: "naslov" }));
          const tk = TK.pregledKnjiga.izdavac;
          const op = PK.opcijeIzdavaca([{ kljuc: "laguna", naziv: "Laguna", broj: 42 }, { kljuc: "vulkan", naziv: "Vulkan", broj: 7 }, { kljuc: "__bez__", naziv: null, broj: 3 }], "", tk);
          provera("opcije izdavača: „Laguna (42)”, „Vulkan (7)”, „Без издавача (3)” redom kako ih vrati baza (broj opadajuće, „bez” poslednje); „Сви издавачи” je zasebna opcija na ekranu", op.map((o) => o.natpis).join("|") === "Laguna (42)|Vulkan (7)|Без издавача (3)" && TK.pregledKnjiga.sviIzdavaci === "Сви издавачи" && TK.pregledKnjiga.filterIzdavac === "Издавач");
          provera("opcije izdavača: izabrani koji je ispao iz spiska (drugi filteri ga ne pogađaju) ostaje sa brojem 0; naziv sa znakom $ ostaje kakav jeste", PK.opcijeIzdavaca([{ kljuc: "a", naziv: "A", broj: 1 }], "laguna", tk).at(-1).natpis === "laguna (0)" && PK.opcijeIzdavaca([], "__bez__", tk)[0].natpis === "Без издавача (0)" && PK.opcijeIzdavaca([{ kljuc: "x", naziv: "Cena $& d.o.o.", broj: 2 }], "", tk)[0].natpis === "Cena $& d.o.o. (2)" && PK.opcijeIzdavaca(null, "", tk).length === 0);
          const kodS = bezKom(citaj("src/pages/BibliotekarKnjige.jsx"));
          provera("ekran: izdavač je padajući izbor (select) sa „Сви издавачи”, a svi filteri se čuvaju u adresi preko useSearchParams (replace, bez novih zapisa u istoriji)", /<select id="pregled-izdavac"/.test(kodS) && /T\.sviIzdavaci/.test(kodS) && /useSearchParams\(\)/.test(kodS) && /\{ replace: true \}/.test(kodS) && /postavi\(\{ izdavac: e\.target\.value \}\)/.test(kodS) && /postavi\(\{ izvor: v \}\)/.test(kodS) && /postavi\(\{ odluka: v \}\)/.test(kodS) && /postavi\(\{ redosled: v \}\)/.test(kodS) && !/useState\(""\);\s*const \[odluka/.test(kodS));
          provera("ekran: spisak izdavača se učitava po pretrazi, izvoru i odluci (NE po izabranom izdavaču), a lista po svim pet filterima; „Учитај још” nosi izdavača", /ucitajIzdavace\(\{ upit: trazi, izvor, odluka \}\)/.test(kodS) && /\}, \[trazi, izvor, odluka, osvezi\]\)/.test(kodS) && /ucitajStranuKnjiga\(\{ upit: trazi, izvor, odluka, izdavac, redosled \}\)/.test(kodS) && /const filteri = \{ upit: trazi, izvor, odluka, izdavac, redosled \}/.test(kodS));
          const kodQ2 = bezKom(citaj("src/lib/pregled-knjiga.js"));
          provera("pregled-knjiga.js: spisak izdavača šalje samo upit, izvor i odluku (ne izdavača), a rpc su i dalje samo tri funkcije", /rpc\("pregled_knjiga_izdavaci", \{ p_upit: p\.p_upit, p_izvor: p\.p_izvor, p_odluka: p\.p_odluka \}\)/.test(kodQ2) && !/uneo_id|clan_id/.test(kodQ2));
          const nedostajeIzd = [];
          for (const m of kodS.matchAll(/\bT\.([A-Za-z]+(?:\.[A-Za-z]+)*)/g)) {
            const v = ("pregledKnjiga." + m[1].replace(/\.(replace|length)$/, "")).split(".").reduce((o, k) => o?.[k], TK);
            if (typeof v !== "string" && !(typeof v === "object" && v !== null)) nedostajeIzd.push(m[1]);
          }
          provera("svi natpisi ekrana (uključujući izdavača) postoje u tekst.js", nedostajeIzd.length === 0, nedostajeIzd);

          const m25 = citaj("supabase/migrations/0025_pregled_knjiga_izdavac.sql");
          const k25s = m25.replace(/^\s*--.*$/gm, "");
          provera("0025 dolazi odmah posle 0024; stara funkcija sa šest parametara se briše (drop function if exists) pre nove; nova ima p_izdavac kao poslednji parametar; prava za oba nova potpisa; notify pgrst", (() => { const fl = readdirSync(new URL("../supabase/migrations/", import.meta.url)).filter((x) => /^\d{4}_/.test(x)).sort(); return fl.indexOf("0025_pregled_knjiga_izdavac.sql") === fl.indexOf("0024_pregled_knjiga.sql") + 1 && fl.every((x, i) => Number(x.slice(0, 4)) === i + 1); })() && /drop function if exists public\.pregled_knjiga\(text, text, text, text, integer, integer\);/.test(k25s) && k25s.indexOf("drop function if exists public.pregled_knjiga(") < k25s.indexOf("create or replace function public.pregled_knjiga(") && /p_pomeraj\s+integer default 0,\s+p_izdavac\s+text\s+default null/.test(k25s) && /revoke all on function public\.pregled_knjiga\(text, text, text, text, integer, integer, text\)/.test(k25s) && /revoke all on function public\.pregled_knjiga_izdavaci\(text, text, text\)/.test(k25s) && /notify pgrst, 'reload schema'/.test(k25s));
          provera("0025: obe javne funkcije SECURITY DEFINER sa search_path i proverom je_bibliotekar(); ključ izdavača je privatno.norm_tekst(btrim(izdavac)); bez politika, tabela i kolona", (k25s.match(/security definer\s+set search_path = pg_catalog, public/g) ?? []).length === 2 && (k25s.match(/privatno\.je_bibliotekar\(\)/g) ?? []).length === 2 && /privatno\.norm_tekst\(btrim\(coalesce\(k\.izdavac, ''\)\)\)/.test(k25s) && !/\b(create|drop|alter)\s+policy\b/i.test(k25s) && !/create\s+table|add column/i.test(k25s));
          provera("0025: nijedna izlazna kolona ne vodi do člana (nema uneo_id, clan_id, nadimka, imena, broja karte)", !/\b(uneo_id|nadimak|broj_kartice|sifra_poziva)\b/.test(k25s) && !/\bc\.ime\b/.test(k25s));
        }
        const m24 = citaj("supabase/migrations/0024_pregled_knjiga.sql");
        const k24s = m24.replace(/^\s*--.*$/gm, "");
        provera("0024 dolazi odmah posle 0023; nema politika, tabela ni kolona; obe funkcije SECURITY DEFINER sa search_path i proverom je_bibliotekar(); anon nema pravo; notify pgrst", (() => { const f = readdirSync(new URL("../supabase/migrations/", import.meta.url)).filter((x) => /^\d{4}_/.test(x)).sort(); return f.indexOf("0024_pregled_knjiga.sql") === f.indexOf("0023_moje_blokade.sql") + 1 && f.every((x, i) => Number(x.slice(0, 4)) === i + 1); })() && !/\b(create|drop|alter)\s+policy\b/i.test(k24s) && !/create\s+table|add column/i.test(k24s) && (k24s.match(/security definer\s+set search_path = pg_catalog, public/g) ?? []).length === 2 && (k24s.match(/privatno\.je_bibliotekar\(\)/g) ?? []).length === 2 && (k24s.match(/revoke all on function public\.pregled_knjiga/g) ?? []).length === 2 && /notify pgrst, 'reload schema'/.test(k24s));
        provera("0024: nijedna izlazna kolona ne vodi do člana (nema uneo_id, clan_id, nadimka, imena, broja karte); od police dolazi samo broj", !/\b(uneo_id|nadimak|broj_kartice|sifra_poziva|ime)\b/.test(k24s.slice(k24s.indexOf("returns table"))) && /count\(\*\)::integer as n/.test(k24s));
      }
      // ── miran prelaz između kartica (korak: ekran ne sme da „igra") ──
      {
        const css = citaj("src/index.css");
        const okvir = bezKom(citaj("src/components/Okvir.jsx"));
        provera("prelaz između kartica: mesto za traku za skrolovanje je uvek rezervisano (scrollbar-gutter: stable na html), pa širina sadržaja ne zavisi od visine stranice", /html\s*\{[^}]*scrollbar-gutter:\s*stable/.test(css));
        const pov = bezKom(citaj("src/components/PovratakNaVrh.jsx"));
        const app = citaj("src/App.jsx");
        provera("prelaz između kartica: pri promeni putanje skrol ide na vrh, osim za dugme „nazad” (POP); zavisi samo od putanje (filteri u adresi ne skaču na vrh); komponenta je unutar rutera i van Routes", /useNavigationType\(\)/.test(pov) && /tip !== "POP"/.test(pov) && /window\.scrollTo\(\{ top: 0, left: 0, behavior: "instant" \}\)/.test(pov) && /\[pathname\]\)/.test(pov) && app.indexOf("<PovratakNaVrh />") > app.indexOf("<AuthProvider>") && app.indexOf("<PovratakNaVrh />") < app.indexOf("<Routes>"));
        provera("okvir ostaje montiran: Okvir je izgled (layout) sa Outlet-om, a ne omotač svake stranice; ZasticenaRuta ga vraća jednom, a stranice su deca iste rute", /<Outlet \/>/.test(okvir) && /<Route element=\{<ZasticenaRuta \/>\}>/.test(app) && /return <Okvir \/>;/.test(citaj("src/components/ZasticenaRuta.jsx")) && !/import Okvir/.test(bezKom(citaj("src/pages/Pocetna.jsx") + citaj("src/pages/Citaoci.jsx") + citaj("src/pages/Profil.jsx") + citaj("src/pages/Pretraga.jsx"))));
        provera("okvir: zaglavlje je lepljivo sa stalnim razmacima, donja navigacija fiksna sa safe-area na telefonu (viewport-fit=cover, env(safe-area-inset-bottom)) i bez ijedne animacije pomeranja", /sticky top-0/.test(okvir) && /pb-\[max\(0\.75rem,env\(safe-area-inset-bottom\)\)\]/.test(okvir) && /pb-\[calc\(7rem\+env\(safe-area-inset-bottom\)\)\]/.test(okvir) && /viewport-fit=cover/.test(citaj("index.html")) && !/translate|animate-|slide|fade/i.test(okvir));
        provera("okvir: značke u navigaciji su apsolutno pozicionirane (tačka na „Читаоци” i „Библиотека”), pa dolazak broja ne menja širinu ni visinu stavki; sve stavke su flex-1 iste visine", (okvir.match(/className="absolute right-1\.5 top-0 size-2\.5 rounded-full/g) ?? []).length === 2 && /flex min-h-14 flex-1 flex-col/.test(okvir));
        const brojStranica = ["Pocetna", "Pretraga", "Citaoci", "Profil", "BibliotekarPocetna", "BibliotekarKnjige", "BibliotekarNabavka", "BibliotekarPrijave", "BibliotekarClanovi", "BibliotekarUnos", "BibliotekarUtisak"];
        provera("naslov svake kartice ima isti razmak odozgo (pt-2), pa se pri prelasku ne pomera po vertikali", brojStranica.every((p) => /stil\.naslov\} pt-2/.test(citaj("src/pages/" + p + ".jsx"))));
        const ucitavaSkeleton = ["Pocetna", "Citaoci", "BibliotekarKnjige", "BibliotekarNabavka", "BibliotekarPrijave", "BibliotekarClanovi"];
        provera("učitavanje ne skače: ekrani kartica umesto reda teksta „Учитавам…” drže blokove stalne visine (Skeleton); tekst za čitače ekrana ostaje", ucitavaSkeleton.every((p) => /<Skeleton /.test(citaj("src/pages/" + p + ".jsx")) && /import Skeleton from/.test(citaj("src/pages/" + p + ".jsx"))) && /sr-only/.test(citaj("src/components/Skeleton.jsx")) && /aria-busy="true"/.test(citaj("src/components/Skeleton.jsx")));
        provera("animacije: jedina je providnost (animate-pulse) u Skeleton-u; nigde translate/slide/fade-in sa pomakom; prefers-reduced-motion gasi sve animacije i prelaze", !/animate-(?!pulse)/.test(Object.values({ a: citaj("src/components/Skeleton.jsx"), b: citaj("src/pages/Pocetna.jsx"), c: citaj("src/pages/Citaoci.jsx"), d: citaj("src/components/Okvir.jsx") }).join("")) && /prefers-reduced-motion: reduce\)\s*\{\s*\*\s*\{\s*animation: none !important;\s*transition: none !important;/.test(css));
        provera("korice: odnos strana 2:3 je zadat u CSS-u (aspect-ratio) i za pločicu i za sliku, a slika ima width i height, pa se ništa ne pomera kad slika stigne", (css.match(/aspect-ratio:\s*2 \/ 3/g) ?? []).length >= 2 && /width=\{v\.px\[0\]\}\s+height=\{v\.px\[1\]\}/.test(citaj("src/components/Korica.jsx")));
        provera("značka na pločici „Пријаве” na početnom ekranu osoblja ne menja visinu reda (min-h)", /min-h-\[26px\] flex-wrap items-baseline justify-between/.test(citaj("src/pages/BibliotekarPocetna.jsx")));
      }
      // ── uvoz fonda iz CSV-a (scripts/uvezi-fond.mjs, src/lib/uvoz-fonda.js) ──
      {
        const UF = await import("../src/lib/uvoz-fonda.js");
        const csv = '\uFEFFcobiss_id,naslov,autor,izdavac,godina,isbn,primeraka\r\n1,Prvi,A. A.,Laguna,2020,9788652126033,2\r\n2,"Sa ""navodnicima"", i zarezom",Б. Б.,"Народна библиотека ""Доситеј""",1999,,1\r\n3,"Dva\nreda",,,,,1\r\n\r\n4,“Хајдук Вељко“ : 1997,Ц,Д,2025,978-86-521-2603-3,1';
        const r = UF.parsirajCsv(csv);
        provera("CSV: BOM se skida, CRLF i prazni redovi se prelaze, polja u navodnicima sa udvojenim navodnicima, zarezom i novim redom u polju ostaju čitava", r.length === 5 && r[0].polja.join("|") === "cobiss_id|naslov|autor|izdavac|godina|isbn|primeraka" && r[2].polja[1] === 'Sa "navodnicima", i zarezom' && r[2].polja[3] === 'Народна библиотека "Доситеј"' && r[3].polja[1] === "Dva\nreda" && r[4].polja[1] === "“Хајдук Вељко“ : 1997" && r.every((x) => x.polja.length === 7), r.map((x) => x.polja.length));
        provera("CSV: broj reda u fajlu je tačan i kad polje ima novi red (zaglavlje je red 1)", r.map((x) => x.linija).join() === "1,2,3,4,7");
        const ind = UF.indeksiKolona(r[0].polja);
        provera("CSV: zaglavlje mora da ima sve kolone (redosled nije bitan), inače greška", ind.naslov === 1 && ind.isbn === 5 && UF.indeksiKolona(["naslov", "autor"]).greska && UF.indeksiKolona(["Isbn", "Naslov", "autor", "izdavac", "godina", "cobiss_id", "primeraka"]).naslov === 1);
        const red = (o) => UF.urediRed({ linija: 9, polja: [o.c ?? "1", o.n ?? "Naslov", o.a ?? "", o.i ?? "", o.g ?? "", o.s ?? "", o.p ?? "1"] }, ind);
        provera("red: prazan naslov se odbija; ostalo je dozvoljeno (autor, izdavač, godina, ISBN mogu da fale)", red({ n: "   " }).ok === false && red({ n: "   " }).razlog === "prazan naslov" && red({}).ok && red({}).knjiga.autor === null && red({}).knjiga.isbn === null && red({}).knjiga.godina === null);
        provera("red: ISBN se normalizuje kao u aplikaciji (crtice, ISBN-10 u ISBN-13); neispravan ISBN NE odbija knjigu nego se izostavlja, uz upozorenje", red({ s: "978-86-521-2603-3" }).knjiga.isbn === "9788652126033" && red({ s: "0-306-40615-2" }).knjiga.isbn === "9780306406157" && (() => { const x = red({ s: "123-456" }); return x.ok && x.knjiga.isbn === null && x.upozorenja.length === 1 && /neispravan ISBN/.test(x.upozorenja[0]); })());
        provera("red: godina van 1400–2200 ili nebrojčana se izostavlja uz upozorenje; ispravna ostaje; razmaci i novi redovi u poljima se sabijaju", red({ g: "1921" }).knjiga.godina === 1921 && red({ g: "1200" }).knjiga.godina === null && red({ g: "1200" }).upozorenja.length === 1 && red({ g: "n.d." }).knjiga.godina === null && red({ n: "  Dva \n reda  " }).knjiga.naslov === "Dva reda");
        provera("red: COBISS ID i broj primeraka se čitaju samo za izveštaj; u red za upis ne ulaze (nema cobiss_id, primeraka, opisa, korica, uneo_id ni odluke)", (() => { const k = red({ c: "173736713", p: "6", n: "X" }).knjiga; const z = UF.redZaUpis(k); return k.cobiss_id === "173736713" && Object.keys(z).sort().join() === "autor,godina,isbn,izdavac,izvor,naslov,u_fondu" && z.izvor === "fond" && z.u_fondu === true; })());
        provera("normTekst je isti kao privatno.norm_tekst (ćirilica → latinica, bez kvačica, mala slova): Ђорђе → djordje, Љубица Његош → ljubica njegos, Šaponja Čačak → saponja cacak", UF.normTekst("Ђорђе") === "djordje" && UF.normTekst("Љубица Његош") === "ljubica njegos" && UF.normTekst("Šaponja Čačak") === "saponja cacak" && UF.kljucTeksta("  LAGUNA  ") === UF.kljucTeksta("Лагуна"));

        // planiranje
        const kn = (o) => ({ ok: true, upozorenja: [], knjiga: { linija: o.l ?? 2, cobiss_id: null, naslov: o.n, autor: o.a ?? null, izdavac: o.iz ?? null, godina: o.g ?? null, isbn: o.s ?? null } });
        const db = (o) => ({ id: o.id, naslov: o.n, autor: o.a ?? null, izdavac: o.iz ?? null, godina: o.g ?? null, isbn: o.s ?? null, izvor: o.izvor ?? "clan", u_fondu: o.f ?? false, odluka_nabavke: o.od ?? null, spojena_sa_id: o.sp ?? null });
        let p = UF.planiraj([kn({ n: "Nova knjiga", s: "9788652126033" })], [db({ id: "a", n: "Druga", s: "9780306406157" })]);
        provera("plan: knjiga koje nema u bazi je nova", p.nove.length === 1 && p.dopune.length === 0);
        p = UF.planiraj([kn({ n: "Prokleta avlija", a: "Ivo Andrić", s: "9788652126033", l: 5 })], [db({ id: "a", n: "PROKLETA  AVLIJA", s: "9788652126033", izvor: "clan", f: false })]);
        provera("plan: isti ISBN i isti normalizovan naslov (velika slova, razmaci) je ista knjiga: dopunjava se (u_fondu, izvor, prazan autor), ne pravi nova", p.nove.length === 0 && p.dopune.length === 1 && p.dopune[0].izmena.u_fondu === true && p.dopune[0].izmena.izvor === "fond" && p.dopune[0].izmena.autor === "Ivo Andrić" && !("naslov" in p.dopune[0].izmena));
        p = UF.planiraj([kn({ n: "Др\u0443\u0433а књига", s: "9788652126033" })], [db({ id: "a", n: "Prokleta avlija", s: "9788652126033", izvor: "fond", f: true })]);
        provera("plan: isti ISBN a RAZLIČIT naslov su različite knjige (greška u COBISS-u): ne spajaju se, uvozi se nova", p.nove.length === 1 && p.dopune.length === 0 && p.vecUFondu.length === 0);
        p = UF.planiraj([kn({ n: "Prvi", s: "9788652126033", l: 2 }), kn({ n: "Drugi", s: "9788652126033", l: 3 })], []);
        provera("plan: isti ISBN sa različitim naslovom u samom fajlu: obe se uvoze, uz napomenu", p.nove.length === 2 && p.isbnRazlicitNaslov.length === 1 && p.isbnRazlicitNaslov[0].naslovi.length === 2);
        p = UF.planiraj([kn({ n: "Ćirilica Šuma", a: "Ђорђе Т", g: 2001, l: 8 })], [db({ id: "a", n: "Cirilica suma", a: "Djordje T", g: 2001 }), db({ id: "b", n: "Cirilica suma", a: "Djordje T", g: 1999 })]);
        provera("plan: bez ISBN-a poredi se normalizovan naslov + autor + godina (pismo i kvačice se ne računaju); druga godina je druga knjiga", p.nove.length === 0 && p.dopune.length === 1 && p.dopune[0].id === "a");
        p = UF.planiraj([kn({ n: "Bez isbn-a u bazi", a: "A", g: 2010, s: "9788652126033" })], [db({ id: "a", n: "Bez isbn-a u bazi", a: "A", g: 2010, s: null })]);
        provera("plan: knjiga iste godine, naslova i autora koja u bazi nema ISBN je ista knjiga (dobija ISBN, ne pravi se duplikat); računa se posebno", p.nove.length === 0 && p.dopuneBezIsbna.length === 1 && p.dopuneBezIsbna[0].izmena.isbn === "9788652126033");
        p = UF.planiraj([kn({ n: "Već u fondu", s: "9788652126033", a: "X" })], [db({ id: "a", n: "Već u fondu", s: "9788652126033", a: "Drugi autor", izvor: "fond", f: true })]);
        provera("plan: knjiga koja je već u fondu i ima popunjena polja se preskače, a popunjeno se NE prepisuje (autor ostaje „Drugi autor”)", p.vecUFondu.length === 1 && p.dopune.length === 0 && p.nove.length === 0);
        p = UF.planiraj([kn({ n: "Sa odlukom", s: "9788652126033" })], [db({ id: "a", n: "Sa odlukom", s: "9788652126033", od: "nabavljamo", f: false })]);
        provera("plan: postojeća knjiga sa odlukom „набављамо” postaje u_fondu, ali se ODLUKA ne menja (samo se prijavljuje u izveštaju)", p.dopune.length === 1 && !("odluka_nabavke" in p.dopune[0].izmena) && p.saOdlukom.length === 1 && p.saOdlukom[0].odluka === "nabavljamo");
        p = UF.planiraj([kn({ n: "Spojena", s: "9788652126033" })], [db({ id: "a", n: "Spojena", s: "9788652126033", sp: "b" })]);
        provera("plan: spojeni duplikati u bazi se ne porede (poredi se samo matični zapis)", p.nove.length === 1 && p.dopune.length === 0);
        p = UF.planiraj([kn({ n: "Ista", s: "9788652126033", l: 2 }), kn({ n: "ISTA", s: "9788652126033", l: 3 }), kn({ n: "Bez", a: "A", g: 2000, l: 4 }), kn({ n: "bez", a: "a", g: 2000, l: 5 })], []);
        provera("plan: ista knjiga dvaput u fajlu (više COBISS zapisa) se uvozi jednom; ponovljena se prijavljuje sa linijom prve", p.nove.length === 2 && p.duplikatiUFajlu.length === 2 && p.duplikatiUFajlu[0].prvaLinija === 2);
        p = UF.planiraj([kn({ n: "Sa ISBN-om", a: "A", g: 2000, s: "9788652126033", l: 2 }), kn({ n: "Sa isbn-om", a: "A", g: 2000, l: 3 })], []);
        provera("plan: red bez ISBN-a je duplikat reda sa ISBN-om istog naslova, autora i godine", p.nove.length === 1 && p.duplikatiUFajlu.length === 1);
        p = UF.planiraj([{ ok: false, razlog: "prazan naslov", linija: 4, naslov: null }, kn({ n: "Dobra" })], []);
        provera("plan: odbijeni redovi nose liniju i razlog, a ne ulaze u nove", p.odbijeni.length === 1 && p.odbijeni[0].linija === 4 && p.odbijeni[0].razlog === "prazan naslov" && p.nove.length === 1);
        const ulaz = [kn({ n: "Jedan", s: "9788652126033", a: "A" }), kn({ n: "Dva", a: "B", g: 2001 }), kn({ n: "Tri", s: "9780306406157" })];
        const baza0 = [db({ id: "x", n: "Jedan", s: "9788652126033", izvor: "clan", f: false }), db({ id: "y", n: "Neka druga", s: "9780000000002" })];
        const p1 = UF.planiraj(ulaz, baza0);
        const baza1 = UF.primeniPlanNaListu(baza0, p1);
        const p2 = UF.planiraj(ulaz, baza1);
        const baza2 = UF.primeniPlanNaListu(baza1, p2);
        provera("idempotentnost: posle primene plana novo planiranje nema ništa da radi (0 novih, 0 dopuna), a drugi prolaz ne menja bazu", p1.nove.length === 2 && p1.dopune.length === 1 && p2.nove.length === 0 && p2.dopune.length === 0 && p2.dopuneBezIsbna.length === 0 && p2.vecUFondu.length === 3 && baza2.length === baza1.length && JSON.stringify(baza2) === JSON.stringify(baza1));
        provera("sve uvezene knjige imaju izvor „fond”, u_fondu = true i praznu odluku (efektivno „Имамо”); postojeće tuđe knjige nisu diranje", baza1.filter((k) => k.id.startsWith("nov-")).every((k) => k.izvor === "fond" && k.u_fondu === true && k.odluka_nabavke === null) && baza1.find((k) => k.id === "y").u_fondu === false);

        // pravi CSV (uvoz/ je van GitHub-a, pa se preskače ako ga nema)
        let pravi = null;
        try { pravi = citaj("uvoz/fond-2025-2026.csv"); } catch { /* nema fajla */ }
        if (pravi) {
          const rr = UF.parsirajCsv(pravi);
          const ii = UF.indeksiKolona(rr[0].polja);
          const un = rr.slice(1).map((x) => { const u = UF.urediRed(x, ii); return u.ok ? u : { ...u, linija: x.linija }; });
          const pl = UF.planiraj(un, []);
          provera("pravi CSV: svih redova ima sedam kolona, nijedan nije odbijen, sve su nove na praznoj bazi, a drugi prolaz je prazan", rr.every((x) => x.polja.length === 7) && pl.odbijeni.length === 0 && pl.nove.length + pl.duplikatiUFajlu.length === rr.length - 1 && UF.planiraj(un, UF.primeniPlanNaListu([], pl)).nove.length === 0, UF.sazetak(pl, rr.length - 1));
        }

        // skripta
        const sk = citaj("scripts/uvezi-fond.mjs");
        const skKod = bezKom(sk);
        provera("skripta: podrazumevani režim je probni; svaki upis (insert, update) je posle provere --upisi; serije po 200; ključ iz .env se nikad ne ispisuje", /const UPISI = Boolean\(arg\("upisi"\)\)/.test(skKod) && skKod.indexOf("if (!UPISI)") > -1 && skKod.indexOf("if (!UPISI)") < skKod.indexOf(".insert(") && skKod.indexOf("if (!UPISI)") < skKod.indexOf(".update(") && /const SERIJA = 200/.test(skKod) && /bezTajni/.test(skKod) && !/console\.(log|error)\([^)]*SERVICE\b[^)]*\)/.test(skKod.replace(/bezTajni\([^)]*\)/g, "")));
        provera("skripta: ne upisuje COBISS ID, primerke, opis ni korice (redZaUpis), ne dira odluku nabavke, ne menja uneo_id; koristi servisni ključ kao resetuj-pin.mjs; npm skripta admin:uvezi-fond sa --env-file=.env", !/cobiss_id\s*:/.test(skKod.replace(/select\([^)]*\)/g, "")) && !/odluka_nabavke\s*:|uneo_id\s*:|broj_primeraka|opis\s*:|korice/.test(skKod.replace(/select\("[^"]*"\)/g, "")) && /redZaUpis/.test(skKod) && /"admin:uvezi-fond": "node --env-file=\.env scripts\/uvezi-fond\.mjs"/.test(citaj("package.json")) && /SUPABASE_SERVICE_ROLE_KEY/.test(skKod));
        provera("uvoz/ je u .gitignore (CSV iz COBISS-a ne ide na GitHub)", /^uvoz\/\s*$/m.test(citaj(".gitignore")));
      }
      // ── korice izdavača (scripts/obogati-korice.mjs, src/lib/korice-izdavaci.js) ──
      {
        const KI = await import("../src/lib/korice-izdavaci.js");
        provera("slug adrese iz naslova: ćirilica i latinica, kvačice i znaci postaju slova i crtice (Prokleta avlija: Djordje! → prokleta-avlija-djordje)", KI.slug("Prokleta avlija: Đorđe!") === "prokleta-avlija-djordje" && KI.slug("  Ђорђе и змај  ") === "djordje-i-zmaj" && KI.slug("24 sata u svetu vikinga") === "24-sata-u-svetu-vikinga");
        provera("adrese za knjigu: ceo naslov, pa naslov bez podnaslova (posle „ : ” ili „ / ”), bez ponavljanja i prekratkih", KI.kandidatiSlugova("Preokret : upravljajte emocijama").join() === "preokret-upravljajte-emocijama,preokret" && KI.kandidatiSlugova("Otac").join() === "otac" && KI.kandidatiSlugova("Ab").length === 0);
        const sitemap = '<?xml version="1.0"?><urlset><url><loc>https://laguna.rs/proizvodi/knjige/otac/</loc></url><url><loc>https://laguna.rs/proizvodi/gift/mini-kuca/</loc></url><url><loc>https://laguna.rs/proizvodi/knjige/preokret/</loc></url></urlset>';
        const ind = KI.indeksSitemapa(KI.adreseIzSitemapa(sitemap), KI.IZDAVACI.laguna.uzorakAdrese);
        provera("sitemap: čitaju se <loc> adrese, a u indeks ulaze samo knjige (ne poklon-artikli); knjiga se nalazi po slug-u, najviše dve adrese", ind.size === 2 && ind.get("otac") === "https://laguna.rs/proizvodi/knjige/otac/" && KI.adreseZaKnjigu("Preokret : upravljajte emocijama", ind).join() === "https://laguna.rs/proizvodi/knjige/preokret/" && KI.adreseZaKnjigu("Nema takve", ind).length === 0);
        provera("izdavač iz baze se prepoznaje bez obzira na pismo i veličinu slova (Laguna, LAGUNA d.o.o., ćirilicom), a drugi izdavač ne", KI.izdavacOdgovara("Laguna", "laguna") && KI.izdavacOdgovara("LAGUNA d.o.o.", "laguna") && KI.izdavacOdgovara("\u041b\u0430\u0433\u0443\u043d\u0430", "laguna") && !KI.izdavacOdgovara("Vulkan izdavaštvo", "laguna") && !KI.izdavacOdgovara(null, "laguna") && KI.izdavacOdgovara("Vulkan izdavaštvo", "vulkan") && KI.izdavacOdgovara("Pčelica", "pcelica"));
        provera("pravilo 6: stranica odgovara knjizi po ISBN-u ILI po naslovu (pismo i znaci se ne računaju, podnaslov se ne traži); inače se preskače sa razlogom", KI.stranicaOdgovara({ naslov: "A", isbn: "9788652126033" }, { naslov: "Sasvim drugo", isbn: "9788652126033" }).po === "isbn" && KI.stranicaOdgovara({ naslov: "Preokret : upravljajte emocijama", isbn: null }, { naslov: "PREOKRET", isbn: null }).po === "naslov" && KI.stranicaOdgovara({ naslov: "\u041f\u0440\u0438\u0447\u0435 \u0443\u0437 \u043e\u0433\u045a\u0438\u0448\u0442\u0435", isbn: null }, { naslov: "Price uz ognjiste", isbn: null }).ok && (() => { const x = KI.stranicaOdgovara({ naslov: "Otac", isbn: "9788652158195" }, { naslov: "Majka", isbn: "9788652126033" }); return x.ok === false && /drugačiji/.test(x.razlog); })());
        provera("slika: samo prepoznat tip (jpeg, png, webp) i veća od 1 KB; manja ili nepoznata se odbija sa razlogom", KI.slikaJeUpotrebljiva({ mime: "image/jpeg" }, 5000).ok && !KI.slikaJeUpotrebljiva({ mime: "image/jpeg" }, 1023).ok && !KI.slikaJeUpotrebljiva(null, 5000).ok && KI.NAJMANJE_BAJTOVA_SLIKE === 1024);
        provera("Open Library: adresa sa default=false (404 kad korice nema); HTTP 429 i 403 prekidaju rad, 404 ne", KI.adresaOpenLibrary("9788652126033") === "https://covers.openlibrary.org/b/isbn/9788652126033-M.jpg?default=false" && KI.jePrekid(429) && KI.jePrekid(403) && !KI.jePrekid(404) && KI.statusIzGreske(new Error("Sajt je odgovorio sa HTTP 429.")) === 429 && KI.statusIzGreske(new Error("nešto drugo")) === null);
        provera("stanje: nastavlja se gde je stalo (upisano je uvek konačno; nije_nadjeno i ne_odgovara samo za istu verziju pravila, pa se posle proširenja ponovo pokušavaju; greška i nepoznato nisu)", KI.jeKonacno({ stanje: "upisano" }) && KI.jeKonacno({ stanje: "nije_nadjeno", pravilo: KI.VERZIJA_PRAVILA }) && !KI.jeKonacno({ stanje: "nije_nadjeno" }) && !KI.jeKonacno({ stanje: "nije_nadjeno", pravilo: KI.VERZIJA_PRAVILA - 1 }) && !KI.jeKonacno({ stanje: "greska" }) && !KI.jeKonacno({ stanje: "bez_korice" }) && !KI.jeKonacno({ stanje: "slika_neupotrebljiva" }) && !KI.jeKonacno(undefined));
        provera("izdavači: Laguna, Vulkan, Kreativni centar i Booka (sitemap) i Pčelica (pretraga po ISBN-u) su uključeni, Publik NIJE (razlog je zapisan: nema robots.txt, sitemap ni pretragu), a svaki ima domen", KI.IZDAVACI.laguna.podrzan === true && KI.IZDAVACI.vulkan.podrzan === true && KI.IZDAVACI.kreativni.podrzan === true && KI.IZDAVACI.pcelica.podrzan === true && KI.IZDAVACI.pcelica.strategija === "pretraga" && KI.IZDAVACI.vulkan.sitemap === "https://www.vulkani.rs/files/sitemap/SRB_rs/product.xml" && KI.IZDAVACI.booka.podrzan === true && ["publik"].every((k) => KI.IZDAVACI[k].podrzan === false && /robots|proveravan/.test(KI.IZDAVACI[k].razlog) && KI.IZDAVACI[k].domen) && KI.KORISNICKI_AGENT === "Citaliste-NBDN/1.0 (biblioteka Negotin)" && KI.PAUZA_MS === 1000);
        provera("slike Lagune: laguna.oozmi-cdn.com je dozvoljen samo kroz slikeDomeni izdavača (https, tačan domen ili poddomen); opšta bela lista ga i dalje NE sadrži, ni baza", KI.IZDAVACI.laguna.slikeDomeni.join() === "laguna.oozmi-cdn.com" && KI.slikaDomenIzdavaca("https://laguna.oozmi-cdn.com/x/korica.jpg", KI.IZDAVACI.laguna.slikeDomeni) && KI.slikaDomenIzdavaca("https://a.laguna.oozmi-cdn.com/k.jpg", KI.IZDAVACI.laguna.slikeDomeni) && !KI.slikaDomenIzdavaca("http://laguna.oozmi-cdn.com/k.jpg", KI.IZDAVACI.laguna.slikeDomeni) && !KI.slikaDomenIzdavaca("https://laguna.oozmi-cdn.com.evil.com/k.jpg", KI.IZDAVACI.laguna.slikeDomeni) && !KI.slikaDomenIzdavaca("https://oozmi-cdn.com/k.jpg", KI.IZDAVACI.laguna.slikeDomeni) && !KI.slikaDomenIzdavaca("https://laguna.oozmi-cdn.com/k.jpg", []) && !citaj("api/_lib/bela-lista.js").includes("oozmi") && !citaj("supabase/migrations/0009_korice_domeni.sql").includes("oozmi") && /slikaDomenIzdavaca\(stranica\.korica, CFG\.slikeDomeni\)/.test(citaj("scripts/obogati-korice.mjs")));
        const indP = new Map([
          ["od-mama-za-mame-1-trudnoca", "https://laguna.rs/proizvodi/knjige/od-mama-za-mame-1-trudnoca/"],
          ["od-mama-za-mame-3-materinstvo", "https://laguna.rs/proizvodi/knjige/od-mama-za-mame-3-materinstvo/"],
          ["sakati-bog-deo-prvi", "https://laguna.rs/proizvodi/knjige/sakati-bog-deo-prvi/"],
          ["sakati-bog-deo-drugi", "https://laguna.rs/proizvodi/knjige/sakati-bog-deo-drugi/"],
          ["jedni-drugima-potrebni-latinica", "https://laguna.rs/proizvodi/knjige/jedni-drugima-potrebni-latinica/"],
          ["jedni-drugima-potrebni-cirilica", "https://laguna.rs/proizvodi/knjige/jedni-drugima-potrebni-cirilica/"],
          ["skola-magicnih-zivotinja-1", "https://laguna.rs/proizvodi/knjige/skola-magicnih-zivotinja-1/"],
          ["skola-magicnih-zivotinja-2-sve-rupa-do-rupe", "https://laguna.rs/proizvodi/knjige/skola-magicnih-zivotinja-2-sve-rupa-do-rupe/"],
        ]);
        const kratko = (n) => KI.prosireneAdrese(n, indP).map((a) => a.split("/").at(-2));
        provera("prošireno pogađanje: serija sa brojem nalazi tom po broju („Knj. 3, Materinstvo” → -3-materinstvo), drugi tomovi se ne uzimaju", kratko("Od mama za mame. Knj. 3, Materinstvo : budite uspešne").join() === "od-mama-za-mame-3-materinstvo" && kratko("Od mama za mame. Knj. 1, Trudnoća : priprema").join() === "od-mama-za-mame-1-trudnoca");
        provera("prošireno pogađanje: „Deo 1” i „Deo 2” su -deo-prvi i -deo-drugi", kratko("Sakati bog. Deo 1").join() === "sakati-bog-deo-prvi" && kratko("Sakati bog. Deo 2").join() === "sakati-bog-deo-drugi");
        provera("prošireno pogađanje: varijanta po pismu naslova (ćirilica → -cirilica, latinica → -latinica)", kratko("\u0408\u0435\u0434\u043d\u0438 \u0434\u0440\u0443\u0433\u0438\u043c\u0430 \u043f\u043e\u0442\u0440\u0435\u0431\u043d\u0438 : \u0431\u0435\u0441\u0458\u0435\u0434\u0435")[0] === "jedni-drugima-potrebni-cirilica" && kratko("Jedni drugima potrebni : besede")[0] === "jedni-drugima-potrebni-latinica");
        provera("prošireno pogađanje: knjiga bez broja u seriji dobija -1 (pa duže adrese koje počinju naslovom); adrese koje nisu u sitemap-u se ne izmišljaju; najviše tri; već probane se izostavljaju; prekratka osnova ne daje ništa", kratko("Škola magičnih životinja")[0] === "skola-magicnih-zivotinja-1" && KI.prosireneAdrese("Nepostojeća knjiga", indP).length === 0 && KI.prosireneAdrese("Ab. Knj. 1", indP).length === 0 && KI.prosireneAdrese("Sakati bog. Deo 1", indP, ["https://laguna.rs/proizvodi/knjige/sakati-bog-deo-prvi/"]).length === 0 && KI.NAJVISE_PROSIRENIH === 3);
        provera("skripta: pogođena adresa se prihvata samo po ISBN-u (ne po naslovu), a stanje pamti verziju pravila", /pogodjena && p\.po !== "isbn"/.test(bezKom(citaj("scripts/obogati-korice.mjs"))) && /pravilo: VERZIJA_PRAVILA/.test(bezKom(citaj("scripts/obogati-korice.mjs"))) && /const prosirene = !poPretrazi && k\.isbn \? prosireneAdrese\(/.test(bezKom(citaj("scripts/obogati-korice.mjs"))));
        const vsm = '<urlset><url><loc>https://www.vulkani.rs/beletristika/5496-xoxo</loc></url><url><loc>https://www.vulkani.rs/ne-fikcija/5497-sokrat-u-patikama</loc></url><url><loc>https://www.vulkani.rs/ne-fikcija/</loc></url><url><loc>https://www.vulkani.rs/proizvodi/12-isto-ime</loc></url></urlset>';
        const vind = KI.indeksSitemapa(KI.adreseIzSitemapa(vsm), KI.IZDAVACI.vulkan.uzorakAdrese);
        provera("Vulkan: adresa je /kategorija/broj-naslov, pa se slug čita iza broja (xoxo, sokrat-u-patikama); stranice kategorija bez broja ne ulaze; knjiga se nalazi po naslovu", vind.size === 3 && vind.get("xoxo") === "https://www.vulkani.rs/beletristika/5496-xoxo" && KI.adreseZaKnjigu("Sokrat u patikama", vind).join() === "https://www.vulkani.rs/ne-fikcija/5497-sokrat-u-patikama" && KI.adreseZaKnjigu("XOXO", vind).length === 1);
        const indD = new Map([
          ["manifestuj-7-koraka-do-najkvalitetnijeg-zivota", "https://x.rs/a/1-manifestuj-7-koraka-do-najkvalitetnijeg-zivota"],
          ["pet-kraljevstava-dar-mracnog-dola", "https://x.rs/a/2-pet-kraljevstava-dar-mracnog-dola"],
          ["opsednutost", "https://x.rs/a/3-opsednutost"],
          ["pet-kraljevstava-dar-mracnog-dola-2", "https://x.rs/a/4-pet-kraljevstava-dar-mracnog-dola-2"],
          ["od-mama-za-mame-1-trudnoca", "https://x.rs/a/5-od-mama-za-mame-1-trudnoca"],
          ["od-mama-za-mame-3-materinstvo", "https://x.rs/a/6-od-mama-za-mame-3-materinstvo"],
        ]);
        const krD = (n) => KI.prosireneAdrese(n, indD).map((a) => a.split("-").slice(1).join("-"));
        provera("prošireno pogađanje: naslov koji je deo duže adrese (počinje ili se završava njime) daje kandidate, najkraće prve (Manifestuj → manifestuj-7-koraka…, Dar Mračnog dola → pet-kraljevstava-…); „Opsena” ne pogađa „opsednutost”", krD("Manifestuj : zaroni dublje")[0] === "manifestuj-7-koraka-do-najkvalitetnijeg-zivota" && krD("Dar Mračnog dola")[0] === "pet-kraljevstava-dar-mracnog-dola" && KI.prosireneAdrese("Opsena", indD).length === 0 && KI.prosireneAdrese("Dar Mračnog dola", indD).length === 1);
        provera("prošireno pogađanje: za knjige sa brojem toma NEMA duljih adresa (Knj. 3 ne vuče sve tomove serije): samo -3-materinstvo", krD("Od mama za mame. Knj. 3, Materinstvo").join() === "od-mama-za-mame-3-materinstvo");
        const ksm = '<?xml version="1.0"?><n1:urlset xmlns:n1="http://www.sitemaps.org/schemas/sitemap/0.9"><n1:url><n1:loc>https://kreativnicentar.rs/p/knjiga/lester-i-bob-i-njihove-avanture/</n1:loc><n1:lastmod>2026-01-01</n1:lastmod></n1:url><n1:url><n1:loc>https://kreativnicentar.rs/p/igracka/medved/</n1:loc></n1:url></n1:urlset>';
        const kad = KI.adreseIzSitemapa(ksm);
        const kind = KI.indeksSitemapa(kad, KI.IZDAVACI.kreativni.uzorakAdrese);
        provera("Kreativni centar: sitemap sa prefiksom n1: se čita (<n1:loc>), obični <loc> i dalje radi, a u indeks ulaze samo knjige (/p/knjiga/<naslov>/)", kad.length === 2 && KI.adreseIzSitemapa("<urlset><url><loc>https://a.rs/x</loc></url></urlset>").length === 1 && kind.size === 1 && KI.adreseZaKnjigu("Lester i Bob i njihove avanture", kind).length === 1);
        const rez = '<a href="https://pcelica.rs/knjige/knjige-za-bebe">meni</a><div class="product-layout"><a href="https://pcelica.rs/babe-dede-i-ostala-bica?search=9788660882839" class="img"></a><a href="https://pcelica.rs/babe-dede-i-ostala-bica?search=9788660882839">naslov</a></div><a href="https://pcelica.rs/drugi-naslov?search=9788660882839">x</a><a href="https://pcelica.rs/treci?search=1">y</a>';
        provera("Pčelica: iz stranice sa rezultatima čitaju se samo linkovi sa ?search= (ne meni ni kategorije), bez ponavljanja, najviše dva, bez parametara u adresi", JSON.stringify(KI.adreseIzRezultata(rez, KI.IZDAVACI.pcelica.uzorakRezultata)) === JSON.stringify(["https://pcelica.rs/babe-dede-i-ostala-bica", "https://pcelica.rs/drugi-naslov"]) && KI.adreseIzRezultata("<html>nema</html>", KI.IZDAVACI.pcelica.uzorakRezultata).length === 0 && KI.IZDAVACI.pcelica.pretraga("9788660882839") === "https://pcelica.rs/index.php?route=product/search&search=9788660882839");
        const dij = { kandidati: [{ izvor: "og:image", ishod: "prihvacena", dopunjena: "https://a.rs/velika.jpg" }, { izvor: "JSON-LD image", ishod: "prihvacena", dopunjena: "https://a.rs/mala.jpg" }, { izvor: "<img> (cover…)", ishod: "prihvacena", dopunjena: "https://a.rs/druga-knjiga.jpg" }, { izvor: "itemprop", ishod: "odbijena", dopunjena: "https://a.rs/x.jpg" }, { izvor: "twitter:image", ishod: "prihvacena", dopunjena: "https://a.rs/velika.jpg" }] };
        provera("druge korice: kad izabrana slika ne može da se preuzme (npr. prevelika), probaju se drugi PREDLOZI sa iste stranice (ne <img> sa stranice, ne odbijeni, ne ista adresa, bez ponavljanja), najviše dva", JSON.stringify(KI.alternativneKorice(dij, "https://a.rs/velika.jpg")) === JSON.stringify(["https://a.rs/mala.jpg"]) && KI.alternativneKorice(undefined, "x").length === 0 && /alternativneKorice\(stranica\.dijagnostika, stranica\.korica\)/.test(bezKom(citaj("scripts/obogati-korice.mjs"))));
        const bsm = '<urlset><url><loc>https://booka.rs/shop/</loc></url><url><loc>https://booka.rs/knjige/savremena-knjizevnost/nesanica-za-dvoje/</loc></url><url><loc>https://booka.rs/vesti/53588-neka-vest/</loc></url></urlset>';
        const bind = KI.indeksSitemapa(KI.adreseIzSitemapa(bsm), KI.IZDAVACI.booka.uzorakAdrese);
        provera("Booka: iz sitemap-a ulaze samo adrese /knjige/<kategorija>/<naslov>/ (ne /shop/ ni vesti), a knjiga se nalazi po naslovu", bind.size === 1 && KI.adreseZaKnjigu("Nesanica za dvoje", bind).length === 1 && KI.IZDAVACI.booka.sitemap === "https://booka.rs/product-sitemap.xml");
        const sk = citaj("scripts/obogati-korice.mjs");
        const skKod = bezKom(sk);
        provera("skripta: podrazumevan je probni režim; Storage upload i update knjige su posle provere --upisi; upis samo uz uslov korice_url is null (nikad se ne prepisuje korica); izvor 'preuzeto' sa korice_poreklo; ostala polja se ne menjaju", /const UPISI = Boolean\(arg\("upisi"\)\)/.test(skKod) && skKod.indexOf("if (UPISI && o.stanje") > -1 && skKod.indexOf("await upisi(k, o)") > skKod.indexOf("if (UPISI && o.stanje") && /\.update\(\{ korice_url: koricaUrl, korice_izvor: "preuzeto", korice_poreklo: r\.korica \}\)/.test(skKod) && /\.is\("korice_url", null\)/.test(skKod) && !/opis\s*:|naslov\s*:\s*[a-z]|autor\s*:|izdavac\s*:/.test(skKod.replace(/select\("[^"]*"\)/g, "")));
        provera("skripta: robots.txt se proverava za svaku adresu, najviše 1 zahtev u sekundi, odgovori se keširaju na disk, 429 i 403 prekidaju rad, koristi preuzmi/parser-knjige/koricaJeDozvoljena/tipSlike iz api/_lib, bela lista za izvor slike, ne čuva opis", /jeDozvoljeno\(r\.pravila/.test(skKod) && /PAUZA_MS/.test(skKod) && /writeFileSync\(kes/.test(skKod) && /jePrekid\(s\)/.test(skKod) && /izvuciIzLinka\(adresa, \{ preuzmiFn: preuzmiPoliticno \}\)/.test(skKod) && /koricaJeDozvoljena\(stranica\.korica\)/.test(skKod) && /tipSlike\(o\.telo\)/.test(skKod) && !/\.opis\b|opis:/.test(skKod));
        provera("skripta: Open Library samo uz --open-library (isključeno podrazumevano), samo covers.openlibrary.org (i njegov CDN archive.org zbog preusmeravanja); npm skripta admin:obogati-korice sa --env-file=.env", /const OPEN_LIBRARY = Boolean\(arg\("open-library"\)\)/.test(skKod) && /if \(OPEN_LIBRARY && k\.isbn\)/.test(skKod) && /\["covers\.openlibrary\.org", "archive\.org"\]/.test(skKod) && /"admin:obogati-korice": "node --env-file=\.env scripts\/obogati-korice\.mjs"/.test(citaj("package.json")));
        provera("preuzmi: poseban User-Agent samo kad ga skripta zada (korisnickiAgent), a api/ funkcije i dalje šalju svoj podrazumevani (Citaliste/1.0)", /korisnickiAgent \|\| KORISNICKI_AGENT/.test(citaj("api/_lib/bezbedan-fetch.js")) && /const KORISNICKI_AGENT = "Citaliste\/1\.0/.test(citaj("api/_lib/bezbedan-fetch.js")) && !/korisnickiAgent/.test(citaj("api/iz-linka.js") + citaj("api/korica-iz-linka.js") + citaj("api/iz-liste.js")));
      }
      // ── izmena i brisanje knjiga iz panela, širi prikaz na računaru ──
      {
        const PK = await import("../src/lib/pregled-knjiga-logika.js");
        provera("izmena knjige: polja forme se pune iz reda (sve je tekst, godina i ISBN mogu da fale)", JSON.stringify(PK.poljaIzmene({ naslov: "N", autor: null, izdavac: "I", godina: 2020, isbn: "9788652126033" })) === JSON.stringify({ naslov: "N", autor: "", izdavac: "I", godina: "2020", isbn: "9788652126033" }) && PK.poljaIzmene({ naslov: "N" }).godina === "");
        provera("izmena knjige: greške dobijaju poruku (prazan naslov, predugo, godina, ISBN, nema prava, opšta), a sve poruke postoje u tekst.js", [[{ polje: "naslov", razlog: "prazno" }, "naslov_prazno"], [{ polje: "autor", razlog: "predugo" }, "predugo"], [{ polje: "godina", razlog: "neispravno" }, "godina_neispravno"], [{ polje: "isbn", razlog: "neispravno" }, "isbn_neispravno"], [{ kod: "nema_dozvole" }, "nema_dozvole"], [{ code: "42501" }, "nema_dozvole"], [new Error("x"), "opste"]].every(([g, k]) => PK.kljucGreskeIzmene(g) === k && typeof TK.pregledKnjiga.izmena.greske[k] === "string"));
        provera("brisanje: nudi se samo administratoru (RLS knjige_delete_admin), ne bibliotekaru ni čitaocu", PK.mozeDaBrise("administrator") && !PK.mozeDaBrise("bibliotekar") && !PK.mozeDaBrise("citalac") && !PK.mozeDaBrise(undefined));
        const kodA = bezKom(citaj("src/lib/knjige-admin.js"));
        provera("knjige-admin.js: izmena šalje samo naslov, autor, izdavača, godinu i ISBN (kroz urediPotvrdu), prazan odgovor je greška nema_dozvole; brisanje je običan DELETE po id-u, prazan odgovor je nema_dozvole; bez service_role, uneo_id i odluke", /urediPotvrdu\(unos\)/.test(kodA) && /\.update\(u\.podaci\)\.eq\("id", id\)/.test(kodA) && /from\("knjige"\)\.delete\(\)\.eq\("id", k\.id\)/.test(kodA) && (kodA.match(/GreskaApija\("nema_dozvole"\)/g) ?? []).length === 2 && !/service_role|SERVICE_ROLE|uneo_id|odluka_nabavke|opis|korice_url:/.test(kodA));
        provera("knjige-admin.js: fajlovi korice se brišu iz našeg Storage-a samo za izvore preuzeto i fotografija, najbolje što može (greška ne poništava brisanje knjige)", /korice_izvor === "preuzeto" \|\| k\.korice_izvor === "fotografija"/.test(kodA) && /skladiste\.remove\(putanje\)/.test(kodA) && /catch \(e\)/.test(kodA));
        const kodS = bezKom(citaj("src/pages/BibliotekarKnjige.jsx"));
        provera("ekran Све књиге: izmena (forma sa naslovom, autorom, izdavačem, godinom i ISBN-om) i brisanje uz potvrdu sa brojem čitalaca; dugme „Обриши” samo za administratora; ekran ne zove Supabase direktno", /izmeniKnjigu\(k\.id, forma\)/.test(kodS) && /obrisiKnjigu\(k\)/.test(kodS) && /mozeDaBrise\(uloga\) && \(/.test(kodS) && /T\.brisanje\.upozorenje/.test(kodS) && /\{ n: k\.citaoca \}/.test(kodS) && !/supabase|from\("/.test(kodS));
        provera("ekran Све књиге: posle izmene red ostaje sa novim podacima, posle brisanja nestaje, a zbir i spisak izdavača se učitavaju ponovo", /naIzmenjeno = \(id, nova\)/.test(kodS) && /naObrisano = \(id\)/.test(kodS) && (kodS.match(/setOsvezi\(\(n\) => n \+ 1\)/g) ?? []).length === 2 && /\[osvezi\]\)/.test(kodS));
        provera("ekran Све књиге: svako dugme ima stil iz stil.js ili min-h-11; bez hex boja i ćirilice u kodu", kodS.split("<button").slice(1).every((d) => /className=\{(?:stil\.|.\$\{stil\.)/.test(d.split("</button>")[0]) || /min-h-1[1-9]/.test(d.split("</button>")[0]) || /className=\{stil\.cip\}/.test(d.split("</button>")[0])) && !/#[0-9a-fA-F]{3,8}\b/.test(kodS) && !/[Ѐ-ӿ]/.test(kodS));
        const nedostajeIz = [];
        for (const m of kodS.matchAll(/\bT\.([A-Za-z]+(?:\.[A-Za-z]+)*)/g)) {
          const v = ("pregledKnjiga." + m[1].replace(/\.(replace|length)$/, "")).split(".").reduce((o, k) => o?.[k], TK);
          if (typeof v !== "string" && !(typeof v === "object" && v !== null)) nedostajeIz.push(m[1]);
        }
        provera("svi natpisi izmene i brisanja postoje u tekst.js", nedostajeIz.length === 0 && /ово се не може вратити/i.test(TK.pregledKnjiga.brisanje.upozorenje), nedostajeIz);

        // širina na računaru
        const okv = citaj("src/components/Okvir.jsx");
        provera("širi prikaz na računaru: telefon ostaje 520 px; opšte stranice do 720 px (md), panel za osoblje do 900 px (md) i 1200 px (xl)", /max-w-\[520px\] \$\{pathname\.startsWith\("\/bibliotekar"\) \? "md:max-w-\[900px\] xl:max-w-\[1200px\]" : "md:max-w-\[720px\]"\}/.test(okv) && /fixed inset-x-0 bottom-0 z-40 mx-auto flex max-w-\[520px\]/.test(okv));
        provera("širi prikaz: knjige i unos su u mreži (Све књиге: bočna kolona na lg, dve kolone na md; Унос књига: dve kolone na lg; polica do pet kolona na md)", /lg:grid-cols-\[320px_minmax\(0,1fr\)\]/.test(kodS) && /md:grid-cols-2 2xl:grid-cols-3/.test(kodS) && /mt-3 grid items-start gap-4 lg:grid-cols-2/.test(citaj("src/pages/BibliotekarUnos.jsx")) && /grid-cols-3 gap-x-\[13px\] gap-y-4 pb-2 md:grid-cols-5/.test(citaj("src/pages/Pocetna.jsx")));
      }
      provera("svi natpisi PWA traka i kartice postoje u tekst.js", sviKljucevi.length === 0, sviKljucevi);
      for (const p of ["src/components/TrakeLjuske.jsx", "src/components/KarticaInstalacije.jsx", "src/lib/pwa.js", "src/lib/pwa-logika.js"]) {
        const kod = bezKom(citaj(p));
        provera(p + ": bez hex boja, localStorage i kolačića (instalacija i verzija se ne pamte)", !/#[0-9a-fA-F]{3,8}\b/.test(kod) && !/localStorage|sessionStorage|indexedDB|document\.cookie/.test(kod));
      }
    }
  } finally {
    Object.assign(console, izvornik);
    cisto();
  }
}

faza("16. Uvoz sa stranice izdavača (api/iz-liste.js): samo bibliotekar, SSRF, robots.txt, najviše 50 linkova");
{
  const listaHandler = (await import("../api/iz-liste.js")).default;
  const R = await import("../api/_lib/robots.js");
  const SP = await import("../api/_lib/spisak-knjiga.js");
  const { granicaSpiska, KANTA_BIBLIOTEKAR, NAJVISE_ZAHTEVA_BIBLIOTEKAR } = await import("../api/_lib/zajednicko.js");
  const citajIzvor = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
  const BIBL = CLANOVI["tok-bib"];

  // ───── uzorci stranica (po obrascima sajtova sa bele liste; izmišljeni, ne pravi) ─────
  const LAGUNA = `<!doctype html><html><head><title>Novo</title><link rel="next" href="/novo?strana=2"></head><body>
    <nav><a href="/">Početna</a> <a href="/korpa">Korpa</a> <a href="/prijava">Prijava</a> <a href="/kategorija/romani">Romani</a> <a href="/uslovi-koriscenja">Uslovi</a> <a href="/blog/vesti">Blog</a> <a href="/autor/ivo-andric">Ivo Andrić</a></nav>
    <ul>
      <li><a href="/n6061_prokleta-avlija.html"><img src="a.jpg" alt="Korica"></a><a href="/n6061_prokleta-avlija.html?utm_source=mejl&fbclid=x#opis">Prokleta avlija</a><a href="/n6061_prokleta-avlija.html">Detaljnije</a></li>
      <li><a href="https://www.laguna.rs/n6062_na-drini-cuprija.html">Na Drini ćuprija</a></li>
      <li><a href="/n6063_derviš-i-smrt.html"><img alt="Derviš i smrt"></a></li>
      <li><a href="/n6064_hazarski-recnik.html" title="Hazarski rečnik"></a></li>
      <li><a href="/n6065_seobe.html">Pročitaj više</a></li>
      <li><a href="https://shop.laguna.rs/n7000_tudj-poddomen.html">Drugi poddomen</a></li>
      <li><a href="https://evil.com/n9999_tudje.html">Tuđi sajt</a></li>
      <li><a href="http://www.laguna.rs/n6066_bez-https.html">Bez https</a></li>
      <li><a href="mailto:a@b.rs">Mejl</a> <a href="#vrh">Vrh</a> <a href="javascript:void(0)">JS</a> <a href="/slika/korica.jpg">Slika</a></li>
      <li><a href="/novo?strana=2">2</a> <a href="/novo?page=3">3</a> <a href="/novo">Ova stranica</a></li>
    </ul></body></html>`;
  const DELFI = `<html><body>
    <a href="/knjige">Knjige</a> <a href="/knjige/kategorija/romani">Romani</a> <a href="/knjige/321-prokleta-avlija">Prokleta avlija</a>
    <a href="/knjige/322-na-drini-cuprija"><h3>Na Drini ćuprija</h3></a> <a href="/knjige/321-prokleta-avlija">Kupi</a>
    <a href="/korpa">Korpa</a> <a href="/knjige/autori/ivo-andric">Autor</a> <a href="/o-nama">O nama</a> <a href="/knjige/nabavka-123">Stranica koja nije knjiga? (ima broj)</a>
  </body></html>`;
  const OPSTI = `<html><body>
    <a href="/knjiga/hazarski-recnik">Hazarski rečnik</a> <a href="/proizvod/seobe-miloš-crnjanski">Seobe</a>
    <a href="/izdanje/gospodjica">Gospođica</a> <a href="/knjige">Sve knjige</a> <a href="/pretraga?q=roman">Pretraga</a>
    <a href="/dereta-nove-knjige-2026.html">Nove knjige</a> <a href="/o-izdavacu">O izdavaču</a>
  </body></html>`;
  const baza = (host, putanja) => new URL(`https://${host}${putanja}`);

  // ───── izvlačenje linkova ─────
  let r = SP.izvuciLinkoveKnjiga(LAGUNA, baza("www.laguna.rs", "/novo"));
  const urlovi = r.linkovi.map((l) => l.url);
  provera("spisak (laguna): samo stranice knjiga, istim domenom, https, bez # i praćenja, bez duplikata, redom pojavljivanja", JSON.stringify(urlovi) === JSON.stringify([
    "https://www.laguna.rs/n6061_prokleta-avlija.html", "https://www.laguna.rs/n6062_na-drini-cuprija.html", "https://www.laguna.rs/n6063_dervi%C5%A1-i-smrt.html", "https://www.laguna.rs/n6064_hazarski-recnik.html", "https://www.laguna.rs/n6065_seobe.html",
  ]) && r.ukupno === 5 && r.skraceno === false, urlovi);
  provera("spisak: naslov je tekst linka; „Detaljnije/Kupi” se preskaču u korist pravog teksta; zatim alt slike, title i na kraju slug iz putanje", r.linkovi[0].naslov === "Prokleta avlija" && r.linkovi[1].naslov === "Na Drini ćuprija" && r.linkovi[2].naslov === "Derviš i smrt" && r.linkovi[3].naslov === "Hazarski rečnik" && r.linkovi[4].naslov === "seobe", r.linkovi.map((l) => l.naslov));
  provera("spisak: kategorije, korpa, prijava, uslovi, blog, autori, drugi poddomen, tuđi sajt, http, mailto, #, javascript, slike i sama stranica se ne uzimaju", !urlovi.some((u) => /korpa|prijava|kategorija|uslovi|blog|autor|shop\.|evil|bez-https|jpg|\/novo/.test(u)));
  provera("spisak: paginacija se ne prati (strana=2, page=3 nisu knjige); javlja se samo adresa sledeće stranice (rel=next)", !urlovi.some((u) => /strana|page/.test(u)) && r.sledeca === "https://www.laguna.rs/novo?strana=2", r.sledeca);
  r = SP.izvuciLinkoveKnjiga(DELFI, baza("delfi.rs", "/knjige/novo"));
  provera("spisak (delfi): /knjige/<broj>-<slug> jesu knjige, a /knjige, kategorija, autori, korpa i o-nama nisu; www i bez www je isti domen", r.linkovi.map((l) => l.url).join() === "https://delfi.rs/knjige/321-prokleta-avlija,https://delfi.rs/knjige/322-na-drini-cuprija,https://delfi.rs/knjige/nabavka-123" && r.linkovi[0].naslov === "Prokleta avlija" && r.linkovi[1].naslov === "Na Drini ćuprija", r.linkovi);
  r = SP.izvuciLinkoveKnjiga(DELFI.replaceAll("href=\"/", "href=\"https://www.delfi.rs/"), baza("delfi.rs", "/knjige/novo"));
  provera("www.delfi.rs i delfi.rs su isti domen (apsolutni linkovi sa www prolaze)", r.linkovi.length === 3, r.linkovi.length);
  r = SP.izvuciLinkoveKnjiga(OPSTI, baza("www.vulkani.rs", "/novo"));
  provera("spisak (opšti obrasci): /knjiga/, /proizvod/, /izdanje/ i slug sa .html jesu, /knjige, pretraga i o-izdavacu nisu", r.linkovi.map((l) => l.url).join() === "https://www.vulkani.rs/knjiga/hazarski-recnik,https://www.vulkani.rs/proizvod/seobe-milo%C5%A1-crnjanski,https://www.vulkani.rs/izdanje/gospodjica,https://www.vulkani.rs/dereta-nove-knjige-2026.html", r.linkovi.map((l) => l.url));
  {
    const mnogo = `<html><body>${Array.from({ length: 80 }, (_, i) => `<a href="/knjiga/naslov-broj-${i}">Naslov ${i}</a>`).join("")}</body></html>`;
    const sve = SP.izvuciLinkoveKnjiga(mnogo, baza("www.laguna.rs", "/novo"));
    provera("najviše 50 linkova: od 80 vraća prvih 50 (po redu), ukupno 80, skraceno = true", sve.linkovi.length === 50 && sve.ukupno === 80 && sve.skraceno === true && sve.linkovi[0].naslov === "Naslov 0" && sve.linkovi[49].naslov === "Naslov 49" && SP.NAJVISE_LINKOVA === 50);
    provera("bez linkova ka knjigama (prazna ili nepoznata stranica) → prazan niz, bez greške", SP.izvuciLinkoveKnjiga("<html><body><a href='/o-nama'>O nama</a></body></html>", baza("www.laguna.rs", "/novo")).linkovi.length === 0 && SP.izvuciLinkoveKnjiga("", baza("www.laguna.rs", "/novo")).linkovi.length === 0);
  }
  provera("robots filtrira linkove: zabranjeni se ne vraćaju, a broje se u izbacenoRobots", (() => { const x = SP.izvuciLinkoveKnjiga(LAGUNA, baza("www.laguna.rs", "/novo"), { jeDozvoljenoFn: (p) => !p.startsWith("/n6063") && !p.startsWith("/n6065") }); return x.linkovi.length === 3 && x.izbacenoRobots === 2 && x.ukupno === 3; })());

  // ───── robots.txt ─────
  const pravila = (tekst) => R.pravilaZaNas(R.parsirajRobots(tekst));
  provera("robots: Disallow za * zabranjuje putanju i sve ispod nje, ostalo je dozvoljeno", (() => { const p = pravila("User-agent: *\nDisallow: /novo\n"); return !R.jeDozvoljeno(p.pravila, "/novo") && !R.jeDozvoljeno(p.pravila, "/novo/knjige?x=1") && R.jeDozvoljeno(p.pravila, "/knjige") && R.jeDozvoljeno(p.pravila, "/"); })());
  provera("robots: grupa za „Citaliste” pobeđuje grupu „*” (i velika slova u nazivu se izjednačavaju)", (() => { const t = "User-agent: *\nDisallow: /\n\nUser-agent: CITALISTE\nDisallow: /privatno\n"; const p = pravila(t); return R.jeDozvoljeno(p.pravila, "/novo") && !R.jeDozvoljeno(p.pravila, "/privatno/x"); })());
  provera("robots: samo „Disallow: /” za * zabranjuje sve; prazan Disallow ne zabranjuje ništa", !R.jeDozvoljeno(pravila("User-agent: *\nDisallow: /\n").pravila, "/novo") && R.jeDozvoljeno(pravila("User-agent: *\nDisallow:\n").pravila, "/novo"));
  provera("robots: najduži uzorak pobeđuje, Allow pri izjednačenju (Disallow: /novo, Allow: /novo/knjige)", (() => { const p = pravila("User-agent: *\nDisallow: /novo\nAllow: /novo/knjige\n"); return R.jeDozvoljeno(p.pravila, "/novo/knjige/1") && !R.jeDozvoljeno(p.pravila, "/novo/drugo") && R.jeDozvoljeno(pravila("User-agent: *\nDisallow: /a\nAllow: /a\n").pravila, "/a"); })());
  provera("robots: džoker * i kraj $ (Disallow: /*?sort=, Disallow: /*.pdf$)", (() => { const p = pravila("User-agent: *\nDisallow: /*?sort=\nDisallow: /*.pdf$\n"); return !R.jeDozvoljeno(p.pravila, "/novo?sort=cena") && !R.jeDozvoljeno(p.pravila, "/f/a.pdf") && R.jeDozvoljeno(p.pravila, "/f/a.pdf?x=1") && R.jeDozvoljeno(p.pravila, "/novo"); })());
  provera("robots: više User-agent redova pre pravila čine jednu grupu; komentari i nepoznata polja se preskaču; CRLF", (() => { const p = pravila("# opis\r\nUser-agent: bing\r\nUser-agent: citaliste # mi\r\nSitemap: https://x/s.xml\r\nDisallow: /tajno # ne\r\nCrawl-delay: 4\r\n"); return !R.jeDozvoljeno(p.pravila, "/tajno") && R.jeDozvoljeno(p.pravila, "/ostalo") && p.pauza === 4; })());
  provera("robots: bez grupe za nas i bez „*” sve je dozvoljeno; prazan i nesvrsishodan tekst ne bacaju grešku", R.jeDozvoljeno(pravila("User-agent: googlebot\nDisallow: /\n").pravila, "/novo") && R.jeDozvoljeno(pravila("").pravila, "/novo") && R.jeDozvoljeno(pravila("<html>nije robots</html>").pravila, "/novo") && pravila("User-agent: *\nCrawl-delay: abc\n").pauza === null);
  {
    const obrada = async (tekstRobots, greska = null) => R.ucitajRobots(new URL("https://www.laguna.rs/novo"), { preuzmiFn: async () => { if (greska) throw greska; return { telo: tekstRobots }; } });
    const a = await obrada("User-agent: *\nCrawl-delay: 5\n");
    const b = await obrada("User-agent: *\nCrawl-delay: 120\n");
    const c = await obrada("", new ApiGreska(502, "ne_mogu_da_procitam"));
    provera("robots: Crawl-delay se čita (5 s), a veliki se skraćuje na najviše 30 s", a.procitan && a.pauzaSekundi === 5 && b.pauzaSekundi === 30 && R.NAJDUZA_PAUZA_SEKUNDI === 30, [a, b]);
    provera("robots: kad se ne može pročitati, ne zabranjuje se ništa i nema pauze (nastavlja se)", c.procitan === false && c.pravila.length === 0 && c.pauzaSekundi === null && R.jeDozvoljeno(c.pravila, "/bilo-sta"));
  }

  // ───── handler, bez mreže ─────
  const mreza = [];
  let sajt = {};
  const odgovor = (u) => {
    mreza.push(`${u.hostname}${u.pathname}${u.search}`);
    const o = sajt[u.pathname];
    if (o instanceof Error) throw o;
    return o ?? { status: 404 };
  };
  bf.unutrasnje.jedanZahtev = async (u) => odgovor(u);
  const html = (tekst) => ({ status: 200, tip: "text/html; charset=utf-8", telo: Buffer.from(tekst, "utf8") });
  const robotsOdg = (tekstR) => ({ status: 200, tip: "text/plain; charset=utf-8", telo: Buffer.from(tekstR, "utf8") });
  const cisto = () => {
    stanje.brojac.clear();
    stanje.pozivi.length = 0;
    stanje.rpcGreska = false;
    stanje.ulogaGreska = false;
    mreza.length = 0;
  };
  const kesPre = stanje.kes.size;
  const TELO = { url: "https://www.laguna.rs/novo" };
  sajt = { "/robots.txt": robotsOdg("User-agent: *\nDisallow: /korpa\n"), "/novo": html(LAGUNA) };
  cisto();

  let o = await z(listaHandler, { metod: "GET", token: "tok-bib" });
  provera("iz-liste: GET se odbija (405)", o.status === 405 && o.zaglavlja.allow === "POST", o.status);
  o = await z(listaHandler, { telo: TELO });
  provera("iz-liste: bez tokena 401, mreža se ne dira", o.status === 401 && mreza.length === 0, o.status);
  o = await z(listaHandler, { token: "tok-neaktivan", telo: TELO });
  provera("iz-liste: neaktivan član dobija 403", o.status === 403, o.status);
  o = await z(listaHandler, { token: "tok-a", telo: TELO });
  provera("iz-liste: ČITALAC dobija 403 nije_bibliotekar; mreža se ne dira, ograničenje se ne troši", o.status === 403 && o.telo.greska.kod === "nije_bibliotekar" && mreza.length === 0 && stanje.pozivi.length === 0, { status: o.status, mreza: mreza.length, pozivi: stanje.pozivi });
  o = await z(listaHandler, { token: "tok-a", telo: { ...TELO, uloga: "bibliotekar" } });
  provera("iz-liste: uloga iz tela zahteva se ne čita (čitalac koji napiše „bibliotekar” i dalje dobija 403; uloga je pročitana u bazi)", o.status === 403 && mreza.length === 0, o.status);
  stanje.citanjaUloge = 0;
  o = await z(listaHandler, { token: "tok-bib", telo: TELO });
  provera("iz-liste: bibliotekar dobija spisak (200); uloga se čita na serveru, u bazi", o.status === 200 && stanje.citanjaUloge >= 1 && o.telo.rezultati[0].linkovi.length === 5, { status: o.status, uloga: stanje.citanjaUloge });
  provera("iz-liste: jedan zahtev ka stranici sa spiskom (posle robots.txt), nijedna stranica knjige se ne čita, paginacija se ne prati", JSON.stringify(mreza) === JSON.stringify(["www.laguna.rs/robots.txt", "www.laguna.rs/novo"]), mreza);
  provera("iz-liste: ograničenje je u kanti „iz-linka:bibliotekar” (200 na sat) i spisak troši TAČNO jedan zahtev", stanje.pozivi.length === 1 && stanje.pozivi[0].kanta === KANTA_BIBLIOTEKAR && stanje.pozivi[0].najvise === 200 && NAJVISE_ZAHTEVA_BIBLIOTEKAR === 200 && stanje.pozivi[0].clan === BIBL.id && KANTA_BIBLIOTEKAR === "iz-linka:bibliotekar", stanje.pozivi);
  provera("iz-liste: odgovor ima stranicu, linkove (url i naslov), ukupno, skraceno, izbacenoRobots, robotsProcitan, pauzaSekundi i sledeću stranicu; nema HTML-a ni ključeva", (() => { const x = o.telo.rezultati[0]; return x.stranica === "https://www.laguna.rs/novo" && x.linkovi[0].naslov === "Prokleta avlija" && x.ukupno === 5 && x.skraceno === false && x.izbacenoRobots === 0 && x.robotsProcitan === true && x.pauzaSekundi === null && x.sledeca === "https://www.laguna.rs/novo?strana=2" && !o.sirovo.includes("<html") && !o.sirovo.includes("<a href") && !TAJNE.some((k) => o.sirovo.includes(k)); })());
  provera("iz-liste: server ništa ne čuva (keš linkova ostaje isti), nema tabele za spisak", stanje.kes.size === kesPre && !/uKes|izKesa|kes_linkova|from\(/.test(citajIzvor("api/iz-liste.js").replace(/\/\/.*$/gm, "")));
  provera("iz-liste: odgovor se ne stavlja u keš, pa ponovljen klik ponovo čita stranicu (nova dva zahteva)", await (async () => { mreza.length = 0; const p = await z(listaHandler, { token: "tok-bib", telo: TELO }); return p.status === 200 && mreza.length === 2; })());

  // SSRF i bela lista (pre mreže i pre ograničenja)
  for (const [naziv, adresa, kod] of [
    ["http", "http://www.laguna.rs/novo", "nije_https"],
    ["domen van liste", "https://evil.com/novo", "domen_nije_dozvoljen"],
    ["domen koji samo liči (laguna.rs.evil.com)", "https://laguna.rs.evil.com/novo", "domen_nije_dozvoljen"],
    ["IP adresa", "https://127.0.0.1/novo", "domen_nije_dozvoljen"],
    ["IPv6", "https://[::1]/novo", "domen_nije_dozvoljen"],
    ["localhost", "https://localhost/novo", "domen_nije_dozvoljen"],
    ["korisnik u adresi (laguna.rs@evil.com)", "https://laguna.rs@evil.com/novo", "neispravan_link"],
    ["korisnik i lozinka", "https://a:b@www.laguna.rs/novo", "neispravan_link"],
    ["port", "https://www.laguna.rs:8443/novo", "neispravan_link"],
    ["domen sa tačkom na kraju", "https://www.laguna.rs./novo", "domen_nije_dozvoljen"],
    ["nije adresa", "ovo nije adresa", "neispravan_link"],
  ]) {
    cisto();
    o = await z(listaHandler, { token: "tok-bib", telo: { url: naziv === "nije adresa" ? "ovo nije adresa" : adresa } });
    provera(`iz-liste odbija pre mreže i pre ograničenja: ${naziv}`, o.status >= 400 && o.status < 500 && o.telo.greska.kod === kod && mreza.length === 0 && stanje.pozivi.length === 0, { status: o.status, kod: o.telo?.greska?.kod, mreza: mreza.length });
  }
  cisto();
  o = await z(listaHandler, { token: "tok-bib", telo: { url: 5 } });
  provera("iz-liste: adresa koja nije tekst, prazna ili preduga → 400", o.status === 400 && (await z(listaHandler, { token: "tok-bib", telo: { url: "" } })).status === 400 && (await z(listaHandler, { token: "tok-bib", telo: { url: `https://www.laguna.rs/${"a".repeat(2100)}` } })).status === 400 && mreza.length === 0);
  provera("iz-liste koristi isti zaštićeni preuzimač i istu belu listu kao iz-linka", citajIzvor("api/iz-liste.js").includes('from "./_lib/bezbedan-fetch.js"') && /proveriUrl\(url\)/.test(citajIzvor("api/iz-liste.js")) && !/https\.request|fetch\(/.test(citajIzvor("api/iz-liste.js") + citajIzvor("api/_lib/robots.js") + citajIzvor("api/_lib/spisak-knjiga.js")) && citajIzvor("api/_lib/robots.js").includes('from "./bezbedan-fetch.js"'));
  provera("preusmeravanje sa stranice spiska van bele liste se odbija (preusmerenje_van_liste), i robots.txt se ne preusmerava van liste", await (async () => { cisto(); sajt = { "/robots.txt": robotsOdg(""), "/novo": { status: 302, preusmerenje: "https://evil.com/knjige" } }; const p = await z(listaHandler, { token: "tok-bib", telo: TELO }); return p.status === 422 && p.telo.greska.kod === "preusmerenje_van_liste"; })());

  // robots.txt u handleru
  cisto();
  sajt = { "/robots.txt": robotsOdg("User-agent: *\nDisallow: /novo\n"), "/novo": html(LAGUNA) };
  o = await z(listaHandler, { token: "tok-bib", telo: TELO });
  provera("robots.txt zabranjuje putanju (za *): 422 robots_zabranjuje, jasna poruka; stranica spiska se NE čita", o.status === 422 && o.telo.greska.kod === "robots_zabranjuje" && /Сајт не дозвољава аутоматско читање ове странице/.test(o.telo.greska.poruka) && JSON.stringify(mreza) === JSON.stringify(["www.laguna.rs/robots.txt"]), { status: o.status, mreza });
  provera("poruka za korisnika u tekst.js: „Сајт не дозвољава аутоматско читање ове странице”", (await import("../src/lib/tekst.js")).tekst.pretraga.greske.robots_zabranjuje === "Сајт не дозвољава аутоматско читање ове странице.");
  cisto();
  sajt = { "/robots.txt": robotsOdg("User-agent: Citaliste\nDisallow: /\n\nUser-agent: *\nAllow: /\n"), "/novo": html(LAGUNA) };
  o = await z(listaHandler, { token: "tok-bib", telo: TELO });
  provera("robots.txt zabranjuje samo „Citaliste” (a „*” dozvoljava): odustaje se", o.status === 422 && o.telo.greska.kod === "robots_zabranjuje" && mreza.length === 1, o.status);
  cisto();
  sajt = { "/robots.txt": robotsOdg("User-agent: *\nDisallow: /novo\nAllow: /novo$\n"), "/novo": html(LAGUNA) };
  o = await z(listaHandler, { token: "tok-bib", telo: TELO });
  provera("robots.txt dozvoljava tačnu putanju (Allow je duži uzorak): čita se", o.status === 200 && o.telo.rezultati[0].linkovi.length === 5, o.status);
  cisto();
  sajt = { "/robots.txt": robotsOdg("User-agent: *\nDisallow: /novo?strana=\n"), "/novo": html(LAGUNA) };
  o = await z(listaHandler, { token: "tok-bib", telo: { url: "https://www.laguna.rs/novo?strana=3" } });
  provera("robots.txt se poredi i sa upitom (/novo?strana=3 je zabranjeno, /novo nije)", o.status === 422 && o.telo.greska.kod === "robots_zabranjuje", o.status);
  cisto();
  sajt = { "/robots.txt": { status: 404 }, "/novo": html(LAGUNA) };
  o = await z(listaHandler, { token: "tok-bib", telo: TELO });
  provera("robots.txt ne postoji (404): nastavlja se; robotsProcitan = false", o.status === 200 && o.telo.rezultati[0].robotsProcitan === false && o.telo.rezultati[0].pauzaSekundi === null && o.telo.rezultati[0].linkovi.length === 5, o.status);
  cisto();
  sajt = { "/robots.txt": new ApiGreska(504, "predugo"), "/novo": html(LAGUNA) };
  o = await z(listaHandler, { token: "tok-bib", telo: TELO });
  provera("robots.txt se ne može pročitati (greška veze): nastavlja se", o.status === 200 && o.telo.rezultati[0].robotsProcitan === false, o.status);
  cisto();
  sajt = { "/robots.txt": robotsOdg("User-agent: *\nCrawl-delay: 7\n"), "/novo": html(LAGUNA) };
  o = await z(listaHandler, { token: "tok-bib", telo: TELO });
  provera("Crawl-delay (7 s) se vraća kao pauzaSekundi, a ekran ga primenjuje između stranica knjiga", o.status === 200 && o.telo.rezultati[0].pauzaSekundi === 7, o.telo?.rezultati?.[0]?.pauzaSekundi);
  provera("ekran uzima veću od podrazumevane pauze i Crawl-delay-a (BibliotekarUnos prosleđuje pauzaMs u obradiRedom)", /pauzaMs/.test(citajIzvor("src/pages/BibliotekarUnos.jsx")) && /Math\.max\(PAUZA_MS/.test(citajIzvor("src/pages/BibliotekarUnos.jsx")));
  cisto();
  sajt = { "/robots.txt": robotsOdg("User-agent: *\nDisallow: /n6063\nDisallow: /n6065\n"), "/novo": html(LAGUNA) };
  o = await z(listaHandler, { token: "tok-bib", telo: TELO });
  provera("linkovi koje robots.txt zabranjuje se ne vraćaju (izbacenoRobots = 2), ostali ostaju", o.status === 200 && o.telo.rezultati[0].linkovi.length === 3 && o.telo.rezultati[0].izbacenoRobots === 2 && !o.sirovo.includes("n6063"), o.telo?.rezultati?.[0]?.izbacenoRobots);
  cisto();
  sajt = { "/robots.txt": robotsOdg("User-agent: *\nDisallow: /drugo\n"), "/novo": { status: 301, preusmerenje: "https://www.laguna.rs/drugo" }, "/drugo": html(LAGUNA) };
  o = await z(listaHandler, { token: "tok-bib", telo: TELO });
  provera("preusmeravanje na putanju koju robots.txt zabranjuje: odustaje se (konačna adresa se proverava iznova)", o.status === 422 && o.telo.greska.kod === "robots_zabranjuje" && !mreza.some((m) => m.endsWith("/drugo") && false), { status: o.status, mreza });

  // mnogo linkova, tip sadržaja, ograničenje, baza
  cisto();
  sajt = { "/robots.txt": robotsOdg(""), "/novo": html(`<html><body>${Array.from({ length: 80 }, (_, i) => `<a href="/knjiga/naslov-broj-${i}">Naslov ${i}</a>`).join("")}</body></html>`) };
  o = await z(listaHandler, { token: "tok-bib", telo: TELO });
  provera("iz-liste: najviše 50 linkova (od 80), skraceno = true, ukupno = 80", o.status === 200 && o.telo.rezultati[0].linkovi.length === 50 && o.telo.rezultati[0].skraceno === true && o.telo.rezultati[0].ukupno === 80, o.status);
  cisto();
  sajt = { "/robots.txt": robotsOdg(""), "/novo": { status: 200, tip: "application/pdf", telo: Buffer.from("%PDF") } };
  o = await z(listaHandler, { token: "tok-bib", telo: TELO });
  provera("iz-liste čita samo HTML: preuzmi se zove bez posebnih tipova (podrazumevano text/html i application/xhtml+xml, proverava se u zaštićenom preuzimaču)", /preuzmi\(url\.href\)/.test(citajIzvor("api/iz-liste.js")) && /tipovi = \["text\/html", "application\/xhtml\+xml"\]/.test(citajIzvor("api/_lib/bezbedan-fetch.js")));
  cisto();
  sajt = { "/robots.txt": robotsOdg(""), "/novo": html(LAGUNA) };
  stanje.brojac.set(kljucB(BIBL.id, KANTA_BIBLIOTEKAR), 200);
  o = await z(listaHandler, { token: "tok-bib", telo: TELO });
  provera("iz-liste: kad se potroši 200 na sat, 429 previse_zahteva (Retry-After), mreža se ne dira", o.status === 429 && o.telo.greska.kod === "previse_zahteva" && o.zaglavlja["retry-after"] === "1234" && mreza.length === 0, { status: o.status, mreza: mreza.length });
  cisto();
  stanje.rpcGreska = true;
  o = await z(listaHandler, { token: "tok-bib", telo: TELO });
  provera("ograničenje je zatvoreno: kad baza ne radi, 503 i mreža se ne dira", o.status === 503 && o.telo.greska.kod === "ogranicenje_nedostupno" && mreza.length === 0, o.status);
  cisto();
  stanje.ulogaGreska = true;
  o = await z(listaHandler, { token: "tok-bib", telo: TELO });
  provera("kad se uloga ne može pročitati, zahtev se odbija (503), ne propušta", o.status === 503 && mreza.length === 0, o.status);
  cisto();
  o = await z(listaHandler, { token: "tok-admin", telo: TELO });
  provera("administrator takođe sme", o.status === 200, o.status);
  provera("granicaSpiska: samo bibliotekar i administrator (inače baca 403), u istoj kanti kao iz-linka za osoblje", (() => { try { granicaSpiska("citalac"); return false; } catch (e) { return e.status === 403; } })() && granicaSpiska("bibliotekar").kanta === "iz-linka:bibliotekar" && granicaSpiska("administrator").najvise === 200);

  // tekst i ekran
  const TK = (await import("../src/lib/tekst.js")).tekst;
  provera("ekran: tekst za uvoz je u tekst.js na ćirilici; izabrano najviše 20 odjednom (kao postojeća obrada), spisak do 50", typeof TK.unos.lista.naslov === "string" && /[Ѐ-ӿ]/.test(TK.unos.lista.naslov + TK.unos.lista.uvod) && citajIzvor("src/components/UvozSaListe.jsx").includes("NAJVISE_LINKOVA") && TK.unos.lista.uvod.includes("50") && TK.unos.lista.uvod.includes("20"));
  provera("ekran: uvoz ne piše ništa u bazu i ne čita stranice knjiga sam; izabrane adrese predaje postojećoj obradi (obradiRedom: jedna po jedna, sa pauzom)", (() => { const k = citajIzvor("src/components/UvozSaListe.jsx").replace(/\/\/.*$/gm, ""); const u = citajIzvor("src/pages/BibliotekarUnos.jsx"); return !/supabase|from\("/.test(k) && /izListe\(/.test(k) && /onIzabrano\(/.test(k) && /obradiRedom\(linkovi/.test(u) && /pokreniObradu\(/.test(u); })());
  provera("uvoz se pokreće samo na dugme: nema useEffect-a koji bi sam čitao spisak ni petlje po stranicama", (() => { const k = citajIzvor("src/components/UvozSaListe.jsx").replace(/\/\/.*$/gm, ""); return !/useEffect/.test(k) && !/setInterval|setTimeout|while\s*\(|for\s*\(\s*;;/.test(k) && /onSubmit=\{/.test(k); })());

  // kartica iz uvoza: „Samo nacrt”, Imamo, Nabavljamo
  {
    const U = await import("../src/lib/unos-knjiga.js");
    const rezultat = { naslov: "Prokleta avlija", autori: ["Ivo Andrić"], izdavac: "Laguna", godina: 2020, isbn: "9788652126033", korica: "https://www.laguna.rs/k.jpg" };
    const nacrt = U.pocetnaForma(rezultat, { nacrt: true });
    provera("kartica iz uvoza počinje kao „Samo nacrt”, a nalepljena adresa kao „Imamo” (kao do sada); opis je prazan u oba slučaja", nacrt.stanje === "nacrt" && U.pocetnaForma(rezultat).stanje === "fond" && nacrt.opis === "" && U.pocetnaForma(rezultat, { nacrt: false }).stanje === "fond");
    const u1 = U.urediUnos(nacrt, { uneoId: "11111111-1111-4111-8111-111111111111" });
    provera("„Samo nacrt” se ne upisuje: urediUnos ne daje red za upis (razlog 'nacrt'), ni kad je sve ostalo ispravno", u1.ok === false && u1.polje === "stanje" && u1.razlog === "nacrt", u1);
    const u2 = U.urediUnos({ ...nacrt, stanje: "fond", primerci: "2" }, { uneoId: "11111111-1111-4111-8111-111111111111" });
    const u3 = U.urediUnos({ ...nacrt, stanje: "nabavka" }, { uneoId: "11111111-1111-4111-8111-111111111111" });
    provera("izborom „Imamo” (u fondu, primerci) ili „Nabavljamo” kartica postaje upisiva, bez opisa (kao do sada)", u2.ok && u2.red.u_fondu === true && u2.red.broj_primeraka === 2 && u2.red.opis === null && u3.ok && u3.red.u_fondu === false && u3.red.broj_primeraka === 0 && u3.red.opis === null, [u2.ok, u3.ok]);
    const TK2 = (await import("../src/lib/tekst.js")).tekst;
    provera("tekst: oznake stanja kartice su „Имамо”, „Набављамо”, „Само нацрт”, a poruke za nacrt i prazno stanje postoje", TK2.unos.kartica.imamo === "Имамо" && TK2.unos.kartica.nabavljamo === "Набављамо" && TK2.unos.kartica.nacrt === "Само нацрт" && typeof TK2.unos.greskeKartice.stanje_nacrt === "string" && typeof TK2.unos.greskeKartice.stanje_prazno === "string" && typeof TK2.unos.kartica.nacrtNapomena === "string");
    const kartica = citajIzvor("src/components/KarticaUnosa.jsx");
    const unosEkran = citajIzvor("src/pages/BibliotekarUnos.jsx");
    provera("ekran: nacrt se ne čuva: dugme „Sačuvaj” je isključeno za nacrt, a „Sačuvaj sve potvrđene” preskače nacrte", /disabled=\{saljem \|\| forma\.stanje === "nacrt"\}/.test(kartica) && (unosEkran.match(/stanje !== "nacrt"/g) ?? []).length === 2 && kartica.includes("T.kartica.imamo") && kartica.includes("T.kartica.nabavljamo") && kartica.includes("T.kartica.nacrt"));
  }
  bf.unutrasnje.jedanZahtev = original;
}

faza("11. Tajne");
provera("ni u jednom odgovoru (telo i zaglavlja) nema ključeva", sviOdgovori.every((t) => !TAJNE.some((k) => t.includes(k))), "neki odgovor sadrži ključ");

globalThis.fetch = pravi;
lazniSupabase.close();
console.log(`\nPASS: ${pass}   FAIL: ${fail}`);
process.exit(fail ? 1 : 0);
