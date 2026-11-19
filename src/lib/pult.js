// Upiti ekrana „Утисак са пулта". Običan klijent kao prijavljeni bibliotekar: RLS važi (utisci_insert dozvoljava
// bibliotekaru upis u ime člana uz potpis uneo_bibliotekar_id = on sam; okidač iz 0022 čuva potpis).
import { GreskaApija } from "./api.js";
import { urediUtisakSaPulta } from "./pult-logika.js";
import { supabase } from "./supabase.js";

// Da li član već ima utisak za knjigu (bibliotekar čita sve utiske, RLS utisci_bibliotekar_select).
export async function imaUtisak(clanId, knjigaId) {
  const { data, error } = await supabase.from("utisci").select("id").eq("clan_id", clanId).eq("knjiga_id", knjigaId).maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

// Upis utiska u ime člana. Postojeći utisak člana se NE prepisuje (jedinstvenost clan_id + knjiga_id daje 23505):
// svoje reči član menja sam.
export async function sacuvajUtisakSaPulta(bibliotekarId, podaci) {
  const u = urediUtisakSaPulta(podaci);
  if (!u.ok) throw Object.assign(new Error(`${u.polje}_${u.razlog}`), { polje: u.polje, razlog: u.razlog });
  const { error } = await supabase.from("utisci").insert({ clan_id: podaci.clan.id, knjiga_id: podaci.knjiga.id, uneo_bibliotekar_id: bibliotekarId, ...u.red });
  if (error) {
    if (error.code === "23505") throw new GreskaApija("vec_ima");
    if (error.code === "22023") throw new GreskaApija("clan_nije_aktivan");
    throw error;
  }
}
