import { useState } from "react";
import { porukaGreske } from "../lib/api.js";
import { tekst } from "../lib/tekst.js";
import Korica from "./Korica.jsx";

const STATUSI = ["zelim", "citam", "procitano"];
const T = tekst.pretraga;

// Jedan rezultat: iz naše baze (ima `id`, `u_fondu`) ili spoljni (Google Books,
// link: `autori`, `izvor`). `onDodaj(knjiga, status)` vraća { uFondu }.
export default function RezultatKnjige({ knjiga, onDodaj }) {
  const [status, setStatus] = useState("zelim");
  const [saljem, setSaljem] = useState(false);
  const [ishod, setIshod] = useState(null); // { poruka, greska }

  const izBaze = Boolean(knjiga.id);
  const autor = izBaze ? knjiga.autor : (knjiga.autori ?? []).join(", ");
  const izdavac = [knjiga.izdavac, knjiga.godina].filter(Boolean).join(", ");

  async function dodaj() {
    if (saljem) return;
    setSaljem(true);
    setIshod(null);
    try {
      const { uFondu } = await onDodaj(knjiga, status);
      setIshod({ poruka: uFondu === false ? T.polica.dodatoNijeUFondu : T.polica.dodato });
    } catch (e) {
      console.error("dodavanje na policu:", e);
      setIshod({ poruka: e?.kod ? porukaGreske(e) : T.polica.nijeDodato, greska: true });
    }
    setSaljem(false);
  }

  let dostupnost = null;
  if (izBaze) {
    dostupnost = knjiga.u_fondu ? (knjiga.broj_slobodnih > 0 ? T.knjiga.slobodna : T.knjiga.izdata) : T.knjiga.nijeUFondu;
  }

  return (
    <li className="flex gap-3 rounded-lg border-2 border-ivica bg-white p-3">
      <Korica knjiga={knjiga} autor={autor} />
      <div className="min-w-0 flex-1">
        <h3 className="text-xl font-semibold leading-snug">{knjiga.naslov}</h3>
        <p className="text-lg">{autor || T.knjiga.bezAutora}</p>
        {izdavac && <p className="text-base text-mastilo/70">{izdavac}</p>}

        {dostupnost && (
          <p className={`mt-1 inline-block rounded px-2 py-0.5 text-base font-medium ${knjiga.u_fondu ? "bg-ivica" : "border border-ivica"}`}>
            {dostupnost}
          </p>
        )}
        {!izBaze && (
          <p className="mt-1 text-base text-mastilo/70">
            {T.knjiga.sa}: {knjiga.izvor === "google_books" ? T.knjiga.googleBooks : T.knjiga.saLinka}
            {knjiga.url && (
              <>
                {" · "}
                <a href={knjiga.url} target="_blank" rel="noopener noreferrer" className="text-pecat underline">
                  {knjiga.izvor === "google_books" ? T.knjiga.pogledaj : new URL(knjiga.url).hostname.replace(/^www\./, "")}
                </a>
              </>
            )}
          </p>
        )}

        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <label className="flex items-center gap-2 text-base">
            <span className="sr-only sm:not-sr-only">{T.polica.dodajKao}</span>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="rounded-lg border-2 border-ivica bg-white px-3 py-2 text-lg"
            >
              {STATUSI.map((s) => (
                <option key={s} value={s}>
                  {T.polica[s]}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={dodaj}
            disabled={saljem}
            className="rounded-lg bg-pecat px-5 py-2 text-lg font-semibold text-white disabled:opacity-60"
          >
            {saljem ? tekst.opste.sacekajte : T.polica.dodaj}
          </button>
        </div>

        {ishod && (
          <p role="status" className={`mt-2 text-base font-medium ${ishod.greska ? "text-pecat" : ""}`}>
            {ishod.poruka}
          </p>
        )}
      </div>
    </li>
  );
}
