// Keš pročitanih linkova (tabela kes_linkova, samo za service_role). Greška u
// kešu nikad ne obara zahtev: gubi se samo ubrzanje.

import { lokalnoBezBaze } from "./okruzenje.js";
import { servisniKlijent } from "./zajednicko.js";

const TRAJANJE_DANA = 7;
const REDOSLED_CISCENJA = 0.05; // u proseku svaki 20. upis briše istekle redove

const PRACENJE = /^(utm_|fbclid$|gclid$|mc_|ref$)/i;

// Isti članak sa različitim praćenjem u adresi je isti ključ.
export function kljucKesa(urlStr) {
  const u = new URL(urlStr);
  u.hash = "";
  u.hostname = u.hostname.toLowerCase();
  for (const k of [...u.searchParams.keys()]) if (PRACENJE.test(k)) u.searchParams.delete(k);
  u.searchParams.sort();
  return u.href.slice(0, 2000);
}

export async function izKesa(kljuc) {
  if (lokalnoBezBaze()) return null;
  try {
    const { data, error } = await servisniKlijent()
      .from("kes_linkova")
      .select("odgovor")
      .eq("url", kljuc)
      .gt("istice", new Date().toISOString())
      .maybeSingle();
    if (error) throw error;
    return data?.odgovor ?? null;
  } catch (e) {
    console.error("keš (čitanje):", e?.message ?? e);
    return null;
  }
}

export async function uKes(kljuc, odgovor) {
  if (lokalnoBezBaze()) return;
  try {
    const sada = new Date();
    const istice = new Date(sada.getTime() + TRAJANJE_DANA * 24 * 3600 * 1000);
    const S = servisniKlijent();
    const { error } = await S.from("kes_linkova").upsert({
      url: kljuc,
      odgovor,
      dohvaceno: sada.toISOString(),
      istice: istice.toISOString(),
    });
    if (error) throw error;
    if (Math.random() < REDOSLED_CISCENJA) await S.from("kes_linkova").delete().lt("istice", sada.toISOString());
  } catch (e) {
    console.error("keš (upis):", e?.message ?? e);
  }
}
