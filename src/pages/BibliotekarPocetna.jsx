import { Link } from "react-router-dom";
import { stil } from "../lib/stil.js";
import { tekst } from "../lib/tekst.js";

const T = tekst.osoblje;

const STAVKE = [
  { putanja: "/bibliotekar/unos", kljuc: "unos" },
  { putanja: "/bibliotekar/clanovi", kljuc: "clanovi" },
  { putanja: "/bibliotekar/rezervacije", kljuc: "rezervacije" },
];

// Početni ekran za bibliotekare i administratore: tri alata, svaki sa jednom rečenicom.
export default function BibliotekarPocetna() {
  return (
    <>
      <h1 className={`${stil.naslov} pt-2`}>{T.naslov}</h1>
      <p className={stil.uvod}>{T.uvod}</p>
      <ul className="mt-4 space-y-3">
        {STAVKE.map((s) => (
          <li key={s.kljuc}>
            <Link to={s.putanja} className={`${stil.karta} block min-h-14 transition active:scale-[.985]`}>
              <span className="block font-naslov text-[17px] font-bold tracking-tight text-bordo">{T[s.kljuc].naslov}</span>
              <span className="mt-1 block text-sm text-mastilo-2">{T[s.kljuc].opis}</span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
