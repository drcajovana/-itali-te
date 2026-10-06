// Zajednički tok obe funkcije:
//   1. samo POST;
//   2. Supabase JWT u Authorization zaglavlju se PROVERAVA (bez njega: 401);
//   3. oblik zahteva se proverava (neispravan zahtev ne troši ograničenje);
//   4. ograničenje 30 zahteva na sat po članu (tabela u bazi, jer funkcije
//      nemaju stanje);
//   5. posao funkcije.

import { createClient } from "@supabase/supabase-js";
import { ApiGreska, posalji, posaljiGresku } from "./greska.js";
import { anonKljuc, lokalnoBezBaze, servisniKljuc, supabaseUrl } from "./okruzenje.js";

export const NAJVISE_ZAHTEVA = 30;
export const PROZOR_SEKUNDI = 3600;

const OPCIJE = { auth: { persistSession: false, autoRefreshToken: false } };

let servisni = null;
export function servisniKlijent() {
  const url = supabaseUrl();
  const kljuc = servisniKljuc();
  if (!url || !kljuc) throw new ApiGreska(500, "greska_servera", "Nedostaje servisni ključ.");
  servisni ??= createClient(url, kljuc, OPCIJE);
  return servisni;
}

// Proverava token kod Supabase Auth-a (ne samo potpis): odbija istekao,
// opozvan i svaki token koji nije sesija člana (npr. sam anon ključ).
export async function proveriClana(req) {
  const m = /^Bearer ([A-Za-z0-9._~+/-]+=*)$/.exec(String(req.headers?.authorization ?? ""));
  if (!m) throw new ApiGreska(401, "nije_prijavljen", "Prijavite se.");
  const token = m[1];

  const url = supabaseUrl();
  const anon = anonKljuc();
  if (!url || !anon) throw new ApiGreska(500, "greska_servera", "Nedostaje podešavanje Supabase-a.");

  const klijent = createClient(url, anon, { ...OPCIJE, global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data, error } = await klijent.auth.getUser(token);
  if (error || !data?.user) {
    if (error?.name === "AuthRetryableFetchError" || error?.status >= 500) {
      throw new ApiGreska(503, "auth_nedostupan", "Provera prijave trenutno nije moguća.");
    }
    throw new ApiGreska(401, "nije_prijavljen", "Sesija nije ispravna.");
  }

  // Red člana čita se sa njegovim tokenom: RLS dozvoljava svoj red i bez servisnog ključa.
  const { data: clan, error: e2 } = await klijent.from("clanovi").select("id, aktivan").eq("id", data.user.id).maybeSingle();
  if (e2) throw new ApiGreska(500, "greska_servera", "Čitanje člana nije uspelo.");
  if (!clan || !clan.aktivan) throw new ApiGreska(403, "clanstvo_nije_aktivno", "Članstvo nije aktivno.");
  return clan;
}

// Zatvoreno kad baza nije dostupna: bez ograničenja se ne radi (osim lokalno,
// uz ZAHTEVI_BEZ_BAZE=1; vidi okruzenje.js).
export async function ogranici(clanId, akcija) {
  if (lokalnoBezBaze()) return { preostalo: NAJVISE_ZAHTEVA };

  const { data, error } = await servisniKlijent().rpc("uzmi_zahtev", {
    p_clan: clanId,
    p_akcija: akcija,
    p_najvise: NAJVISE_ZAHTEVA,
    p_prozor_sekundi: PROZOR_SEKUNDI,
  });
  if (error) {
    console.error("uzmi_zahtev nije uspeo:", error.message);
    throw new ApiGreska(503, "ogranicenje_nedostupno", "Ograničenje zahteva trenutno nije dostupno.");
  }
  if (!data?.dozvoljeno) {
    const g = new ApiGreska(429, "previse_zahteva", "Previše zahteva.");
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
      throw new ApiGreska(400, "neispravan_zahtev", "Telo zahteva nije ispravan JSON.");
    }
  }
  if (!telo || typeof telo !== "object" || Array.isArray(telo)) {
    throw new ApiGreska(400, "neispravan_zahtev", "Očekuje se JSON objekat.");
  }
  return telo;
}

// proveri(telo) → parametri za radi (baca ApiGreska za neispravan zahtev);
// radi(parametri, clan) → niz rezultata.
export async function obradi(req, res, akcija, { proveri, radi }) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      throw new ApiGreska(405, "metod_nije_dozvoljen", "Dozvoljen je samo POST.");
    }
    const clan = await proveriClana(req);
    const parametri = proveri(procitajTelo(req));
    const ogranicenje = await ogranici(clan.id, akcija);
    const rezultati = await radi(parametri, clan);
    posalji(res, 200, { rezultati }, { "X-RateLimit-Remaining": String(ogranicenje.preostalo) });
  } catch (e) {
    posaljiGresku(res, e);
  }
}
