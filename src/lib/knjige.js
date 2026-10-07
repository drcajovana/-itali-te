// Pretraga i dodavanje knjiga: naša baza, Google Books, link, ručni upis.
// Sve ide preko klijenta iz supabase.js; spoljni izvori preko api/ funkcija.
//
// Google Books je pomoć pri pretrazi uživo, ne izvor podataka: iz spoljnih izvora se
// trajno čuva samo ono što član potvrdi (red-knjige.js). Nikad opis, nikad Google-ova
// korica, nikad masovno.
import { supabase } from "./supabase.js";
import { GreskaApija, pozoviApi } from "./api.js";
import { uIsbn13 } from "./isbn.js";
import { redZaUpis, urediPotvrdu } from "./red-knjige.js";

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

// `knjiga` je ili red iz naše baze (ima `id`), ili POTVRĐENI spoljni rezultat:
// { podaci, izvor, korica }, gde su `podaci` izlaz iz urediPotvrdu (ono što je član
// video u formi i potvrdio). Vraća id knjige u našoj bazi, a ako je još nema, upisuje je.
// Upis radi običan član: okidač u bazi svakako postavlja izvor='clan' i u_fondu=false,
// pa član ne može da proglasi knjigu delom fonda.
async function nadjiIliUpisi(knjiga) {
  if (knjiga.id) return { id: knjiga.id, uFondu: knjiga.u_fondu ?? null };

  const { podaci, izvor, korica } = knjiga;

  // Ista knjiga po ISBN-u (isti ISBN-13 iz različitih izvora): ne pravi se duplikat,
  // a postojeći zapis se ne menja.
  if (podaci.isbn) {
    const slicne = await pretraziNasuBazu(podaci.isbn);
    const ista = slicne.find((k) => uIsbn13(k.isbn) === podaci.isbn);
    if (ista) return { id: ista.id, uFondu: ista.u_fondu };
  }

  const { data, error } = await supabase.from("knjige").insert(redZaUpis(podaci, izvor, korica)).select("id, u_fondu").single();
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
export function dodajRucno(clanId, naslov, autor) {
  const r = urediPotvrdu({ naslov, autor });
  if (!r.ok) throw new Error(`neispravan unos: ${r.polje} (${r.razlog})`);
  return dodajNaPolicu(clanId, { podaci: r.podaci, izvor: "clan" }, "zelim");
}

// Korica za PRIKAZ (PLAN.md, „Korice"): adresa iz naše baze ili iz rezultata (Google
// korica se samo prikazuje, ne čuva se), pa Open Library po ISBN-u, pa pločica (u
// komponenti Korica). Ovde samo poredak adresa koje vredi probati.
export function adreseKorica(knjiga) {
  const isbn = uIsbn13(knjiga.isbn);
  return [
    knjiga.korice_url ?? knjiga.korica,
    // default=false: Open Library vraća 404 kad korice nema, pa lanac ide dalje
    isbn ? `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg?default=false` : null,
  ].filter(Boolean);
}

// ───────────────────────── ekran za bibliotekare (unos linkovima) ─────────────────────────

// Postoji li već ova knjiga? Normalizaciju radi baza (trazi_knjige → privatno.norm_tekst i
// privatno.isbn13), pa „Андрић" i „Andric", kao i ISBN-10 i ISBN-13, daju isti pogodak.
//   poIsbn:   isti ISBN-13 (praktično sigurno ista knjiga)
//   poTekstu: svaka reč iz naslova i autora stoji u naslovu ili autoru postojećeg zapisa
//             (moguć duplikat; bibliotekar odlučuje)
export async function nadjiDuplikate({ isbn, naslov, autor }) {
  const poIsbn = isbn ? (await pretraziNasuBazu(isbn)).filter((k) => uIsbn13(k.isbn) === isbn) : [];
  const upit = [naslov, autor].filter(Boolean).join(" ");
  const poTekstu = (await pretraziNasuBazu(upit)).filter((k) => !poIsbn.some((i) => i.id === k.id));
  return { poIsbn, poTekstu };
}

// Upis kao PRIJAVLJENI bibliotekar (običan klijent, ne service_role): RLS i okidači važe.
// Okidač knjige_unos_clana za bibliotekare propušta u_fondu, broj primeraka i izvor.
export async function sacuvajKnjigu(red) {
  const { data, error } = await supabase.from("knjige").insert(red).select("id, naslov, u_fondu, izvor").single();
  if (error) throw error;
  return data;
}

// Povećanje broja primeraka postojećeg zapisa (novi primerci su slobodni). Ako je zapis
// bio „nije u fondu", postaje deo fonda. Uslov na tekuće vrednosti hvata istovremenu
// izmenu: ako se zapis u međuvremenu promenio, ne menja se ništa.
export async function dodajPrimerke(postojeca, kolicina) {
  const { data, error } = await supabase
    .from("knjige")
    .update({
      u_fondu: true,
      broj_primeraka: postojeca.broj_primeraka + kolicina,
      broj_slobodnih: postojeca.broj_slobodnih + kolicina,
    })
    .eq("id", postojeca.id)
    .eq("broj_primeraka", postojeca.broj_primeraka)
    .eq("broj_slobodnih", postojeca.broj_slobodnih)
    .select("id, broj_primeraka")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new GreskaApija("izmenjeno_u_medjuvremenu");
  return data;
}
