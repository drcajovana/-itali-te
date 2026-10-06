// Preuzimanje stranice za api/iz-linka.js, sa odbranom od SSRF-a.
//
// Šta se proverava, i za SVAKO preusmeravanje posebno:
//  1. samo https, bez korisnika/lozinke u adresi, samo port 443;
//  2. domen mora biti na beloj listi (api/_lib/bela-lista.js); IP adrese kao
//     domen i „localhost" se odbijaju;
//  3. DNS odgovor se proverava u istom koraku u kom se otvara veza (lookup
//     funkcija ispod): ako je ijedna adresa privatna, loopback ili link-local,
//     veza se ne otvara. Povezuje se baš na proverenu adresu, pa ne može da se
//     promeni između provere i veze (DNS rebinding);
//  4. preusmeravanja se ne prate automatski: svako se ručno proverava (1-3),
//     najviše 3, i ono van bele liste se odbija;
//  5. vremensko ograničenje za ceo lanac, najveća veličina odgovora (i posle
//     raspakivanja, zbog „zip bombi") i dozvoljeni tipovi sadržaja.

import https from "node:https";
import dns from "node:dns";
import net from "node:net";
import zlib from "node:zlib";
import { ApiGreska } from "./greska.js";
import { DOZVOLJENI_DOMENI } from "./bela-lista.js";

export const OGRANICENJA = {
  rokMs: 8000,
  najvisePreusmeravanja: 3,
  najviseBajtova: 1_500_000,
};

// Predstavljamo se pošteno. Neki sajtovi odbijaju nepoznate klijente; tada član
// upisuje naslov ručno. Lažno predstavljanje kao pregledač se ne radi.
const KORISNICKI_AGENT = "Citaliste/1.0 (link preview for library members; Narodna biblioteka Negotin)";

// ───────────────────────── adresa i domen ─────────────────────────

export function domenJeDozvoljen(host, lista = DOZVOLJENI_DOMENI) {
  const h = String(host).toLowerCase();
  return lista.some((d) => h === d || h.endsWith(`.${d}`));
}

// Vraća URL objekat ili baca ApiGreska. Ne radi nikakav mrežni poziv.
export function proveriUrl(ulaz, lista = DOZVOLJENI_DOMENI) {
  let u;
  try {
    u = new URL(String(ulaz));
  } catch {
    throw new ApiGreska(400, "neispravan_link", "Adresa nije ispravna.");
  }
  if (u.protocol !== "https:") throw new ApiGreska(422, "nije_https", "Dozvoljene su samo https adrese.");
  if (u.username || u.password) throw new ApiGreska(422, "neispravan_link", "Adresa ne sme da sadrži korisnika.");
  if (u.port && u.port !== "443") throw new ApiGreska(422, "neispravan_link", "Port nije dozvoljen.");

  const host = u.hostname.toLowerCase();
  if (net.isIP(host) || host.startsWith("[") || host === "localhost" || host.endsWith(".")) {
    throw new ApiGreska(422, "domen_nije_dozvoljen", "Domen nije dozvoljen.");
  }
  if (!domenJeDozvoljen(host, lista)) {
    throw new ApiGreska(422, "domen_nije_dozvoljen", "Domen nije na listi dozvoljenih.");
  }
  return u;
}

