// Upiti ekrana „Пријаве" (bibliotekar). Običan klijent kao prijavljeni bibliotekar: RLS važi, pa se
// vidi samo ono što baza dozvoli (prijave, utisci, članovi i SAMO prijavljene preporuke). Izmene
// prijave štiti okidač (0021): menjaju se samo `resena` i `beleska`, a ko je rešio i kada upisuje baza.
import { GreskaApija } from "./api.js";
import { NAJVISE_PRIJAVA, potrebniIdovi, sastaviPrijave } from "./prijave-logika.js";
import { supabase } from "./supabase.js";

const KOLONE_PRIJAVE = "id, prijavio_id, tip, stavka_id, razlog, resena, resio_id, beleska, kreirana, resena_datum";
const KOLONE_CLANA = "id, ime, nadimak, broj_kartice, uloga, aktivan";

async function uzmi(upit) {
  const { data, error } = await upit;
  if (error) throw error;
  return data ?? [];
}

const poId = (redovi) => new Map(redovi.map((r) => [r.id, r]));

// Nerešene idu od najstarije (prvo se rešava ono što najduže čeka), rešene od najnovije.
// Traži se jedna više od granice, samo da se zna da ima još.
export async function ucitajPrijave(resene) {
  let q = supabase.from("prijave").select(KOLONE_PRIJAVE).eq("resena", resene).limit(NAJVISE_PRIJAVA + 1);
  q = resene ? q.order("resena_datum", { ascending: false }) : q.order("kreirana", { ascending: true });
  const sve = await uzmi(q);
  const prijave = sve.slice(0, NAJVISE_PRIJAVA);
  const ids = potrebniIdovi(prijave);

  const [utisci, preporuke] = await Promise.all([
    ids.utisci.length ? uzmi(supabase.from("utisci").select("id, clan_id, knjiga_id, ocena, tekst, vidljivost, spojler, skriven").in("id", ids.utisci)) : [],
    ids.preporuke.length ? uzmi(supabase.from("preporuke").select("id, posiljalac_id, primalac_id, knjiga_id, poruka, skrivena").in("id", ids.preporuke)) : [],
  ]);

  const clanIds = new Set(ids.clanovi);
  for (const u of utisci) clanIds.add(u.clan_id);
  for (const r of preporuke) {
    clanIds.add(r.posiljalac_id);
    clanIds.add(r.primalac_id);
  }
  const knjigaIds = [...new Set([...utisci.map((u) => u.knjiga_id), ...preporuke.map((r) => r.knjiga_id)].filter(Boolean))];

  const [clanovi, knjige] = await Promise.all([
    clanIds.size ? uzmi(supabase.from("clanovi").select(KOLONE_CLANA).in("id", [...clanIds])) : [],
    knjigaIds.length ? uzmi(supabase.from("knjige").select("id, naslov, autor").in("id", knjigaIds)) : [],
  ]);

  return {
    lista: sastaviPrijave(prijave, { clanovi: poId(clanovi), utisci: poId(utisci), preporuke: poId(preporuke), knjige: poId(knjige) }),
    imaJos: sve.length > NAJVISE_PRIJAVA,
  };
}

// Broj nerešenih prijava (tačka na stavci „Библиотека" i broj na početnom ekranu osoblja).
export async function ucitajBrojOtvorenih() {
  const { count, error } = await supabase.from("prijave").select("id", { count: "exact", head: true }).eq("resena", false);
  if (error) throw error;
  return count ?? 0;
}

// Izmena jednog reda; prazan odgovor znači da red ne postoji ili izmena nije dozvoljena.
async function izmeni(tabela, id, polja) {
  const { data, error } = await supabase.from(tabela).update(polja).eq("id", id).select("id");
  if (error) throw error;
  if (!data?.length) throw new GreskaApija("nije_sacuvano");
}

export const resiPrijavu = (id, beleska) => izmeni("prijave", id, { resena: true, beleska });
export const vratiPrijavu = (id) => izmeni("prijave", id, { resena: false });
export const postaviSakrivenUtisak = (id, skriven) => izmeni("utisci", id, { skriven });
export const postaviSakrivenuPreporuku = (id, skrivena) => izmeni("preporuke", id, { skrivena });

// Javlja Okviru da osveži broj nerešenih (isti događaj kao ekran „Читаоци").
export const javiPromenuPrijava = () => window.dispatchEvent(new Event("citaoci-promena"));
