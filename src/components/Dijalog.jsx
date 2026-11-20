import { useEffect, useId } from "react";

// Jednostavan dijalog preko ekrana (izmena i potvrda brisanja knjige): zatamnjena pozadina, kutija u sredini, zatvaranje tasterom Esc
// ili dodirom van kutije (osim dok traje upis: `zauzet`). Sav tekst dolazi spolja.
export default function Dijalog({ naslov, onZatvori, zauzet = false, children }) {
  const idNaslova = useId();

  useEffect(() => {
    const naTaster = (e) => {
      if (e.key === "Escape" && !zauzet) onZatvori();
    };
    document.addEventListener("keydown", naTaster);
    return () => document.removeEventListener("keydown", naTaster);
  }, [zauzet, onZatvori]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-mastilo/45 p-3 sm:items-center sm:p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !zauzet) onZatvori();
      }}
    >
      <div role="dialog" aria-modal="true" aria-labelledby={idNaslova} className="max-h-[92vh] w-full max-w-[520px] overflow-y-auto rounded-velik bg-povrsina p-5 shadow-senka">
        <h2 id={idNaslova} className="font-naslov text-[19px] font-bold tracking-[-0.02em]">
          {naslov}
        </h2>
        {children}
      </div>
    </div>
  );
}
