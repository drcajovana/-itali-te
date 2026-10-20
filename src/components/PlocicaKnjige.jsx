import { Link } from "react-router-dom";
import { tekst } from "../lib/tekst.js";
import Korica from "./Korica.jsx";

// Knjiga u mreži police: korica (naša slika → Open Library → složena pločica, vidi Korica.jsx),
// naslov i oznaka „nije u fondu" kad knjiga nije u fondu (npr. ručno upisana). Ceo element je veza
// (dodirna meta veća od 44 px).
export default function PlocicaKnjige({ knjiga }) {
  return (
    <Link
      to={`/knjiga/${knjiga.id}`}
      aria-label={tekst.pocetna.otvori.replace("{naslov}", knjiga.naslov)}
      className="flex min-h-11 min-w-0 flex-col items-center gap-1 rounded-lg p-1 text-center"
    >
      <Korica knjiga={knjiga} autor={knjiga.autor} />
      <span className="line-clamp-2 w-full break-words text-base font-medium leading-tight">{knjiga.naslov}</span>
      {!knjiga.u_fondu && <span className="rounded border border-ivica px-1.5 text-sm text-mastilo/70">{tekst.pocetna.nijeUFondu}</span>}
    </Link>
  );
}
