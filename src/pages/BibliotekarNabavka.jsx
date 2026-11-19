import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Skeleton from "../components/Skeleton.jsx";
import Korica from "../components/Korica.jsx";
import { brojeviPoFilteru, FILTERI, filtrirajNabavku, imeFajlaNabavke, izvestajUCsv, ODLUKE, poredjajNabavku, saNovomOdlukom } from "../lib/nabavka-logika.js";
import { postaviOdluku, ucitajNabavku } from "../lib/nabavka.js";
import { datumIzVremena } from "../lib/osoblje-logika.js";
import { formatDatum } from "../lib/polica-logika.js";
import { stil } from "../lib/stil.js";
import { tekst } from "../lib/tekst.js";

const T = tekst.nabavka;

// Izveštaj za nabavku (samo za bibliotekare i administratore): knjige koje čitaoci žele, sa BROJEM
// čitalaca (nikad imena) i odlukom bibliotekara. Podatke vraća pogled izvestaj_za_nabavku (0020): u
// pregledač ne stiže nijedno polje o članu, pa od ovog ekrana nema puta do imena. Brojevi su tačni,
// i kad je broj 1: ekran je samo za bibliotekare, a bez imena i vremena broj nikoga ne otkriva.
export default function BibliotekarNabavka() {
  const [stanje, setStanje] = useState({ ucitava: true, redovi: [], greska: false });
  const [filter, setFilter] = useState("nove");
  const [upit, setUpit] = useState("");
  const [zauzet, setZauzet] = useState(null);
  const [poruka, setPoruka] = useState(null);

  useEffect(() => {
    let otkazano = false;
    ucitajNabavku()
      .then((redovi) => !otkazano && setStanje({ ucitava: false, redovi: poredjajNabavku(redovi), greska: false }))
      .catch((e) => {
        console.error("izveštaj za nabavku:", e);
        if (!otkazano) setStanje({ ucitava: false, redovi: [], greska: true });
      });
    return () => {
      otkazano = true;
    };
  }, []);

  const brojevi = useMemo(() => brojeviPoFilteru(stanje.redovi), [stanje.redovi]);
  const prikaz = useMemo(() => filtrirajNabavku(stanje.redovi, filter, upit), [stanje.redovi, filter, upit]);

  async function odluci(r, odluka) {
    if (zauzet || (r.odluka ?? null) === odluka) return;
    setZauzet(r.id);
    setPoruka(null);
    try {
      const knjiga = await postaviOdluku(r.id, odluka);
      setStanje((s) => ({ ...s, redovi: s.redovi.map((x) => (x.id === r.id ? saNovomOdlukom(x, knjiga) : x)) }));
      setPoruka({ tekst: T.sacuvano });
    } catch (e) {
      console.error("odluka nabavke:", e?.kod ?? e?.code);
      setPoruka({ tekst: T.nijeSacuvano, greska: true });
    }
    setZauzet(null);
  }

  function preuzmi() {
    const sadrzaj = izvestajUCsv(prikaz, T.csv, T.odluke);
    const url = URL.createObjectURL(new Blob([sadrzaj], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = imeFajlaNabavke();
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <>
      <h1 className={`${stil.naslov} pt-2`}>{T.naslov}</h1>
      <p className={stil.uvod}>{T.uvod}</p>
      <p className="mt-1 text-sm text-mastilo-2">{T.privatnost}</p>

      <div role="group" aria-label={T.filter} className="mt-4 flex flex-wrap gap-2">
        {FILTERI.map((f) => (
          <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)} className={stil.cip}>
            {T.filteri[f]} <span className="ml-1 tabular-nums opacity-70">{brojevi[f]}</span>
          </button>
        ))}
      </div>

      <div className="mt-4">
        <label htmlFor="pretraga-nabavke" className="text-sm font-medium text-mastilo-2">
          {T.pretraga}
        </label>
        <input id="pretraga-nabavke" type="search" autoComplete="off" placeholder={T.pretragaPrazno} value={upit} onChange={(e) => setUpit(e.target.value)} className={`${stil.polje} mt-1.5`} />
      </div>

      <div className="mt-4 flex flex-col gap-1">
        <button type="button" onClick={preuzmi} disabled={prikaz.length === 0} className={stil.okvirno}>
          {T.preuzmi}
        </button>
        <p className="text-xs text-mastilo-2">
          {T.preuzmiNapomena} {T.brojKnjiga.replace("{n}", String(prikaz.length))}
        </p>
      </div>

      {poruka && (
        <p role={poruka.greska ? "alert" : "status"} className={`mt-3 text-sm font-medium ${poruka.greska ? "text-bordo" : ""}`}>
          {poruka.tekst}
        </p>
      )}

      <section className="mt-4" aria-label={T.naslov}>
        {stanje.ucitava && <Skeleton blokova={3} visina="h-36" razmak="" />}
        {stanje.greska && (
          <p role="alert" className="text-base font-medium text-bordo">
            {T.greska}
          </p>
        )}
        {!stanje.ucitava && !stanje.greska && prikaz.length === 0 && <p className={`${stil.karta} text-sm text-mastilo-2`}>{stanje.redovi.length === 0 ? T.nemaSvih : T.nema}</p>}

        <ul className="space-y-3">
          {prikaz.map((r) => (
            <li key={r.id} className={stil.karta}>
              <div className="flex gap-3">
                <div className="w-11 flex-none">
                  <Korica knjiga={r} autor={r.autor} velicina="sitna" />
                </div>
                <div className="min-w-0 flex-1">
                  <Link to={`/knjiga/${r.id}`} className="inline-flex min-h-11 min-w-11 items-center font-naslov text-[16px] font-bold leading-tight tracking-[-0.02em] text-bordo underline">
                    {r.naslov}
                  </Link>
                  {r.autor && <p className="text-sm text-mastilo-2">{r.autor}</p>}
                  {r.izdavac && <p className="text-xs text-mastilo-2">{r.izdavac}</p>}
                  <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm tabular-nums">
                    <span className="font-semibold text-bordo">{T.zele.replace("{n}", String(r.zele))}</span>
                    <span className="text-mastilo-2">{T.citaju.replace("{n}", String(r.citaju_ili_procitali))}</span>
                  </p>
                </div>
              </div>

              <div role="group" aria-label={T.odlukaGrupa.replace("{naslov}", r.naslov)} className="mt-3 flex flex-wrap gap-2">
                {ODLUKE.map((o) => (
                  <button key={o} type="button" disabled={zauzet === r.id} aria-pressed={r.odluka === o} onClick={() => odluci(r, o)} className={stil.cip}>
                    {T.odluke[o]}
                  </button>
                ))}
                <button type="button" disabled={zauzet === r.id} aria-pressed={r.odluka == null} onClick={() => odluci(r, null)} className={stil.cip}>
                  {T.bezOdluke}
                </button>
              </div>
              {r.odluka_postavljena && r.odluka_datum && <p className="mt-2 text-xs text-mastilo-2">{T.odlukaOd.replace("{datum}", formatDatum(datumIzVremena(r.odluka_datum)))}</p>}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
