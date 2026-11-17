// Zajednički tok obe funkcije:
//   1. samo POST;
//   2. Supabase JWT u Authorization zaglavlju se PROVERAVA (bez njega: 401);
//   3. oblik zahteva se proverava (neispravan zahtev ne troši ograničenje);
//   4. ograničenje zahteva na sat po članu (tabela u bazi, jer funkcije nemaju
//      stanje): 30 za čitaoce, a za iz-linka 200 za bibliotekare i administratore.
//      Uloga se čita NA SERVERU iz tabele clanovi (service_role), nikad iz zahteva;
//   5. posao funkcije.

import { createClient } from "@supabase/supabase-js";
import { ApiGreska, posalji, posaljiGresku } from "./greska.js";
import { anonKljuc, lokalnoBezBaze, servisniKljuc, supabaseUrl } from "./okruzenje.js";

export const NAJVISE_ZAHTEVA = 30; // čitaoci, i Google pretraga za sve
export const NAJVISE_ZAHTEVA_BIBLIOTEKAR = 200; // iz-linka za bibliotekare i administratore
export const PROZOR_SEKUNDI = 3600;

// Kante u kojima se broje zahtevi (public.uzmi_zahtev, migracija 0012). Svaka kanta
// ima svoje brojanje, pa veći limit za bibliotekare ne dira Google ni čitaoce.
export const KANTA_OPSTA = "api"; // čitaoci (obe funkcije zajedno) i Google pretraga
export const KANTA_BIBLIOTEKAR = "iz-linka:bibliotekar";
export const KANTA_KORICA = "korica-iz-linka:bibliotekar"; // preuzimanje slike korice (samo osoblje)
export const NAJVISE_KORICA = 100;

const ULOGE_SA_VECIM_LIMITOM = ["bibliotekar", "administrator"];
export const jeBibliotekarskaUloga = (uloga) => ULOGE_SA_VECIM_LIMITOM.includes(uloga);

// Granica za iz-linka: bibliotekar i administrator imaju 200 u svojoj kanti, svi ostali
// ostaju na opštoj (30). Prosleđuje se obradi kao ogranicenje(uloga).
export function granicaIzLinka(uloga) {
  return jeBibliotekarskaUloga(uloga)
    ? { kanta: KANTA_BIBLIOTEKAR, najvise: NAJVISE_ZAHTEVA_BIBLIOTEKAR }
    : { kanta: KANTA_OPSTA, najvise: NAJVISE_ZAHTEVA };
}

// Granica za iz-liste (stranica sa spiskom knjiga): samo bibliotekar i administrator, u ISTOJ kanti kao
// iz-linka za osoblje (200 na sat). Sam spisak troši jedan zahtev, a svaka knjiga koja se posle toga
// obrađuje troši po jedan kroz iz-linka. Ostali dobijaju 403 pre ograničenja i pre mreže.
export function granicaSpiska(uloga) {
  if (!jeBibliotekarskaUloga(uloga)) throw new ApiGreska(403, "nije_bibliotekar", "Само библиотекар може да чита спискове са сајта издавача.");
  return { kanta: KANTA_BIBLIOTEKAR, najvise: NAJVISE_ZAHTEVA_BIBLIOTEKAR };
}

// Granica za korica-iz-linka: samo bibliotekar i administrator. Ostali dobijaju 403 pre
// ograničenja i pre ikakvog mrežnog poziva.
export function granicaKorice(uloga) {
  if (!jeBibliotekarskaUloga(uloga)) throw new ApiGreska(403, "nije_bibliotekar", "Само библиотекар може да преузме корицу.");
  return { kanta: KANTA_KORICA, najvise: NAJVISE_KORICA };
}

// Članovi: pravljenje naloga i novi PIN (samo osoblje). Jedna kanta za obe funkcije, 60 na sat po
// korisniku; kad se potroši, ni jedna ne radi. Ostali dobijaju 403 pre ograničenja.
export const KANTA_CLANOVI = "clanovi:bibliotekar";
export const NAJVISE_CLANOVA = 60;

export function granicaClanova(uloga) {
  if (!jeBibliotekarskaUloga(uloga)) throw new ApiGreska(403, "nije_bibliotekar", "Само библиотекар може да управља члановима.");
  return { kanta: KANTA_CLANOVI, najvise: NAJVISE_CLANOVA };
}

const OPCIJE = { auth: { persistSession: false, autoRefreshToken: false } };

let servisni = null;
export function servisniKlijent() {
  const url = supabaseUrl();
  const kljuc = servisniKljuc();
  if (!url || !kljuc) throw new ApiGreska(500, "greska_servera", "Недостаје сервисни кључ.");
  servisni ??= createClient(url, kljuc, OPCIJE);
  return servisni;
}

