import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../lib/auth-context.js";
import { tekst } from "../lib/tekst.js";
import Okvir from "./Okvir.jsx";

// Bez prijave sve vodi na /prijava; posle prijave se vraća gde je član krenuo.
export default function ZasticenaRuta() {
  const { sesija, clan, ucitava, profilGreska, osveziClana, odjavi } = useAuth();
  const lokacija = useLocation();

  if (ucitava) {
    return <p className="p-6 text-lg text-mastilo/70">{tekst.opste.ucitava}</p>;
  }

  if (!sesija) {
    return <Navigate to="/prijava" replace state={{ od: lokacija }} />;
  }

  if (profilGreska) {
    return (
      <main className="mx-auto max-w-xl p-6">
        <h1 className="text-2xl font-semibold text-pecat">{tekst.zasticeno.profilGreska}</h1>
        <p className="mt-2 text-lg">{tekst.zasticeno.profilGreskaPomoc}</p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <button type="button" onClick={osveziClana} className="rounded-lg bg-pecat px-5 py-3 text-lg font-semibold text-white">
            {tekst.zasticeno.ponovo}
          </button>
          <button type="button" onClick={odjavi} className="rounded-lg border-2 border-pecat px-5 py-3 text-lg font-semibold text-pecat">
            {tekst.meni.odjava}
          </button>
        </div>
      </main>
    );
  }

  // Prijava postoji, a profil se još učitava (ili se upravo odjavljuje neaktivan član).
  if (!clan) {
    return <p className="p-6 text-lg text-mastilo/70">{tekst.opste.ucitava}</p>;
  }

  return <Okvir />;
}
