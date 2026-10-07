import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import RezultatKnjige from "../components/RezultatKnjige.jsx";
import { porukaGreske } from "../lib/api.js";
import { useAuth } from "../lib/auth-context.js";
import { dodajNaPolicu, dodajRucno, izLinka, pretraziGoogle, pretraziNasuBazu } from "../lib/knjige.js";
import { tekst } from "../lib/tekst.js";

const T = tekst.pretraga;

const polje =
  "block w-full rounded-lg border-2 border-ivica bg-white px-4 py-3 text-xl focus:border-pecat focus:outline-none";
const dugme = "block w-full rounded-lg bg-pecat px-5 py-3 text-xl font-semibold text-white disabled:opacity-60 sm:w-auto";
const MIRNO = { stanje: "mirno", rezultati: [], greska: null };

function Lista({ rezultati, onDodaj }) {
  return (
    <ul className="mt-3 space-y-3">
      {rezultati.map((k, i) => (
        <RezultatKnjige key={k.id ?? k.isbn ?? `${k.naslov}-${i}`} knjiga={k} onDodaj={onDodaj} />
      ))}
    </ul>
  );
}

function Odeljak({ naslov, uvod, children }) {
  return (
    <section className="mt-10">
      <h2 className="text-2xl font-semibold">{naslov}</h2>
      {uvod && <p className="mt-1 text-lg">{uvod}</p>}
      {children}
    </section>
  );
}

const Greska = ({ poruka }) =>
  poruka ? (
    <p role="alert" className="mt-3 rounded-lg border-2 border-pecat bg-white p-3 text-lg font-medium text-pecat">
      {poruka}
    </p>
  ) : null;

