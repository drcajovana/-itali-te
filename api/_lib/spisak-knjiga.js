// Izvlačenje linkova ka stranicama knjiga iz stranice SA SPISKOM jednog izdavača (novi naslovi, kategorija,
// rezultati pretrage na sajtu izdavača) za api/iz-liste.js. Čista funkcija: HTML i adresa u, linkovi
// van; bez mreže. Ne čita ništa sa stranica knjiga (to radi postojeći api/iz-linka.js, jednu po jednu).
//
// Pravila za link: https, isti domen kao stranica sa spiskom (www. se ne računa), bez # i bez parametara
// praćenja, bez duplikata, najviše 50, i mora da liči na stranicu knjige. Ne prati se paginacija: stranice
// spiska (/page/2, ?strana=3) se ne uzimaju kao knjige; samo se javlja adresa sledeće stranice (rel="next"),
// a čita se tek na novi klik bibliotekara.
//
// Šta „liči na knjigu" (heuristika po putanji; nije proveravano na pravim sajtovima, vidi README):
//   - posebni obrasci sajtova sa bele liste (OBRASCI_SAJTOVA), npr. delfi.rs /knjige/123-naslov;
//   - opšti: /knjiga|knjige|book|proizvod|product|izdanje|naslov/<slug>, „broj pa slug" (321-prokleta-avlija),
//     numerisan proizvod (/n6061_naslov) ili slug sa bar tri reči i nastavkom .html;
//   - nikad: kategorije, korpa, prijava, uslovi, blog, autori, pretraga, kontakt, fajlovi, korena sajta.
import { parseHTML } from "linkedom";

export const NAJVISE_LINKOVA = 50;

const PRACENJE = /^(utm_|fbclid$|gclid$|mc_|ref$)/i; // isto kao ključ keša (api/_lib/kes.js)
const PAGINACIJA_PARAM = /^(page|paged|pg|p|strana|stranica|str|offset)$/i;

// Putanje koje nikad nisu knjiga.
const ISKLJUCENE = /(^|\/)(kategorij\w*|category|categories|kolekcij\w*|collection\w*|korpa|cart|checkout|naplata|prijava|login|logout|registracija|register|nalog|moj-nalog|account|uslovi\w*|terms|politika\w*|privatnost|privacy|kolacic\w*|cookie\w*|blog|vesti|novosti|news|o-nama|about|kontakt|contact|pomoc|help|faq|pretraga|search|trazi|tag|tagovi|autor|autori|author|authors|izdavac|izdavaci|publisher|zanr|zanrovi|genre|lista-zelja|wishlist|poredjenje|compare|katalog|catalog|knjizare|prodavnice|stranica|strana|page)(\/|$)/i;
const FAJL = /\.(jpe?g|png|gif|webp|svg|pdf|zip|docx?|xlsx?|mp3|mp4|css|js|xml|json|ico)$/i;

// Obrasci poznatih sajtova (putanja): pretpostavljeni po primerima i starom parseru, NISU proveravani na
// pravim sajtovima. Dodaje se samo domen (bez www.) i regularni izraz za putanju knjige.
export const OBRASCI_SAJTOVA = {
  "laguna.rs": [/\/[ns]\d{3,}_[^/]+/i],
  "delfi.rs": [/^\/knjige\/\d+-[^/]+$/i],
};

const OPSTI_OBRASCI = [
  /(^|\/)(knjiga|knjige|book|books|proizvod|proizvodi|product|products|izdanje|izdanja|naslov|naslovi)\/[^/]{4,}/i,
  /\/(?:\d{2,}[-_][^/]+|[^/]+[-_]\d{3,})(?:\.html?)?$/i, // broj pa slug, ili slug pa broj
  /\/[ns]\d{3,}_[^/]+/i, // numerisan proizvod
  /\/[a-z0-9]+(?:-[a-z0-9]+){2,}\.html?$/i, // slug sa bar tri reči i .html
];

const GENERICKI_TEKST = /^(detaljnije|vi[sš]e|pro[cč]itaj vi[sš]e|saznaj vi[sš]e|kupi|dodaj u korpu|u korpu|pogledaj|detalji|read more|more|details|buy( now)?|add to cart)\.?$/i;
const GENERICKI_ALT = /^(korica|slika|cover|image|photo|foto|thumbnail|knjiga|book)\.?$/i;

const bezWww = (host) => host.toLowerCase().replace(/^www\./, "");

// Ista adresa u jednom obliku: bez #, bez praćenja, bez završne kose crte (osim korena).
function normalizuj(u) {
  const n = new URL(u.href);
  n.hash = "";
  n.hostname = n.hostname.toLowerCase();
  for (const k of [...n.searchParams.keys()]) if (PRACENJE.test(k)) n.searchParams.delete(k);
  n.searchParams.sort();
  if (n.pathname.length > 1 && n.pathname.endsWith("/")) n.pathname = n.pathname.slice(0, -1);
  return n;
}

