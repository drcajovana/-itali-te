// Upis novog člana: provera broja karte i imena, podrazumevani nadimak.
// Koristi ga i server (api/napravi-clana.js) i ekran bibliotekara, da se pravila ne razilaze.
// Običan JS bez uvoza osim kartica.js, bez import.meta (čita ga i Node).
//
// Broj karte je UVEK tekst: počinje nulom (0101228), a Number("0101228") je 101228.
// Zato se broj koji stigne kao broj odbija, ne pretvara se u tekst (nula je već izgubljena).
import { normalizujKarticu } from "./kartica.js";

export const DUZINA_KARTE = 7;
export const DUZINA_PINA = 6;
export const NAJDUZE_IME = 80;

const KARTA_OBRAZAC = /^[0-9]{7}$/;
// Slova (sa kvačicama), razmak, tačka, crtica i apostrof; bez cifara i znakova za kontrolu.
const IME_OBRAZAC = /^[\p{L}][\p{L}\p{M}.'’ -]*$/u;

// Vraća normalizovan broj karte (7 cifara, kao tekst) ili null.
export function proveriBrojKarte(unos) {
  if (typeof unos !== "string") return null;
  const karta = normalizujKarticu(unos);
  return KARTA_OBRAZAC.test(karta) ? karta : null;
}

// Vraća ime i prezime sa jednim razmakom između reči ili null (najmanje dve reči).
export function ocistiIme(unos) {
  if (typeof unos !== "string") return null;
  const ime = unos.normalize("NFC").trim().replace(/\s+/g, " ");
  if (ime.length < 3 || ime.length > NAJDUZE_IME) return null;
  if (!IME_OBRAZAC.test(ime)) return null;
  if (ime.split(" ").length < 2) return null;
  return ime;
}

// „Ime P.": prvo ime i prvo slovo prezimena (poslednje reči) sa tačkom; radi i za ćirilicu
// („Ана Петровић” daje „Ана П.”). Očekuje ime iz ocistiIme.
export function podrazumevaniNadimak(ime) {
  const reci = String(ime ?? "").trim().split(/\s+/).filter(Boolean);
  if (reci.length === 0) return "";
  if (reci.length === 1) return reci[0];
  const prezime = Array.from(reci[reci.length - 1]);
  return `${reci[0]} ${prezime[0].toLocaleUpperCase("sr")}.`;
}

// Upit za pretragu članova (ime ili broj karte) pre nego što uđe u PostgREST filter `or=(...)`:
// zarez, zagrade, navodnici, zvezdica, procenat i kosa crta menjaju značenje filtera, pa se
// pretvaraju u razmak. Prazan rezultat znači „bez filtera".
export function upitZaPretragu(unos) {
  return String(unos ?? "")
    .normalize("NFC")
    .replace(/[%*,()"'\\:]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}
