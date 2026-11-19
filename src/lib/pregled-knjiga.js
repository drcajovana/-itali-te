// Upiti ekrana „Све књиге" (bibliotekar). Običan klijent kao prijavljeni bibliotekar; sve ide kroz dve funkcije iz migracije 0024
// (public.pregled_knjiga_zbir i public.pregled_knjiga), koje vraćaju samo knjige i zbirne brojeve, bez ikakvog traga do člana.
// Ekran nikad ne čita tabele polica ni clanovi, i ne traži knjige.uneo_id.
import { parametriPregleda } from "./pregled-knjiga-logika.js";
import { supabase } from "./supabase.js";

export async function ucitajZbirKnjiga() {
  const { data, error } = await supabase.rpc("pregled_knjiga_zbir");
  if (error) throw error;
  return data?.[0] ?? null;
}

// Jedna stranica liste (najviše 50). Svaki red nosi `ukupno`: koliko knjiga odgovara filteru, na svim stranicama.
export async function ucitajStranuKnjiga(filteri) {
  const { data, error } = await supabase.rpc("pregled_knjiga", parametriPregleda(filteri));
  if (error) throw error;
  const redovi = data ?? [];
  return { redovi, ukupno: redovi.length ? Number(redovi[0].ukupno) : 0 };
}
