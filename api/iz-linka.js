// POST /api/iz-linka   (Authorization: Bearer <Supabase JWT člana>)
// Telo: { url }  — adresa stranice knjige (samo https, samo domeni sa bele liste)
// Odgovor: { rezultati: [{ naslov, autori, izdavac, godina, isbn, korica, izvor: 'link', url }] }
// Samo za bibliotekare i administratore (uloga se čita na serveru) odgovor ima i `dijagnostika`:
// iz kog izvora je pročitano svako polje i svi kandidati za koricu (sirova vrednost, adresa posle
// dopune prema konačnoj adresi stranice, ishod i razlog). Bez HTML-a i bez ičeg tajnog.
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
import { granicaIzLinka, jeBibliotekarskaUloga, obradi } from "./_lib/zajednicko.js";

// Verzija oblika keširanog odgovora: stariji zapisi (bez dijagnostike i bez korice sa API-ja) se
// ne koriste, nego se stranica čita iznova.
const KES_VERZIJA = 2;

// Dijagnostika (iz kog izvora je pročitano svako polje i svi kandidati za koricu) ide SAMO
// bibliotekarima i administratorima; uloga je pročitana na serveru. Nikad ceo HTML.
function zaKlijenta(rezultat, smeDijagnostiku) {
  const { dijagnostika, kesVerzija: _verzija, ...javno } = rezultat; // eslint-disable-line no-unused-vars
  return smeDijagnostiku && dijagnostika ? { ...javno, dijagnostika } : javno;
}

export default function handler(req, res) {
  return obradi(req, res, {
    ogranicenje: granicaIzLinka,
    proveri(telo) {
      const url = typeof telo.url === "string" ? telo.url.trim() : "";
      if (!url || url.length > 2000) throw new ApiGreska(400, "neispravan_link", "Adresa nije ispravna.");
      // Neispravan ili nedozvoljen link se odbija pre ograničenja i pre mreže.
      return { url: proveriUrl(url).href };
    },
    async radi({ url }, _clan, { uloga } = {}) {
      const smeDijagnostiku = jeBibliotekarskaUloga(uloga);
      const kljuc = kljucKesa(url);
      const kesirano = await izKesa(kljuc);
      if (kesirano?.kesVerzija === KES_VERZIJA) return [zaKlijenta({ ...kesirano, izKesa: true }, smeDijagnostiku)];

      const rezultat = await izvuciIzLinka(url);
      await uKes(kljuc, { ...rezultat, kesVerzija: KES_VERZIJA });
      return [zaKlijenta(rezultat, smeDijagnostiku)];
    },
  });
}
