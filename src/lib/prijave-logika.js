// Čista logika ekrana „Пријаве" (bibliotekar): bez Supabase klijenta i bez React-a, da je test:api
// proverava bez mreže. Upiti su u prijave.js.
//
// Šta bibliotekar vidi određuje baza (RLS): prijave, utiske, i SAMO prijavljene preporuke
// (preporuke_prijavljene_select). Ovde se ništa ne filtrira po pravima; ovde se samo sklapa prikaz.
// Stavka na koju prijava pokazuje može da ne postoji (prijava preživi brisanje stavke, 0004), a to je
// običan slučaj, ne greška.

export const FILTERI = ["otvorene", "resene"];
export const NAJDUZA_BELESKA = 500;
export const NAJVISE_PRIJAVA = 50;

// Beleška bibliotekara uz rešenu prijavu: nije obavezna, do 500 znakova (granica je i u bazi, 0021).
export function urediBelesku(unos) {
  const s = String(unos ?? "").normalize("NFC").trim();
  if (s.length > NAJDUZA_BELESKA) return { ok: false, razlog: "predugo" };
  return { ok: true, vrednost: s || null };
}

const clanZaPrikaz = (c) => (c ? { id: c.id, ime: c.ime, nadimak: c.nadimak ?? null, broj_kartice: c.broj_kartice, uloga: c.uloga, aktivan: c.aktivan } : null);
const knjigaZaPrikaz = (k) => (k ? { id: k.id, naslov: k.naslov, autor: k.autor ?? null } : null);

// Prijave iz baze + sve što je potrebno za prikaz (mape po id-u) → redovi za ekran.
//   izvori: { clanovi, utisci, preporuke, knjige }, svaki Map(id → red)
// Svaki red ima `stavka` sa poljem `postoji`; kad stavke nema, ostalo je prazno.
export function sastaviPrijave(prijave, izvori = {}) {
  const clanovi = izvori.clanovi ?? new Map();
  const utisci = izvori.utisci ?? new Map();
  const preporuke = izvori.preporuke ?? new Map();
  const knjige = izvori.knjige ?? new Map();

  return (prijave ?? []).map((p) => {
    let stavka = { postoji: false };
    if (p.tip === "utisak") {
      const u = utisci.get(p.stavka_id);
      if (u) {
        stavka = {
          postoji: true,
          id: u.id,
          autor: clanZaPrikaz(clanovi.get(u.clan_id)),
          knjiga: knjigaZaPrikaz(knjige.get(u.knjiga_id)),
          ocena: u.ocena ?? null,
          tekst: u.tekst ?? null,
          vidljivost: u.vidljivost,
          spojler: Boolean(u.spojler),
          skriven: Boolean(u.skriven),
        };
      }
    } else if (p.tip === "preporuka") {
      const r = preporuke.get(p.stavka_id);
      if (r) {
        stavka = {
          postoji: true,
          id: r.id,
          posiljalac: clanZaPrikaz(clanovi.get(r.posiljalac_id)),
          primalac: clanZaPrikaz(clanovi.get(r.primalac_id)),
          knjiga: knjigaZaPrikaz(knjige.get(r.knjiga_id)),
          poruka: r.poruka ?? null,
          skrivena: Boolean(r.skrivena),
        };
      }
    } else if (p.tip === "clan") {
      const c = clanZaPrikaz(clanovi.get(p.stavka_id));
      if (c) stavka = { postoji: true, clan: c };
    }
    return {
      id: p.id,
      tip: p.tip,
      kreirana: p.kreirana,
      razlog: p.razlog ?? null,
      resena: Boolean(p.resena),
      resena_datum: p.resena_datum ?? null,
      beleska: p.beleska ?? null,
      prijavilac: clanZaPrikaz(clanovi.get(p.prijavio_id)),
      resio: clanZaPrikaz(clanovi.get(p.resio_id)),
      stavka,
    };
  });
}

// Id-evi članova, utisaka i preporuka koje treba učitati za dati spisak prijava.
export function potrebniIdovi(prijave) {
  const clanovi = new Set();
  const utisci = new Set();
  const preporuke = new Set();
  for (const p of prijave ?? []) {
    if (p.prijavio_id) clanovi.add(p.prijavio_id);
    if (p.resio_id) clanovi.add(p.resio_id);
    if (p.tip === "clan") clanovi.add(p.stavka_id);
    else if (p.tip === "utisak") utisci.add(p.stavka_id);
    else if (p.tip === "preporuka") preporuke.add(p.stavka_id);
  }
  return { clanovi: [...clanovi], utisci: [...utisci], preporuke: [...preporuke] };
}

// Popunjava šablon iz tekst.js: „Утисак члана {ime}" + { ime: "Ана" }. Zamena ide funkcijom, pa naslov
// knjige sa znakom $ ostaje kakav jeste (String.replace sa tekstom tumači „$&").
export const popuni = (sablon, vrednosti) => String(sablon).replace(/\{(\w+)\}/g, (celo, kljuc) => (kljuc in vrednosti ? String(vrednosti[kljuc] ?? "") : celo));

// Ime člana za prikaz osoblju (osoblje vidi pravo ime); bez člana dolazi zamena iz tekst.js.
export const imeClana = (c, zamena) => (c?.ime && String(c.ime).trim() ? String(c.ime).trim() : zamena);
