import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../lib/auth-context.js";
import { tekst } from "../lib/tekst.js";
import { jeBibliotekar } from "../lib/uloge.js";

const veza = ({ isActive }) =>
  `rounded-lg px-4 py-2 text-lg font-medium ${isActive ? "bg-pecat text-white" : "text-pecat"}`;

// Zaglavlje sa menijem za sve stranice posle prijave.
export default function Okvir() {
  const { clan, odjavi } = useAuth();

  return (
    <>
      <header className="border-b border-ivica">
        <div className="mx-auto flex max-w-2xl flex-wrap items-center justify-between gap-2 p-3">
          <span className="text-xl font-semibold text-pecat">{tekst.aplikacija.naziv}</span>
          <nav className="flex flex-wrap items-center gap-1">
            <NavLink to="/" end className={veza}>
              {tekst.meni.pocetna}
            </NavLink>
            <NavLink to="/pretraga" className={veza}>
              {tekst.meni.pretraga}
            </NavLink>
            {jeBibliotekar(clan?.uloga) && (
              <NavLink to="/bibliotekar/unos" className={veza}>
                {tekst.meni.unos}
              </NavLink>
            )}
            <NavLink to="/profil" className={veza}>
              {tekst.meni.profil}
            </NavLink>
            <button type="button" onClick={odjavi} className="rounded-lg px-4 py-2 text-lg font-medium text-mastilo/70">
              {tekst.meni.odjava}
            </button>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-2xl p-4 sm:p-6">
        <Outlet />
      </main>
    </>
  );
}
