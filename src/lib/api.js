// Poziv naših funkcija na Vercel-u (api/) sa tokenom sesije prijavljenog člana.
// Server proverava token; bez njega odgovara 401.
import { supabase } from "./supabase.js";
import { tekst } from "./tekst.js";

export class GreskaApija extends Error {
  constructor(kod, status = 0, ponovoZaSekundi = null) {
    super(kod);
    this.kod = kod;
    this.status = status;
    this.ponovoZaSekundi = ponovoZaSekundi;
  }
}

// Vraća niz rezultata ili baca GreskaApija (kod prevodi porukaGreske).
export async function pozoviApi(putanja, telo) {
  // getSession osvežava istekao token, ako je potrebno.
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new GreskaApija("nije_prijavljen", 401);

  let odgovor;
  try {
    odgovor = await fetch(putanja, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` },
      body: JSON.stringify(telo),
    });
  } catch {
    throw new GreskaApija("mreza");
  }

  let json = null;
  try {
    json = await odgovor.json();
  } catch {
    /* odgovor nije JSON (npr. 404 kad funkcije nisu pokrenute) */
  }
  if (!odgovor.ok) {
    // 404 bez našeg JSON-a: funkcije ne postoje (npr. samo `vite`, bez `vercel dev`).
    const kod = json?.greska?.kod ?? (odgovor.status === 404 ? "api_nedostupan" : "greska_servera");
    throw new GreskaApija(kod, odgovor.status, json?.greska?.ponovoZaSekundi ?? null);
  }
  return json?.rezultati ?? [];
}

// Poruka za korisnika iz tekst.js. Nepoznat kod daje opštu poruku.
export function porukaGreske(e) {
  const greske = tekst.pretraga.greske;
  const kod = e instanceof GreskaApija ? e.kod : "greska_servera";
  let poruka = greske[kod] ?? greske.greska_servera;
  if (kod === "previse_zahteva") {
    poruka = poruka.replace("{minuta}", String(Math.max(1, Math.ceil((e.ponovoZaSekundi ?? 3600) / 60))));
  }
  return poruka;
}
