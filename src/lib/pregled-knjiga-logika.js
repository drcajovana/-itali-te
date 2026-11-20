// Čista logika ekrana „Све књиге" (bibliotekar). Bez React-a i bez mreže. Upiti su u pregled-knjiga.js.
//
// Šta ekran sme da dobije: samo knjige i ZBIRNE brojeve (koliko čitalaca ima knjigu na polici). Funkcije iz migracije 0024 ne
// vraćaju ni jedan trag do člana (nema uneo_id, imena, broja karte, id-eva), a ovde se to ne dodaje.

export const NAJVISE_PO_STRANI = 50;

// Vrednosti filtera i redosleda su iste kao u funkciji public.pregled_knjiga (nepoznata vrednost je tamo greška 22023).
export const IZVORI = ["fond", "link", "google_books", "clan"];
export const ODLUKE = ["imamo", "nabavljamo", "ne_nabavljamo", "bez"];
export const REDOSLEDI = ["najnovije", "citaoca", "naslov"];
// Posebna vrednost filtera po izdavaču: knjige bez izdavača (isto kao u public.pregled_knjiga, migracija 0025).
export const BEZ_IZDAVACA = "__bez__";

// Filteri iz ekrana → parametri RPC-a (prazno = bez filtera).
export function parametriPregleda({ upit = "", izvor = "", odluka = "", izdavac = "", redosled = "najnovije", pomeraj = 0 } = {}) {
  return {
    p_izdavac: String(izdavac ?? "").trim() || null,
    p_upit: String(upit).trim() || null,
    p_izvor: IZVORI.includes(izvor) ? izvor : null,
    p_odluka: ODLUKE.includes(odluka) ? odluka : null,
    p_redosled: REDOSLEDI.includes(redosled) ? redosled : "najnovije",
    p_najvise: NAJVISE_PO_STRANI,
    p_pomeraj: Math.max(0, Math.trunc(Number(pomeraj) || 0)),
  };
}

// Ključ filtera: kad se promeni, lista počinje iznova (stranice se ne mešaju).
export const kljucFiltera = (f) => JSON.stringify([String(f.upit ?? "").trim(), f.izvor ?? "", f.odluka ?? "", f.izdavac ?? "", f.redosled ?? "najnovije"]);

// Filteri u adresi (URL parametri), da se izbor sačuva pri osvežavanju i povratku na ekran. Samo vrednosti koje nisu
// podrazumevane se upisuju; nepoznata vrednost izvora, odluke ili redosleda u adresi se ignoriše (ne šalje se bazi).
export const PARAMETRI_ADRESE = { upit: "q", izvor: "izvor", odluka: "odluka", izdavac: "izdavac", redosled: "redosled" };

export function filteriIzAdrese(params) {
  const uzmi = (k) => params?.get?.(PARAMETRI_ADRESE[k]) ?? "";
  const izvor = uzmi("izvor");
  const odluka = uzmi("odluka");
  const redosled = uzmi("redosled");
  return {
    upit: uzmi("upit").slice(0, 100),
    izvor: IZVORI.includes(izvor) ? izvor : "",
    odluka: ODLUKE.includes(odluka) ? odluka : "",
    izdavac: uzmi("izdavac").slice(0, 200),
    redosled: REDOSLEDI.includes(redosled) ? redosled : "najnovije",
  };
}

// Filteri → URLSearchParams (samo ono što nije podrazumevano).
export function filteriUAdresu(f) {
  const p = new URLSearchParams();
  const upit = String(f.upit ?? "").trim();
  if (upit) p.set(PARAMETRI_ADRESE.upit, upit);
  if (IZVORI.includes(f.izvor)) p.set(PARAMETRI_ADRESE.izvor, f.izvor);
  if (ODLUKE.includes(f.odluka)) p.set(PARAMETRI_ADRESE.odluka, f.odluka);
  if (f.izdavac) p.set(PARAMETRI_ADRESE.izdavac, f.izdavac);
  if (REDOSLEDI.includes(f.redosled) && f.redosled !== "najnovije") p.set(PARAMETRI_ADRESE.redosled, f.redosled);
  return p;
}

// Spisak izdavača iz baze (kljuc, naziv, broj) → opcije za padajući izbor: „Лагуна (42)", „Без издавача (3)".
// Redosled je već određen u bazi (broj opadajuće, pa naziv, „bez" poslednje). Ako je izabrani izdavač ispao iz spiska jer ga
// ostali filteri ne pogađaju, ostaje kao opcija sa brojem 0, da izbor ne nestane tiho.
export function opcijeIzdavaca(redovi, izabran, tekstovi) {
  // zamena funkcijom: naziv izdavača sa znakom $ ostaje kakav jeste
  const natpis = (naziv, n) => tekstovi.stavka.replace(/{(naziv|n)}/g, (_, k) => (k === "naziv" ? naziv : String(n)));
  const opcije = (redovi ?? []).map((x) => ({ kljuc: x.kljuc, natpis: natpis(x.kljuc === BEZ_IZDAVACA ? tekstovi.bez : (x.naziv ?? x.kljuc), x.broj) }));
  if (izabran && !opcije.some((o) => o.kljuc === izabran)) opcije.push({ kljuc: izabran, natpis: natpis(izabran === BEZ_IZDAVACA ? tekstovi.bez : izabran, 0) });
  return opcije;
}

// Polja forme za izmenu knjige iz reda liste (sve je tekst, kao i u formi za unos).
export const poljaIzmene = (k) => ({ naslov: k?.naslov ?? "", autor: k?.autor ?? "", izdavac: k?.izdavac ?? "", godina: k?.godina != null ? String(k.godina) : "", isbn: k?.isbn ?? "" });

// Ključ poruke (tekst.pregledKnjiga.izmena.greske) za grešku izmene: neispravan unos (polje + razlog), nema prava ili opšta greška.
export function kljucGreskeIzmene(g) {
  if (g?.polje === "naslov" && g.razlog === "prazno") return "naslov_prazno";
  if (g?.razlog === "predugo") return "predugo";
  if (g?.polje === "godina") return "godina_neispravno";
  if (g?.polje === "isbn") return "isbn_neispravno";
  if (g?.kod === "nema_dozvole" || g?.code === "42501") return "nema_dozvole";
  return "opste";
}

// Brisanje knjige sme samo administrator (RLS knjige_delete_admin); dugme se bibliotekaru ni ne nudi.
export const mozeDaBrise = (uloga) => uloga === "administrator";

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
