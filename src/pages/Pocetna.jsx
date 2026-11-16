import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Korica from "../components/Korica.jsx";
import PlocicaKnjige from "../components/PlocicaKnjige.jsx";
import TrakaNapretka from "../components/TrakaNapretka.jsx";
import { useAuth } from "../lib/auth-context.js";
import { dobaDana, grupisiPolicu, oblikBroja, podrazumevanaKartica, prikazaniNapredak } from "../lib/polica-logika.js";
import { ucitajPolicu } from "../lib/polica.js";
import { stil } from "../lib/stil.js";
import { tekst } from "../lib/tekst.js";

const T = tekst.pocetna;
const KARTICE = ["citam", "procitano", "zelim"];

// Gde je knjiga u biblioteci, za red „čitam": u fondu (ima slobodnih), izdato ili nije u fondu.
const gdeJe = (k) => (k.u_fondu ? (k.broj_slobodnih > 0 ? T.fond.slobodno : T.fond.izdato) : T.fond.nema);

// Početna: „Moja polica" (prototip, ekran Polica). Pozdrav po dobu dana, knjige u toku sa trakom
// napretka, segmentna kontrola (Čitam, Pročitano, Želim) i mreža korica izabrane kartice. Čita samo
// SVOJU policu (RLS pokazuje i policu povezanih članova).
export default function Pocetna() {
  const { clan } = useAuth();
  const [stanje, setStanje] = useState({ ucitava: true, redovi: [], greska: false });
  const [pokusaj, setPokusaj] = useState(0);
  const [izabrana, setIzabrana] = useState(null);

  useEffect(() => {
    let otkazano = false;
    ucitajPolicu(clan.id)
      .then((redovi) => !otkazano && setStanje({ ucitava: false, redovi, greska: false }))
      .catch((e) => {
        console.error("učitavanje police:", e);
        if (!otkazano) setStanje({ ucitava: false, redovi: [], greska: true });
      });
    return () => {
      otkazano = true;
    };
  }, [clan.id, pokusaj]);

  const { ucitava, redovi, greska } = stanje;
  const grupe = grupisiPolicu(redovi);
  const kartica = izabrana ?? podrazumevanaKartica(grupe);
  const ime = clan.nadimak || String(clan.ime ?? "").split(/\s+/)[0];
  const uToku = grupe.citam.length;

  return (
    <>
      <h1 className={`${stil.naslov} pt-2`}>
        {T.pozdrav[dobaDana()]},
        <br />
        {ime}
      </h1>
      {!ucitava && !greska && redovi.length > 0 && <p className={stil.uvod}>{T.uvod[oblikBroja(uToku)].replace("{n}", String(uToku))}</p>}

      {ucitava && <p className="mt-6 text-base text-mastilo-2">{T.ucitava}</p>}

      {greska && (
        <div role="alert" className={`${stil.karta} mt-6 space-y-3`}>
          <p className="text-base font-medium text-bordo">{T.greska}</p>
          <button
            type="button"
            onClick={() => {
              setStanje({ ucitava: true, redovi: [], greska: false });
              setPokusaj((n) => n + 1);
            }}
            className={stil.veliko}
          >
            {T.ponovo}
          </button>
        </div>
      )}

      {!ucitava && !greska && redovi.length === 0 && (
        <div className={`${stil.karta} mt-6 space-y-4`}>
          <p className="text-base">{T.prazno}</p>
          <Link to="/pretraga" className={stil.veliko}>
            {T.trazi}
          </Link>
        </div>
      )}

      {!ucitava && !greska && redovi.length > 0 && (
        <>
          <section className="mt-4" aria-label={T.uToku}>
            {grupe.citam.length === 0 ? (
              <p className="mt-2 text-base text-mastilo-2">{T.nemaUToku}</p>
            ) : (
              <ul className="space-y-3">
                {grupe.citam.map((r) => (
                  <li key={r.id}>
                    <Link to={`/knjiga/${r.knjiga.id}`} className={`${stil.karta} flex min-h-11 gap-[15px] transition active:scale-[.988]`}>
                      <Korica knjiga={r.knjiga} autor={r.knjiga.autor} velicina="glavna" />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="font-naslov text-lg font-bold leading-[1.18] tracking-[-0.025em]">{r.knjiga.naslov}</span>
                        {r.knjiga.autor && <span className="mt-[3px] text-[13.5px] text-mastilo-2">{r.knjiga.autor}</span>}
                        <span className="mt-auto pt-3">
                          <TrakaNapretka procenat={prikazaniNapredak(r)} />
                        </span>
                        <span className="mt-2 flex items-center justify-between gap-2 text-[12px] tabular-nums text-mastilo-2">
                          <span>{T.napredakPostotak.replace("{n}", String(prikazaniNapredak(r)))}</span>
                          <span>{gdeJe(r.knjiga)}</span>
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div role="tablist" aria-label={T.prikaz} className="my-5 flex gap-1 rounded-full bg-povrsina p-1 shadow-senka">
            {KARTICE.map((s) => (
              <button
                key={s}
                type="button"
                role="tab"
                id={`kartica-${s}`}
                aria-selected={kartica === s}
                aria-controls="polica-mreza"
                onClick={() => setIzabrana(s)}
                className="min-h-11 flex-1 rounded-full px-1.5 text-[13px] font-medium text-mastilo-2 transition aria-selected:bg-bordo aria-selected:text-white"
              >
                {T.kartice[s]} <span className="text-[12px] opacity-75">{grupe[s].length}</span>
              </button>
            ))}
          </div>

          <div role="tabpanel" id="polica-mreza" aria-labelledby={`kartica-${kartica}`}>
            {grupe[kartica].length === 0 ? (
              <p className="px-2 py-6 text-center text-sm text-mastilo-2">{T.prazneKartice[kartica]}</p>
            ) : (
              <ul className="grid grid-cols-3 gap-x-[13px] gap-y-4 pb-2">
                {grupe[kartica].map((r) => (
                  <li key={r.id} className="min-w-0">
                    <PlocicaKnjige knjiga={r.knjiga} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </>
  );
}
