import { useEffect, useRef, useState } from "react";
import { smanjiSliku } from "../lib/korica-slika.js";
import { tekst } from "../lib/tekst.js";

const T = tekst.korice;
const dugme = "flex min-h-12 w-full items-center justify-center rounded-lg px-5 py-3 text-xl font-semibold disabled:opacity-60 sm:w-auto";

// Izbor korice PRE čuvanja knjige (kartica sa predlogom korice iz api/iz-linka). Ništa se ne šalje
// dok se knjiga ne sačuva: ovde se samo bira, a čuvanje (BibliotekarUnos) onda upiše knjigu, pa
// primeni izbor.
//   - pregled predložene slike (učitava se sa sajta samo u pregledaču bibliotekara) i kvačica
//     „Preuzmi i koricu", podrazumevano uključena;
//   - „Bez korice": isključuje kvačicu;
//   - „Izaberi drugu sliku": obična selekcija fajla (telefon nudi kameru i galeriju); slika se
//     odmah smanji u pregledaču (najviše 600 px) i čeka čuvanje knjige.
// izbor: 'preuzmi' | 'slika' | 'bez'. slika: { blob, url } ili null.
export default function KoricaPrePregled({ naslov, predlog, izbor, slika, onIzbor, onSlika, onemoguceno = false }) {
  const ulaz = useRef(null);
  const [predlogNeVidi, setPredlogNeVidi] = useState(false);
  const [radi, setRadi] = useState(false);
  const [greska, setGreska] = useState(null);

  // izabrana slika je u memoriji dok se ne sačuva; adresa za pregled se oslobađa kad se zameni
  useEffect(() => {
    const url = slika?.url;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [slika?.url]);

  async function naIzbor(e) {
    const fajl = e.target.files?.[0];
    e.target.value = "";
    if (!fajl || radi) return;
    setRadi(true);
    setGreska(null);
    try {
      const { blob } = await smanjiSliku(fajl);
      onSlika({ blob, url: URL.createObjectURL(blob) });
    } catch (err) {
      setGreska(T.greske[err?.kod] ?? T.greske.slika_neispravna);
    }
    setRadi(false);
  }

  const prikaz = izbor === "slika" && slika?.url ? slika.url : predlog;
  const dolaziSaSajta = prikaz === predlog;

  return (
    <fieldset className="min-w-0 space-y-3 rounded-lg border-2 border-ivica p-3" disabled={onemoguceno}>
      <legend className="px-1 text-base font-medium">{T.korica}</legend>
      <div className="flex flex-col gap-3">
        <div className="h-44 w-32 shrink-0 overflow-hidden rounded border border-ivica bg-white">
          {izbor === "bez" ? (
            <p className="p-2 text-sm text-mastilo/70">{T.bezOdluka}</p>
          ) : dolaziSaSajta && predlogNeVidi ? (
            <p className="p-2 text-sm text-mastilo/70">{T.predlogNijeUcitan}</p>
          ) : (
            <img
              src={prikaz}
              alt={(dolaziSaSajta ? T.predlogAlt : T.izabranaAlt).replace("{naslov}", naslov)}
              width={128}
              height={176}
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
              onError={() => dolaziSaSajta && setPredlogNeVidi(true)}
              className="h-full w-full object-cover"
            />
          )}
        </div>
        <div className="min-w-0 space-y-2">
          <label className="flex min-h-11 items-center gap-3 text-lg">
            <input
              type="checkbox"
              checked={izbor === "preuzmi"}
              onChange={(e) => onIzbor(e.target.checked ? "preuzmi" : "bez")}
              className="h-6 w-6 accent-pecat"
            />
            {T.preuzmiKvacica}
          </label>
          <p className="text-base text-mastilo/70">{izbor === "slika" ? T.izabranaSlika : T.preuzmiNapomena}</p>
        </div>
      </div>

      <input ref={ulaz} type="file" accept="image/*" onChange={naIzbor} tabIndex={-1} aria-hidden="true" className="sr-only" />
      <div className="flex flex-col gap-2 sm:flex-row">
        <button type="button" onClick={() => ulaz.current?.click()} disabled={radi} className={`${dugme} border-2 border-pecat text-pecat`}>
          {radi ? T.radi : T.drugaSlika}
        </button>
        <button type="button" onClick={() => onIzbor("bez")} className={`${dugme} border-2 border-ivica`}>
          {T.bez}
        </button>
      </div>
      {greska && (
        <p role="alert" className="text-base font-medium text-pecat">
          {greska}
        </p>
      )}
    </fieldset>
  );
}
