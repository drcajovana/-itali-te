// POST /api/korica-iz-linka   (Authorization: Bearer <Supabase JWT člana>)
// Telo: { url, knjigaId }  — adresa SLIKE (predlog iz api/iz-linka.js) i knjiga kojoj pripada
// Odgovor: { rezultati: [{ korica_url, korica_poreklo, tip, bajtova }] }
//
// SAMO bibliotekar i administrator (uloga se čita na serveru iz tabele clanovi, ne iz zahteva).
// Preuzima sliku JEDNOM, sa istom zaštitom kao iz-linka (bezbedan-fetch.js): samo https,
// bez IP adresa, localhost-a i privatnih adresa (provera u samom DNS upitu), svako
// preusmeravanje se proverava, rok 8 s, najviše 1.5 MB. Za razliku od stranice knjige,
// domen slike NIJE ograničen listom (slike stoje na CDN-ovima koji se razlikuju od sajta).
// Pravi tip se proverava po sadržaju (jpeg, png, webp; slika.js), ne po nastavku ni po
// zaglavlju. Slika se ne menja na serveru: čuva se onakva kakva je stigla.
//
// Čuva se u Supabase Storage (bucket „korice", pod <id knjige>/<vreme>.<ekstenzija>), pa se u
// knjige upisuje korice_url (naša javna adresa), korice_izvor = 'preuzeto' i korice_poreklo
// (adresa sa koje je slika uzeta). Stara naša fotografija te knjige se briše.
// Piše se kao service_role: dozvola je u ovoj funkciji, ne u politikama baze.
import { ApiGreska } from "./_lib/greska.js";
import { preuzmi, proveriUrl } from "./_lib/bezbedan-fetch.js";
import { lokalnoBezBaze } from "./_lib/okruzenje.js";
import { tipSlike } from "./_lib/slika.js";
import { granicaKorice, jeBibliotekarskaUloga, obradi, servisniKlijent, ulogaClana } from "./_lib/zajednicko.js";
import { BUCKET_KORICE, putanjaIzAdrese, putanjaKorice } from "../src/lib/korica-slika.js";

const NAJVISE_BAJTOVA = 1_500_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export default function handler(req, res) {
  return obradi(req, res, {
    ogranicenje: granicaKorice,
    proveri(telo) {
      const url = typeof telo.url === "string" ? telo.url.trim() : "";
      if (!url || url.length > 500) throw new ApiGreska(400, "neispravan_link", "Adresa slike nije ispravna.");
      const knjigaId = typeof telo.knjigaId === "string" ? telo.knjigaId.trim() : "";
      if (!UUID.test(knjigaId)) throw new ApiGreska(400, "neispravan_zahtev", "Knjiga nije ispravna.");
      // https, bez korisnika, porta, IP adrese i localhost-a; bez ograničenja domenom (lista = null)
      return { url: proveriUrl(url, null).href, knjigaId };
    },
    async radi({ url, knjigaId }, clan) {
      // obradi() čita ulogu samo kad se ograničenje računa (ne i uz ZAHTEVI_BEZ_BAZE)
      if (lokalnoBezBaze() && !jeBibliotekarskaUloga(await ulogaClana(clan.id))) {
        throw new ApiGreska(403, "nije_bibliotekar", "Samo bibliotekar može da preuzme koricu.");
      }
      const servis = servisniKlijent();

      const { data: knjiga, error: greskaCitanja } = await servis.from("knjige").select("id, korice_url").eq("id", knjigaId).maybeSingle();
      if (greskaCitanja) {
        console.error("čitanje knjige:", greskaCitanja.message);
        throw new ApiGreska(500, "greska_servera", "Čitanje knjige nije uspelo.");
      }
      if (!knjiga) throw new ApiGreska(404, "knjiga_ne_postoji", "Knjiga ne postoji.");

      let slika;
      try {
        slika = await preuzmi(url, {
          lista: null,
          sirovo: true,
          accept: "image/jpeg,image/png,image/webp",
          // zaglavlje samo odbacuje očigledno pogrešno; pravi tip se proverava po sadržaju
          tipovi: ["image/", "application/octet-stream", "binary/octet-stream"],
          najviseBajtova: NAJVISE_BAJTOVA,
        });
      } catch (e) {
        if (e instanceof ApiGreska && e.kod === "nije_stranica") throw new ApiGreska(422, "nije_slika", "Adresa ne vodi do slike.");
        if (e instanceof ApiGreska && e.kod === "prevelika_stranica") throw new ApiGreska(422, "prevelika_slika", "Slika je prevelika.");
        throw e;
      }

      const tip = tipSlike(slika.telo);
      if (!tip) throw new ApiGreska(422, "slika_nije_podrzana", "Dozvoljene su samo jpeg, png i webp slike.");

      const skladiste = servis.storage.from(BUCKET_KORICE);
      const putanja = putanjaKorice(knjigaId, Date.now(), tip.mime);
      const { error: greskaSlanja } = await skladiste.upload(putanja, slika.telo, {
        contentType: tip.mime,
        cacheControl: "31536000", // ime je novo pri svakoj zameni
        upsert: false,
      });
      if (greskaSlanja) {
        console.error("upis u Storage:", greskaSlanja.message);
        throw new ApiGreska(String(greskaSlanja.statusCode) === "413" ? 422 : 502, String(greskaSlanja.statusCode) === "413" ? "prevelika_slika" : "cuvanje_slike_nije_uspelo", "Čuvanje slike nije uspelo.");
      }

      const koricaUrl = skladiste.getPublicUrl(putanja).data.publicUrl;
      const { data: upisano, error: greskaUpisa } = await servis
        .from("knjige")
        .update({ korice_url: koricaUrl, korice_izvor: "preuzeto", korice_poreklo: url })
        .eq("id", knjigaId)
        .select("id")
        .maybeSingle();
      if (greskaUpisa || !upisano) {
        if (greskaUpisa) console.error("upis korice u knjigu:", greskaUpisa.message);
        await skladiste.remove([putanja]).catch((e) => console.error("uklanjanje nove slike:", e?.message));
        throw new ApiGreska(502, "cuvanje_slike_nije_uspelo", "Čuvanje slike nije uspelo.");
      }

      // Stara naša slika te knjige više nije potrebna. Briše se samo ako je adresa sa NAŠEG
      // bucket-a (tačan prefiks) i iz fascikle ove knjige; tuđa adresa se nikad ne dira.
      const prefiks = koricaUrl.slice(0, koricaUrl.length - putanja.length);
      const stara = putanjaIzAdrese(knjiga.korice_url, prefiks);
      if (stara && stara !== putanja && stara.startsWith(`${knjigaId}/`)) {
        await skladiste.remove([stara]).catch((e) => console.error("brisanje stare korice:", e?.message));
      }

      return [{ korica_url: koricaUrl, korica_poreklo: url, tip: tip.mime, bajtova: slika.telo.length }];
    },
  });
}
