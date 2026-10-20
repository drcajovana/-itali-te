// Čista logika police i utisaka (bez Supabase klijenta), da je test:api proverava bez mreže.
// Upiti ka bazi su u polica.js; ovde su samo pravila: prelaz stanja, napredak, ocena, utisak.
//
// Šta štiti baza, a šta je samo udobnost: vidljivost utisaka i police je u RLS-u. Ovde nema
// nikakvog filtriranja po tome ko sme šta da vidi.

export const STANJA = ["citam", "procitano", "zelim"];
export const VIDLJIVOSTI = ["javno", "prijatelji", "samo_ja"];
export const NAJDUZI_UTISAK = 3000;

// Današnji datum u lokalnom vremenu (YYYY-MM-DD). toISOString() daje UTC, pa bi posle ponoći po
// srpskom vremenu upisao jučerašnji datum.
export function danas(d = new Date()) {
  const dvocifreno = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${dvocifreno(d.getMonth() + 1)}-${dvocifreno(d.getDate())}`;
}

// Polja police koja se menjaju kad član promeni stanje knjige. `red` je postojeći red police
// (ili null kad knjige još nema na polici).
//   zelim:     samo stanje; datum kraja se briše; datum početka i napredak ostaju
//   citam:     datum početka je prvi dan čitanja (već postojeći se čuva); datum kraja se briše;
//              ko ponovo počne pročitanu knjigu kreće od 0%
//   procitano: datum kraja je danas; napredak je 100; datum početka se ne izmišlja
export function promenaStanja(red, novo, dan = danas()) {
  if (!STANJA.includes(novo)) throw new Error(`nepoznato stanje: ${novo}`);
  if (novo === "zelim") return { status: "zelim", datum_kraja: null };
  if (novo === "citam") {
    return {
      status: "citam",
      datum_pocetka: red?.datum_pocetka ?? dan,
      datum_kraja: null,
      napredak: red?.status === "procitano" ? 0 : (red?.napredak ?? 0),
    };
  }
  return { status: "procitano", datum_kraja: dan, napredak: 100 };
}

// Napredak koji je član uneo: ceo broj od 0 do 100, inače null.
export function uredjenNapredak(v) {
  if (typeof v === "string" && !/^\d{1,3}$/.test(v.trim())) return null;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isInteger(n) && n >= 0 && n <= 100 ? n : null;
}

// Napredak za prikaz: procitano je uvek 100, zelim je 0, citam je ono što piše u redu.
export function prikazaniNapredak(red) {
  if (!red) return 0;
  if (red.status === "procitano") return 100;
  if (red.status === "zelim") return 0;
  return uredjenNapredak(red.napredak) ?? 0;
}

// Redovi police po stanju, najskorije izmenjeni prvo.
export function grupisiPolicu(redovi) {
  const grupe = { citam: [], procitano: [], zelim: [] };
  const poVremenu = [...(redovi ?? [])].sort((a, b) => String(b.izmenjeno ?? "").localeCompare(String(a.izmenjeno ?? "")));
  for (const r of poVremenu) if (grupe[r.status]) grupe[r.status].push(r);
  return grupe;
}

// Koja kartica je otvorena na početku: prva koja nije prazna (Čitam, Želim, Pročitano), inače „citam".
export function podrazumevanaKartica(grupe) {
  return ["citam", "zelim", "procitano"].find((s) => grupe[s]?.length) ?? "citam";
}

// Prosečna ocena za prikaz („8,3"); null kad nema ocena.
export function prosecnaOcena(red) {
  if (!red || !(Number(red.broj_ocena) > 0) || red.prosecna_ocena == null) return null;
  return String(Number(red.prosecna_ocena).toFixed(1)).replace(".", ",");
}

// Utisak iz forme → red za upis, ili { ok: false, polje, razlog }. Isto pravilo kao ograničenje
// utisci_bar_nesto u bazi: ocena ili tekst mora da postoji.
export function urediUtisak(unos) {
  const ocena = unos?.ocena === "" || unos?.ocena == null ? null : Number(unos.ocena);
  if (ocena !== null && !(Number.isInteger(ocena) && ocena >= 1 && ocena <= 10)) return { ok: false, polje: "ocena", razlog: "neispravno" };
  const tekst = String(unos?.tekst ?? "").replace(/\r\n/g, "\n").trim();
  if (tekst.length > NAJDUZI_UTISAK) return { ok: false, polje: "tekst", razlog: "predugo" };
  if (ocena === null && !tekst) return { ok: false, polje: "ocena", razlog: "prazno" };
  const vidljivost = unos?.vidljivost ?? "javno";
  if (!VIDLJIVOSTI.includes(vidljivost)) return { ok: false, polje: "vidljivost", razlog: "neispravno" };
  return { ok: true, red: { ocena, tekst: tekst || null, vidljivost, spojler: Boolean(unos?.spojler) && Boolean(tekst) } };
}

// Početne vrednosti forme za utisak iz postojećeg reda (ili prazne).
export const formaUtiska = (utisak) => ({
  ocena: utisak?.ocena ?? "",
  tekst: utisak?.tekst ?? "",
  vidljivost: utisak?.vidljivost ?? "javno",
  spojler: Boolean(utisak?.spojler),
});

// „2026-10-20" → „20. 10. 2026." (datum kako se piše kod nas); neispravan ulaz se vraća kakav jeste.
export function formatDatum(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ""));
  return m ? `${Number(m[3])}. ${Number(m[2])}. ${m[1]}.` : String(iso ?? "");
}
