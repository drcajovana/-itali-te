// Upiti ekrana „Читаоци": pozivi, veze, blokade, prijave, preporuke. Običan klijent kao prijavljeni
// član: RLS važi. Ovde se NE odlučuje ko sme šta da vidi; ekran samo prikazuje ono što baza vrati,
// a prazno stanje kad ništa ne vrati (nema veze ili postoji blokada).
//
// Nadimci drugih članova dolaze samo iz pogleda moje_veze i moje_preporuke (migracija 0019); iz
// clanovi se ništa ne čita (i ne bi moglo: RLS).
import { GreskaApija } from "./api.js";
import { postaviStanje, ucitajPolicu, ucitajRedPolice } from "./polica.js";
import { supabase } from "./supabase.js";

const KNJIGA_ZA_PRIKAZ = "id, naslov, autor, isbn, korice_url, korice_izvor";

// Pozivi i veze (pogled moje_veze: samo moje, bez blokiranih, sa nadimkom druge strane).
export async function ucitajVeze() {
  const { data, error } = await supabase.from("moje_veze").select("id, clan_id, smer, status, kreirana, potvrdjena, nadimak").order("kreirana", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function ucitajVezu(id) {
  const { data, error } = await supabase.from("moje_veze").select("id, clan_id, smer, status, nadimak").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

// Veza sa jednim članom (po id-u člana) ili null. Ako veze nema ili postoji blokada, pogled ne
// vraća ništa: ekran ne može da razlikuje „nema veze" od „blokada", i ne treba.
export async function ucitajVezuSaClanom(clanId) {
  const { data, error } = await supabase.from("moje_veze").select("id, clan_id, smer, status, nadimak").eq("clan_id", clanId).eq("status", "prihvacena").maybeSingle();
  if (error) throw error;
  return data;
}

// Slanje poziva. Baza daje ISTU grešku (P0001) za šifru koja ne postoji, za sopstvenu šifru, za člana
// koji nije aktivan i za blokadu u bilo kom smeru; ovde se sve to pretvara u jedan kod.
// Vraća id veze (već postojeća veza se ne duplira).
export async function posaljiPoziv(sifra) {
  const { data, error } = await supabase.rpc("posalji_poziv", { sifra });
  if (error) {
    if (error.code === "P0001") throw new GreskaApija("sifra_nije_nadjena");
    throw error;
  }
  return data;
}

export async function prihvatiPoziv(vezaId) {
  const { error } = await supabase.rpc("prihvati_poziv", { veza: vezaId });
  if (error) {
    if (error.code === "P0001") throw new GreskaApija("poziv_nije_pronadjen");
    throw error;
  }
}

// Odbijanje primljenog poziva i povlačenje poslatog su običan DELETE reda koji čeka (RLS:
// veze_svoje_delete). Uslov na status čuva prihvaćenu vezu od slučajnog brisanja ovom putanjom.
export async function ukloniPoziv(vezaId) {
  const { data, error } = await supabase.from("veze").delete().eq("id", vezaId).eq("status", "na_cekanju").select("id");
  if (error) throw error;
  if (!data?.length) throw new GreskaApija("poziv_nije_pronadjen");
}

// Raskid prihvaćene veze: običan DELETE (RLS), bez obaveštenja drugoj strani.
export async function raskiniVezu(vezaId) {
  const { data, error } = await supabase.from("veze").delete().eq("id", vezaId).select("id");
  if (error) throw error;
  if (!data?.length) throw new GreskaApija("poziv_nije_pronadjen");
}

// Blokada: prvo upis blokade (od tog trenutka su_povezani je false i sve nestaje), pa brisanje veze.
// Blokirani ne dobija nikakav signal: veza mu jednostavno nestaje, kao pri raskidu.
export async function blokiraj(clanId, drugiId, vezaId) {
  const { error } = await supabase.from("blokade").insert({ blokirao_id: clanId, blokirani_id: drugiId });
  if (error && error.code !== "23505") throw error; // već blokiran: nastavlja se
  const { error: e2 } = await supabase.from("veze").delete().eq("id", vezaId);
  if (e2) console.error("brisanje veze posle blokade:", e2.code);
}

// Prijava bibliotekaru: tip 'clan' (stavka je id člana), 'utisak' ili 'preporuka'.
export async function prijavi(prijavioId, tip, stavkaId, razlog) {
  const { error } = await supabase.from("prijave").insert({ prijavio_id: prijavioId, tip, stavka_id: stavkaId, razlog });
  if (error) {
    if (error.code === "23505") throw new GreskaApija("vec_prijavljeno");
    // okidač iz 0021: stavka ne postoji, nije vidljiva prijaviocu ili nije njegova za prijavu
    if (error.code === "22023") throw new GreskaApija("stavka_nedostupna");
    throw error;
  }
}

// ── polica i utisci povezanog čitaoca ──
// Polica: isti upit kao za moju (polica.js, .eq("clan_id", ...)); tuđu policu RLS vraća samo ako smo
// povezani (polica_povezani_select), inače prazno.
export const ucitajPolicuCitaoca = (clanId) => ucitajPolicu(clanId);

// Njegovi utisci koje RLS pokazuje (javni, i „samo povezani" dok smo povezani; „samo ja" nikad), sa
// knjigama. Pogled utisci_sa_autorom ništa ne filtrira. Vraća { utisci, knjige: Map(id → knjiga) }.
export async function ucitajUtiskeCitaoca(clanId) {
  const { data, error } = await supabase
    .from("utisci_sa_autorom")
    .select("id, clan_id, knjiga_id, ocena, tekst, vidljivost, spojler, skriven, izmenjeno")
    .eq("clan_id", clanId)
    .order("izmenjeno", { ascending: false })
    .limit(100);
  if (error) throw error;
  const utisci = data ?? [];
  return { utisci, knjige: await knjigePoId(utisci.map((u) => u.knjiga_id)) };
}

async function knjigePoId(ids) {
  const jedinstveni = [...new Set(ids.filter(Boolean))];
  if (!jedinstveni.length) return new Map();
  const { data, error } = await supabase.from("knjige").select(KNJIGA_ZA_PRIKAZ).in("id", jedinstveni);
  if (error) throw error;
  return new Map((data ?? []).map((k) => [k.id, k]));
}

// ── preporuke ──
// Primljene i neobrađene (procitana = false), sa knjigama. Obrađena znači: primalac je odlučio
// (želim, već pročitano, nije za mene). skrivena (moderacija) i blokirani su već izbačeni u pogledu.
export async function ucitajPreporuke() {
  const { data, error } = await supabase
    .from("moje_preporuke")
    .select("id, knjiga_id, poruka, procitana, kreirana, posiljalac_nadimak")
    .eq("procitana", false)
    .order("kreirana", { ascending: false })
    .limit(50);
  if (error) throw error;
  const lista = data ?? [];
  const knjige = await knjigePoId(lista.map((p) => p.knjiga_id));
  return lista.map((p) => ({ ...p, knjiga: knjige.get(p.knjiga_id) ?? null })).filter((p) => p.knjiga);
}

export async function oznaciObradjenom(preporukaId) {
  const { data, error } = await supabase.from("preporuke").update({ procitana: true }).eq("id", preporukaId).select("id");
  if (error) throw error;
  if (!data?.length) throw new GreskaApija("preporuka_nije_pronadjena");
}

// „Желим да прочитам": knjiga ide na policu kao „zelim" samo ako je tamo nema; postojeće stanje
// (čitam, pročitano) se ne vraća unazad.
export async function preporukaNaPolicu(clanId, knjigaId, status) {
  const red = await ucitajRedPolice(clanId, knjigaId);
  if (status === "zelim" && red) return red;
  if (status === "procitano" && red?.status === "procitano") return red;
  return postaviStanje(clanId, knjigaId, status, red);
}

// Slanje preporuke povezanom čitaocu. Upis štiti RLS (preporuke_insert: samo ako su_povezani) i
// ograničenje napomene (280) i jedinstvenost neobrađene preporuke (0019).
export async function posaljiPreporuku(posiljalacId, primalacId, knjigaId, poruka) {
  const { error } = await supabase.from("preporuke").insert({ posiljalac_id: posiljalacId, primalac_id: primalacId, knjiga_id: knjigaId, poruka });
  if (error) {
    if (error.code === "23505") throw new GreskaApija("vec_poslato");
    if (error.code === "42501") throw new GreskaApija("nije_povezan");
    throw error;
  }
}

// ── obaveštenja (tačka na stavci „Читаоци") ──
// { pozivi, preporuke }: primljeni pozivi koji čekaju i preporuke koje primalac još nije obradio.
export async function ucitajObavestenja() {
  const [a, b] = await Promise.all([
    supabase.from("moje_veze").select("id", { count: "exact", head: true }).eq("smer", "primljen").eq("status", "na_cekanju"),
    supabase.from("moje_preporuke").select("id", { count: "exact", head: true }).eq("procitana", false),
  ]);
  if (a.error) throw a.error;
  if (b.error) throw b.error;
  return { pozivi: a.count ?? 0, preporuke: b.count ?? 0 };
}

// Javlja Okviru da osveži tačku (posle prihvatanja, odbijanja, obrade preporuke).
export const javiPromenu = () => window.dispatchEvent(new Event("citaoci-promena"));

// ── blokirani čitaoci ──
// Koga sam ja blokirao, sa nadimkom (pogled moje_blokade, migracija 0023: samo moje blokade, bez imena i broja karte).
export async function ucitajBlokirane() {
  const { data, error } = await supabase.from("moje_blokade").select("id, clan_id, kreirana, nadimak").order("kreirana", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

// Odblokiranje je običan DELETE svoje blokade (RLS blokade_svoje). Veza se ne vraća; blokirani ne dobija nikakav signal.
export async function odblokiraj(blokadaId) {
  const { data, error } = await supabase.from("blokade").delete().eq("id", blokadaId).select("id");
  if (error) throw error;
  if (!data?.length) throw new GreskaApija("blokada_nije_pronadjena");
}