export default function Pretraga() {
  const { clan } = useAuth();
  const dodaj = (knjiga, status) => dodajNaPolicu(clan.id, knjiga, status);

  // 1. naša baza
  // ?upit=... (npr. „Otvori" sa ekrana za unos bibliotekara) odmah pokreće pretragu
  const [parametri] = useSearchParams();
  const polazniUpit = (parametri.get("upit") ?? "").trim();
  const [upit, setUpit] = useState(polazniUpit);
  const [trazi, setTrazi] = useState(false);
  const [nase, setNase] = useState(null); // { upit, rezultati }
  const [greskaNase, setGreskaNase] = useState(null);
  // 2. Google Books
  const [google, setGoogle] = useState(MIRNO);
  // 3. link
  const [adresa, setAdresa] = useState("");
  const [link, setLink] = useState(MIRNO);
  // 4. ručni upis
  const [rucnoNaslov, setRucnoNaslov] = useState("");
  const [rucnoAutor, setRucnoAutor] = useState("");
  const [rucno, setRucno] = useState({ saljem: false, poruka: null, greska: false });

  async function izvrsiPretragu(q) {
    setGreskaNase(null);
    if (q.length < 2) return setGreskaNase(T.prekratko);
    setTrazi(true);
    setNase(null);
    setGoogle(MIRNO);
    try {
      setNase({ upit: q, rezultati: await pretraziNasuBazu(q) });
    } catch (err) {
      console.error("pretraga baze:", err);
      setGreskaNase(porukaGreske(err));
    }
    setTrazi(false);
  }

  function pretrazi(e) {
    e.preventDefault();
    if (!trazi) izvrsiPretragu(upit.trim());
  }

  // Pretraga iz adrese (?upit=...) kreće jednom, pri otvaranju strane.
  useEffect(() => {
    if (polazniUpit.length < 2) return undefined;
    let otkazano = false;
    // odloženo do sledećeg ciklusa: stanje se ne postavlja sinhrono iz efekta
    Promise.resolve().then(() => {
      if (!otkazano) izvrsiPretragu(polazniUpit);
    });
    return () => {
      otkazano = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- samo pri otvaranju strane
  }, []);

  async function pretraziNaGoogle() {
    setGoogle({ ...MIRNO, stanje: "trazi" });
    try {
      setGoogle({ stanje: "gotovo", rezultati: await pretraziGoogle(nase.upit), greska: null });
    } catch (err) {
      setGoogle({ stanje: "greska", rezultati: [], greska: porukaGreske(err) });
    }
  }

  async function procitajLink(e) {
    e.preventDefault();
    if (link.stanje === "trazi" || !adresa.trim()) return;
    setLink({ ...MIRNO, stanje: "trazi" });
    try {
      setLink({ stanje: "gotovo", rezultati: await izLinka(adresa.trim()), greska: null });
    } catch (err) {
      setLink({ stanje: "greska", rezultati: [], greska: porukaGreske(err) });
    }
  }

  async function dodajRucnoNaPolicu(e) {
    e.preventDefault();
    if (rucno.saljem) return;
    if (!rucnoNaslov.trim() || !rucnoAutor.trim()) return setRucno({ saljem: false, poruka: T.rucno.obavezno, greska: true });
    setRucno({ saljem: true, poruka: null, greska: false });
    try {
      await dodajRucno(clan.id, rucnoNaslov, rucnoAutor);
      setRucnoNaslov("");
      setRucnoAutor("");
      setRucno({ saljem: false, poruka: T.polica.dodatoNijeUFondu, greska: false });
    } catch (err) {
      console.error("ručni upis:", err);
      setRucno({ saljem: false, poruka: T.polica.nijeDodato, greska: true });
    }
  }

  return (
    <>
      <h1 className="text-3xl font-semibold text-pecat">{T.naslov}</h1>
      <p className="mt-1 text-lg">{T.uvod}</p>

      {/* 1. naša baza */}
      <form onSubmit={pretrazi} className="mt-4 space-y-3" noValidate role="search">
        <label htmlFor="upit" className="sr-only">
          {T.polje}
        </label>
        <input
          id="upit"
          type="search"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="search"
          placeholder={T.polje}
          value={upit}
          onChange={(e) => setUpit(e.target.value)}
          className={polje}
        />
        <button type="submit" disabled={trazi} className={dugme}>
          {trazi ? T.trazi : T.dugme}
        </button>
      </form>
      <Greska poruka={greskaNase} />

      {nase && (
        <Odeljak naslov={T.nase.naslov}>
          {nase.rezultati.length ? <Lista rezultati={nase.rezultati} onDodaj={dodaj} /> : <p className="mt-2 text-lg">{T.nase.nema}</p>}
        </Odeljak>
      )}

      {/* 2. Google Books (izričito, na dugme: broj pretraga na sat je ograničen) */}
      {nase && (
        <Odeljak naslov={T.google.naslov} uvod={T.google.uvod}>
          <button
            type="button"
            onClick={pretraziNaGoogle}
            disabled={google.stanje === "trazi"}
            className={`${dugme} mt-3`}
          >
            {google.stanje === "trazi" ? T.trazi : T.google.dugme}
          </button>
          <Greska poruka={google.greska} />
          {google.stanje === "gotovo" &&
            (google.rezultati.length ? <Lista rezultati={google.rezultati} onDodaj={dodaj} /> : <p className="mt-2 text-lg">{T.google.nema}</p>)}
        </Odeljak>
      )}

      {/* 3. link */}
      <Odeljak naslov={T.link.naslov} uvod={T.link.uvod}>
        <form onSubmit={procitajLink} className="mt-3 space-y-3" noValidate>
          <label htmlFor="adresa" className="sr-only">
            {T.link.polje}
          </label>
          <input
            id="adresa"
            type="text"
            inputMode="url"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder={T.link.polje}
            value={adresa}
            onChange={(e) => setAdresa(e.target.value)}
            className={polje}
          />
          <button type="submit" disabled={link.stanje === "trazi" || !adresa.trim()} className={dugme}>
            {link.stanje === "trazi" ? T.trazi : T.link.dugme}
          </button>
        </form>
        <Greska poruka={link.greska} />
        {link.stanje === "gotovo" && <Lista rezultati={link.rezultati} onDodaj={dodaj} />}
      </Odeljak>

      {/* 4. ručni upis: uvek dostupan, nikad ćorsokak */}
      <Odeljak naslov={T.rucno.naslov} uvod={T.rucno.uvod}>
        <form onSubmit={dodajRucnoNaPolicu} className="mt-3 space-y-3" noValidate>
          <div>
            <label htmlFor="rucno-naslov" className="text-lg font-medium">
              {T.rucno.naslovPolje}
            </label>
            <input
              id="rucno-naslov"
              type="text"
              autoComplete="off"
              maxLength={300}
              value={rucnoNaslov}
              onChange={(e) => setRucnoNaslov(e.target.value)}
              className={`${polje} mt-1`}
            />
          </div>
          <div>
            <label htmlFor="rucno-autor" className="text-lg font-medium">
              {T.rucno.autorPolje}
            </label>
            <input
              id="rucno-autor"
              type="text"
              autoComplete="off"
              maxLength={200}
              value={rucnoAutor}
              onChange={(e) => setRucnoAutor(e.target.value)}
              className={`${polje} mt-1`}
            />
          </div>
          <button type="submit" disabled={rucno.saljem} className={dugme}>
            {rucno.saljem ? tekst.opste.sacekajte : T.rucno.dugme}
          </button>
        </form>
        {rucno.poruka && (
          <p role={rucno.greska ? "alert" : "status"} className={`mt-3 text-lg font-medium ${rucno.greska ? "text-pecat" : ""}`}>
            {rucno.poruka}
          </p>
        )}
      </Odeljak>
    </>
  );
}
