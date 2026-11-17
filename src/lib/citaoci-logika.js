// Čista logika ekrana „Читаоци" (bez Supabase klijenta i bez React-a), da je test:api proverava bez
// mreže. Upiti su u citaoci.js. Ovde nema nikakvog odlučivanja ko sme šta da vidi: to je u RLS-u i u
// pogledima moje_veze i moje_preporuke (0019). Ovde su samo pravila oblika i prikaza.
//
// Šta se prikazuje o drugom članu: SAMO nadimak. Nikad ime, broj karte ni šifra poziva; kad nadimka
// nema, prikazuje se opšta reč (tekst.citaoci.anonimno), nikad nešto iz clanovi.

export const NAJDUZA_NAPOMENA = 280;
export const NAJDUZI_RAZLOG = 300;
const NAJKRACA_SIFRA = 4;
const NAJDUZA_SIFRA = 40;

// Šifra poziva kako je član ukucao: razmaci na krajevima se skidaju, unutra se sabijaju. Velika i mala
// slova i razdelnici („NEG·4471·KJ", „neg 4471 kj") se izjednačavaju u bazi (privatno.norm_sifra),
// pa se ovde ništa ne „popravlja". Vraća tekst ili null kad je prazna ili neverovatna.
export function urediSifru(unos) {
  if (typeof unos !== "string") return null;
  const s = unos.normalize("NFC").trim().replace(/\s+/g, " ");
  return s.length >= NAJKRACA_SIFRA && s.length <= NAJDUZA_SIFRA ? s : null;
}

// Napomena uz preporuku: najviše 280 znakova (ograničenje je i u bazi, 0019). Prazno je dozvoljeno (null).
export function urediNapomenu(unos) {
  const s = String(unos ?? "").normalize("NFC").trim();
  if (s.length > NAJDUZA_NAPOMENA) return { ok: false, razlog: "predugo" };
  return { ok: true, vrednost: s || null };
}

// Razlog prijave: kratak tekst, obavezan, do 300 znakova.
export function urediRazlog(unos) {
  const s = String(unos ?? "").normalize("NFC").trim();
  if (!s) return { ok: false, razlog: "prazno" };
  if (s.length > NAJDUZI_RAZLOG) return { ok: false, razlog: "predugo" };
  return { ok: true, vrednost: s };
}

// Redovi pogleda moje_veze po vrsti, najnovije prvo.
//   primljeni: poziv koji je neko poslao meni, čeka moju odluku
//   poslati:   poziv koji sam ja poslao, čeka drugu stranu
//   povezani:  prihvaćene veze
export function grupisiVeze(redovi) {
  const grupe = { primljeni: [], poslati: [], povezani: [] };
  const poVremenu = [...(redovi ?? [])].sort((a, b) => String(b.kreirana ?? "").localeCompare(String(a.kreirana ?? "")));
  for (const r of poVremenu) {
    if (r.status === "prihvacena") grupe.povezani.push(r);
    else if (r.status === "na_cekanju" && r.smer === "primljen") grupe.primljeni.push(r);
    else if (r.status === "na_cekanju" && r.smer === "poslat") grupe.poslati.push(r);
  }
  return grupe;
}

// Nadimak za prikaz; prazan ili samo razmaci daju zamenu (opšta reč iz tekst.js).
export const prikaznoIme = (nadimak, zamena) => (typeof nadimak === "string" && nadimak.trim() ? nadimak.trim() : zamena);

// Inicijali iz nadimka (do dva slova, velika); „Ана П." → „АП".
export function inicijaliNadimka(nadimak) {
  const slova = String(nadimak ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((r) => Array.from(r)[0].toLocaleUpperCase("sr"));
  return slova.join("") || "?";
}

// Boja avatara iz tema (index.css): ista za istog člana, bez čuvanja bilo čega.
export const BOJE_AVATARA = ["bg-bordo", "bg-avatar-smeda", "bg-zlato", "bg-avatar-ljubicasta"];
export function bojaAvatara(id) {
  let h = 0;
  for (const ch of String(id ?? "")) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return BOJE_AVATARA[h % BOJE_AVATARA.length];
}

// Zbir obaveštenja za tačku na stavci „Читаоци": primljeni pozivi koji čekaju + preporuke koje primalac
// još nije obradio.
export const brojObavestenja = (pozivi, preporuke) => (Number(pozivi) || 0) + (Number(preporuke) || 0);

// Veze koje se nude na stranici knjige i profilu: samo prihvaćene.
export const povezaniSamo = (redovi) => (redovi ?? []).filter((r) => r.status === "prihvacena");

// Utisci jednog člana grupisani sa knjigom (za profil): { utisak, knjiga } po utisku; utisak bez
// knjige (nema je u mapi) se izostavlja. Ocena se uzima iz utiska (mapa knjiga → ocena).
export function utisciSaKnjigama(utisci, knjigePoId) {
  return (utisci ?? []).map((u) => ({ utisak: u, knjiga: knjigePoId.get(u.knjiga_id) })).filter((x) => x.knjiga);
}
export function ocenePoKnjizi(utisci) {
  const mapa = new Map();
  for (const u of utisci ?? []) if (u.ocena != null) mapa.set(u.knjiga_id, u.ocena);
  return mapa;
}
