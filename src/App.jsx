import { tekst } from "./lib/tekst.js";

export default function App() {
  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="text-3xl font-semibold text-pecat">
        {tekst.aplikacija.naziv}
      </h1>
      <p className="mt-2 text-mastilo/70">{tekst.aplikacija.ustanova}</p>
      <p className="mt-8 text-mastilo/60">{tekst.pocetna.uIzradi}</p>
    </main>
  );
}
