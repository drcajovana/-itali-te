// Izmena i brisanje knjige iz panela za bibliotekare („Све књиге"). Običan klijent kao prijavljeni bibliotekar ili administrator;
// prava određuje baza (RLS): izmenu sme bibliotekar i administrator (knjige_update_bibliotekar), brisanje SAMO administrator
// (knjige_delete_admin). Prazan odgovor znači da red ne postoji ili nema prava; ekran to prikazuje kao „немате право".
//
// Brisanje knjige briše i sve što je za nju vezano (strani ključevi sa on delete cascade): stavke na policama čitalaca, utiske i preporuke.
// Zato ga ekran traži uz potvrdu sa brojem čitalaca. Korica u našem Storage-u se uklanja uz knjigu (najbolje što može, greška ne poništava brisanje).
import { GreskaApija } from "./api.js";
import { BUCKET_KORICE } from "./korica-slika.js";
import { urediPotvrdu } from "./red-knjige.js";
import { supabase } from "./supabase.js";

const KOLONE = "id, naslov, autor, izdavac, godina, isbn";

// Izmena podataka o knjizi: naslov, autor, izdavač, godina, ISBN (iste provere kao pri unosu, red-knjige.js). Ostala polja se ne dodiruju.
// Vraća nove vrednosti (isbn je normalizovan u 13 cifara). Baca grešku sa poljem `polje` i `razlog` za neispravan unos.
export async function izmeniKnjigu(id, unos) {
  const u = urediPotvrdu(unos);
  if (!u.ok) throw Object.assign(new Error(`${u.polje}_${u.razlog}`), { polje: u.polje, razlog: u.razlog });
  const { data, error } = await supabase.from("knjige").update(u.podaci).eq("id", id).select(KOLONE).maybeSingle();
  if (error) throw error;
  if (!data) throw new GreskaApija("nema_dozvole");
  return data;
}

// Brisanje knjige (samo administrator, po RLS-u). Zatim se uklanjaju fajlovi korice iz našeg Storage-a (folder knjige).
export async function obrisiKnjigu(k) {
  const { data, error } = await supabase.from("knjige").delete().eq("id", k.id).select("id");
  if (error) throw error;
  if (!data?.length) throw new GreskaApija("nema_dozvole");
  if (k.korice_izvor === "preuzeto" || k.korice_izvor === "fotografija") await ukloniFajloveKorice(k.id);
  return true;
}

async function ukloniFajloveKorice(knjigaId) {
  try {
    const skladiste = supabase.storage.from(BUCKET_KORICE);
    const { data: fajlovi } = await skladiste.list(knjigaId);
    const putanje = (fajlovi ?? []).map((f) => `${knjigaId}/${f.name}`);
    if (putanje.length) await skladiste.remove(putanje);
  } catch (e) {
    console.error("brisanje korice uz knjigu:", e?.message);
  }
}
