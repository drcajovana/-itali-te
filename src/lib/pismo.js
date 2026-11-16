// Prebacivanje srpskog teksta između ćirilice i latinice. Služi samo da se isti upit traži u oba
// pisma tamo gde baza ne normalizuje (npr. pretraga članova po imenu: ime je upisano kako je upisano).
// Pretraga knjiga ne treba ovo: privatno.norm_tekst u bazi već izjednačava ćirilicu i latinicu.
// Običan JS bez uvoza.

const LAT_U_CIR = {
  a: "а", b: "б", c: "ц", č: "ч", ć: "ћ", d: "д", đ: "ђ", e: "е", f: "ф", g: "г", h: "х", i: "и", j: "ј", k: "к", l: "л",
  m: "м", n: "н", o: "о", p: "п", r: "р", s: "с", š: "ш", t: "т", u: "у", v: "в", z: "з", ž: "ж",
};
const DIGRAFI = { lj: "љ", nj: "њ", dž: "џ" };
const CIR_U_LAT = Object.fromEntries([...Object.entries(LAT_U_CIR).map(([l, c]) => [c, l]), ["љ", "lj"], ["њ", "nj"], ["џ", "dž"]]);

const velikoSlovo = (s) => s !== s.toLowerCase();
const velikoPrvo = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

export function uCirilicu(unos) {
  const s = String(unos ?? "");
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const par = s.slice(i, i + 2);
    if (par.length === 2 && DIGRAFI[par.toLowerCase()]) {
      const c = DIGRAFI[par.toLowerCase()];
      out += velikoSlovo(par[0]) ? c.toUpperCase() : c;
      i++;
      continue;
    }
    const mala = s[i].toLowerCase();
    out += LAT_U_CIR[mala] ? (velikoSlovo(s[i]) ? LAT_U_CIR[mala].toUpperCase() : LAT_U_CIR[mala]) : s[i];
  }
  return out;
}

export function uLatinicu(unos) {
  const s = String(unos ?? "");
  let out = "";
  for (const ch of s) {
    const lat = CIR_U_LAT[ch.toLowerCase()];
    out += lat ? (velikoSlovo(ch) ? velikoPrvo(lat) : lat) : ch;
  }
  return out;
}

// Isti upit u tri oblika (kako je upisan, ćirilica, latinica), bez ponavljanja i praznih.
export function oblikeUpita(unos) {
  const s = String(unos ?? "");
  return [...new Set([s, uCirilicu(s), uLatinicu(s)].filter(Boolean))];
}
