import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../lib/auth-context.js";
import { brojObavestenja } from "../lib/citaoci-logika.js";
import { ucitajObavestenja } from "../lib/citaoci.js";
import { ucitajBrojOtvorenih } from "../lib/prijave.js";
import { tekst } from "../lib/tekst.js";
import { jeBibliotekar } from "../lib/uloge.js";

const NAZIV = tekst.aplikacija.naziv;

// Inicijali za avatar: prva slova prve dve reči imena („Jovana Đorđević" → „JĐ").
const inicijali = (ime) =>
  String(ime ?? "")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((r) => r.charAt(0).toUpperCase())
    .join("");

// Ikone donje navigacije su iz prototipa (docs/prototip.html).
const IKONE = {
  polica: <path d="M4 5.5A1.5 1.5 0 015.5 4H10v16H5.5A1.5 1.5 0 014 18.5zM14 4h4.5A1.5 1.5 0 0120 5.5v13a1.5 1.5 0 01-1.5 1.5H14z" />,
  trazi: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.6-3.6" />
    </>
  ),
  citaoci: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19c0-3.2 2.5-5.2 5.5-5.2s5.5 2 5.5 5.2M16 6.2a3 3 0 010 5.6M18 14.4c2 .6 3.2 2.1 3.2 4.3" />
    </>
  ),
  profil: (
    <>
      <circle cx="12" cy="8" r="3.6" />
      <path d="M5 20c0-3.7 3.1-6 7-6s7 2.3 7 6" />
    </>
  ),
  biblioteka: <path d="M3 21h18M5 21V10m4 11V10m6 11V10m4 11V10M3 10l9-6 9 6" />,
};

const STAVKE = [
  { putanja: "/", kljuc: "polica", natpis: tekst.meni.pocetna, end: true },
  { putanja: "/pretraga", kljuc: "trazi", natpis: tekst.meni.pretraga },
  { putanja: "/citaoci", kljuc: "citaoci", natpis: tekst.meni.citaoci },
  { putanja: "/profil", kljuc: "profil", natpis: tekst.meni.profil },
];
// Samo za bibliotekare i administratore: ulaz u alate (članovi, unos knjiga).
const STAVKA_OSOBLJA = { putanja: "/bibliotekar", kljuc: "biblioteka", natpis: tekst.meni.biblioteka };

// Okvir svih stranica posle prijave (prototip): lepljivo zaglavlje sa grbom „1846", imenom i avatarom,
// sadržaj najviše 520 px širine i donja navigacija Polica, Traži, Čitaoci, Profil.
export default function Okvir() {
  const { clan } = useAuth();
  const { pathname } = useLocation();
  const [obavestenja, setObavestenja] = useState(0);
  const [otvorenePrijave, setOtvorenePrijave] = useState(0);
  const osoblje = jeBibliotekar(clan?.uloga);

  // Tačka na stavci „Читаоци": novi poziv ili neobrađena preporuka. Osvežava se pri promeni ekrana,
  // kad se prozor vrati u prvi plan i kad ekran Читаоци javi promenu. Greška je tiha (tačka samo izostane).
  // Osoblje dobija i tačku na stavci „Библиотека" dok ima nerešenih prijava (isti okidači osvežavanja).
  useEffect(() => {
    let otkazano = false;
    const osvezi = () => {
      ucitajObavestenja()
        .then((o) => !otkazano && setObavestenja(brojObavestenja(o.pozivi, o.preporuke)))
        .catch(() => {});
      if (osoblje) {
        ucitajBrojOtvorenih()
          .then((n) => !otkazano && setOtvorenePrijave(n))
          .catch(() => {});
      }
    };
    osvezi();
    window.addEventListener("citaoci-promena", osvezi);
    window.addEventListener("focus", osvezi);
    return () => {
      otkazano = true;
      window.removeEventListener("citaoci-promena", osvezi);
      window.removeEventListener("focus", osvezi);
    };
  }, [pathname, osoblje]);

  return (
    <div className={`mx-auto w-full max-w-[520px] ${pathname.startsWith("/bibliotekar") ? "md:max-w-[900px] xl:max-w-[1200px]" : "md:max-w-[720px]"}`}>
      <header className="sticky top-0 z-20 flex items-center gap-3 bg-pozadina px-5 pb-3 pt-[18px] after:pointer-events-none after:absolute after:inset-x-0 after:-bottom-6 after:h-6 after:bg-linear-to-b after:from-pozadina after:to-transparent after:content-['']">
        <img src="/znak.svg" alt="" aria-hidden="true" width="40" height="40" className="size-10 flex-none" />
        <Link to="/" className="flex min-h-11 flex-1 items-center font-naslov text-[19px] font-extrabold tracking-[-0.03em]">
          {NAZIV.slice(0, 4)}
          <span className="text-bordo">{NAZIV.slice(4)}</span>
        </Link>
        {/* „Унос књига”: samo uz pretragu (i na kartici Biblioteka); na početnoj polici i ostalim ekranima ga nema */}
        {jeBibliotekar(clan?.uloga) && pathname.startsWith("/pretraga") && (
          <Link to="/bibliotekar/unos" className="flex min-h-11 items-center rounded-full bg-povrsina px-4 text-sm font-semibold text-bordo shadow-senka">
            {tekst.meni.unos}
          </Link>
        )}
        <Link
          to="/profil"
          aria-label={tekst.meni.profil}
          className="flex size-11 flex-none items-center justify-center rounded-full bg-bordo text-[13px] font-semibold text-white"
        >
          {inicijali(clan?.ime)}
        </Link>
      </header>

      <main className="px-5 pb-[calc(7rem+env(safe-area-inset-bottom))] pt-2">
        <Outlet />
      </main>

      <nav
        aria-label={tekst.meni.oznaka}
        className="fixed inset-x-0 bottom-0 z-40 mx-auto flex max-w-[520px] border-t border-linija bg-povrsina/90 px-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-1.5 backdrop-blur-md"
      >
        {(jeBibliotekar(clan?.uloga) ? [...STAVKE, STAVKA_OSOBLJA] : STAVKE).map((s) => (
          <NavLink
            key={s.kljuc}
            to={s.putanja}
            end={s.end}
            className="group flex min-h-14 flex-1 flex-col items-center justify-center gap-1 rounded-srednji px-1 py-2 text-[11px] font-medium text-mastilo-2 transition aria-[current=page]:text-bordo"
          >
            <span className="relative flex h-7 w-[46px] items-center justify-center rounded-full transition group-aria-[current=page]:bg-bordo-svetla">
              <svg viewBox="0 0 24 24" className="size-[19px] fill-none stroke-current stroke-[1.7]" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                {IKONE[s.kljuc]}
              </svg>
              {s.kljuc === "citaoci" && obavestenja > 0 && (
                <>
                  <span aria-hidden="true" className="absolute right-1.5 top-0 size-2.5 rounded-full bg-bordo ring-2 ring-povrsina" />
                  <span className="sr-only">{tekst.meni.obavestenje}</span>
                </>
              )}
              {s.kljuc === "biblioteka" && otvorenePrijave > 0 && (
                <>
                  <span aria-hidden="true" className="absolute right-1.5 top-0 size-2.5 rounded-full bg-bordo ring-2 ring-povrsina" />
                  <span className="sr-only">{tekst.meni.obavestenjePrijave}</span>
                </>
              )}
            </span>
            {s.natpis}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
