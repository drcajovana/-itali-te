import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth-context.js";
import { formatDatum, prikazaniNapredak, uredjenNapredak } from "../lib/polica-logika.js";
import { postaviNapredak, postaviStanje, ucitajRedPolice } from "../lib/polica.js";
import { stil } from "../lib/stil.js";
import { tekst } from "../lib/tekst.js";
import TrakaNapretka from "./TrakaNapretka.jsx";

const T = tekst.knjigaEkran.polica;
const STANJA = ["zelim", "citam", "procitano"];

// Stanje knjige na MOJOJ polici (Želim, Čitam, Pročitano), napredak čitanja i „Označi kao pročitano".
export default function StanjePolice({ knjiga }) {
  const { clan } = useAuth();
  const [red, setRed] = useState(undefined); // undefined: učitava se; null: knjige nema na polici
  const [napredak, setNapredak] = useState("0");
  const [zauzet, setZauzet] = useState(false);
  const [poruka, setPoruka] = useState(null); // { tekst, greska }

  useEffect(() => {
    let otkazano = false;
    ucitajRedPolice(clan.id, knjiga.id)
      .then((r) => {
        if (otkazano) return;
        setRed(r);
        setNapredak(String(prikazaniNapredak(r)));
      })
      .catch((e) => {
        console.error("učitavanje police:", e);
        if (!otkazano) {
          setRed(null);
          setPoruka({ tekst: T.greska, greska: true });
        }
      });
    return () => {
      otkazano = true;
    };
  }, [clan.id, knjiga.id]);

  async function uradi(posao, poruci = null, greska = T.greska) {
    if (zauzet) return;
    setZauzet(true);
    setPoruka(null);
    try {
      await posao();
      if (poruci) setPoruka({ tekst: poruci });
    } catch (e) {
      console.error("polica:", e);
      setPoruka({ tekst: greska, greska: true });
    }
    setZauzet(false);
  }

  const promeni = (novo) =>
    uradi(async () => {
      const r = await postaviStanje(clan.id, knjiga.id, novo, red);
      setRed(r);
      setNapredak(String(prikazaniNapredak(r)));
    }, T.sacuvano);

  const sacuvajNapredak = () => {
    const n = uredjenNapredak(napredak);
    if (n === null) return setPoruka({ tekst: T.napredakGreska, greska: true });
    return uradi(async () => setRed(await postaviNapredak(red.id, n)), T.sacuvano, T.napredakGreska);
  };

  if (red === undefined) return <p className="mt-7 text-base text-mastilo-2">{tekst.opste.ucitava}</p>;

  return (
    <section className="mt-7" aria-labelledby="moja-polica">
      <h2 id="moja-polica" className="mb-3 font-naslov text-[15px] font-bold tracking-tight">
        {T.naslov}
      </h2>

      <div className={`${stil.karta} space-y-4`}>
        <div role="group" aria-label={T.grupa} className="flex gap-1 rounded-full bg-pozadina p-1">
          {STANJA.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={red?.status === s}
              disabled={zauzet}
              onClick={() => promeni(s)}
              className="min-h-11 flex-1 rounded-full px-1.5 text-[13px] font-medium text-mastilo-2 transition disabled:opacity-60 aria-pressed:bg-bordo aria-pressed:text-white"
            >
              {T.stanja[s]}
            </button>
          ))}
        </div>
        {red === null && <p className="text-sm text-mastilo-2">{T.nijeNaPolici}</p>}

        {red?.status === "citam" && (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold">{T.napredak}</h3>
            <TrakaNapretka procenat={prikazaniNapredak(red)} oznaka={T.napredak} />
            <label className="block text-sm font-medium tabular-nums" htmlFor="napredak-klizac">
              {T.napredakVrednost.replace("{n}", napredak)}
            </label>
            <input
              id="napredak-klizac"
              type="range"
              min={0}
              max={100}
              step={5}
              value={uredjenNapredak(napredak) ?? 0}
              onChange={(e) => setNapredak(e.target.value)}
              className="block h-11 w-full accent-bordo"
            />
            <button type="button" disabled={zauzet} onClick={sacuvajNapredak} className={stil.okvirno}>
              {T.napredakSacuvaj}
            </button>
            {red.datum_pocetka && <p className="text-xs text-mastilo-2">{T.pocetak.replace("{datum}", formatDatum(red.datum_pocetka))}</p>}
          </div>
        )}

        {red?.status === "procitano" && red.datum_kraja && <p className="text-xs text-mastilo-2">{T.kraj.replace("{datum}", formatDatum(red.datum_kraja))}</p>}

        {red?.status !== "procitano" && (
          <button type="button" disabled={zauzet} onClick={() => promeni("procitano")} className={stil.veliko}>
            {T.oznaciProcitano}
          </button>
        )}

        {poruka && (
          <p role={poruka.greska ? "alert" : "status"} className={`text-sm font-medium ${poruka.greska ? "text-bordo" : ""}`}>
            {poruka.tekst}
          </p>
        )}
      </div>
    </section>
  );
}
