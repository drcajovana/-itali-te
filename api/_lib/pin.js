// PIN novog člana i resetovanog naloga: 6 cifara, iz kriptografskog generatora.
// Vraća se klijentu JEDNOM, u odgovoru; ne loguje se i ne čuva (Auth čuva samo hash lozinke).
import { randomInt } from "node:crypto";
import { DUZINA_PINA } from "../../src/lib/clan-unos.js";

// Tekst, ne broj: PIN može da počne nulom (007341). randomInt je ravnomeran (bez modulo pristrasnosti).
export function noviPin() {
  return String(randomInt(0, 10 ** DUZINA_PINA)).padStart(DUZINA_PINA, "0");
}

// Poruka greške iz Supabase-a ide u log samo bez PIN-a (ne bi trebalo da ga sadrži, ali se ne računa na to).
export const bezPina = (poruka, pin) => String(poruka ?? "").split(pin).join("***");
