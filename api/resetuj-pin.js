// POST /api/resetuj-pin   (Authorization: Bearer <Supabase JWT bibliotekara ili administratora>)
// Telo: { clanId }   — id člana (uuid) kome se postavlja novi PIN
// Odgovor: { rezultati: [{ clan: { id, broj_kartice, ime }, pin }] }
//
// SAMO bibliotekar i administrator (uloga se čita na serveru, kao u napravi-clana). Pravila:
//   - administrator sme da resetuje PIN svakom članu;
//   - bibliotekar samo čitaocima (uloga 'citalac'): ne administratorima, a ni drugim bibliotekarima
//     ni sebi, jer bi tako preuzeo tuđi nalog sa istim ili većim pravima. Odbija se sa 403.
// Novi PIN (6 cifara, crypto.randomInt) vraća se JEDNOM u odgovoru; ne čuva se i ne loguje se.
// Postojeće sesije člana ostaju dok ne isteknu: promena lozinke ih ne prekida.
//
// Ograničenje: ista kanta kao napravi-clana (60 na sat po korisniku).
import { ApiGreska } from "./_lib/greska.js";
import { bezPina, noviPin } from "./_lib/pin.js";
import { granicaClanova, obradi, servisniKlijent, ulogaOsoblja } from "./_lib/zajednicko.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export default function handler(req, res) {
  return obradi(req, res, {
    ogranicenje: granicaClanova,
    proveri(telo) {
      const clanId = typeof telo.clanId === "string" ? telo.clanId.trim().toLowerCase() : "";
      if (!UUID.test(clanId)) throw new ApiGreska(400, "neispravan_zahtev", "Члан није исправан.");
      return { clanId };
    },
    async radi({ clanId }, clan, { uloga }) {
      const ulogaPozivaoca = await ulogaOsoblja(clan, uloga);
      const servis = servisniKlijent();
      const pin = noviPin();
      const dnevnik = (poruka) => bezPina(poruka, pin);

      const { data: cilj, error: greskaCitanja } = await servis.from("clanovi").select("id, broj_kartice, ime, uloga").eq("id", clanId).maybeSingle();
      if (greskaCitanja) {
        console.error("čitanje člana:", dnevnik(greskaCitanja.message));
        throw new ApiGreska(500, "greska_servera", "Читање члана није успело.");
      }
      if (!cilj) throw new ApiGreska(404, "clan_ne_postoji", "Члан не постоји.");
      if (ulogaPozivaoca !== "administrator" && cilj.uloga !== "citalac") {
        throw new ApiGreska(403, "nema_dozvole", "Немате право да мењате ПИН овом налогу.");
      }

      const { error: greskaPromene } = await servis.auth.admin.updateUserById(cilj.id, { password: pin });
      if (greskaPromene) {
        console.error("promena PIN-a:", dnevnik(greskaPromene.message));
        throw new ApiGreska(500, "greska_servera", "Промена ПИН-а није успела.");
      }

      return [{ clan: { id: cilj.id, broj_kartice: cilj.broj_kartice, ime: cilj.ime }, pin }];
    },
  });
}
