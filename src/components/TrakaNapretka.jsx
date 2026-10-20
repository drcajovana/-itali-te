import { tekst } from "../lib/tekst.js";

// Traka napretka čitanja (0–100). Boje samo iz teme aplikacije: ivica (staza) i pečat (popuna).
export default function TrakaNapretka({ procenat, oznaka = tekst.pocetna.napredakOznaka }) {
  const n = Math.max(0, Math.min(100, Number(procenat) || 0));
  return (
    <div role="progressbar" aria-label={oznaka} aria-valuemin={0} aria-valuemax={100} aria-valuenow={n} className="h-3 w-full overflow-hidden rounded-full bg-ivica">
      <div className="h-full rounded-full bg-pecat" style={{ width: `${n}%` }} />
    </div>
  );
}
