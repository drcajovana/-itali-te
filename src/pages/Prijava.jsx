import { useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../lib/auth-context.js";
import { stil } from "../lib/stil.js";
import { tekst } from "../lib/tekst.js";

// Polja su najmanje 16 px (telefon ne zumira kad se polje otvori) i 44 px visine.
const polje = `${stil.polje} mt-1.5`;
const NAZIV = tekst.aplikacija.naziv;

export default function Prijava() {
  const { sesija, prijavi, obavest, ocistiObavest } = useAuth();
  const lokacija = useLocation();
  const [kartica, setKartica] = useState("");
  const [pin, setPin] = useState("");
  const [vidiPin, setVidiPin] = useState(false);
  const [razlog, setRazlog] = useState(null);
  const [saljem, setSaljem] = useState(false);

  if (sesija) return <Navigate to={lokacija.state?.od?.pathname ?? "/"} replace />;

  async function posalji(e) {
    e.preventDefault();
    if (saljem) return;
    setSaljem(true);
    setRazlog(null);
    ocistiObavest();
    const rezultat = await prijavi(kartica, pin);
    setSaljem(false);
    if (!rezultat.ok) {
      setRazlog(rezultat.razlog);
      setPin(""); // karta ostaje; ista poruka za pogrešnu kartu i pogrešan PIN
    }
  }

  const poruka = razlog ? tekst.prijava.greske[razlog] : obavest === "neaktivan" ? tekst.prijava.neaktivan : null;

  return (
    <main className="mx-auto w-full max-w-[520px] px-5 pb-10 pt-8">
      <div className="flex items-center gap-3">
        <div
          aria-hidden="true"
          className="flex size-[34px] flex-none items-center justify-center rounded-full border-[1.5px] border-zlato bg-bordo font-naslov text-[10px] font-bold tracking-tight text-zlato-svetlo"
        >
          {tekst.aplikacija.godina}
        </div>
        <span className="font-naslov text-[19px] font-extrabold tracking-[-0.03em]">
          {NAZIV.slice(0, 4)}
          <span className="text-bordo">{NAZIV.slice(4)}</span>
        </span>
      </div>
      <p className="mt-2 text-sm text-mastilo-2">{tekst.aplikacija.ustanova}</p>

      <h1 className={`${stil.naslov} mt-8`}>{tekst.prijava.naslov}</h1>
      <p className={stil.uvod}>{tekst.prijava.uvod}</p>

      <form onSubmit={posalji} className={`${stil.karta} mt-5 space-y-5`} noValidate>
        <div>
          <label htmlFor="kartica" className="text-sm font-medium text-mastilo-2">
            {tekst.prijava.kartica}
          </label>
          <input
            id="kartica"
            name="username"
            type="text"
            autoComplete="username"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="next"
            value={kartica}
            onChange={(e) => setKartica(e.target.value)}
            className={polje}
          />
        </div>

        <div>
          <label htmlFor="pin" className="text-sm font-medium text-mastilo-2">
            {tekst.prijava.pin}
          </label>
          <div className="flex gap-2">
            <input
              id="pin"
              name="password"
              type={vidiPin ? "text" : "password"}
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="current-password"
              enterKeyHint="go"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              className={`${polje} min-w-0 flex-1`}
            />
            <button type="button" onClick={() => setVidiPin((v) => !v)} className={`${stil.okvirno} mt-1.5 w-auto! shrink-0 px-4 text-sm`}>
              {vidiPin ? tekst.prijava.sakrijPin : tekst.prijava.prikaziPin}
            </button>
          </div>
        </div>

        {poruka && (
          <p role="alert" className="rounded-srednji border border-bordo bg-bordo-svetla p-3 text-base font-medium text-bordo">
            {poruka}
          </p>
        )}

        <button type="submit" disabled={saljem} className={stil.veliko}>
          {saljem ? tekst.opste.sacekajte : tekst.prijava.dugme}
        </button>
      </form>

      <p className="mt-5 text-sm text-mastilo-2">{tekst.prijava.pomoc}</p>
    </main>
  );
}
