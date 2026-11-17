// Upiti ekrana „Набавка". Običan klijent kao prijavljeni bibliotekar: izveštaj čita pogled
// izvestaj_za_nabavku (samo brojevi, redove vidi samo bibliotekar/administrator, migracija 0020);
// odluku upisuje običan UPDATE knjige (RLS knjige_update_bibliotekar). Ni polica, ni clanovi se ovde ne čitaju.
import { GreskaApija } from "./api.js";
import { supabase } from "./supabase.js";

export async function ucitajNabavku() {
  const { data, error } = await supabase
    .from("izvestaj_za_nabavku")
    .select("id, naslov, autor, izdavac, isbn, korice_url, korice_izvor, u_fondu, odluka, odluka_postavljena, odluka_datum, zele, citaju_ili_procitali")
    .order("zele", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

// odluka: 'imamo' | 'nabavljamo' | 'ne_nabavljamo' | null (bez odluke). Datum postavlja okidač u bazi.
export async function postaviOdluku(knjigaId, odluka) {
  const { data, error } = await supabase.from("knjige").update({ odluka_nabavke: odluka }).eq("id", knjigaId).select("id, odluka_nabavke, odluka_datum, u_fondu").maybeSingle();
  if (error) throw error;
  if (!data) throw new GreskaApija("nema_dozvole");
  return data;
}
