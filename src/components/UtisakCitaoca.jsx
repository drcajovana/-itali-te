import { useState } from "react";
import { Link } from "react-router-dom";
import { stil } from "../lib/stil.js";
import { tekst } from "../lib/tekst.js";

const T = tekst.citalac;

// Utisak povezanog čitaoca na njegovom profilu: knjiga, ocena i tekst. Tekst sa spojlerom je
// zamagljen dok se ne dodirne, i sakriven od čitača ekrana dok je zamagljen (isto kao tuđi utisci
// na stranici knjige). Koje utiske ima da vidi određuje RLS; ovde se ništa ne filtrira.
export default function UtisakCitaoca({ utisak, knjiga }) {
  const [otkriven, setOtkriven] = useState(false);
  const zamagljen = utisak.spojler && Boolean(utisak.tekst) && !otkriven;
  return (
    <li className={stil.karta}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Link
          to={`/knjiga/${knjiga.id}`}
          aria-label={T.otvoriKnjigu.replace("{naslov}", knjiga.naslov)}
          className="inline-flex min-h-11 min-w-11 items-center font-naslov text-[16px] font-bold leading-tight tracking-[-0.02em] text-bordo underline"
        >
          {knjiga.naslov}
        </Link>
        {utisak.ocena != null && <span className="font-naslov text-[15px] font-bold tracking-[-0.03em] text-bordo">{T.ocena.replace("{ocena}", String(utisak.ocena))}</span>}
      </div>
      {knjiga.autor && <p className="text-sm text-mastilo-2">{knjiga.autor}</p>}
      {utisak.tekst && (
        <div className="relative mt-3 border-l-2 border-bordo-svetla pl-3">
          <p aria-hidden={zamagljen} className={`whitespace-pre-line text-sm leading-[1.55] ${zamagljen ? "select-none blur-md" : ""}`}>
            {utisak.tekst}
          </p>
          {zamagljen && (
            <button type="button" onClick={() => setOtkriven(true)} className="absolute inset-0 flex min-h-11 items-center justify-center rounded-mali text-center text-sm font-semibold text-bordo">
              <span className="rounded-full bg-pozadina px-3 py-1.5">{T.spojler}</span>
            </button>
          )}
        </div>
      )}
      {utisak.spojler && utisak.tekst && otkriven && (
        <button type="button" onClick={() => setOtkriven(false)} className="mt-1 inline-flex min-h-11 items-center text-sm font-medium text-bordo underline">
          {T.sakrijSpojler}
        </button>
      )}
    </li>
  );
}
