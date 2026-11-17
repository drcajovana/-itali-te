// robots.txt za api/iz-liste.js: pre čitanja stranice sa spiskom knjiga proverava se robots.txt tog
// domena. Preuzima se istim zaštićenim preuzimačem kao i stranice (bezbedan-fetch.js: https, bela lista,
// DNS zaštita, preusmeravanja, rok i najveći odgovor), pa robots.txt ne može da bude put za SSRF.
//
// Pravila (prema RFC 9309, u onoj meri u kojoj nam treba):
//   - grupa za naš naziv („citaliste"), a ako je nema, grupa „*"; bez grupe je sve dozvoljeno;
//   - Allow/Disallow sa džokerom * i krajem $; pobeđuje najduži uzorak, a pri izjednačenju Allow;
//   - prazan Disallow ne zabranjuje ništa;
//   - Crawl-delay (sekunde) čita se iz izabrane grupe;
//   - ako se robots.txt ne može pročitati (nema ga, greška, predugo), NE zabranjuje se ništa: nastavlja se
//     uz uobičajenu pauzu (tako je dogovoreno). Ovo je svesno blaže od RFC-a za 5xx odgovor.
import { preuzmi } from "./bezbedan-fetch.js";

export const NAZIV_ZA_ROBOTS = "citaliste"; // „Citaliste/1.0" u User-Agent zaglavlju
export const NAJDUZA_PAUZA_SEKUNDI = 30; // veći Crawl-delay se skraćuje (obrada 20 knjiga ne sme da traje satima)

// Tekst robots.txt → grupe { agenti: [mala slova], pravila: [{ dozvoli, uzorak }], pauza }.
export function parsirajRobots(tekst) {
  const grupe = [];
  let tekuca = null;
  let uNizuAgenata = false;
  for (const sirova of String(tekst ?? "").split(/\r?\n/)) {
    const red = sirova.replace(/#.*$/, "").trim();
    if (!red) continue;
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(red);
    if (!m) continue;
    const polje = m[1].toLowerCase();
    const vrednost = m[2].trim();
    if (polje === "user-agent") {
      if (!tekuca || !uNizuAgenata) {
        tekuca = { agenti: [], pravila: [], pauza: null };
        grupe.push(tekuca);
      }
      tekuca.agenti.push(vrednost.toLowerCase());
      uNizuAgenata = true;
      continue;
    }
    uNizuAgenata = false;
    if (!tekuca) continue;
    if (polje === "allow" || polje === "disallow") {
      tekuca.pravila.push({ dozvoli: polje === "allow", uzorak: vrednost });
    } else if (polje === "crawl-delay") {
      const n = Number(vrednost);
      if (Number.isFinite(n) && n >= 0) tekuca.pauza = n;
    }
  }
  return grupe;
}

// Pravila i pauza koji važe za nas: spojene sve grupe sa našim imenom, a bez njih grupe „*".
export function pravilaZaNas(grupe, naziv = NAZIV_ZA_ROBOTS) {
  const nasi = grupe.filter((g) => g.agenti.some((a) => a === naziv || a === `${naziv}/1.0`));
  const izabrane = nasi.length ? nasi : grupe.filter((g) => g.agenti.includes("*"));
  const pauze = izabrane.map((g) => g.pauza).filter((p) => p !== null);
  return {
    pravila: izabrane.flatMap((g) => g.pravila),
    pauza: pauze.length ? Math.max(...pauze) : null,
  };
}

function uzorakURegex(uzorak) {
  const kraj = uzorak.endsWith("$");
  const telo = kraj ? uzorak.slice(0, -1) : uzorak;
  const izraz = telo.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${izraz}${kraj ? "$" : ""}`);
}

// putanja: pathname + search („/knjige?strana=2"). Najduži uzorak pobeđuje, Allow pri izjednačenju.
export function jeDozvoljeno(pravila, putanja) {
  let najbolje = null;
  for (const p of pravila) {
    if (p.uzorak === "") continue; // prazan Disallow: ništa se ne zabranjuje (prazan Allow ništa ne menja)
    if (!uzorakURegex(p.uzorak).test(putanja)) continue;
    if (!najbolje || p.uzorak.length > najbolje.uzorak.length || (p.uzorak.length === najbolje.uzorak.length && p.dozvoli)) najbolje = p;
  }
  return najbolje ? najbolje.dozvoli : true;
}

// → { procitan, pravila, pauzaSekundi }. Nikad ne baca: greška znači „nije pročitan", pa se nastavlja.
export async function ucitajRobots(u, { preuzmiFn = preuzmi } = {}) {
  try {
    const odgovor = await preuzmiFn(`https://${u.hostname}/robots.txt`, {
      accept: "text/plain,*/*;q=0.1",
      tipovi: ["text/"],
      najviseBajtova: 500_000,
    });
    const { pravila, pauza } = pravilaZaNas(parsirajRobots(odgovor.telo));
    return { procitan: true, pravila, pauzaSekundi: pauza === null ? null : Math.min(pauza, NAJDUZA_PAUZA_SEKUNDI) };
  } catch {
    return { procitan: false, pravila: [], pauzaSekundi: null };
  }
}

export const putanjaZaRobots = (u) => `${u.pathname}${u.search}`;
