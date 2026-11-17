import { useId, useState } from "react";
import { Link } from "react-router-dom";
import { porukaGreske } from "../lib/api.js";
import { urediPotvrdu } from "../lib/red-knjige.js";
import { stil } from "../lib/stil.js";
import { tekst } from "../lib/tekst.js";
import Korica from "./Korica.jsx";

const STATUSI = ["zelim", "citam", "procitano"];
const T = tekst.pretraga;

const polje = `${stil.polje} mt-1`;

// Izbor stanja police: tri jasna dugmeta u jednom redu (umesto padajuće liste).
function IzborStanja({ status, onPromena }) {
  return (
    <div>
      <p className="mb-1.5 text-sm font-medium text-mastilo-2">{T.polica.dodajKao}</p>
      <div role="group" aria-label={T.polica.dodajKao} className="grid grid-cols-3 gap-1 rounded-full bg-pozadina p-1">
        {STATUSI.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={status === s}
            onClick={() => onPromena(s)}
            className="flex min-h-11 items-center justify-center rounded-full px-2 text-[14.5px] font-semibold text-mastilo-2 transition aria-pressed:bg-bordo aria-pressed:text-white"
          >
            {T.polica.kratko[s]}
          </button>
        ))}
      </div>
    </div>
  );
}

// Jedan rezultat: iz naše baze (ima `id`, `u_fondu`) ili spoljni (Google Books,
// link: `autori`, `izvor`).
//  - iz naše baze: dodaje se odmah;
//  - spoljni: prvo se prikazuju izmenljiva polja sa vrednostima iz rezultata, a upis
//    ide tek na dugme „Potvrdi". Trajno se čuva samo ono što član potvrdi (naslov,
//    autor, izdavač, godina, ISBN), nikad opis ni Google-ova korica.
// `onDodaj(knjiga, status)` dodaje knjigu na policu.
export default function RezultatKnjige({ knjiga, onDodaj }) {
  const id = useId();
  const izBaze = Boolean(knjiga.id);
  const autor = izBaze ? knjiga.autor : (knjiga.autori ?? []).join(", ");
  const izdavac = [knjiga.izdavac, knjiga.godina].filter(Boolean).join(", ");

  const [status, setStatus] = useState("zelim");
  const [saljem, setSaljem] = useState(false);
  const [ishod, setIshod] = useState(null); // { poruka, greska }
  const [forma, setForma] = useState(null); // otvorena forma za potvrdu: { naslov, autor, izdavac, godina, isbn }
  const [greskaForme, setGreskaForme] = useState(null);

  async function upisi(zaDodavanje) {
    setSaljem(true);
    setIshod(null);
    try {
      await onDodaj(zaDodavanje, status);
      setForma(null);
      setIshod({ poruka: T.polica.dodato });
    } catch (e) {
      console.error("dodavanje na policu:", e);
      setIshod({ poruka: e?.kod ? porukaGreske(e) : T.polica.nijeDodato, greska: true });
    }
    setSaljem(false);
  }

  function klikDodaj() {
    if (saljem) return;
    setIshod(null);
    if (izBaze) return upisi(knjiga);
    // spoljni rezultat: najpre prikaži polja za proveru
    setGreskaForme(null);
    setForma({
      naslov: knjiga.naslov ?? "",
      autor,
      izdavac: knjiga.izdavac ?? "",
      godina: knjiga.godina ? String(knjiga.godina) : "",
      isbn: knjiga.isbn ?? "",
    });
  }

  function potvrdi(e) {
    e.preventDefault();
    if (saljem) return;
    const r = urediPotvrdu(forma);
    if (!r.ok) {
      const kljuc = r.razlog === "predugo" ? "predugo" : `${r.polje}_${r.razlog}`;
      return setGreskaForme(T.potvrda.greske[kljuc] ?? T.potvrda.greske.predugo);
    }
    setGreskaForme(null);
    // Šalje se samo potvrđeno (red-knjige.js): nikad opis ni korica.
    return upisi({ podaci: r.podaci });
  }

  const promeni = (ime) => (e) => setForma((f) => ({ ...f, [ime]: e.target.value }));

  const izGoogle = knjiga.izvor === "google_books";

  return (
    <li className={stil.karta}>
      <div className="flex gap-3">
      <Korica knjiga={knjiga} autor={autor} google={izGoogle ? { url: knjiga.url } : null} />
      <div className="min-w-0 flex-1">
        <h3 className="font-naslov text-[17px] font-bold leading-tight tracking-[-0.025em]">{knjiga.naslov}</h3>
        <p className="mt-0.5 text-[13.5px] text-mastilo-2">{autor || T.knjiga.bezAutora}</p>
        {izdavac && <p className="text-xs text-mastilo-2">{izdavac}</p>}

        {izBaze && (
          <div className="mt-1">
            <Link to={`/knjiga/${knjiga.id}`} className="inline-flex min-h-11 items-center text-sm font-semibold text-bordo underline">
              {T.knjiga.detalji}
            </Link>
          </div>
        )}
        {!izBaze && (
          <p className="mt-2 text-xs text-mastilo-2">
            <span className={izGoogle ? stil.izvorSpolja : stil.izvor}>{izGoogle ? T.knjiga.googleBooks : T.knjiga.saLinka}</span>
            {" "}
            {T.knjiga.sa}: {izGoogle ? T.knjiga.googleBooks : T.knjiga.saLinka}
            {knjiga.url && (
              <>
                {" · "}
                <a href={knjiga.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-bordo underline">
                  {izGoogle ? T.knjiga.pogledaj : new URL(knjiga.url).hostname.replace(/^www\./, "")}
                </a>
              </>
            )}
          </p>
        )}

      </div>
      </div>

      <div className="mt-4">
        {!forma && (
          <div className="space-y-3">
            <IzborStanja status={status} onPromena={setStatus} />
            <button
              type="button"
              onClick={klikDodaj}
              disabled={saljem}
              className={`${stil.veliko} sm:w-full`}
            >
              {saljem ? tekst.opste.sacekajte : T.polica.dodaj}
            </button>
          </div>
        )}

        {forma && (
          <form onSubmit={potvrdi} className="mt-3 space-y-3 rounded-srednji border border-bordo bg-povrsina p-3" noValidate>
            <h4 className="text-base font-bold">{T.potvrda.naslov}</h4>
            <p className="text-base">{izGoogle ? T.potvrda.uvodGoogle : T.potvrda.uvodLink}</p>
            {[
              ["naslov", 300],
              ["autor", 200],
              ["izdavac", 150],
              ["godina", 4],
              ["isbn", 20],
            ].map(([ime, najvise]) => (
              <div key={ime}>
                <label htmlFor={`${id}-${ime}`} className="text-sm font-medium text-mastilo-2">
                  {T.potvrda.polja[ime]}
                </label>
                <input
                  id={`${id}-${ime}`}
                  type="text"
                  inputMode={ime === "godina" ? "numeric" : undefined}
                  autoComplete="off"
                  maxLength={najvise}
                  value={forma[ime]}
                  onChange={promeni(ime)}
                  className={polje}
                />
              </div>
            ))}
            <IzborStanja status={status} onPromena={setStatus} />
            {greskaForme && (
              <p role="alert" className="text-base font-medium text-bordo">
                {greskaForme}
              </p>
            )}
            <div className="flex flex-col gap-2 sm:flex-row">
              <button type="submit" disabled={saljem} className={stil.veliko}>
                {saljem ? tekst.opste.sacekajte : T.potvrda.potvrdi}
              </button>
              <button
                type="button"
                disabled={saljem}
                onClick={() => setForma(null)}
                className={stil.tiho}
              >
                {T.potvrda.odustani}
              </button>
            </div>
          </form>
        )}

        {ishod && (
          <p role="status" className={`mt-2 text-base font-medium ${ishod.greska ? "text-bordo" : ""}`}>
            {ishod.poruka}
          </p>
        )}
      </div>
    </li>
  );
}
