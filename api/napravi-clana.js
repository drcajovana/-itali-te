// POST /api/napravi-clana   (Authorization: Bearer <Supabase JWT bibliotekara ili administratora>)
// Telo: { kartica, ime }   — kartica je TEKST od 7 cifara (vodeća nula ostaje), ime je „Ime Prezime"
// Odgovor: { rezultati: [{ clan: { id, broj_kartice, ime, nadimak, uloga }, pin }] }
//
// SAMO bibliotekar i administrator (uloga se čita na serveru iz tabele clanovi pomoću service_role,
// nikad iz zahteva). Pravi Auth nalog {karta}@citaliste.local i red u clanovi. Uloga novog člana je
// UVEK 'citalac': telo zahteva je ne određuje (i da stigne polje „uloga", ne čita se), pa
// bibliotekar ne može da napravi ni bibliotekara ni administratora.
//
// PIN (6 cifara, crypto.randomInt) pravi server i vraća ga JEDNOM u ovom odgovoru. Ne upisuje se
// nigde osim kao lozinka u Auth-u (tamo ostaje samo hash), ne ide u log ni u poruku greške.
// Odgovor ima Cache-Control: no-store (posalji u greska.js).
//
// Ograničenje: 60 zahteva na sat po korisniku (kanta „clanovi:bibliotekar", uzmi_zahtev), zajedno
// sa resetuj-pin. Zatvoreno: kad baza ne radi, zahtev se odbija (503).
import { ApiGreska } from "./_lib/greska.js";
import { bezPina, noviPin } from "./_lib/pin.js";
import { granicaClanova, obradi, servisniKlijent, ulogaOsoblja } from "./_lib/zajednicko.js";
import { ocistiIme, podrazumevaniNadimak, proveriBrojKarte } from "../src/lib/clan-unos.js";
import { kartaUEmail } from "../src/lib/kartica.js";

export default function handler(req, res) {
  return obradi(req, res, {
    ogranicenje: granicaClanova,
    proveri(telo) {
      const kartica = proveriBrojKarte(telo.kartica);
      if (!kartica) throw new ApiGreska(400, "neispravna_kartica", "Број карте мора да има 7 цифара.");
      const ime = ocistiIme(telo.ime);
      if (!ime) throw new ApiGreska(400, "neispravno_ime", "Упишите име и презиме.");
      return { kartica, ime };
    },
    async radi({ kartica, ime }, clan, { uloga }) {
      await ulogaOsoblja(clan, uloga);
      const servis = servisniKlijent();
      const pin = noviPin();
      const dnevnik = (poruka) => bezPina(poruka, pin);

      const { data: postoji, error: greskaProvere } = await servis.from("clanovi").select("id").eq("broj_kartice", kartica).maybeSingle();
      if (greskaProvere) {
        console.error("provera broja karte:", dnevnik(greskaProvere.message));
        throw new ApiGreska(500, "greska_servera", "Провера броја карте није успела.");
      }
      if (postoji) throw new ApiGreska(409, "kartica_postoji", "Та карта већ постоји.");

      const email = kartaUEmail(kartica);
      const { data: nalog, error: greskaNaloga } = await servis.auth.admin.createUser({ email, password: pin, email_confirm: true });
      if (greskaNaloga || !nalog?.user) {
        // Auth nalog sa tom adresom već postoji (npr. ostao bez reda u clanovi): ista poruka kao za kartu.
        if (greskaNaloga?.code === "email_exists" || greskaNaloga?.status === 422) throw new ApiGreska(409, "kartica_postoji", "Та карта већ постоји.");
        console.error("pravljenje naloga:", dnevnik(greskaNaloga?.message));
        throw new ApiGreska(500, "greska_servera", "Прављење налога није успело.");
      }
      const id = nalog.user.id;

      const { data: red, error: greskaReda } = await servis
        .from("clanovi")
        .insert({ id, broj_kartice: kartica, ime, nadimak: podrazumevaniNadimak(ime), uloga: "citalac" })
        .select("id, broj_kartice, ime, nadimak, uloga")
        .single();
      if (greskaReda || !red) {
        // Ne ostavljati Auth nalog bez reda u clanovi.
        const { error: greskaPovracaja } = await servis.auth.admin.deleteUser(id);
        if (greskaPovracaja) console.error("UPOZORENJE: Auth nalog nije poništen posle neuspelog upisa:", dnevnik(greskaPovracaja.message));
        if (greskaReda?.code === "23505") throw new ApiGreska(409, "kartica_postoji", "Та карта већ постоји.");
        console.error("upis člana:", dnevnik(greskaReda?.message));
        throw new ApiGreska(500, "greska_servera", "Упис члана није успео.");
      }

      return [{ clan: red, pin }];
    },
  });
}