export function liciNaKnjigu(u) {
  const host = bezWww(u.hostname);
  const putanja = decodeURIComponentBezGreske(u.pathname);
  if (putanja === "/" || putanja === "") return false;
  if (FAJL.test(putanja)) return false;
  if ([...u.searchParams.keys()].some((k) => PAGINACIJA_PARAM.test(k))) return false;
  if (ISKLJUCENE.test(putanja)) return false;
  const posebni = OBRASCI_SAJTOVA[host] ?? Object.entries(OBRASCI_SAJTOVA).find(([d]) => host.endsWith(`.${d}`))?.[1] ?? [];
  if (posebni.some((o) => o.test(putanja))) return true;
  return OPSTI_OBRASCI.some((o) => o.test(putanja));
}

function decodeURIComponentBezGreske(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

// Naslov iz poslednjeg dela putanje: „321-prokleta-avlija.html" → „prokleta avlija".
function naslovIzPutanje(u) {
  const deo = decodeURIComponentBezGreske(u.pathname.split("/").filter(Boolean).pop() ?? "");
  const naslov = deo
    .replace(/\.html?$/i, "")
    .replace(/^[ns]?\d+[-_]/i, "")
    .replace(/[-_]\d+$/, "")
    .replace(/[-_]+/g, " ")
    .trim();
  return naslov || deo;
}

const skrati = (s, n = 200) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const urediTekst = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

// { tekst, rezerva }: pravi tekst linka ima prednost nad title/aria-label/alt slike (koji su rezerva).
function tekstLinka(a) {
  const ok = (t, generickiAlt = false) => t.length >= 3 && !GENERICKI_TEKST.test(t) && !(generickiAlt && GENERICKI_ALT.test(t));
  const tekst = [urediTekst(a.textContent)].filter((t) => ok(t));
  const rezerva = [urediTekst(a.getAttribute("title")), urediTekst(a.getAttribute("aria-label")), urediTekst(a.querySelector?.("img")?.getAttribute("alt"))].filter((t) => ok(t, true));
  return { tekst, rezerva };
}

// html: tekst stranice; bazna: konačna adresa stranice (URL); robots: { jeDozvoljeno(putanja) } ili null.
// → { linkovi: [{ url, naslov }], ukupno, skraceno, izbacenoRobots, sledeca }
export function izvuciLinkoveKnjiga(html, bazna, { jeDozvoljenoFn = null, najvise = NAJVISE_LINKOVA } = {}) {
  const { document: doc } = parseHTML(html);
  const base = new URL(bazna.href ?? bazna);
  const domen = bezWww(base.hostname);
  const sama = normalizuj(base).href;

  const poAdresi = new Map(); // adresa → { url, naslovi[] }, redom kojim se prvi put pojavljuju
  let izbacenoRobots = 0;

  for (const a of doc.querySelectorAll("a[href]")) {
    const sirova = (a.getAttribute("href") ?? "").trim();
    if (!sirova || /^(javascript:|mailto:|tel:|data:|#)/i.test(sirova)) continue;
    let u;
    try {
      u = new URL(sirova, base);
    } catch {
      continue;
    }
    if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) continue;
    if (bezWww(u.hostname) !== domen) continue;
    const n = normalizuj(u);
    if (n.href === sama) continue;
    if (!liciNaKnjigu(n)) continue;
    if (jeDozvoljenoFn && !jeDozvoljenoFn(`${n.pathname}${n.search}`)) {
      if (!poAdresi.has(n.href)) izbacenoRobots++;
      poAdresi.set(n.href, poAdresi.get(n.href) ?? { url: n.href, naslovi: [], zabranjeno: true });
      continue;
    }
    const stavka = poAdresi.get(n.href) ?? { url: n.href, naslovi: [], rezerva: [] };
    const t = tekstLinka(a);
    stavka.naslovi.push(...t.tekst);
    stavka.rezerva.push(...t.rezerva);
    poAdresi.set(n.href, stavka);
  }

  const sve = [...poAdresi.values()].filter((s) => !s.zabranjeno);
  const linkovi = sve.slice(0, najvise).map((s) => ({ url: s.url, naslov: skrati(s.naslovi[0] ?? s.rezerva?.[0] ?? naslovIzPutanje(new URL(s.url))) }));

  let sledeca = null;
  const sl = doc.querySelector('link[rel~="next"][href], a[rel~="next"][href]');
  if (sl) {
    try {
      const nu = normalizuj(new URL(sl.getAttribute("href"), base));
      if (nu.protocol === "https:" && bezWww(nu.hostname) === domen && nu.href !== sama) sledeca = nu.href;
    } catch {
      /* neispravna adresa: nema sledeće */
    }
  }

  return { linkovi, ukupno: sve.length, skraceno: sve.length > najvise, izbacenoRobots, sledeca };
}
