import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth-context.js";
import { formatDatum, prikazaniNapredak, uredjenNapredak } from "../lib/polica-logika.js";
import { otkaziRezervaciju, postaviNapredak, postaviStanje, rezervisi, ucitajRedPolice, ucitajRezervaciju } from "../lib/polica.js";
import { tekst } from "../lib/tekst.js";
import TrakaNapretka from "./TrakaNapretka.jsx";

const T = tekst.knjigaEkran.polica;
const R = tekst.knjigaEkran.rezervacija;
const STANJA = ["zelim", "citam", "procitano"];
const dugme = "flex min-h-12 w-full items-center justify-center rounded-lg px-5 py-3 text-xl font-semibold disabled:opacity-60 sm:w-auto";

// Stanje knjige na MOJOJ polici (Želim, Čitam, Pročitano), napredak čitanja, „Označi kao pročitano"
// i „Rezerviši". Rezervacija je poruka bibliotekaru i samo je za knjige u fondu (baza to proverava).
export default function StanjePolice({ knjiga }) {
  const { clan } = useAuth();
  const [red, setRed] = useState(undefined); // undefined: učitava se; null: knjige nema na polici
  const [rezervacija, setRezervacija] = useState(undefined);
  const [napredak, setNapredak] = useState("0");
  const [zauzet, setZauzet] = useState(false);
  const [poruka, setPoruka] = useState(null); // { tekst, greska }

  useEffect(() => {
    let otkazano = false;
    Promise.all([ucitajRedPolice(clan.id, knjiga.id), knjiga.u_fondu ? ucitajRezervaciju(clan.id, knjiga.id) : Promise.resolve(null)])
      .then(([r, rez]) => {
        if (otkazano) return;
        setRed(r);
        setNapredak(String(prikazaniNapredak(r)));
        setRezervacija(rez);
      })
      .catch((e) => {
        console.error("učitavanje police:", e);
        if (!otkazano) {
          setRed(null);
          setRezervacija(null);
          setPoruka({ tekst: T.greska, greska: true });
        }
      });
    return () => {
      otkazano = true;
    };
  }, [clan.id, knjiga.id, knjiga.u_fondu]);

  async function uradi(posao, poruci = null, greska = T.greska) {
    if (zauzet) return;
    setZauzet(true);
    setPoruka(null);
    try {
      await posao();
      if (poruci) setPoruka({ tekst: poruci });
    } catch (e) {
      console.error("polica:", e);
      setPoruka({ tekst: R.greske[e?.kod] ?? greska, greska: true });
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

  const rezervisiKnjigu = () =>
    uradi(async () => setRezervacija(await rezervisi(clan.id, knjiga.id)), R.sacuvano, R.greske.opste);
  const otkaziRez = () =>
    uradi(async () => {
      await otkaziRezervaciju(rezervacija.id);
      setRezervacija(null);
    }, R.otkazana, R.greske.opste);

  if (red === undefined) return <p className="mt-6 text-lg text-mastilo/70">{tekst.opste.ucitava}</p>;

  return (
    <section className="mt-6 space-y-4" aria-labelledby="moja-polica">
      <h2 id="moja-polica" className="text-2xl font-semibold">
        {T.naslov}
      </h2>

      <div role="group" aria-label={T.grupa} className="grid grid-cols-3 gap-2">
        {STANJA.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={red?.status === s}
            disabled={zauzet}
            onClick={() => promeni(s)}
            className={`flex min-h-12 items-center justify-center rounded-lg border-2 border-pecat px-1 text-base font-semibold disabled:opacity-60 ${
              red?.status === s ? "bg-pecat text-white" : "bg-white text-pecat"
            }`}
          >
            {T.stanja[s]}
          </button>
        ))}
      </div>
      {red === null && <p className="text-base text-mastilo/70">{T.nijeNaPolici}</p>}

      {red?.status === "citam" && (
        <div className="space-y-3 rounded-lg border-2 border-ivica bg-white p-3">
          <h3 className="text-lg font-semibold">{T.napredak}</h3>
          <TrakaNapretka procenat={prikazaniNapredak(red)} oznaka={T.napredak} />
          <label className="block text-base font-medium" htmlFor="napredak-klizac">
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
            className="block h-11 w-full accent-pecat"
          />
          <button type="button" disabled={zauzet} onClick={sacuvajNapredak} className={`${dugme} border-2 border-pecat text-pecat`}>
            {T.napredakSacuvaj}
          </button>
          {red.datum_pocetka && <p className="text-base text-mastilo/70">{T.pocetak.replace("{datum}", formatDatum(red.datum_pocetka))}</p>}
        </div>
      )}

      {red?.status === "procitano" && red.datum_kraja && <p className="text-base text-mastilo/70">{T.kraj.replace("{datum}", formatDatum(red.datum_kraja))}</p>}

      {red?.status !== "procitano" && (
        <button type="button" disabled={zauzet} onClick={() => promeni("procitano")} className={`${dugme} bg-pecat text-white`}>
          {T.oznaciProcitano}
        </button>
      )}

      {knjiga.u_fondu && rezervacija !== undefined && (
        <div className="space-y-2 rounded-lg border-2 border-ivica bg-white p-3">
          {rezervacija ? (
            <>
              <p className="text-lg font-medium">{R.rezervisano}</p>
              <button type="button" disabled={zauzet} onClick={otkaziRez} className={`${dugme} border-2 border-pecat text-pecat`}>
                {R.otkazi}
              </button>
            </>
          ) : (
            <>
              <button type="button" disabled={zauzet} onClick={rezervisiKnjigu} className={`${dugme} border-2 border-pecat text-pecat`}>
                {R.dugme}
              </button>
              <p className="text-base text-mastilo/70">{R.napomena}</p>
            </>
          )}
        </div>
      )}

      {poruka && (
        <p role={poruka.greska ? "alert" : "status"} className={`text-base font-medium ${poruka.greska ? "text-pecat" : ""}`}>
          {poruka.tekst}
        </p>
      )}
    </section>
  );
}
