// Pravi prvog (ili još jednog) administratora: Auth nalog + red u clanovi sa
// ulogom 'administrator'. Pokreće ga korisnik, lokalno:
//
//   npm run admin:napravi
//
// Broj karte, ime i PIN se traže pitanjima u terminalu, ne kao argumenti
// komande, da ostanu van istorije ljuske. PIN se pri kucanju ne prikazuje.
// Ključevi se učitavaju iz .env preko node --env-file i nikad se ne ispisuju.
//
// Radi kao service_role: trigger clanovi_zastita propušta servisnu ulogu, pa
// uloga 'administrator' ostaje (običan korisnik to ne bi mogao).
//
// Broj karte i PIN su UVEK tekst (vodeća nula se čuva: 0101228, ne 101228).

import { createClient } from "@supabase/supabase-js";
import { jeIspravanPin, jeIspravnaKartica, kartaUEmail, normalizujKarticu } from "../src/lib/kartica.js";
import { Prekinuto, pitaj, pitajTajno } from "./unos.mjs";

const URL_ = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

const nedostaje = [!URL_ && "VITE_SUPABASE_URL", !SERVICE && "SUPABASE_SERVICE_ROLE_KEY"].filter(Boolean);
if (nedostaje.length) {
  console.error(`Nedostaju promenljive u .env: ${nedostaje.join(", ")}`);
  process.exit(2);
}
if (!process.stdin.isTTY) {
  console.error("Pokrenite skriptu u terminalu (traži unos pitanjima, PIN se ne prikazuje).");
  process.exit(2);
}

const bezTajni = (t) => String(t ?? "").split(SERVICE).join("***");
const S = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

const POKUSAJA = 3;

// Pogrešan unos ne prekida rad: poruka se ispiše i pita se ponovo.
// provera(unos) vraća { vrednost } ili { greska }.
async function pitajDok(pitanje, provera, { tajno = false } = {}) {
  for (let i = 0; i < POKUSAJA; i++) {
    const unos = tajno ? await pitajTajno(pitanje) : await pitaj(pitanje);
    const r = provera(unos);
    if (r.greska === undefined) return r.vrednost;
    console.log(`  ${r.greska}`);
  }
  console.error(`Previše pogrešnih pokušaja (${POKUSAJA}). Prekinuto, ništa nije napravljeno.`);
  return null;
}

const proveraKarte = (unos) => {
  const kartica = normalizujKarticu(unos);
  if (!kartica) return { greska: "Upišite broj karte." };
  if (!jeIspravnaKartica(kartica)) {
    return { greska: "Broj karte sme da ima samo slova bez kvačica, cifre, tačku, crticu i donju crtu." };
  }
  return { vrednost: kartica };
};
const proveraImena = (unos) => (unos ? { vrednost: unos } : { greska: "Upišite ime i prezime." });
const proveraPina = (pin) =>
  jeIspravanPin(pin) ? { vrednost: pin } : { greska: "PIN mora da ima 6 do 12 cifara (Supabase Auth traži najmanje 6 znakova)." };

async function pitajPin() {
  for (let i = 0; i < POKUSAJA; i++) {
    const pin = await pitajDok("PIN (6 do 12 cifara): ", proveraPina, { tajno: true });
    if (pin === null) return null;
    if (pin === (await pitajTajno("PIN još jednom: "))) return pin;
    console.log("  PIN-ovi se ne poklapaju, probajte ponovo.");
  }
  console.error(`Previše pogrešnih pokušaja (${POKUSAJA}). Prekinuto, ništa nije napravljeno.`);
  return null;
}

async function main() {
  console.log(`Pravljenje administratora — projekat: ${new URL(URL_).host}\n`);

  const postojeci = await S.from("clanovi").select("id", { count: "exact", head: true }).eq("uloga", "administrator");
  if (postojeci.error) throw new Error(`provera postojećih administratora: ${postojeci.error.message}`);
  if (postojeci.count > 0) {
    const odgovor = (await pitaj(`Administrator već postoji (${postojeci.count}). Napraviti još jednog? (da/ne): `)).toLowerCase();
    if (odgovor !== "da") {
      console.log("Prekinuto, ništa nije napravljeno.");
      return 0;
    }
  }

  const kartica = await pitajDok("Broj članske karte: ", proveraKarte);
  if (kartica === null) return 1;
  console.log(`  Karta se čuva kao tekst: ${kartica}`);

  const ime = await pitajDok("Ime i prezime: ", proveraImena);
  if (ime === null) return 1;

  const pin = await pitajPin();
  if (pin === null) return 1;

  const zauzeta = await S.from("clanovi").select("id").eq("broj_kartice", kartica).maybeSingle();
  if (zauzeta.error) throw new Error(`provera broja karte: ${zauzeta.error.message}`);
  if (zauzeta.data) {
    console.error(`Karta ${kartica} već postoji.`);
    return 1;
  }

  const nalog = await S.auth.admin.createUser({ email: kartaUEmail(kartica), password: pin, email_confirm: true });
  if (nalog.error) throw new Error(`pravljenje naloga: ${nalog.error.message}`);
  const id = nalog.data.user.id;

  const clan = await S.from("clanovi")
    .insert({ id, broj_kartice: kartica, ime, uloga: "administrator" })
    .select("sifra_poziva, uloga")
    .single();
  if (clan.error) {
    // Ne ostavljati Auth nalog bez reda u clanovi.
    const povracaj = await S.auth.admin.deleteUser(id);
    throw new Error(
      `upis u clanovi: ${clan.error.message}` +
        (povracaj.error ? ` (UPOZORENJE: Auth nalog ${kartaUEmail(kartica)} nije obrisan: ${povracaj.error.message})` : " (nalog je poništen)")
    );
  }

  console.log(`\nNapravljen administrator: ${ime}, karta ${kartica}.`);
  console.log(`Šifra za poziv: ${clan.data.sifra_poziva}`);
  console.log("Prijava u aplikaciju: broj karte i upravo uneti PIN.");
  return 0;
}

let kod = 1;
try {
  kod = await main();
} catch (e) {
  if (e instanceof Prekinuto) {
    console.log("Prekinuto, ništa nije napravljeno.");
    kod = 130;
  } else {
    console.error(`Greška: ${bezTajni(e?.message ?? e)}`);
  }
}
// Bez process.exit(): na Windows-u ruši Node odmah posle oslobađanja terminala.
process.exitCode = kod;
