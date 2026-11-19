import { tekst } from "../lib/tekst.js";

// Rezervisan prostor dok se podaci učitavaju: nekoliko blokova stalne visine umesto reda teksta „Учитавам…".
// Kad podaci stignu, lista zauzima otprilike isto mesto, pa se ostatak ekrana ne pomera. Tekst za čitače ekrana ostaje.
// Treperenje (animate-pulse) je samo providnost, bez pomeranja, i gasi se pod prefers-reduced-motion (index.css).
// `visina` je Tailwind klasa visine jednog bloka (npr. "h-24"), `blokova` koliko ih ima.
export default function Skeleton({ blokova = 3, visina = "h-24", razmak = "mt-4" }) {
  return (
    <div role="status" aria-busy="true" className={`${razmak} space-y-3`}>
      <span className="sr-only">{tekst.opste.ucitava}</span>
      {Array.from({ length: blokova }, (_, i) => (
        <div key={i} aria-hidden="true" className={`${visina} animate-pulse rounded-velik bg-povrsina shadow-senka`} />
      ))}
    </div>
  );
}