// Samo javne adrese. IPv4: odbija sve rezervisane opsege. IPv6: dozvoljen je
// samo globalni unicast 2000::/3, što odbija ::1, ::, fe80::/10, fc00::/7,
// ff00::/8 i IPv4-mapirane (::ffff:a.b.c.d); uz to dokumentacioni opseg,
// Teredo (2001::/32) i 6to4 (2002::/16).
export function jeJavnaAdresa(ip) {
  const verzija = net.isIP(ip);
  if (verzija === 4) {
    const [a, b, c] = ip.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 100 && b >= 64 && b <= 127) return false; // 100.64.0.0/10 (CGNAT)
    if (a === 169 && b === 254) return false; // link-local, uključujući 169.254.169.254
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;
    if (a === 192 && b === 168) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    if (a === 198 && b === 51 && c === 100) return false;
    if (a === 203 && b === 0 && c === 113) return false;
    if (a >= 224) return false; // multicast, rezervisano, broadcast
    return true;
  }
  if (verzija === 6) {
    const grupe = ip.toLowerCase().split("%")[0].split(":");
    const prva = grupe[0] === "" ? 0 : parseInt(grupe[0], 16);
    if ((prva & 0xe000) !== 0x2000) return false;
    const druga = grupe[1] === undefined || grupe[1] === "" ? 0 : parseInt(grupe[1], 16);
    if (prva === 0x2001 && (druga === 0x0db8 || druga === 0)) return false;
    if (prva === 0x2002) return false;
    return true;
  }
  return false;
}

// DNS upit kojim se otvara veza. Provera i povezivanje koriste isti odgovor.
export function lookupZasticen(hostname, opcije, cb) {
  dns.lookup(hostname, { all: true, verbatim: true }, (err, adrese) => {
    if (err) return cb(err);
    if (!adrese.length || adrese.some((a) => !jeJavnaAdresa(a.address))) {
      return cb(new ApiGreska(422, "domen_nije_dozvoljen", "Domen se razrešava na nedozvoljenu adresu."));
    }
    // Node 20+ zove lookup sa all:true kad bira između IPv4 i IPv6.
    if (opcije && opcije.all) return cb(null, adrese);
    return cb(null, adrese[0].address, adrese[0].family);
  });
}

// ───────────────────────── jedan HTTP zahtev ─────────────────────────

function dekoder(kodiranje) {
  switch (kodiranje) {
    case "":
    case "identity":
      return null;
    case "gzip":
    case "x-gzip":
      return zlib.createGunzip();
    case "deflate":
      return zlib.createInflate();
    case "br":
      return zlib.createBrotliDecompress();
    default:
      throw new ApiGreska(502, "ne_mogu_da_procitam", `Nepodržano kodiranje: ${kodiranje}`);
  }
}

// Izdvojeno u objekat da test može da ga zameni, bez prave mreže.
export const unutrasnje = {
  jedanZahtev(u, { accept, tipovi, najviseBajtova }, preostaloMs) {
    return new Promise((resolve, reject) => {
      let zavrseno = false;
      const gotovo = (f, v) => {
        if (zavrseno) return;
        zavrseno = true;
        clearTimeout(sat);
        f(v);
      };
      const req = https.request(
        {
          protocol: "https:",
          hostname: u.hostname,
          port: 443,
          path: `${u.pathname}${u.search}`,
          method: "GET",
          lookup: lookupZasticen,
          servername: u.hostname,
          headers: {
            "User-Agent": KORISNICKI_AGENT,
            Accept: accept,
            "Accept-Encoding": "gzip, deflate, br",
            "Accept-Language": "sr,en;q=0.5",
          },
        },
        (res) => {
          const status = res.statusCode ?? 0;
          if ([301, 302, 303, 307, 308].includes(status)) {
            res.resume();
            return gotovo(resolve, { status, preusmerenje: res.headers.location });
          }
          if (status !== 200) {
            res.resume();
            return gotovo(resolve, { status });
          }
          const tip = String(res.headers["content-type"] ?? "").toLowerCase();
          if (!tipovi.some((t) => tip.startsWith(t))) {
            res.resume();
            return gotovo(reject, new ApiGreska(422, "nije_stranica", `Neočekivan tip sadržaja: ${tip.split(";")[0]}`));
          }
          if (Number(res.headers["content-length"]) > najviseBajtova) {
            res.destroy();
            return gotovo(reject, new ApiGreska(422, "prevelika_stranica", "Stranica je prevelika."));
          }
          let tok = res;
          try {
            const d = dekoder(String(res.headers["content-encoding"] ?? "").toLowerCase());
            if (d) {
              d.on("error", (e) => gotovo(reject, e));
              tok = res.pipe(d);
            }
          } catch (e) {
            res.resume();
            return gotovo(reject, e);
          }
          const delovi = [];
          let ukupno = 0;
          tok.on("data", (deo) => {
            ukupno += deo.length;
            if (ukupno > najviseBajtova) {
              req.destroy();
              return gotovo(reject, new ApiGreska(422, "prevelika_stranica", "Stranica je prevelika."));
            }
            delovi.push(deo);
          });
          tok.on("end", () => gotovo(resolve, { status, tip, telo: Buffer.concat(delovi) }));
          tok.on("error", (e) => gotovo(reject, e));
        }
      );
      // Rok za ceo zahtev (ne samo za neaktivnu vezu).
      const sat = setTimeout(() => {
        req.destroy();
        gotovo(reject, new ApiGreska(504, "predugo", "Sajt predugo odgovara."));
      }, preostaloMs);
      req.on("error", (e) => gotovo(reject, e));
      req.end();
    });
  },
};

