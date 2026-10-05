// Један једини Supabase клијент у целој апликацији (план, тачка 4).
// Ако се направи други, Auth сесија почиње да се дуплира и одјаве постају
// неухватљиве — зато се увози одавде, никад се не прави нови.
import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    "Недостају VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — види .env.example"
  );
}

export const supabase = createClient(url, anonKey, {
  auth: { persistSession: true, autoRefreshToken: true },
});

// Број чланске карте није е-адреса, па Auth ради са синтетичком (план, тачка 4).
export const kartaUEmail = (brojKartice) =>
  `${String(brojKartice).trim().toLowerCase()}@citaliste.local`;
