// POST /api/iz-linka   (Authorization: Bearer <Supabase JWT člana>)
// Telo: { url }  — adresa stranice knjige (samo https, samo domeni sa bele liste)
// Odgovor: { rezultati: [{ naslov, autori, izdavac, godina, isbn, korica, izvor: 'link', url }] }
// `korica` je samo PREDLOG adrese slike (JSON-LD image ili og:image), ili null. Slika se ne
// preuzima ovde; to radi api/korica-iz-linka.js na zahtev bibliotekara. Opis se ne čita.
//
// Čita jednu stranicu koju je član sam zalepio (kao pregled linka), uz keš po
// adresi i ograničenje zahteva na sat: 30 za čitaoce, 200 za bibliotekare i
// administratore (uloga se čita na serveru iz tabele clanovi, ne iz zahteva).
// Ovo nije skidanje kataloga: jedna stranica po adresi koju je korisnik zalepio.
import { ApiGreska } from "./_lib/greska.js";
import { proveriUrl } from "./_lib/bezbedan-fetch.js";
import { izKesa, kljucKesa, uKes } from "./_lib/kes.js";
import { izvuciIzLinka } from "./_lib/parser-knjige.js";
import { granicaIzLinka, obradi } from "./_lib/zajednicko.js";

export default function handler(req, res) {
  return obradi(req, res, {
    ogranicenje: granicaIzLinka,
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
