import { tekst } from "../lib/tekst.js";

// Traka napretka čitanja (0–100), kao u prototipu: staza u boji pozadine, popuna bordo, visina 6 px.
export default function TrakaNapretka({ procenat, oznaka = tekst.pocetna.napredakOznaka }) {
  const n = Math.max(0, Math.min(100, Number(procenat) || 0));
  return (
    <div role="progressbar" aria-label={oznaka} aria-valuemin={0} aria-valuemax={100} aria-valuenow={n} className="h-1.5 w-full overflow-hidden rounded-full bg-pozadina">
      <div className="h-full rounded-full bg-bordo" style={{ width: `${n}%` }} />
    </div>
  );
}
