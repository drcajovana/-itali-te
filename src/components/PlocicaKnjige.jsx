import { Link } from "react-router-dom";
import { tekst } from "../lib/tekst.js";
import Korica from "./Korica.jsx";

// Knjiga u mreži police (prototip: .mreza): korica širine kolone (naša slika → Open Library →
// gradijent-pločica, vidi Korica.jsx), naslov u dva reda i autor. Knjiga koja nije u fondu ima
// značku „nije u fondu" preko korice. Ceo element je veza (dodirna meta veća od 44 px).
export default function PlocicaKnjige({ knjiga }) {
  return (
    <Link
      to={`/knjiga/${knjiga.id}`}
      aria-label={tekst.pocetna.otvori.replace("{naslov}", knjiga.naslov)}
      className="block min-h-11 min-w-0 rounded-mali text-left"
    >
      <div className="relative">
        <Korica knjiga={knjiga} autor={knjiga.autor} velicina="puna" />
        {!knjiga.u_fondu && (
          <span className="absolute right-[7px] top-[7px] z-10 rounded-full bg-white/95 px-2 py-0.5 text-[10.5px] font-semibold leading-tight text-zlato">{tekst.pocetna.nijeUFondu}</span>
        )}
      </div>
      <span className="mt-2 line-clamp-2 block break-words text-[12.5px] font-medium leading-tight">{knjiga.naslov}</span>
      {knjiga.autor && <span className="mt-0.5 line-clamp-1 block text-[11px] text-mastilo-2">{knjiga.autor}</span>}
    </Link>
  );
}