// Proverava token kod Supabase Auth-a (ne samo potpis): odbija istekao,
// opozvan i svaki token koji nije sesija člana (npr. sam anon ključ).
export async function proveriClana(req) {
  const m = /^Bearer ([A-Za-z0-9._~+/-]+=*)$/.exec(String(req.headers?.authorization ?? ""));
  if (!m) throw new ApiGreska(401, "nije_prijavljen", "Пријавите се.");
  const token = m[1];

  const url = supabaseUrl();
  const anon = anonKljuc();
  if (!url || !anon) throw new ApiGreska(500, "greska_servera", "Недостаје подешавање Supabase-а.");

  const klijent = createClient(url, anon, { ...OPCIJE, global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data, error } = await klijent.auth.getUser(token);
  if (error || !data?.user) {
    if (error?.name === "AuthRetryableFetchError" || error?.status >= 500) {
      throw new ApiGreska(503, "auth_nedostupan", "Провера пријаве тренутно није могућа.");
    }
    throw new ApiGreska(401, "nije_prijavljen", "Сесија није исправна.");
  }

  // Red člana čita se sa njegovim tokenom: RLS dozvoljava svoj red i bez servisnog ključa.
  const { data: clan, error: e2 } = await klijent.from("clanovi").select("id, aktivan").eq("id", data.user.id).maybeSingle();
  if (e2) throw new ApiGreska(500, "greska_servera", "Читање члана није успело.");
  if (!clan || !clan.aktivan) throw new ApiGreska(403, "clanstvo_nije_aktivno", "Чланство није активно.");
  return clan;
}

// Zatvoreno kad baza nije dostupna: bez ograničenja se ne radi (osim lokalno,
// uz ZAHTEVI_BEZ_BAZE=1; vidi okruzenje.js).
// Uloga člana, pročitana u bazi pomoću service_role. Ne veruje se ničemu iz zahteva
// (telo, zaglavlja): čitalac koji pošalje { uloga: "bibliotekar" } dobija 30, ne 200.
// Zatvoreno: ako se uloga ne može pročitati, zahtev se odbija.
export async function ulogaClana(clanId) {
  const { data, error } = await servisniKlijent()
    .from("clanovi")
    .select("uloga")
    .eq("id", clanId)
    .eq("aktivan", true)
    .maybeSingle();
  if (error) {
    console.error("čitanje uloge nije uspelo:", error.message);
    throw new ApiGreska(503, "ogranicenje_nedostupno", "Ограничење захтева тренутно није доступно.");
  }
  return data?.uloga ?? "citalac";
}

// Uloga pozivaoca za funkcije samo za osoblje. obradi() je pročita kad računa ograničenje; uz
// ZAHTEVI_BEZ_BAZE (samo lokalno) nije pročitana, pa se čita ovde. Nikad iz zahteva.
export async function ulogaOsoblja(clan, ulogaIzObrade) {
  const uloga = ulogaIzObrade ?? (await ulogaClana(clan.id));
  if (!jeBibliotekarskaUloga(uloga)) throw new ApiGreska(403, "nije_bibliotekar", "Само библиотекар може да управља члановима.");
  return uloga;
}

export async function ogranici(clanId, kanta = KANTA_OPSTA, najvise = NAJVISE_ZAHTEVA) {
  if (lokalnoBezBaze()) return { preostalo: najvise };

  const { data, error } = await servisniKlijent().rpc("uzmi_zahtev", {
    p_clan: clanId,
    p_akcija: kanta,
    p_najvise: najvise,
    p_prozor_sekundi: PROZOR_SEKUNDI,
  });
  if (error) {
    console.error("uzmi_zahtev nije uspeo:", error.message);
    throw new ApiGreska(503, "ogranicenje_nedostupno", "Ограничење захтева тренутно није доступно.");
  }
  if (!data?.dozvoljeno) {
    const g = new ApiGreska(429, "previse_zahteva", "Превише захтева.");
    g.ponovoZaSekundi = data?.ponovo_za_sekundi ?? PROZOR_SEKUNDI;
    throw g;
  }
  return data;
}

export function procitajTelo(req) {
  let telo = req.body;
  if (typeof telo === "string") {
    try {
      telo = JSON.parse(telo);
    } catch {
      throw new ApiGreska(400, "neispravan_zahtev", "Тело захтева није исправан JSON.");
    }
  }
  if (!telo || typeof telo !== "object" || Array.isArray(telo)) {
    throw new ApiGreska(400, "neispravan_zahtev", "Очекује се JSON објекат.");
  }
  return telo;
}

// proveri(telo) → parametri za radi (baca ApiGreska za neispravan zahtev);
// radi(parametri, clan, { uloga }) → niz rezultata (uloga je pročitana na serveru ili null);
// ogranicenje(uloga) → { kanta, najvise } (neobavezno): kad ga funkcija zada, uloga se
// čita u bazi; bez njega važi opšta kanta (30 na sat) i uloga se ne čita.
export async function obradi(req, res, { proveri, radi, ogranicenje: granicaZa }) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      throw new ApiGreska(405, "metod_nije_dozvoljen", "Дозвољен је само ПОСТ.");
    }
    const clan = await proveriClana(req);
    const parametri = proveri(procitajTelo(req));
    let granica = { kanta: KANTA_OPSTA, najvise: NAJVISE_ZAHTEVA };
    let uloga = null; // samo ako je pročitana u bazi (nikad iz zahteva); inače null
    if (granicaZa && !lokalnoBezBaze()) {
      uloga = await ulogaClana(clan.id);
      granica = granicaZa(uloga);
    }
    const ogranicenje = await ogranici(clan.id, granica.kanta, granica.najvise);
    const rezultati = await radi(parametri, clan, { uloga });
    posalji(res, 200, { rezultati }, { "X-RateLimit-Remaining": String(ogranicenje.preostalo) });
  } catch (e) {
    posaljiGresku(res, e);
  }
}
