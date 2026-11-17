// POST /api/iz-liste   (Authorization: Bearer <Supabase JWT bibliotekara ili administratora>)
// Telo: { url }  — adresa STRANICE SA SPISKOM knjiga jednog izdavača (samo https, samo domeni sa bele liste)
// Odgovor: { rezultati: [{ stranica, linkovi: [{ url, naslov }], ukupno, skraceno, izbacenoRobots,
//            robotsProcitan, pauzaSekundi, sledeca }] }
//
// Izvlači najviše 50 linkova ka stranicama knjiga (api/_lib/spisak-knjiga.js). Posle toga bibliotekar
// štiklira koje želi, a izabrane čita POSTOJEĆI api/iz-linka.js, jednu po jednu, sa pauzom. Ova funkcija
// ništa ne čuva (nema tabele ni keša za spisak) i ne čita stranice knjiga.
//
// Pravila:
//   - samo bibliotekar i administrator (uloga se čita na serveru, kao u korica-iz-linka); ostali 403;
//   - jedan zahtev ka stranici sa spiskom po kliku, bez praćenja sledeće stranice (javlja se samo adresa
//     `sledeca`, a čita se tek na novi klik);
//   - ista zaštita od SSRF-a kao iz-linka (https, bela lista, DNS zaštita, preusmeravanja, rok, najveći odgovor);
//   - pre čitanja se proverava robots.txt tog domena (isti zaštićeni preuzimač): ako zabranjuje putanju za
//     „Citaliste" ili „*", odustaje se (422, robots_zabranjuje). Ako se robots.txt ne može pročitati, nastavlja
//     se. Linkovi koje robots.txt zabranjuje ne vraćaju se (izbacenoRobots). Crawl-delay se vraća kao
//     pauzaSekundi (najviše 30), a ekran ga primenjuje između stranica knjiga;
//   - ograničenje: kanta „iz-linka:bibliotekar" (200 na sat); spisak troši 1, a svaka obrađena knjiga po 1.
import { ApiGreska } from "./_lib/greska.js";
import { preuzmi, proveriUrl } from "./_lib/bezbedan-fetch.js";
import { lokalnoBezBaze } from "./_lib/okruzenje.js";
import { jeDozvoljeno, putanjaZaRobots, ucitajRobots } from "./_lib/robots.js";
import { izvuciLinkoveKnjiga } from "./_lib/spisak-knjiga.js";
import { granicaSpiska, jeBibliotekarskaUloga, obradi, ulogaClana } from "./_lib/zajednicko.js";

const ROBOTS_PORUKA = "Сајт не дозвољава аутоматско читање ове странице.";

// Zabrana iz robots.txt: baca 422. Pravila su učitana za domen te adrese.
function zahtevajDozvolu(robots, u) {
  if (!jeDozvoljeno(robots.pravila, putanjaZaRobots(u))) throw new ApiGreska(422, "robots_zabranjuje", ROBOTS_PORUKA);
}

export default function handler(req, res) {
  return obradi(req, res, {
    ogranicenje: granicaSpiska,
    proveri(telo) {
      const url = typeof telo.url === "string" ? telo.url.trim() : "";
      if (!url || url.length > 2000) throw new ApiGreska(400, "neispravan_link", "Адреса није исправна.");
      // Neispravan ili nedozvoljen link se odbija pre ograničenja i pre mreže.
      return { url: proveriUrl(url) };
    },
    async radi({ url }, clan) {
      // obradi() čita ulogu samo kad računa ograničenje (ne i uz ZAHTEVI_BEZ_BAZE)
      if (lokalnoBezBaze() && !jeBibliotekarskaUloga(await ulogaClana(clan.id))) {
        throw new ApiGreska(403, "nije_bibliotekar", "Само библиотекар може да чита спискове са сајта издавача.");
      }

      // 1. robots.txt domena (ne baca: nepročitan znači „nastavi")
      const robots = await ucitajRobots(url);
      zahtevajDozvolu(robots, url);

      // 2. jedna stranica sa spiskom
      const stranica = await preuzmi(url.href);

      // preusmeravanje na drugu putanju ili domen: ista provera i za konačnu adresu
      let robotsKonacne = robots;
      if (stranica.url.hostname !== url.hostname) robotsKonacne = await ucitajRobots(stranica.url);
      if (stranica.url.href !== url.href) zahtevajDozvolu(robotsKonacne, stranica.url);

      // 3. linkovi ka knjigama (najviše 50), bez onih koje robots.txt zabranjuje
      const izvuceno = izvuciLinkoveKnjiga(stranica.telo, stranica.url, { jeDozvoljenoFn: (putanja) => jeDozvoljeno(robotsKonacne.pravila, putanja) });
      return [
        {
          stranica: stranica.url.href,
          linkovi: izvuceno.linkovi,
          ukupno: izvuceno.ukupno,
          skraceno: izvuceno.skraceno,
          izbacenoRobots: izvuceno.izbacenoRobots,
          robotsProcitan: robotsKonacne.procitan,
          pauzaSekundi: robotsKonacne.pauzaSekundi,
          sledeca: izvuceno.sledeca,
        },
      ];
    },
  });
}
