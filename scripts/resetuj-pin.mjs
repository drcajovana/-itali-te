// Resetuje PIN postojećem članu (npr. administratoru koji je zaboravio PIN).
// Pokreće ga korisnik, lokalno:  npm run admin:resetuj-pin
// Broj karte i novi PIN se traže pitanjima, PIN se pri kucanju ne prikazuje.

import { createClient } from "@supabase/supabase-js";
import { jeIspravanPin, normalizujKarticu } from "../src/lib/kartica.js";
import { Prekinuto, pitaj, pitajTajno } from "./unos.mjs";

const URL_ = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !SERVICE) {
  console.error("Nedostaju VITE_SUPABASE_URL i/ili SUPABASE_SERVICE_ROLE_KEY u .env");
  process.exit(2);
}
if (!process.stdin.isTTY) {
  console.error("Pokrenite skriptu u terminalu.");
  process.exit(2);
}
const bezTajni = (t) => String(t ?? "").split(SERVICE).join("***");
const S = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

async function main() {
  console.log(`Reset PIN-a — projekat: ${new URL(URL_).host}\n`);
  const kartica = normalizujKarticu(await pitaj("Broj članske karte: "));
  if (!kartica) { console.error("Broj karte nije upisan."); return 1; }

  const { data: clan, error } = await S.from("clanovi").select("id, ime, uloga").eq("broj_kartice", kartica).maybeSingle();
  if (error) throw new Error(`pretraga člana: ${error.message}`);
  if (!clan) { console.error(`Karta ${kartica} ne postoji.`); return 1; }
  console.log(`  Nađen član: ${clan.ime} (${clan.uloga})`);

  const pin = await pitajTajno("Novi PIN (6 do 12 cifara): ");
  if (!jeIspravanPin(pin)) { console.error("PIN mora da ima 6 do 12 cifara. Ništa nije promenjeno."); return 1; }
  if (pin !== (await pitajTajno("Novi PIN još jednom: "))) { console.error("PIN-ovi se ne poklapaju. Ništa nije promenjeno."); return 1; }

  const r = await S.auth.admin.updateUserById(clan.id, { password: pin });
  if (r.error) throw new Error(`promena PIN-a: ${r.error.message}`);
  console.log(`\nPIN je promenjen za ${clan.ime}, karta ${kartica}. Sačuvajte ga u menadžeru lozinki.`);
  return 0;
}

let kod = 1;
try { kod = await main(); }
catch (e) {
  if (e instanceof Prekinuto) { console.log("Prekinuto, ništa nije promenjeno."); kod = 130; }
  else console.error(`Greška: ${bezTajni(e?.message ?? e)}`);
}
process.exitCode = kod;
