import { useId, useState } from "react";
import { Link } from "react-router-dom";
import { porukaGreske } from "../lib/api.js";
import { urediPotvrdu } from "../lib/red-knjige.js";
import { tekst } from "../lib/tekst.js";
import Korica from "./Korica.jsx";

const STATUSI = ["zelim", "citam", "procitano"];
const T = tekst.pretraga;

const polje = "mt-1 block w-full rounded-lg border-2 border-ivica bg-white px-3 py-2 text-lg focus:border-pecat focus:outline-none";

// Jedan rezultat: iz naše baze (ima `id`, `u_fondu`) ili spoljni (Google Books,
// link: `autori`, `izvor`).
//  - iz naše baze: dodaje se odmah;
//  - spoljni: prvo se prikazuju izmenljiva polja sa vrednostima iz rezultata, a upis
//    ide tek na dugme „Potvrdi". Trajno se čuva samo ono što član potvrdi (naslov,
//    autor, izdavač, godina, ISBN), nikad opis ni Google-ova korica.
// `onDodaj(knjiga, status)` vraća { uFondu }.
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
      const { uFondu } = await onDodaj(zaDodavanje, status);
      setForma(null);
      setIshod({ poruka: uFondu === false ? T.polica.dodatoNijeUFondu : T.polica.dodato });
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

  let dostupnost = null;
  if (izBaze) {
    dostupnost = knjiga.u_fondu ? (knjiga.broj_slobodnih > 0 ? T.knjiga.slobodna : T.knjiga.izdata) : T.knjiga.nijeUFondu;
  }
  const izGoogle = knjiga.izvor === "google_books";

  return (
    <li className="flex gap-3 rounded-lg border-2 border-ivica bg-white p-3">
      <Korica knjiga={knjiga} autor={autor} google={izGoogle ? { url: knjiga.url } : null} />
      <div className="min-w-0 flex-1">
        <h3 className="text-xl font-semibold leading-snug">{knjiga.naslov}</h3>
        <p className="text-lg">{autor || T.knjiga.bezAutora}</p>
        {izdavac && <p className="text-base text-mastilo/70">{izdavac}</p>}

        {dostupnost && (
          <p className={`mt-1 inline-block rounded px-2 py-0.5 text-base font-medium ${knjiga.u_fondu ? "bg-ivica" : "border border-ivica"}`}>
            {dostupnost}
          </p>
        )}
        {izBaze && (
          <div className="mt-1">
            <Link to={`/knjiga/${knjiga.id}`} className="inline-flex min-h-11 items-center text-lg text-pecat underline">
              {T.knjiga.detalji}
            </Link>
          </div>
        )}
        {!izBaze && (
          <p className="mt-1 text-base text-mastilo/70">
            {T.knjiga.sa}: {izGoogle ? T.knjiga.googleBooks : T.knjiga.saLinka}
            {knjiga.url && (
              <>
                {" · "}
                <a href={knjiga.url} target="_blank" rel="noopener noreferrer" className="text-pecat underline">
                  {izGoogle ? T.knjiga.pogledaj : new URL(knjiga.url).hostname.replace(/^www\./, "")}
                </a>
              </>
            )}
          </p>
        )}

        {!forma && (
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
              onClick={klikDodaj}
              disabled={saljem}
              className="rounded-lg bg-pecat px-5 py-2 text-lg font-semibold text-white disabled:opacity-60"
            >
              {saljem ? tekst.opste.sacekajte : T.polica.dodaj}
            </button>
          </div>
        )}

        {forma && (
          <form onSubmit={potvrdi} className="mt-3 space-y-3 rounded-lg border-2 border-pecat p-3" noValidate>
            <h4 className="text-lg font-semibold">{T.potvrda.naslov}</h4>
            <p className="text-base">{izGoogle ? T.potvrda.uvodGoogle : T.potvrda.uvodLink}</p>
            {[
              ["naslov", 300],
              ["autor", 200],
              ["izdavac", 150],
              ["godina", 4],
              ["isbn", 20],
            ].map(([ime, najvise]) => (
              <div key={ime}>
                <label htmlFor={`${id}-${ime}`} className="text-base font-medium">
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
            <label className="flex items-center gap-2 text-base">
              <span>{T.polica.dodajKao}</span>
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
            {greskaForme && (
              <p role="alert" className="text-base font-medium text-pecat">
                {greskaForme}
              </p>
            )}
            <div className="flex flex-col gap-2 sm:flex-row">
              <button type="submit" disabled={saljem} className="rounded-lg bg-pecat px-5 py-2 text-lg font-semibold text-white disabled:opacity-60">
                {saljem ? tekst.opste.sacekajte : T.potvrda.potvrdi}
              </button>
              <button
                type="button"
                disabled={saljem}
                onClick={() => setForma(null)}
                className="rounded-lg border-2 border-ivica px-5 py-2 text-lg font-semibold"
              >
                {T.potvrda.odustani}
              </button>
            </div>
          </form>
        )}

        {ishod && (
          <p role="status" className={`mt-2 text-base font-medium ${ishod.greska ? "text-pecat" : ""}`}>
            {ishod.poruka}
          </p>
        )}
      </div>
    </li>
  );
}
