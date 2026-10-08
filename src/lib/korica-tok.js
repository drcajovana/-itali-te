// Čuvanje knjige iz linka ZAJEDNO sa koricom (ekran /bibliotekar/unos). Čist modul: sve što
// radi nešto spolja (upis knjige, preuzimanje korice, otpremanje slike, čekanje) dobija se kao
// funkcija, pa ga test:api proverava bez mreže i bez Supabase klijenta.
//
// Pravila:
//   1. prvo se upisuje knjiga, pa tek onda korica (korici treba ID knjige);
//   2. greška pri koricu NIKAD ne poništava upis knjige: knjiga ostaje sačuvana (sa pločicom),
//      a ishod nosi čitljiv razlog, da kartica ponudi „Pokušaj ponovo";
//   3. korica se preuzima samo ako je izbor 'preuzmi' (kvačica „Preuzmi i koricu"); isključena
//      kvačica ne šalje nikakav zahtev;
//   4. „Sačuvaj sve": knjige redom, uz pauzu između dva preuzimanja; kad server javi da je
//      ograničenje potrošeno (previse_zahteva), ostale se čuvaju bez korice.
import { tekst } from "./tekst.js";

// Izbor korice za karticu: podrazumevano „preuzmi" kad je link dao predlog, inače „bez".
// 'slika' (bibliotekar je izabrao drugu sliku) važi samo dok slika postoji.
export function izborKorice(stavka) {
  const predlog = stavka?.rezultat?.korica ?? null;
  const izbor = stavka?.koricaIzbor;
  if (izbor === "slika") return stavka?.slika?.blob ? "slika" : predlog ? "preuzmi" : "bez";
  if (izbor === "bez") return "bez";
  if (izbor === "preuzmi") return predlog ? "preuzmi" : "bez";
  return predlog ? "preuzmi" : "bez";
}

// Razlog za korisnika (tekst.js) iz greške preuzimanja ili otpremanja. Radi i za GreskaApija
// (kod iz api/) i za greške iz knjige.js (kod: slika_tip, nema_dozvole...).
export function razlogKorice(greska) {
  const T = tekst.korice;
  const kod = greska?.kod;
  let poruka = T.preuzimanjeGreske[kod] ?? T.greske[kod] ?? tekst.pretraga.greske[kod] ?? T.greske.korica_upload;
  if (kod === "previse_zahteva") poruka = poruka.replace("{minuta}", String(Math.max(1, Math.ceil((greska.ponovoZaSekundi ?? 3600) / 60))));
  return poruka;
}

// Primenjuje izbor na već upisanu knjigu. Nikad ne baca grešku; vraća ishod:
//   { ishod: 'bez' }                               ništa nije traženo (ili nema šta)
//   { ishod: 'preuzeta' | 'slika', korica }        korica je postavljena (adresa u `korica`)
//   { ishod: 'greska', razlog, kod }               nije uspelo; knjiga ostaje sačuvana
//   { ishod: 'limit', razlog }                     ograničenje preuzimanja je potrošeno
// `ogranicenjePotroseno`: preuzimanje se ni ne pokušava (vidi sacuvajSve).
export async function primeniKoricu({ izbor, predlog = null, slika = null, knjigaId, preuzmi, otpremi, ogranicenjePotroseno = false }) {
  if (izbor === "preuzmi" && predlog) {
    if (ogranicenjePotroseno) return { ishod: "limit", razlog: tekst.korice.limitPotrosen };
    try {
      const r = await preuzmi(knjigaId, predlog);
      return { ishod: "preuzeta", korica: r.korica_url };
    } catch (e) {
      if (e?.kod === "previse_zahteva") return { ishod: "limit", razlog: razlogKorice(e), kod: e.kod };
      return { ishod: "greska", razlog: razlogKorice(e), kod: e?.kod ?? null };
    }
  }
  if (izbor === "slika" && slika?.blob) {
    try {
      return { ishod: "slika", korica: await otpremi(knjigaId, slika.blob) };
    } catch (e) {
      return { ishod: "greska", razlog: razlogKorice(e), kod: e?.kod ?? null };
    }
  }
  return { ishod: "bez" };
}

