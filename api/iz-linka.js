// POST /api/iz-linka   (Authorization: Bearer <Supabase JWT člana>)
// Telo: { url }  — adresa stranice knjige (samo https, samo domeni sa bele liste)
// Odgovor: { rezultati: [{ naslov, autori, izdavac, godina, isbn, opis, korica, izvor: 'link', url }] }
//
// Čita jednu stranicu koju je član sam zalepio (kao pregled linka), uz keš po
// adresi i ograničenje 30 zahteva na sat. Ovo nije skidanje kataloga.
import { ApiGreska } from "./_lib/greska.js";
import { proveriUrl } from "./_lib/bezbedan-fetch.js";
import { izKesa, kljucKesa, uKes } from "./_lib/kes.js";
import { izvuciIzLinka } from "./_lib/parser-knjige.js";
import { obradi } from "./_lib/zajednicko.js";

export default function handler(req, res) {
  return obradi(req, res, "iz-linka", {
    proveri(telo) {
      const url = typeof telo.url === "string" ? telo.url.trim() : "";
      if (!url || url.length > 2000) throw new ApiGreska(400, "neispravan_link", "Adresa nije ispravna.");
      // Neispravan ili nedozvoljen link se odbija pre ograničenja i pre mreže.
      return { url: proveriUrl(url).href };
    },
    async radi({ url }) {
      const kljuc = kljucKesa(url);
      const kesirano = await izKesa(kljuc);
      if (kesirano) return [{ ...kesirano, izKesa: true }];

      const rezultat = await izvuciIzLinka(url);
      await uKes(kljuc, rezultat);
      return [rezultat];
    },
  });
}
