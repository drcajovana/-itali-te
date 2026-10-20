import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Korica from "../components/Korica.jsx";
import PlocicaKnjige from "../components/PlocicaKnjige.jsx";
import TrakaNapretka from "../components/TrakaNapretka.jsx";
import { useAuth } from "../lib/auth-context.js";
import { grupisiPolicu, podrazumevanaKartica, prikazaniNapredak } from "../lib/polica-logika.js";
import { ucitajPolicu } from "../lib/polica.js";
import { tekst } from "../lib/tekst.js";

const T = tekst.pocetna;
const KARTICE = ["citam", "procitano", "zelim"];

// Početna: „Moja polica". Knjige u toku sa trakom napretka, tri kartice (Čitam, Pročitano, Želim) i
// mreža korica izabrane kartice. Čita samo SVOJU policu (RLS pokazuje i policu povezanih članova).
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

  return (
    <>
      <h1 className="text-3xl font-semibold text-pecat">{T.naslov}</h1>
      <p className="mt-1 text-lg text-mastilo/70">
        {T.pozdrav}, {clan.nadimak || clan.ime}
      </p>
      <Link to="/pretraga" className="mt-4 flex min-h-12 items-center justify-center rounded-lg bg-pecat px-5 py-3 text-center text-xl font-semibold text-white sm:inline-flex">
        {T.trazi}
      </Link>

      {ucitava && <p className="mt-6 text-lg text-mastilo/70">{T.ucitava}</p>}

      {greska && (
        <div role="alert" className="mt-6 space-y-3 rounded-lg border-2 border-pecat p-4">
          <p className="text-lg font-medium text-pecat">{T.greska}</p>
          <button
            type="button"
            onClick={() => {
              setStanje({ ucitava: true, redovi: [], greska: false });
              setPokusaj((n) => n + 1);
            }}
            className="flex min-h-12 w-full items-center justify-center rounded-lg bg-pecat px-5 py-3 text-xl font-semibold text-white sm:w-auto"
          >
            {T.ponovo}
          </button>
        </div>
      )}

      {!ucitava && !greska && redovi.length === 0 && (
        <p className="mt-6 rounded-lg border-2 border-ivica bg-white p-4 text-lg">{T.prazno}</p>
      )}

      {!ucitava && !greska && redovi.length > 0 && (
        <>
          <section className="mt-8" aria-labelledby="u-toku">
            <h2 id="u-toku" className="text-2xl font-semibold">
              {T.uToku}
            </h2>
            {grupe.citam.length === 0 ? (
              <p className="mt-2 text-lg text-mastilo/70">{T.nemaUToku}</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {grupe.citam.map((r) => (
                  <li key={r.id}>
                    <Link to={`/knjiga/${r.knjiga.id}`} className="flex min-h-11 gap-3 rounded-lg border-2 border-ivica bg-white p-3">
                      <Korica knjiga={r.knjiga} autor={r.knjiga.autor} />
                      <span className="flex min-w-0 flex-1 flex-col justify-center gap-2">
                        <span className="text-xl font-semibold leading-snug">{r.knjiga.naslov}</span>
                        {r.knjiga.autor && <span className="text-base text-mastilo/70">{r.knjiga.autor}</span>}
                        <TrakaNapretka procenat={prikazaniNapredak(r)} />
                        <span className="text-base font-medium">{T.napredak.replace("{n}", String(prikazaniNapredak(r)))}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="mt-8" aria-label={T.prikaz}>
            <div role="group" aria-label={T.prikaz} className="grid grid-cols-3 gap-2">
              {KARTICE.map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={kartica === s}
                  onClick={() => setIzabrana(s)}
                  className={`flex min-h-14 flex-col items-center justify-center rounded-lg border-2 border-pecat px-1 py-2 text-base font-semibold leading-tight ${
                    kartica === s ? "bg-pecat text-white" : "bg-white text-pecat"
                  }`}
                >
                  <span>{T.kartice[s]}</span>
                  <span className="text-sm font-medium">{grupe[s].length}</span>
                </button>
              ))}
            </div>
            {grupe[kartica].length === 0 ? (
              <p className="mt-4 text-lg text-mastilo/70">{T.prazneKartice[kartica]}</p>
            ) : (
              <ul className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4">
                {grupe[kartica].map((r) => (
                  <li key={r.id} className="min-w-0">
                    <PlocicaKnjige knjiga={r.knjiga} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </>
  );
}
