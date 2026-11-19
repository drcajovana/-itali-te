import { useEffect, useState } from "react";
import { odblokiraj, ucitajBlokirane } from "../lib/citaoci.js";
import { prikaznoIme } from "../lib/citaoci-logika.js";
import { popuni } from "../lib/prijave-logika.js";
import { stil } from "../lib/stil.js";
import { tekst } from "../lib/tekst.js";
import Avatar from "./Avatar.jsx";

const T = tekst.citaoci.blokirani;

// Spisak čitalaca koje sam blokirao, sa dugmetom „Одблокирај" (uz potvrdu). Samo nadimak, nikad ime ni broj karte.
// Odblokirani ne dobija nikakav signal, a veza se ne vraća: obojica mogu ponovo da se pozovu pozivom. Dok nema
// nikoga ili pogled još nije dostupan (greška), odeljka nema, da ekran Читаоци ostane isti kao do sada.
export default function SpisakBlokiranih() {
  const [lista, setLista] = useState([]);
  const [pita, setPita] = useState(null); // id blokade koja čeka potvrdu
  const [zauzet, setZauzet] = useState(false);
  const [poruka, setPoruka] = useState(null); // { tekst, greska }

  useEffect(() => {
    let otkazano = false;
    ucitajBlokirane()
      .then((l) => !otkazano && setLista(l))
      .catch((e) => console.error("spisak blokiranih:", e?.code ?? e?.message));
    return () => {
      otkazano = true;
    };
  }, []);

  async function ukloni(b) {
    if (zauzet) return;
    setZauzet(true);
    setPoruka(null);
    try {
      await odblokiraj(b.id);
      setLista((l) => l.filter((x) => x.id !== b.id));
      setPita(null);
      setPoruka({ tekst: T.gotovo });
    } catch (e) {
      console.error("odblokiranje:", e?.kod ?? e?.code);
      setPoruka({ tekst: T.greska, greska: true });
    }
    setZauzet(false);
  }

  if (lista.length === 0 && !poruka) return null;

  return (
    <section aria-label={T.naslov}>
      <h2 className={stil.odeljak}>{T.naslov}</h2>
      <p className="mb-3 text-sm text-mastilo-2">{T.opis}</p>
      {poruka && (
        <p role={poruka.greska ? "alert" : "status"} className={`mb-3 text-sm font-medium ${poruka.greska ? "text-bordo" : ""}`}>
          {poruka.tekst}
        </p>
      )}
      <ul className="space-y-3">
        {lista.map((b) => {
          const ime = prikaznoIme(b.nadimak, tekst.citaoci.anonimno);
          return (
            <li key={b.id} className={stil.karta}>
              <div className="flex items-center gap-3">
                <Avatar id={b.clan_id} nadimak={b.nadimak} />
                <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{ime}</span>
                {pita !== b.id && (
                  <button type="button" disabled={zauzet} onClick={() => setPita(b.id)} className="inline-flex min-h-11 flex-none items-center rounded-full bg-pozadina px-4 text-sm font-medium text-bordo">
                    {T.odblokiraj}
                  </button>
                )}
              </div>
              {pita === b.id && (
                <div role="group" aria-label={popuni(T.pitanje, { nadimak: ime })} className="mt-3 space-y-2 rounded-srednji border border-bordo p-3">
                  <p className="text-sm font-semibold">{popuni(T.pitanje, { nadimak: ime })}</p>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" disabled={zauzet} onClick={() => ukloni(b)} className={stil.veliko}>
                      {T.da}
                    </button>
                    <button type="button" disabled={zauzet} onClick={() => setPita(null)} className={stil.tiho}>
                      {T.odustani}
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
