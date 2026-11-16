import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { postaviStatusRezervacije, ucitajRezervacije } from "../lib/clanovi.js";
import { GreskaApija } from "../lib/api.js";
import { datumIzVremena, filtrirajRezervacije, STATUSI_REZERVACIJE } from "../lib/osoblje-logika.js";
import { formatDatum } from "../lib/polica-logika.js";
import { stil } from "../lib/stil.js";
import { tekst } from "../lib/tekst.js";

const T = tekst.rezervacijeOsoblje;

// Lista rezervacija (knjiga, član, datum, stanje) sa dugmadima za promenu stanja. Postojeće RLS
// politike važe: bibliotekar sme sve (rezervacije_bibliotekar_all), ovde se ništa ne zaobilazi.
export default function BibliotekarRezervacije() {
  const [stanje, setStanje] = useState({ ucitava: true, lista: [], greska: false });
  const [filter, setFilter] = useState("otvorene");
  const [zauzet, setZauzet] = useState(null); // id rezervacije koja se menja
  const [poruka, setPoruka] = useState(null);

  useEffect(() => {
    let otkazano = false;
    ucitajRezervacije()
      .then((lista) => !otkazano && setStanje({ ucitava: false, lista, greska: false }))
      .catch((e) => {
        console.error("učitavanje rezervacija:", e);
        if (!otkazano) setStanje({ ucitava: false, lista: [], greska: true });
      });
    return () => {
      otkazano = true;
    };
  }, []);

  async function promeni(r, status) {
    if (zauzet || r.status === status) return;
    setZauzet(r.id);
    setPoruka(null);
    try {
      const nova = await postaviStatusRezervacije(r.id, status);
      setStanje((s) => ({ ...s, lista: s.lista.map((x) => (x.id === r.id ? { ...x, status: nova.status } : x)) }));
      setPoruka({ tekst: T.sacuvano.replace("{stanje}", T.statusi[nova.status]) });
    } catch (e) {
      console.error("promena stanja rezervacije:", e?.kod ?? e?.message);
      setPoruka({ tekst: e instanceof GreskaApija && e.kod === "duplikat" ? T.nijeSacuvanoDuplikat : T.nijeSacuvano, greska: true });
    }
    setZauzet(null);
  }

  const prikaz = filtrirajRezervacije(stanje.lista, filter);

  return (
    <>
      <h1 className={`${stil.naslov} pt-2`}>{T.naslov}</h1>
      <p className={stil.uvod}>{T.uvod}</p>

      <div role="group" aria-label={T.filter} className="mt-4 flex flex-wrap gap-2">
        {Object.keys(T.filteri).map((f) => (
          <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)} className={stil.cip}>
            {T.filteri[f]}
          </button>
        ))}
      </div>

      {poruka && (
        <p role={poruka.greska ? "alert" : "status"} className={`mt-3 text-sm font-medium ${poruka.greska ? "text-bordo" : ""}`}>
          {poruka.tekst}
        </p>
      )}

      <section className="mt-4" aria-label={T.naslov}>
        {stanje.ucitava && <p className="text-base text-mastilo-2">{T.ucitava}</p>}
        {stanje.greska && (
          <p role="alert" className="text-base font-medium text-bordo">
            {T.greska}
          </p>
        )}
        {!stanje.ucitava && !stanje.greska && prikaz.length === 0 && <p className={`${stil.karta} text-sm text-mastilo-2`}>{filter === "sve" ? T.nemaSvih : T.nemaOtvorenih}</p>}

        <ul className="space-y-3">
          {prikaz.map((r) => (
            <li key={r.id} className={stil.karta}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                {r.knjiga ? (
                  <Link to={`/knjiga/${r.knjiga.id}`} className="inline-flex min-h-11 min-w-11 items-center font-naslov text-[16px] font-bold leading-tight tracking-[-0.02em] text-bordo underline">
                    {r.knjiga.naslov}
                  </Link>
                ) : (
                  <p className="font-naslov text-[16px] font-bold">{T.nepoznataKnjiga}</p>
                )}
                <span className={r.status === "nova" || r.status === "spremna" ? stil.izvorFond : stil.izvor}>{T.statusi[r.status]}</span>
              </div>
              {r.knjiga?.autor && <p className="text-sm text-mastilo-2">{r.knjiga.autor}</p>}
              <p className="mt-2 text-sm">{r.clan ? T.clan.replace("{ime}", r.clan.ime).replace("{karta}", r.clan.broj_kartice) : T.nepoznatClan}</p>
              <p className="text-xs text-mastilo-2">{T.datum.replace("{datum}", formatDatum(datumIzVremena(r.kreirana)))}</p>

              <div role="group" aria-label={T.statusGrupa} className="mt-3 flex flex-wrap gap-2">
                {STATUSI_REZERVACIJE.map((s) => (
                  <button key={s} type="button" disabled={zauzet === r.id} aria-pressed={r.status === s} onClick={() => promeni(r, s)} className={stil.cip}>
                    {T.statusi[s]}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
