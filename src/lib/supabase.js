// Jedan jedini Supabase klijent u celoj aplikaciji (plan, tačka 4).
// Ako se napravi drugi, Auth sesija počinje da se duplira i odjave postaju
// neuhvatljive — zato se uvozi odavde, nikad se ne pravi novi.
import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    "Nedostaju VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — vidi .env.example"
  );
}

export const supabase = createClient(url, anonKey, {
  auth: { persistSession: true, autoRefreshToken: true },
});

// Broj članske karte nije e-adresa, pa Auth radi sa sintetičkom (plan, tačka 4).
export const kartaUEmail = (brojKartice) =>
  `${String(brojKartice).trim().toLowerCase()}@citaliste.local`;
