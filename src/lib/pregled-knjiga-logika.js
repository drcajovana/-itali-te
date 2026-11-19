// Čista logika ekrana „Све књиге" (bibliotekar). Bez React-a i bez mreže. Upiti su u pregled-knjiga.js.
//
// Šta ekran sme da dobije: samo knjige i ZBIRNE brojeve (koliko čitalaca ima knjigu na polici). Funkcije iz migracije 0024 ne
// vraćaju ni jedan trag do člana (nema uneo_id, imena, broja karte, id-eva), a ovde se to ne dodaje.

export const NAJVISE_PO_STRANI = 50;

// Vrednosti filtera i redosleda su iste kao u funkciji public.pregled_knjiga (nepoznata vrednost je tamo greška 22023).
export const IZVORI = ["fond", "link", "google_books", "clan"];
export const ODLUKE = ["imamo", "nabavljamo", "ne_nabavljamo", "bez"];
export const REDOSLEDI = ["najnovije", "citaoca", "naslov"];

// Filteri iz ekrana → parametri RPC-a (prazno = bez filtera).
export function parametriPregleda({ upit = "", izvor = "", odluka = "", redosled = "najnovije", pomeraj = 0 } = {}) {
  return {
    p_upit: String(upit).trim() || null,
    p_izvor: IZVORI.includes(izvor) ? izvor : null,
    p_odluka: ODLUKE.includes(odluka) ? odluka : null,
    p_redosled: REDOSLEDI.includes(redosled) ? redosled : "najnovije",
    p_najvise: NAJVISE_PO_STRANI,
    p_pomeraj: Math.max(0, Math.trunc(Number(pomeraj) || 0)),
  };
}

// Ključ filtera: kad se promeni, lista počinje iznova (stranice se ne mešaju).
export const kljucFiltera = (f) => JSON.stringify([String(f.upit ?? "").trim(), f.izvor ?? "", f.odluka ?? "", f.redosled ?? "najnovije"]);

// Da li ima još redova posle učitanih (ukupno je broj svih koji odgovaraju filteru, iz svakog reda).
export const imaJos = (ucitano, ukupno) => Number(ukupno) > ucitano;

// Zbir iz funkcije → redovi za prikaz po grupama. Brojevi su celi; nepoznato je 0.
export function grupeZbira(z) {
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  return {
    ukupno: n(z?.ukupno),
    spojenih: n(z?.spojenih),
    izvori: IZVORI.map((k) => ({ kljuc: k, broj: n(z?.[k]) })),
    odluke: [
      { kljuc: "imamo", broj: n(z?.imamo) },
      { kljuc: "nabavljamo", broj: n(z?.nabavljamo) },
      { kljuc: "ne_nabavljamo", broj: n(z?.ne_nabavljamo) },
      { kljuc: "bez", broj: n(z?.bez_odluke) },
    ],
  };
}

// Dobar zbir: izvori se sabiraju u ukupno i odluke se sabiraju u ukupno (proverava test; ekran ne zavisi od toga).
export function zbirJeUskladjen(z) {
  const g = grupeZbira(z);
  const sum = (a) => a.reduce((s, x) => s + x.broj, 0);
  return sum(g.izvori) === g.ukupno && sum(g.odluke) === g.ukupno;
}
