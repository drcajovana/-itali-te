// Pretraga i dodavanje knjiga: naša baza, Google Books, link, ručni upis.
// Sve ide preko klijenta iz supabase.js; spoljni izvori preko api/ funkcija.
import { supabase } from "./supabase.js";
import { pozoviApi } from "./api.js";
import { uIsbn13 } from "./isbn.js";

// 1. Naša baza. Normalizaciju teksta (ćirilica/latinica) radi baza, u funkciji
// trazi_knjige, preko privatno.norm_tekst.
export async function pretraziNasuBazu(upit) {
  const { data, error } = await supabase.rpc("trazi_knjige", { upit, najvise: 20 });
  if (error) throw error;
  return data ?? [];
}

// 2. Google Books (preko api/pretraga-google.js). Server prepoznaje ISBN u slobodnom upitu.
export const pretraziGoogle = (upit) => pozoviApi("/api/pretraga-google", { q: upit });

// 3. Link sa sajta izdavača (preko api/iz-linka.js).
export const izLinka = (url) => pozoviApi("/api/iz-linka", { url });

const praznoUNull = (v) => {
  const t = typeof v === "string" ? v.trim() : v;
  return t === "" || t === undefined ? null : t;
};

// Knjiga iz baze ima `id`; rezultat Google-a ili linka ima `izvor`, `autori`...
// Vraća id knjige u našoj bazi, a ako je još nema, upisuje je.
// Upis radi običan član: okidač u bazi svakako postavlja izvor='clan' i
// u_fondu=false, pa član ne može da proglasi knjigu delom fonda.
async function nadjiIliUpisi(knjiga) {
  if (knjiga.id) return { id: knjiga.id, uFondu: knjiga.u_fondu ?? null };

  // Ista knjiga po ISBN-u (isti ISBN-13 iz različitih izvora): ne pravi se duplikat.
  if (knjiga.isbn) {
    const slicne = await pretraziNasuBazu(knjiga.isbn);
    const ista = slicne.find((k) => uIsbn13(k.isbn) === knjiga.isbn);
    if (ista) return { id: ista.id, uFondu: ista.u_fondu };
  }

  const red = {
    naslov: knjiga.naslov.trim(),
    autor: praznoUNull((knjiga.autori ?? []).join(", ")),
    izdavac: praznoUNull(knjiga.izdavac),
    godina: knjiga.godina ?? null,
    isbn: knjiga.isbn ?? null,
    opis: praznoUNull(knjiga.opis),
    korice_url: knjiga.korica ?? null,
    // Odakle korica potiče; izvor knjige postavlja baza ('clan').
    korice_izvor: knjiga.korica ? (knjiga.izvor === "google_books" ? "google_books" : "og_slika") : null,
  };
  const { data, error } = await supabase.from("knjige").insert(red).select("id, u_fondu").single();
  if (error) throw error;
  return { id: data.id, uFondu: data.u_fondu };
}

// Dodavanje na policu (status: citam | procitano | zelim). Vraća { uFondu }.
export async function dodajNaPolicu(clanId, knjiga, status) {
  const { id, uFondu } = await nadjiIliUpisi(knjiga);
  const { error } = await supabase
    .from("polica")
    .upsert({ clan_id: clanId, knjiga_id: id, status }, { onConflict: "clan_id,knjiga_id" });
  if (error) throw error;
  return { uFondu };
}

// 4. Ručni upis: naslov i autor, ništa više. Ide na policu kao „želim da pročitam";
// knjiga je „nije u fondu" i ulazi u izveštaj za nabavku.
export const dodajRucno = (clanId, naslov, autor) =>
  dodajNaPolicu(clanId, { naslov, autori: [autor.trim()] }, "zelim");

// Korica iz lanca (PLAN.md, „Korice"): 1. naša baza, 2. Google Books, 4. og:image
// sa linka, svi kao `korice_url`/`korica`; 3. Open Library po ISBN-u; 5. pločica
// (u komponenti Korica). Ovde samo poredak adresa koje vredi probati.
export function adreseKorica(knjiga) {
  const isbn = uIsbn13(knjiga.isbn);
  return [
    knjiga.korice_url ?? knjiga.korica,
    // default=false: Open Library vraća 404 kad korice nema, pa lanac ide dalje
    isbn ? `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg?default=false` : null,
  ].filter(Boolean);
}
