// Čista logika ekrana „Утисак са пулта" (bibliotekar upisuje utisak u ime člana). Bez React-a i bez mreže.
import { urediUtisak, VIDLJIVOSTI } from "./polica-logika.js";

// Forma sa pulta → red za upis ili { ok: false, polje, razlog }.
// Razlika od utiska koji član piše sam: vidljivost se NE pretpostavlja (bibliotekar pita člana i bira), a
// bibliotekar mora da potvrdi da član to želi. Tako se ništa ne objavljuje „iz navike".
export function urediUtisakSaPulta({ clan, knjiga, forma, potvrda }) {
  if (!clan?.id) return { ok: false, polje: "clan", razlog: "prazno" };
  if (!knjiga?.id) return { ok: false, polje: "knjiga", razlog: "prazno" };
  if (!VIDLJIVOSTI.includes(forma?.vidljivost)) return { ok: false, polje: "vidljivost", razlog: "prazno" };
  const u = urediUtisak(forma);
  if (!u.ok) return u;
  if (!potvrda) return { ok: false, polje: "potvrda", razlog: "prazno" };
  return u;
}

// Poruka iz tekst.pult.greske za grešku iz urediUtisakSaPulta ili iz baze (kod).
export function kljucGreske(g) {
  if (g?.polje === "ocena" && g.razlog === "prazno") return "prazno";
  if (g?.polje === "tekst" && g.razlog === "predugo") return "predugo";
  if (["clan", "knjiga", "vidljivost", "potvrda"].includes(g?.polje)) return g.polje;
  if (g?.kod === "vec_ima" || g?.kod === "clan_nije_aktivan") return g.kod;
  return "opste";
}

// Samo aktivni članovi se nude (baza ionako odbija upis za neaktivnog).
export const aktivniClanovi = (lista) => (lista ?? []).filter((c) => c.aktivan);
