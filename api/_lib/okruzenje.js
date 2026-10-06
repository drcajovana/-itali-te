// Promenljive okruženja za funkcije. Na Vercel-u postoje VITE_SUPABASE_URL,
// SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (Secret). Ključevi se nikad ne
// ispisuju, ni u greškama.

export const supabaseUrl = () => process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
export const anonKljuc = () => process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
export const servisniKljuc = () => process.env.SUPABASE_SERVICE_ROLE_KEY;
export const googleKljuc = () => process.env.GOOGLE_BOOKS_API_KEY;

// Samo za lokalno testiranje, kad servisni ključ nije dostupan (na Vercel-u je
// Secret i ne može da se povuče). Preskače keš i ograničenje broja zahteva;
// provera prijave (JWT) ostaje. Ne radi na Vercel-u: tamo je VERCEL_ENV
// 'production' ili 'preview', pa se promenljiva ignoriše čak i ako je postavljena.
export const lokalnoBezBaze = () =>
  process.env.ZAHTEVI_BEZ_BAZE === "1" && (!process.env.VERCEL_ENV || process.env.VERCEL_ENV === "development");
