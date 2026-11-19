import { useId, useState } from "react";
import { GreskaApija } from "../lib/api.js";
import { useAuth } from "../lib/auth-context.js";
import { NAJDUZI_RAZLOG, urediRazlog } from "../lib/citaoci-logika.js";
import { prijavi } from "../lib/citaoci.js";
import { stil } from "../lib/stil.js";
import { tekst } from "../lib/tekst.js";

const T = tekst.prijavaStavke;

// Dugme „Пријави" na tuđem utisku i na primljenoj preporuci: razlog (obavezan, do 300 znakova) i slanje
// bibliotekaru. Prijava ide običnim klijentom kao prijavljeni član; šta sme da se prijavi proverava
// baza (okidač iz 0021: utisak koji vidim, preporuka koju sam primio), pa ovde nema nikakve provere
// prava. Kad je prijava poslata, dugme se zamenjuje porukom, da se ista stvar ne šalje dvaput.
export default function PrijaviStavku({ tip, stavkaId }) {
  const { clan } = useAuth();
  const idPolja = useId();
  const [otvoreno, setOtvoreno] = useState(false);
  const [razlog, setRazlog] = useState("");
  const [saljem, setSaljem] = useState(false);
  const [ishod, setIshod] = useState(null); // { tekst, greska, gotovo }

  async function posalji(e) {
    e.preventDefault();
    if (saljem) return;
    const r = urediRazlog(razlog);
    if (!r.ok) return setIshod({ tekst: r.razlog === "prazno" ? T.razlogPrazno : T.razlogPredugo, greska: true });
    setSaljem(true);
    setIshod(null);
    try {
      await prijavi(clan.id, tip, stavkaId, r.vrednost);
      setIshod({ tekst: T.poslata, gotovo: true });
      setOtvoreno(false);
      setRazlog("");
    } catch (err) {
      console.error("prijava stavke:", err?.kod ?? err?.code);
      if (err instanceof GreskaApija && err.kod === "vec_prijavljeno") setIshod({ tekst: T.vecPrijavljeno, gotovo: true });
      else if (err instanceof GreskaApija && err.kod === "stavka_nedostupna") setIshod({ tekst: T.nedostupno, gotovo: true });
      else setIshod({ tekst: T.greska, greska: true });
    }
    setSaljem(false);
  }

  if (ishod?.gotovo) {
    return (
      <p role="status" className="mt-2 text-sm font-medium text-mastilo-2">
        {ishod.tekst}
      </p>
    );
  }

  if (!otvoreno) {
    return (
      <button
        type="button"
        onClick={() => setOtvoreno(true)}
        aria-label={tip === "utisak" ? T.dugmeUtisak : T.dugmePreporuka}
        className="inline-flex min-h-11 items-center text-sm font-medium text-mastilo-2 underline"
      >
        {T.dugme}
      </button>
    );
  }

  return (
    <form onSubmit={posalji} noValidate className="mt-2 space-y-3 rounded-srednji border border-linija p-3">
      <p className="text-sm text-mastilo-2">{T.opis}</p>
      <div>
        <label htmlFor={idPolja} className="text-sm font-medium text-mastilo-2">
          {T.razlog}
        </label>
        <textarea id={idPolja} rows={3} maxLength={NAJDUZI_RAZLOG} value={razlog} onChange={(e) => setRazlog(e.target.value)} className={`${stil.polje} mt-1.5 min-h-20`} />
      </div>
      {ishod?.greska && (
        <p role="alert" className="text-sm font-medium text-bordo">
          {ishod.tekst}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={saljem} className={stil.veliko}>
          {saljem ? T.saljem : T.posalji}
        </button>
        <button
          type="button"
          disabled={saljem}
          onClick={() => {
            setOtvoreno(false);
            setIshod(null);
          }}
          className={stil.tiho}
        >
          {T.odustani}
        </button>
      </div>
    </form>
  );
}
