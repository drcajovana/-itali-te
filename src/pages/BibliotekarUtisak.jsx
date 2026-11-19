import { useEffect, useId, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth-context.js";
import { ucitajClanove } from "../lib/clanovi.js";
import { pretraziNasuBazu } from "../lib/knjige.js";
import { NAJDUZI_UTISAK, VIDLJIVOSTI } from "../lib/polica-logika.js";
import { popuni } from "../lib/prijave-logika.js";
import { imaUtisak, sacuvajUtisakSaPulta } from "../lib/pult.js";
import { aktivniClanovi, kljucGreske } from "../lib/pult-logika.js";
import { stil } from "../lib/stil.js";
import { tekst } from "../lib/tekst.js";

const T = tekst.pult;
const OCENE = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const PRAZNA_FORMA = { ocena: "", tekst: "", vidljivost: "", spojler: false };
const opisOcene = (n) => popuni(tekst.utisak.ocenaOpis, { ocena: n, opis: tekst.utisak.ocene[n] });

// Izbor jednog reda iz liste rezultata (član ili knjiga): dugme na celoj širini, najmanje 56 px.
function Izbor({ lista, naIzbor, naslov, podnaslov }) {
  return (
    <ul className="mt-3 space-y-2">
      {lista.map((x) => (
        <li key={x.id}>
          <button type="button" onClick={() => naIzbor(x)} className="flex min-h-14 w-full flex-col justify-center rounded-srednji bg-pozadina px-4 py-2 text-left transition hover:bg-bordo-svetla">
            <span className="text-[15px] font-semibold leading-tight">{naslov(x)}</span>
            {podnaslov(x) && <span className="text-xs text-mastilo-2">{podnaslov(x)}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}

// Utisak sa pulta (/bibliotekar/utisak): bibliotekar upisuje utisak U IME člana koji to želi. Tri koraka: član, knjiga,
// utisak. Vidljivost se ne pretpostavlja (bibliotekar pita člana), bibliotekar potvrđuje da član to želi, a postojeći
// utisak člana se ne prepisuje. Upis ide običnim klijentom (RLS); potpis bibliotekara čuva okidač (0022), a član
// ga vidi kao napomenu uz svoj utisak.
export default function BibliotekarUtisak() {
  const { clan: ja } = useAuth();
  const idTeksta = useId();
  const [upitClan, setUpitClan] = useState("");
  const [clanovi, setClanovi] = useState(null); // null: još se nije tražilo
  const [clan, setClan] = useState(null);
  const [upitKnjiga, setUpitKnjiga] = useState("");
  const [knjige, setKnjige] = useState(null);
  const [knjiga, setKnjiga] = useState(null);
  const [vec, setVec] = useState(false); // član već ima utisak za izabranu knjigu
  const [proveravam, setProveravam] = useState(false);
  const [forma, setForma] = useState(PRAZNA_FORMA);
  const [potvrda, setPotvrda] = useState(false);
  const [trazi, setTrazi] = useState(false);
  const [zauzet, setZauzet] = useState(false);
  const [poruka, setPoruka] = useState(null); // { tekst, greska }

  // Kad se izabere član i knjiga, proverava se da li član već ima utisak (ne prepisuje se).
  useEffect(() => {
    if (!clan || !knjiga) return;
    let otkazano = false;
    imaUtisak(clan.id, knjiga.id)
      .then((da) => {
        if (otkazano) return;
        setVec(da);
        setProveravam(false);
      })
      .catch((e) => {
        console.error("provera utiska:", e);
        if (!otkazano) setProveravam(false);
      });
    return () => {
      otkazano = true;
    };
  }, [clan, knjiga]);

  const izaberiKnjigu = (k) => {
    setKnjiga(k);
    setVec(false);
    setProveravam(true);
    setPoruka(null);
  };

  async function traziClana(e) {
    e.preventDefault();
    if (trazi || upitClan.trim().length < 2) return;
    setTrazi(true);
    setPoruka(null);
    try {
      setClanovi(aktivniClanovi((await ucitajClanove(upitClan.trim())).lista));
    } catch (err) {
      console.error("pult, članovi:", err);
      setClanovi([]);
      setPoruka({ tekst: T.greske.pretraga, greska: true });
    }
    setTrazi(false);
  }

  async function traziKnjigu(e) {
    e.preventDefault();
    if (trazi || upitKnjiga.trim().length < 2) return;
    setTrazi(true);
    setPoruka(null);
    try {
      setKnjige(await pretraziNasuBazu(upitKnjiga.trim()));
    } catch (err) {
      console.error("pult, knjige:", err);
      setKnjige([]);
      setPoruka({ tekst: T.greske.pretraga, greska: true });
    }
    setTrazi(false);
  }

  async function sacuvaj(e) {
    e.preventDefault();
    if (zauzet) return;
    setZauzet(true);
    setPoruka(null);
    try {
      await sacuvajUtisakSaPulta(ja.id, { clan, knjiga, forma, potvrda });
      setPoruka({ tekst: popuni(T.sacuvano, { ime: clan.ime }) });
      setKnjiga(null);
      setKnjige(null);
      setUpitKnjiga("");
      setForma(PRAZNA_FORMA);
      setPotvrda(false);
    } catch (err) {
      const kljuc = kljucGreske(err);
      if (kljuc === "opste") console.error("pult, upis:", err?.kod ?? err?.code);
      setPoruka({ tekst: T.greske[kljuc], greska: true });
    }
    setZauzet(false);
  }

  function drugiClan() {
    setClan(null);
    setClanovi(null);
    setUpitClan("");
    setKnjiga(null);
    setKnjige(null);
    setUpitKnjiga("");
    setForma(PRAZNA_FORMA);
    setPotvrda(false);
    setPoruka(null);
  }

  const ocena = forma.ocena === "" ? null : Number(forma.ocena);
  const mozeForma = clan && knjiga && !vec && !proveravam;

  return (
    <>
      <h1 className={`${stil.naslov} pt-2`}>{T.naslov}</h1>
      <p className={stil.uvod}>{T.uvod}</p>

      <section className={`${stil.karta} mt-4`} aria-label={T.clan.naslov}>
        <h2 className="font-naslov text-[17px] font-bold">{T.clan.naslov}</h2>
        {clan ? (
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold">{popuni(T.clan.izabran, { ime: clan.ime, karta: clan.broj_kartice })}</p>
            <button type="button" onClick={drugiClan} className="inline-flex min-h-11 items-center text-sm font-medium text-bordo underline">
              {T.clan.promeni}
            </button>
          </div>
        ) : (
          <>
            <form onSubmit={traziClana} className="mt-2 space-y-2" noValidate>
              <label htmlFor="pult-clan" className="text-sm font-medium text-mastilo-2">
                {T.clan.pretraga}
              </label>
              <input id="pult-clan" type="search" autoComplete="off" value={upitClan} onChange={(e) => setUpitClan(e.target.value)} className={stil.polje} />
              <button type="submit" disabled={trazi} className={stil.veliko}>
                {trazi ? T.clan.trazim : T.clan.trazi}
              </button>
            </form>
            {clanovi && clanovi.length === 0 && <p className="mt-3 text-sm text-mastilo-2">{T.clan.nema}</p>}
            {clanovi && clanovi.length > 0 && <Izbor lista={clanovi} naIzbor={(c) => { setClan(c); setPoruka(null); }} naslov={(c) => c.ime} podnaslov={(c) => popuni(tekst.clanovi.karta, { karta: c.broj_kartice })} />}
          </>
        )}
      </section>

      {clan && (
        <section className={`${stil.karta} mt-4`} aria-label={T.knjiga.naslov}>
          <h2 className="font-naslov text-[17px] font-bold">{T.knjiga.naslov}</h2>
          {knjiga ? (
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <p className="min-w-0 text-sm font-semibold">{popuni(T.knjiga.izabrana, { naslov: knjiga.naslov })}</p>
              <button
                type="button"
                onClick={() => {
                  setKnjiga(null);
                  setVec(false);
                }}
                className="inline-flex min-h-11 items-center text-sm font-medium text-bordo underline"
              >
                {T.knjiga.promeni}
              </button>
            </div>
          ) : (
            <>
              <form onSubmit={traziKnjigu} className="mt-2 space-y-2" noValidate>
                <label htmlFor="pult-knjiga" className="text-sm font-medium text-mastilo-2">
                  {T.knjiga.pretraga}
                </label>
                <input id="pult-knjiga" type="search" autoComplete="off" value={upitKnjiga} onChange={(e) => setUpitKnjiga(e.target.value)} className={stil.polje} />
                <button type="submit" disabled={trazi} className={stil.veliko}>
                  {trazi ? T.clan.trazim : T.clan.trazi}
                </button>
              </form>
              {knjige && knjige.length === 0 && (
                <p className="mt-3 text-sm text-mastilo-2">
                  {T.knjiga.nema}{" "}
                  <Link to="/bibliotekar/unos" className="font-medium text-bordo underline">
                    {T.knjiga.unos}
                  </Link>
                </p>
              )}
              {knjige && knjige.length > 0 && <Izbor lista={knjige} naIzbor={izaberiKnjigu} naslov={(k) => k.naslov} podnaslov={(k) => k.autor} />}
            </>
          )}
          {proveravam && <p className="mt-2 text-sm text-mastilo-2">{T.knjiga.proveravam}</p>}
          {vec && (
            <p role="alert" className="mt-3 text-sm font-medium text-bordo">
              {T.knjiga.vecIma}
            </p>
          )}
        </section>
      )}

      {mozeForma && (
        <form onSubmit={sacuvaj} className={`${stil.karta} mt-4 space-y-5`} noValidate>
          <h2 className="font-naslov text-[17px] font-bold">{T.utisak.naslov}</h2>

          <fieldset>
            <legend className="text-sm font-medium text-mastilo-2">{T.utisak.ocena}</legend>
            <div className="mt-2 grid grid-cols-5 gap-2">
              {OCENE.map((n) => (
                <button
                  key={n}
                  type="button"
                  aria-pressed={ocena === n}
                  aria-label={opisOcene(n)}
                  onClick={() => setForma((f) => ({ ...f, ocena: f.ocena === n ? "" : n }))}
                  className="flex min-h-12 items-center justify-center rounded-mali bg-pozadina text-[15px] font-semibold text-mastilo-2 transition hover:bg-bordo-svetla hover:text-bordo aria-pressed:bg-bordo aria-pressed:text-white"
                >
                  {n}
                </button>
              ))}
            </div>
            <p className="mt-3 min-h-5 text-[13px] text-mastilo-2" aria-live="polite">
              {ocena ? opisOcene(ocena) : tekst.utisak.bezOcene}
            </p>
          </fieldset>

          <div>
            <label htmlFor={idTeksta} className="text-sm font-medium text-mastilo-2">
              {T.utisak.tekst}
            </label>
            <textarea id={idTeksta} rows={5} maxLength={NAJDUZI_UTISAK} value={forma.tekst} onChange={(e) => setForma((f) => ({ ...f, tekst: e.target.value }))} className={`${stil.polje} mt-1.5 min-h-24`} />
          </div>

          <fieldset>
            <legend className="text-sm font-medium text-mastilo-2">{T.utisak.vidljivost}</legend>
            <div role="group" aria-label={T.utisak.vidljivost} className="mt-2 flex flex-wrap gap-2">
              {VIDLJIVOSTI.map((v) => (
                <button key={v} type="button" aria-pressed={forma.vidljivost === v} onClick={() => setForma((f) => ({ ...f, vidljivost: v }))} className={stil.cip}>
                  {tekst.utisak.vidljivosti[v]}
                </button>
              ))}
            </div>
          </fieldset>

          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-mastilo-2">
            <input type="checkbox" checked={forma.spojler} onChange={(e) => setForma((f) => ({ ...f, spojler: e.target.checked }))} className="size-[18px] accent-bordo" />
            {tekst.utisak.spojler}
          </label>

          <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm font-medium">
            <input type="checkbox" checked={potvrda} onChange={(e) => setPotvrda(e.target.checked)} className="mt-0.5 size-[18px] flex-none accent-bordo" />
            {T.utisak.potvrda}
          </label>

          <button type="submit" disabled={zauzet} className={stil.veliko}>
            {zauzet ? T.utisak.cuvam : T.utisak.sacuvaj}
          </button>
        </form>
      )}

      {poruka && (
        <p role={poruka.greska ? "alert" : "status"} className={`mt-4 text-sm font-medium ${poruka.greska ? "text-bordo" : ""}`}>
          {poruka.tekst}
        </p>
      )}
      {clan && !knjiga && poruka && !poruka.greska && (
        <button type="button" onClick={drugiClan} className={`${stil.okvirno} mt-3`}>
          {T.drugiClan}
        </button>
      )}
    </>
  );
}
