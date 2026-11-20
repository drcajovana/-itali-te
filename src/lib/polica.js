// Upiti za policu i utiske (običan klijent, kao prijavljeni član: RLS važi).
// Logika (prelaz stanja, napredak, ocena) je u polica-logika.js.
//
// Šta čita ko: vidljivost police i utisaka određuju politike u bazi. Ovde se NE filtrira po tome ko
// sme da vidi šta. Jedini filteri po članu (.eq("clan_id", ...)) služe tome da ekran traži SVOJU policu:
// RLS pokazuje i policu povezanih članova (i bibliotekaru sve), pa bi bez njega „moja polica" sadržala i tuđe.
import { promenaStanja, urediUtisak } from "./polica-logika.js";
import { supabase } from "./supabase.js";

const KNJIGA_ZA_PRIKAZ = "id, naslov, autor, isbn, korice_url, korice_izvor";

// Moja polica sa podacima o knjigama.
export async function ucitajPolicu(clanId) {
  const { data, error } = await supabase
    .from("polica")
    .select(`id, status, napredak, datum_pocetka, datum_kraja, izmenjeno, knjiga:knjige(${KNJIGA_ZA_PRIKAZ})`)
    .eq("clan_id", clanId)
    .order("izmenjeno", { ascending: false });
  if (error) throw error;
  return (data ?? []).filter((r) => r.knjiga); // red bez knjige (ne bi smelo) se ne prikazuje
}

// Red moje police za jednu knjigu (ili null).
export async function ucitajRedPolice(clanId, knjigaId) {
  const { data, error } = await supabase
    .from("polica")
    .select("id, status, napredak, datum_pocetka, datum_kraja")
    .eq("clan_id", clanId)
    .eq("knjiga_id", knjigaId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Promena stanja (Želim, Čitam, Pročitano); ako knjige nema na polici, dodaje se.
export async function postaviStanje(clanId, knjigaId, novo, postojeci = null) {
  const { data, error } = await supabase
    .from("polica")
    .upsert({ clan_id: clanId, knjiga_id: knjigaId, ...promenaStanja(postojeci, novo) }, { onConflict: "clan_id,knjiga_id" })
    .select("id, status, napredak, datum_pocetka, datum_kraja")
    .single();
  if (error) throw error;
  return data;
}

// Uklanjanje knjige sa MOJE police (briše se samo red police; utisak o knjizi je posebna stvar i ostaje). RLS (polica_svoja) dozvoljava brisanje samo
// svog reda; prazan odgovor znači da reda nema ili nije moj, pa se to javlja kao greška.
export async function ukloniSaPolice(redId) {
  const { data, error } = await supabase.from("polica").delete().eq("id", redId).select("id");
  if (error) throw error;
  if (!data?.length) throw new Error("nijedan red nije uklonjen");
}

export async function postaviNapredak(redId, napredak) {
  const { data, error } = await supabase.from("polica").update({ napredak }).eq("id", redId).select("id, status, napredak, datum_pocetka, datum_kraja").single();
  if (error) throw error;
  return data;
}

// Prosečna ocena i broj utisaka iz pogleda ocene_knjiga (pogled je security_invoker: računa se od utisaka
// koje RLS pokazuje onome ko čita). null kad knjiga nema nijedan utisak.
export async function ucitajOcenu(knjigaId) {
  const { data, error } = await supabase.from("ocene_knjiga").select("prosecna_ocena, broj_ocena, broj_utisaka").eq("knjiga_id", knjigaId).maybeSingle();
  if (error) throw error;
  return data;
}

// Moj utisak o knjizi (ili null).
export async function ucitajMojUtisak(clanId, knjigaId) {
  const { data, error } = await supabase
    .from("utisci")
    .select("id, ocena, tekst, vidljivost, spojler, skriven, izmenjeno, uneo_bibliotekar_id")
    .eq("clan_id", clanId)
    .eq("knjiga_id", knjigaId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Tuđi utisci o knjizi: samo oni koje RLS pokazuje (javni, „samo povezani" od povezanih, a
// bibliotekaru i skriveni). Uslov clan_id <> moj služi samo da se moj utisak ne prikaže dvaput
// (on je u formi); ne štiti ništa.
export async function ucitajTudjeUtiske(clanId, knjigaId) {
  const { data, error } = await supabase
    .from("utisci_sa_autorom")
    .select("id, ocena, tekst, vidljivost, spojler, skriven, kreiran, autor")
    .eq("knjiga_id", knjigaId)
    .neq("clan_id", clanId)
    .order("kreiran", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

// Upis ili izmena SVOG utiska (unos iz forme se uređuje u urediUtisak).
export async function sacuvajUtisak(clanId, knjigaId, unos, postojeciId = null) {
  const u = urediUtisak(unos);
  if (!u.ok) throw Object.assign(new Error(`${u.polje}_${u.razlog}`), { kod: `utisak_${u.polje}_${u.razlog}` });
  const kolone = "id, ocena, tekst, vidljivost, spojler, skriven, izmenjeno, uneo_bibliotekar_id";
  const q = postojeciId
    ? supabase.from("utisci").update(u.red).eq("id", postojeciId).select(kolone).single()
    : supabase.from("utisci").insert({ clan_id: clanId, knjiga_id: knjigaId, ...u.red }).select(kolone).single();
  const { data, error } = await q;
  if (error) throw error;
  return data;
}

export async function obrisiUtisak(id) {
  const { data, error } = await supabase.from("utisci").delete().eq("id", id).select("id");
  if (error) throw error;
  if (!data?.length) throw Object.assign(new Error("utisak nije obrisan"), { kod: "utisak_nije_obrisan" });
}
