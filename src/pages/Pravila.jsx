import { useNavigate } from "react-router-dom";
import { stil } from "../lib/stil.js";
import { tekst } from "../lib/tekst.js";

const T = tekst.pravila;

// Pravila korišćenja i obaveštenje o obradi podataka (/pravila). Javna stranica (bez prijave), da je član
// može pročitati i pre prve prijave, i da je bibliotekar pokaže na pultu. Sav tekst je u tekst.js.
export default function Pravila() {
  const navigate = useNavigate();
  const nazad = () => (window.history.length > 1 ? navigate(-1) : navigate("/"));

  return (
    <main className="mx-auto w-full max-w-[520px] px-5 pb-12 pt-6">
      <button type="button" onClick={nazad} className="inline-flex min-h-11 items-center text-sm font-semibold text-bordo underline">
        {T.nazad}
      </button>
      <h1 className={`${stil.naslov} mt-2`}>{T.naslov}</h1>
      <p className={stil.uvod}>{T.uvod}</p>

      {T.odeljci.map((o) => (
        <section key={o.naslov} aria-label={o.naslov}>
          <h2 className={stil.odeljak}>{o.naslov}</h2>
          <ul className={`${stil.karta} list-disc space-y-2 pl-9 pr-4 text-[14.5px] leading-[1.55] marker:text-bordo`}>
            {o.tacke.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