// Jedna knjiga: upis, pa korica. `upisi()` vraća { status: 'sacuvano', id } ili { status: 'duplikat' | 'greska' }.
// Korica se ne pokušava ako upis nije uspeo. `naKorici(stanje)` javlja kartici da korica počinje;
// `pauza()` se čeka neposredno pre zahteva za preuzimanje.
export async function sacuvajPaKoricu({ upisi, izbor, predlog, slika, preuzmi, otpremi, ogranicenjePotroseno = false, naKorici = () => {}, pauza = async () => {} }) {
  const upis = await upisi();
  if (upis.status !== "sacuvano") return { upis: upis.status, korica: null };
  if (izbor === "bez" || (izbor === "preuzmi" && !predlog) || (izbor === "slika" && !slika?.blob)) return { upis: "sacuvano", id: upis.id, korica: { ishod: "bez" } };
  const saljeZahtev = izbor === "preuzmi" && !ogranicenjePotroseno;
  if (saljeZahtev) await pauza(); // pauza tek kad se zahtev stvarno šalje (ne pre duplikata ni pre ostalih)
  if (!(izbor === "preuzmi" && ogranicenjePotroseno)) naKorici("radi");
  const korica = await primeniKoricu({ izbor, predlog, slika, knjigaId: upis.id, preuzmi, otpremi, ogranicenjePotroseno });
  return { upis: "sacuvano", id: upis.id, korica };
}

const spavaj = (ms) => new Promise((r) => setTimeout(r, ms));
export const PAUZA_PREUZIMANJA_MS = 1200;

// „Sačuvaj sve potvrđene": stavke = [{ id, izbor, predlog, slika }], redom. `sacuvaj(stavka, opcije)`
// radi upis i primenjuje koricu preko sacuvajPaKoricu i vraća njen rezultat. Između dva
// PREUZIMANJA je pauza (kao kod čitanja linkova); kad server javi ograničenje, preostale knjige
// se čuvaju bez korice. `sacuvaj` dobija { ogranicenjePotroseno, pauza } i prosleđuje ih u sacuvajPaKoricu. `naStavku(id, rezultat)` javlja kartici. Vraća zbir (vidi tekstSazetka).
export async function sacuvajSve(stavke, { sacuvaj, naStavku = () => {}, cekaj = spavaj, pauzaMs = PAUZA_PREUZIMANJA_MS }) {
  const zbir = { sacuvano: 0, ostalo: 0, preuzeta: 0, slika: 0, bez: 0, nijeUspelo: [], limit: 0 };
  let ogranicenjePotroseno = false;
  let bilaPreuzimanja = false;
  // pauza između dva preuzimanja: čeka se tek neposredno pre zahteva, ne pre prvog
  const pauza = async () => {
    if (bilaPreuzimanja) await cekaj(pauzaMs);
    bilaPreuzimanja = true;
  };
  for (const s of stavke) {
    const r = await sacuvaj(s, { ogranicenjePotroseno, pauza });
    naStavku(s.id, r);
    if (r.upis !== "sacuvano") {
      zbir.ostalo++;
      continue;
    }
    zbir.sacuvano++;
    const k = r.korica ?? { ishod: "bez" };
    if (k.ishod === "preuzeta") zbir.preuzeta++;
    else if (k.ishod === "slika") zbir.slika++;
    else if (k.ishod === "limit") {
      ogranicenjePotroseno = true;
      zbir.limit++;
    } else if (k.ishod === "greska") zbir.nijeUspelo.push({ id: s.id, razlog: k.razlog });
    else zbir.bez++;
  }
  return zbir;
}

// Sažetak za bibliotekara: koliko je sačuvano, kod koliko je korica preuzeta, a kod kojih nije i zašto.
// `naslovi`: { id: naslov } za spisak neuspelih.
export function tekstSazetka(zbir, naslovi = {}) {
  const S = tekst.unos.sazetak;
  const delovi = [S.sacuvano.replace("{n}", String(zbir.sacuvano))];
  if (zbir.preuzeta) delovi.push(S.preuzeta.replace("{n}", String(zbir.preuzeta)));
  if (zbir.slika) delovi.push(S.slika.replace("{n}", String(zbir.slika)));
  if (zbir.nijeUspelo.length) {
    const spisak = zbir.nijeUspelo.map((x) => `${naslovi[x.id] ?? "?"}: ${x.razlog}`).join(" ");
    delovi.push(S.nijeUspelo.replace("{n}", String(zbir.nijeUspelo.length)).replace("{spisak}", spisak));
  }
  if (zbir.limit) delovi.push(S.limit.replace("{n}", String(zbir.limit)));
  if (zbir.ostalo) delovi.push(S.ostalo.replace("{m}", String(zbir.ostalo)));
  return delovi.join(" ");
}
