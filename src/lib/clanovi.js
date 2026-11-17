// Upiti za ekran bibliotekara: članovi. Običan klijent kao prijavljeni bibliotekar:
// RLS važi (bibliotekar vidi sve članove). Pravljenje naloga i novi PIN idu preko
// api/ funkcija, jer traže servisni ključ koji nikad ne dolazi u pregledač.
import { GreskaApija, pozoviApi } from "./api.js";
import { upitZaPretragu } from "./clan-unos.js";
import { oblikeUpita } from "./pismo.js";
import { supabase } from "./supabase.js";
import { tekst } from "./tekst.js";

export const NAJVISE_CLANOVA = 50;

// Članovi po imenu ili broju karte; najviše 50 (jedan više se traži samo da se zna da ima još).
// Ime je upisano ćirilicom ili latinicom, pa se traži u oba pisma (pismo.js); broj karte su cifre.
export async function ucitajClanove(upit) {
  let q = supabase.from("clanovi").select("id, broj_kartice, ime, nadimak, uloga, aktivan").order("ime").limit(NAJVISE_CLANOVA + 1);
  const cist = upitZaPretragu(upit);
  if (cist) q = q.or([...oblikeUpita(cist).map((o) => `ime.ilike.%${o}%`), `broj_kartice.ilike.%${cist}%`].join(","));
  const { data, error } = await q;
  if (error) throw error;
  return { lista: (data ?? []).slice(0, NAJVISE_CLANOVA), imaJos: (data ?? []).length > NAJVISE_CLANOVA };
}

export async function postaviAktivnost(id, aktivan) {
  const { data, error } = await supabase.from("clanovi").update({ aktivan }).eq("id", id).select("id, aktivan").maybeSingle();
  if (error) throw error;
  if (!data) throw new GreskaApija("aktivnost");
  return data;
}

// → { clan: { id, broj_kartice, ime, nadimak, uloga }, pin }. PIN se čuva samo u stanju ekrana.
export async function napraviClana(kartica, ime) {
  const [rezultat] = await pozoviApi("/api/napravi-clana", { kartica, ime });
  return rezultat;
}

// → { clan: { id, broj_kartice, ime }, pin }
export async function resetujPin(clanId) {
  const [rezultat] = await pozoviApi("/api/resetuj-pin", { clanId });
  return rezultat;
}

// Poruka za korisnika (tekst.clanovi.greske). Nepoznat kod daje opštu poruku.
export function porukaClanova(e) {
  const greske = tekst.clanovi.greske;
  const kod = e instanceof GreskaApija ? e.kod : "greska_servera";
  let poruka = greske[kod] ?? greske.greska_servera;
  if (kod === "previse_zahteva") poruka = poruka.replace("{minuta}", String(Math.max(1, Math.ceil((e.ponovoZaSekundi ?? 3600) / 60))));
  return poruka;
}
