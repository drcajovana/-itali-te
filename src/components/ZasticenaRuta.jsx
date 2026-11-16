import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../lib/auth-context.js";
import { stil } from "../lib/stil.js";
import { tekst } from "../lib/tekst.js";
import Okvir from "./Okvir.jsx";

// Bez prijave sve vodi na /prijava; posle prijave se vraća gde je član krenuo.
export default function ZasticenaRuta() {
  const { sesija, clan, ucitava, profilGreska, osveziClana, odjavi } = useAuth();
  const lokacija = useLocation();

  if (ucitava) {
    return <p className="p-6 text-base text-mastilo-2">{tekst.opste.ucitava}</p>;
  }

  if (!sesija) {
    return <Navigate to="/prijava" replace state={{ od: lokacija }} />;
  }

  if (profilGreska) {
    return (
      <main className="mx-auto max-w-[520px] p-6">
        <h1 className="font-naslov text-2xl font-bold text-bordo">{tekst.zasticeno.profilGreska}</h1>
        <p className="mt-2 text-base">{tekst.zasticeno.profilGreskaPomoc}</p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <button type="button" onClick={osveziClana} className={stil.veliko}>
            {tekst.zasticeno.ponovo}
          </button>
          <button type="button" onClick={odjavi} className={stil.okvirno}>
            {tekst.meni.odjava}
          </button>
        </div>
      </main>
    );
  }

  // Prijava postoji, a profil se još učitava (ili se upravo odjavljuje neaktivan član).
  if (!clan) {
    return <p className="p-6 text-base text-mastilo-2">{tekst.opste.ucitava}</p>;
  }

  return <Okvir />;
}
