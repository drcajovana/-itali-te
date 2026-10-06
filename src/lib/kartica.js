// Broj članske karte i PIN — jedino mesto gde se oni normalizuju i pretvaraju u
// Auth podatke. Koriste ga aplikacija (prijava), scripts/napravi-administratora.mjs
// i scripts/test-rls.mjs, pa mora ostati običan JS bez uvoza i bez import.meta.
//
// Supabase Auth traži e-adresu, a član ima samo broj karte, pa se Auth nalog
// vodi na sintetičku adresu {broj_kartice}@citaliste.local, a PIN je lozinka
// (plan, tačka 4). Korisnik tu adresu nikad ne vidi.

// „ 1234 ", „nb-1234" i „NB-1234" su ista karta. Čuva se i prikazuje velikim
// slovima; u adresi je malim.
export function normalizujKarticu(unos) {
  return String(unos ?? "").normalize("NFKC").replace(/\s+/g, "").toUpperCase();
}

// Dozvoljeni znaci su oni koji bezbedno staju u deo adrese pre @. Kad se vidi
// kakvi brojevi karata stvarno postoje u biblioteci, ovde se proširuje.
const KARTICA_OBRAZAC = /^[A-Z0-9][A-Z0-9._-]{0,39}$/;

export const jeIspravnaKartica = (kartica) => KARTICA_OBRAZAC.test(kartica);

export const kartaUEmail = (unos) => `${normalizujKarticu(unos).toLowerCase()}@citaliste.local`;

// Supabase Auth traži najmanje 6 znakova lozinke, pa PIN od 4 cifre ne može da
// bude lozinka. PIN koji dodeljuje bibliotekar je 6 do 12 cifara.
const PIN_OBRAZAC = /^[0-9]{6,12}$/;

export const jeIspravanPin = (pin) => PIN_OBRAZAC.test(String(pin ?? ""));
