import { useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../lib/auth-context.js";
import { tekst } from "../lib/tekst.js";

// Velika polja i dugmad; font polja je najmanje 16px (17px osnova), pa telefon
// ne zumira kad se polje otvori.
const polje =
  "mt-1 block w-full rounded-lg border-2 border-ivica bg-white px-4 py-3 text-xl focus:border-pecat focus:outline-none";

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
    <main className="mx-auto max-w-md p-4 sm:p-6">
      <h1 className="text-3xl font-semibold text-pecat">{tekst.aplikacija.naziv}</h1>
      <p className="mt-1 text-mastilo/70">{tekst.aplikacija.ustanova}</p>

      <h2 className="mt-8 text-2xl font-semibold">{tekst.prijava.naslov}</h2>
      <p className="mt-1 text-lg">{tekst.prijava.uvod}</p>

      <form onSubmit={posalji} className="mt-6 space-y-5" noValidate>
        <div>
          <label htmlFor="kartica" className="text-lg font-medium">
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
          <label htmlFor="pin" className="text-lg font-medium">
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
              className={polje}
            />
            <button
              type="button"
              onClick={() => setVidiPin((v) => !v)}
              className="mt-1 shrink-0 rounded-lg border-2 border-ivica px-3 text-base font-medium text-pecat"
            >
              {vidiPin ? tekst.prijava.sakrijPin : tekst.prijava.prikaziPin}
            </button>
          </div>
        </div>

        {poruka && (
          <p role="alert" className="rounded-lg border-2 border-pecat bg-white p-3 text-lg font-medium text-pecat">
            {poruka}
          </p>
        )}

        <button
          type="submit"
          disabled={saljem}
          className="block w-full rounded-lg bg-pecat px-5 py-4 text-xl font-semibold text-white disabled:opacity-60"
        >
          {saljem ? tekst.opste.sacekajte : tekst.prijava.dugme}
        </button>
      </form>

      <p className="mt-6 text-mastilo/70">{tekst.prijava.pomoc}</p>
    </main>
  );
}
