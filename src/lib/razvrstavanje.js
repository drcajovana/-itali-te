// Upiti ekrana „Разврставање књига" (bibliotekar). Običan klijent kao prijavljeni bibliotekar ili administrator; prava određuje baza (RLS):
// knjige čita aktivan član, a menja samo bibliotekar i administrator (knjige_update_bibliotekar). Menja se samo kolona zanrovi.
// Ekran ne traži knjige.uneo_id ni išta što vodi do člana.
import { GreskaApija } from "./api.js";
import { nizZaUpit, saOblikom } from "./razvrstavanje-logika.js";
import { supabase } from "./supabase.js";

const KOLONE = "id, naslov, autor, izdavac, godina, isbn, zanrovi, korice_url, korice_izvor, korice_poreklo";
const NAJVISE_U_REDU = 40;

// Matične književne knjige bez oblika, poređane po autoru (knjige istog autora dolaze zajedno, pa „isti oblik za autora" ima smisla).
// `preskoceno` su id-evi koje je bibliotekar preskočio u ovoj sesiji; ne traže se ponovo.
function osnova(q, knjizevneGrupe, nazivi, preskoceno = []) {
  let r = q.is("spojena_sa_id", null).overlaps("zanrovi", knjizevneGrupe).not("zanrovi", "ov", nizZaUpit(nazivi));
  if (preskoceno.length) r = r.not("id", "in", `(${preskoceno.join(",")})`);
  return r;
}

export async function ucitajRed({ knjizevneGrupe, nazivi, preskoceno = [] }) {
  const { data, error } = await osnova(supabase.from("knjige").select(KOLONE), knjizevneGrupe, nazivi, preskoceno)
    .order("autor", { ascending: true, nullsFirst: false })
    .order("naslov", { ascending: true })
    .limit(NAJVISE_U_REDU);
  if (error) throw error;
  return data ?? [];
}

// Koliko knjiga ukupno čeka oblik (uključujući i preskočene).
export async function ucitajBrojPreostalih({ knjizevneGrupe, nazivi }) {
  const { count, error } = await osnova(supabase.from("knjige").select("id", { count: "exact", head: true }), knjizevneGrupe, nazivi);
  if (error) throw error;
  return count ?? 0;
}

// Upisuje oblik jednoj knjizi. Prazan odgovor znači da red ne postoji ili da nema prava.
export async function postaviOblik(id, zanrovi) {
  const { data, error } = await supabase.from("knjige").update({ zanrovi }).eq("id", id).select("id").maybeSingle();
  if (error) throw error;
  if (!data) throw new GreskaApija("nema_dozvole");
}

// Isti oblik svim knjigama istog autora koje još nemaju oblik (uključujući i onu otvorenu). Vraća [{ id, zanrovi }] sa STARIM žanrovima,
// da se može poništiti. Autor bez imena se ne grupiše: menja se samo otvorena knjiga.
export async function postaviOblikAutoru({ autor, oblik, knjizevneGrupe, nazivi }) {
  const { data, error } = await osnova(supabase.from("knjige").select("id, zanrovi"), knjizevneGrupe, nazivi).eq("autor", autor);
  if (error) throw error;
  const stare = [];
  try {
    for (const k of data ?? []) {
      await postaviOblik(k.id, saOblikom(k.zanrovi, oblik, nazivi));
      stare.push({ id: k.id, zanrovi: k.zanrovi });
    }
  } catch (e) {
    // ono što je već upisano se prijavljuje, da ekran može da ga poništi ili makar prikaže tačno stanje
    throw Object.assign(e instanceof Error ? e : new Error("upis"), { stare });
  }
  return stare;
}