// Tekst iz bajtova: zaglavlje Content-Type, pa <meta charset> iz prvih 2 KB.
// Starije srpske stranice su često u windows-1250.
export function dekodujTelo(telo, tip = "") {
  let oznaka = /charset=["']?([\w-]+)/i.exec(tip)?.[1];
  if (!oznaka) {
    const pocetak = telo.subarray(0, 2048).toString("latin1");
    oznaka = /<meta[^>]+charset=["']?([\w-]+)/i.exec(pocetak)?.[1];
  }
  try {
    return new TextDecoder(oznaka || "utf-8").decode(telo);
  } catch {
    return new TextDecoder("utf-8").decode(telo);
  }
}

// ───────────────────────── javni ulaz ─────────────────────────

export async function preuzmi(ulaz, opcije = {}) {
  const {
    accept = "text/html,application/xhtml+xml",
    tipovi = ["text/html", "application/xhtml+xml"],
    najviseBajtova = OGRANICENJA.najviseBajtova,
    lista = DOZVOLJENI_DOMENI,
  } = opcije;
  const pocetak = Date.now();
  let u = proveriUrl(ulaz, lista);

  for (let skok = 0; skok <= OGRANICENJA.najvisePreusmeravanja; skok++) {
    const preostalo = OGRANICENJA.rokMs - (Date.now() - pocetak);
    if (preostalo <= 0) throw new ApiGreska(504, "predugo", "Sajt predugo odgovara.");

    let odgovor;
    try {
      odgovor = await unutrasnje.jedanZahtev(u, { accept, tipovi, najviseBajtova }, preostalo);
    } catch (e) {
      if (e instanceof ApiGreska) throw e;
      throw new ApiGreska(502, "ne_mogu_da_procitam", `Veza nije uspela: ${e?.code ?? e?.message ?? e}`);
    }

    if (odgovor.preusmerenje) {
      try {
        u = proveriUrl(new URL(odgovor.preusmerenje, u).href, lista);
      } catch (e) {
        // Preusmeravanje van bele liste (ili na http, IP...) se odbija.
        throw new ApiGreska(422, "preusmerenje_van_liste", `Preusmeravanje nije dozvoljeno (${e?.kod ?? "neispravno"}).`);
      }
      continue;
    }
    if (odgovor.status !== 200) {
      throw new ApiGreska(502, "ne_mogu_da_procitam", `Sajt je odgovorio sa HTTP ${odgovor.status}.`);
    }
    return { url: u, tip: odgovor.tip, telo: dekodujTelo(odgovor.telo, odgovor.tip) };
  }
  throw new ApiGreska(422, "previse_preusmeravanja", "Previše preusmeravanja.");
}
