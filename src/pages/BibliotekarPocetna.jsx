import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { popuni } from "../lib/prijave-logika.js";
import { ucitajBrojOtvorenih } from "../lib/prijave.js";
import { stil } from "../lib/stil.js";
import { tekst } from "../lib/tekst.js";

const T = tekst.osoblje;

const STAVKE = [
  { putanja: "/bibliotekar/unos", kljuc: "unos" },
  { putanja: "/bibliotekar/knjige", kljuc: "knjige" },
  { putanja: "/bibliotekar/razvrstavanje", kljuc: "razvrstavanje" },
  { putanja: "/bibliotekar/clanovi", kljuc: "clanovi" },
  { putanja: "/bibliotekar/nabavka", kljuc: "nabavka" },
  { putanja: "/bibliotekar/utisak", kljuc: "pult" },
  { putanja: "/bibliotekar/prijave", kljuc: "prijave" },
];

// Početni ekran za bibliotekare i administratore: sedam alata, svaki sa jednom rečenicom. Uz „Пријаве"
// stoji broj nerešenih (greška pri učitavanju je tiha: broj samo izostane).
export default function BibliotekarPocetna() {
  const [otvorene, setOtvorene] = useState(0);

  useEffect(() => {
    let otkazano = false;
    ucitajBrojOtvorenih()
      .then((n) => !otkazano && setOtvorene(n))
      .catch(() => {});
    return () => {
      otkazano = true;
    };
  }, []);

  return (
    <>
      <h1 className={`${stil.naslov} pt-2`}>{T.naslov}</h1>
      <p className={stil.uvod}>{T.uvod}</p>
      <ul className="mt-4 space-y-3">
        {STAVKE.map((s) => (
          <li key={s.kljuc}>
            <Link to={s.putanja} className={`${stil.karta} block min-h-14 transition active:scale-[.985]`}>
              <span className="flex min-h-[26px] flex-wrap items-baseline justify-between gap-2">
                <span className="font-naslov text-[17px] font-bold tracking-tight text-bordo">{T[s.kljuc].naslov}</span>
                {s.kljuc === "prijave" && otvorene > 0 && <span className={stil.izvorFond}>{popuni(T.otvorene, { n: otvorene })}</span>}
              </span>
              <span className="mt-1 block text-sm text-mastilo-2">{T[s.kljuc].opis}</span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
