import { useState } from "react";
import { porukaGreske } from "../lib/api.js";
import { koricaIzLinka, ukloniKoricu } from "../lib/knjige.js";
import { tekst } from "../lib/tekst.js";
import SlikajKoricu from "./SlikajKoricu.jsx";

const T = tekst.korice;
const dugme = "flex min-h-12 w-full items-center justify-center rounded-lg px-5 py-3 text-xl font-semibold disabled:opacity-60 sm:w-auto";

const STATUS = { preuzimanje: T.preuzimam, slanje: T.radi, uklanjanje: T.uklanjam };

// Sve što bibliotekar može da uradi sa koricom jedne knjige:
//   - predlog sa sajta (`predlog`, adresa iz api/iz-linka): pregled i „Koristi ovu koricu”, što
//     poziva api/korica-iz-linka (server preuzima sliku u naš Storage, izvor 'preuzeto');
//   - „Slikaj koricu” (kamera) i „Izaberi sliku sa računara ili telefona”: slika se smanjuje u
//     pregledaču i šalje običnim klijentom (izvor 'fotografija', korice_poreklo prazno);
//   - „Bez korice” (samo kad roditelj da `onBez`): knjiga svesno ostaje bez korice;
//   - „Ukloni koricu” (samo uz `mozeUklanjanje`), uz potvrdu: briše fajl i prazni korice_url,
//     korice_izvor i korice_poreklo.
// Dok traje bilo koja radnja, sva dugmad su onemogućena i vidi se status.
// `korica`: naša adresa korice koja već postoji (ili null). onKorica(adresa, izvor).
export default function KoricaIzbor({
  knjigaId,
  naslov,
  predlog = null,
  korica = null,
  bezKorice = false,
  onKorica,
  onBez = null,
  mozeUklanjanje = false,
  onUklonjena = null,
  zauzetVani = false, // kartica upravo preuzima ili šalje koricu (posle čuvanja knjige)
}) {
  const [zauzet, setZauzet] = useState(null); // null | 'preuzimanje' | 'slanje' | 'uklanjanje'
  const [poruka, setPoruka] = useState(null); // { tekst, greska }
  const [potvrda, setPotvrda] = useState(false);
  const [predlogNeVidi, setPredlogNeVidi] = useState(false);

  async function koristiPredlog() {
    setZauzet("preuzimanje");
    setPoruka(null);
    try {
      const r = await koricaIzLinka(knjigaId, predlog);
      onKorica(r.korica_url, "preuzeto");
      setPoruka({ tekst: T.sacuvana });
    } catch (e) {
      console.error("korica sa linka:", e);
      setPoruka({ tekst: porukaGreske(e), greska: true });
    }
    setZauzet(null);
  }

  async function ukloni() {
    setZauzet("uklanjanje");
    setPoruka(null);
    setPotvrda(false);
    try {
      const { fajlObrisan } = await ukloniKoricu(knjigaId, korica);
      onUklonjena?.();
      setPoruka({ tekst: fajlObrisan === false ? T.uklonjenaBezFajla : T.uklonjena });
    } catch (e) {
      console.error("uklanjanje korice:", e);
      setPoruka({ tekst: T.greske[e?.kod] ?? T.greske.korica_upis, greska: true });
    }
    setZauzet(null);
  }

  const onemoguceno = zauzet !== null || zauzetVani;
  const slanje = (radi) => {
    setZauzet(radi ? "slanje" : null);
    if (radi) setPoruka(null); // stara poruka ne sme da stoji uz novi pokušaj
  };

  if (bezKorice && onBez) {
    return (
      <div className="space-y-2">
        <p className="text-base font-medium">{T.bezOdluka}</p>
        <button type="button" onClick={() => onBez(false)} className={`${dugme} border-2 border-ivica`}>
          {T.predomislio}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3" aria-busy={onemoguceno}>
      {predlog && !korica && (
        <figure className="flex gap-3">
          <div className="h-44 w-32 shrink-0 overflow-hidden rounded border border-ivica bg-white">
            {predlogNeVidi ? (
              <p className="p-2 text-sm text-mastilo/70">{T.predlogNijeUcitan}</p>
            ) : (
              <img
                src={predlog}
                alt={T.predlogAlt.replace("{naslov}", naslov)}
                width={128}
                height={176}
                loading="lazy"
                decoding="async"
                referrerPolicy="no-referrer"
                onError={() => setPredlogNeVidi(true)}
                className="h-full w-full object-cover"
              />
            )}
          </div>
          <figcaption className="min-w-0 text-base">
            <span className="font-semibold">{T.predlog}</span>
            <span className="mt-1 block text-mastilo/70">{T.predlogNapomena}</span>
          </figcaption>
        </figure>
      )}

      {predlog && (
        <button type="button" disabled={onemoguceno} onClick={koristiPredlog} className={`${dugme} ${korica ? "border-2 border-pecat text-pecat" : "bg-pecat text-white"}`}>
          {zauzet === "preuzimanje" ? T.preuzimam : T.koristi}
        </button>
      )}

      <SlikajKoricu
        knjigaId={knjigaId}
        staraAdresa={korica}
        oznaka={korica ? T.zameni : T.slikaj}
        glavno={!predlog && !korica}
        kamera
        onemoguceno={onemoguceno}
        onRadi={slanje}
        onPostavljena={(adresa, izvor) => {
          onKorica(adresa, izvor);
          setPoruka({ tekst: T.sacuvana });
        }}
      />
      <SlikajKoricu
        knjigaId={knjigaId}
        staraAdresa={korica}
        oznaka={T.izaberi}
        glavno={false}
        kamera={false}
        onemoguceno={onemoguceno}
        onRadi={slanje}
        onPostavljena={(adresa, izvor) => {
          onKorica(adresa, izvor);
          setPoruka({ tekst: T.sacuvana });
        }}
      />

      {onBez && !korica && (
        <button type="button" disabled={onemoguceno} onClick={() => onBez(true)} className={`${dugme} border-2 border-ivica`}>
          {T.bez}
        </button>
      )}

      {mozeUklanjanje && korica && !potvrda && (
        <button type="button" disabled={onemoguceno} onClick={() => setPotvrda(true)} className={`${dugme} border-2 border-pecat text-pecat`}>
          {T.ukloni}
        </button>
      )}
      {mozeUklanjanje && korica && potvrda && (
        <div role="group" aria-label={T.ukloniPitanje} className="space-y-2 rounded-lg border-2 border-pecat p-3">
          <p className="text-lg font-semibold">{T.ukloniPitanje}</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button type="button" disabled={onemoguceno} onClick={ukloni} className={`${dugme} bg-pecat text-white`}>
              {T.ukloniDa}
            </button>
            <button type="button" disabled={onemoguceno} onClick={() => setPotvrda(false)} className={`${dugme} border-2 border-ivica`}>
              {T.ukloniNe}
            </button>
          </div>
        </div>
      )}

      {zauzet && (
        <p role="status" className="text-base font-medium">
          {STATUS[zauzet]}
        </p>
      )}
      {poruka && !zauzet && (
        <p role={poruka.greska ? "alert" : "status"} className={`text-base font-medium ${poruka.greska ? "text-pecat" : ""}`}>
          {poruka.tekst}
        </p>
      )}
    </div>
  );
}
