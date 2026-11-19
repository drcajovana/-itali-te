import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import Korica from "../components/Korica.jsx";
import Skeleton from "../components/Skeleton.jsx";
import { datumIzVremena } from "../lib/osoblje-logika.js";
import { formatDatum } from "../lib/polica-logika.js";
import { IZVORI, ODLUKE, REDOSLEDI, filteriIzAdrese, filteriUAdresu, grupeZbira, imaJos, kljucFiltera, opcijeIzdavaca } from "../lib/pregled-knjiga-logika.js";
import { ucitajIzdavace, ucitajStranuKnjiga, ucitajZbirKnjiga } from "../lib/pregled-knjiga.js";
import { popuni } from "../lib/prijave-logika.js";
import { stil } from "../lib/stil.js";
import { tekst } from "../lib/tekst.js";

const T = tekst.pregledKnjiga;

// Jedan broj iz zbira: veliki broj i natpis ispod.
function Broj({ broj, natpis }) {
  return (
    <div className="rounded-srednji bg-pozadina px-3 py-2.5">
      <p className="font-naslov text-[22px] font-bold leading-none tracking-[-0.03em] text-bordo">{broj}</p>
      <p className="mt-1 text-xs text-mastilo-2">{natpis}</p>
    </div>
  );
}

// Jedna knjiga u listi. Samo podaci o knjizi i ZBIRNI broj čitalaca; nikad ko je unosilac ni ko je knjigu stavio na policu.
function RedKnjige({ k }) {
  const odluka = k.odluka ? T.odluke[k.odluka] : T.odluke.bez;
  return (
    <li className={`${stil.karta} flex gap-3`}>
      <div className="w-11 flex-none">
        <Korica knjiga={k} autor={k.autor} velicina="sitna" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-naslov text-[15.5px] font-bold leading-tight tracking-[-0.02em]">{k.naslov}</p>
        <p className="mt-0.5 text-sm text-mastilo-2">{k.autor || T.bezAutora}</p>
        {(k.izdavac || k.godina) && <p className="text-xs text-mastilo-2">{[k.izdavac, k.godina].filter(Boolean).join(", ")}</p>}
        {k.isbn && <p className="text-xs tabular-nums text-mastilo-2">{popuni(T.isbn, { isbn: k.isbn })}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className={k.izvor === "fond" ? stil.izvorFond : stil.izvor}>{T.izvoriKratko[k.izvor] ?? k.izvor}</span>
          <span className={k.odluka === "imamo" ? stil.izvorFond : stil.izvor}>{odluka}</span>
        </div>
        <p className="mt-2 text-xs text-mastilo-2">
          {popuni(T.citaoca, { n: k.citaoca })} · {popuni(T.unetoDatum, { datum: formatDatum(datumIzVremena(k.kreirana)) })}
        </p>
      </div>
    </li>
  );
}

// Ekran „Све књиге" (/bibliotekar/knjige): zbirni brojevi i lista svih knjiga sa brojem čitalaca. Samo za bibliotekare i
// administratore (RutaZaBibliotekare je udobnost; funkcije iz 0024 vraćaju prazno svima ostalima). Ekran ne dobija nikakav trag
// do člana: nema unosioca, nema imena, nema onoga ko je knjigu stavio na policu.
export default function BibliotekarKnjige() {
  // Filteri žive u adresi (?q=&izvor=&odluka=&izdavac=&redosled=), pa se izbor čuva pri osvežavanju i povratku na ekran.
  // Svaka promena filtera menja adresu bez novog zapisa u istoriji, a lista počinje iznova od prve strane (ključ filtera).
  const [params, setParams] = useSearchParams();
  const { upit: trazi, izvor, odluka, izdavac, redosled } = filteriIzAdrese(params);
  const postavi = (izmena) => setParams(filteriUAdresu({ upit: trazi, izvor, odluka, izdavac, redosled, ...izmena }), { replace: true });
  // Polje za pretragu ima svoj tekst; u adresu ide tek kad se kucanje zaustavi.
  const [upit, setUpit] = useState(trazi);
  const [izdavaci, setIzdavaci] = useState({ kljuc: null, redovi: [] });
  const [zbir, setZbir] = useState({ ucitano: false, podaci: null, greska: false });
  // Rezultat pamti za koji je filter učitan; dok se ne poklopi sa izabranim, ekran javlja da učitava.
  const [lista, setLista] = useState({ kljuc: null, redovi: [], ukupno: 0, greska: false });
  const [jos, setJos] = useState(false);

  useEffect(() => {
    if (upit.trim() === trazi) return;
    const t = setTimeout(() => setParams(filteriUAdresu({ upit, izvor, odluka, izdavac, redosled }), { replace: true }), 300);
    return () => clearTimeout(t);
  }, [upit, trazi, izvor, odluka, izdavac, redosled, setParams]);

  useEffect(() => {
    let otkazano = false;
    ucitajZbirKnjiga()
      .then((podaci) => !otkazano && setZbir({ ucitano: true, podaci, greska: false }))
      .catch((e) => {
        console.error("zbir knjiga:", e?.code ?? e?.message);
        if (!otkazano) setZbir({ ucitano: true, podaci: null, greska: true });
      });
    return () => {
      otkazano = true;
    };
  }, []);

  const filteri = { upit: trazi, izvor, odluka, izdavac, redosled };
  const kljuc = kljucFiltera(filteri);

  useEffect(() => {
    let otkazano = false;
    const k = kljucFiltera({ upit: trazi, izvor, odluka, izdavac, redosled });
    ucitajStranuKnjiga({ upit: trazi, izvor, odluka, izdavac, redosled })
      .then(({ redovi, ukupno }) => !otkazano && setLista({ kljuc: k, redovi, ukupno, greska: false }))
      .catch((e) => {
        console.error("lista knjiga:", e?.code ?? e?.message);
        if (!otkazano) setLista({ kljuc: k, redovi: [], ukupno: 0, greska: true });
      });
    return () => {
      otkazano = true;
    };
  }, [trazi, izvor, odluka, izdavac, redosled]);

  // Spisak izdavača prati pretragu, izvor i odluku (ne i izabranog izdavača), pa brojevi odgovaraju onome što bi se dobilo.
  useEffect(() => {
    let otkazano = false;
    const k = JSON.stringify([trazi, izvor, odluka]);
    ucitajIzdavace({ upit: trazi, izvor, odluka })
      .then((redovi) => !otkazano && setIzdavaci({ kljuc: k, redovi }))
      .catch((e) => {
        console.error("izdavači:", e?.code ?? e?.message);
        if (!otkazano) setIzdavaci({ kljuc: k, redovi: [] });
      });
    return () => {
      otkazano = true;
    };
  }, [trazi, izvor, odluka]);

  async function ucitajJos() {
    if (jos) return;
    setJos(true);
    try {
      const { redovi, ukupno } = await ucitajStranuKnjiga({ ...filteri, pomeraj: lista.redovi.length });
      setLista((l) => (l.kljuc === kljuc ? { ...l, redovi: [...l.redovi, ...redovi], ukupno } : l));
    } catch (e) {
      console.error("još knjiga:", e?.code ?? e?.message);
      setLista((l) => ({ ...l, greska: true }));
    }
    setJos(false);
  }

  const ucitava = lista.kljuc !== kljuc;
  const g = grupeZbira(zbir.podaci);
  const opcijeIzd = opcijeIzdavaca(izdavaci.redovi, izdavac, T.izdavac);

  return (
    <>
      <h1 className={`${stil.naslov} pt-2`}>{T.naslov}</h1>
      <p className={stil.uvod}>{T.uvod}</p>

      <section className={`${stil.karta} mt-4`} aria-label={T.ukupno}>
        {!zbir.ucitano && <Skeleton blokova={1} visina="h-[318px]" razmak="" />}
        {zbir.greska && (
          <p role="alert" className="text-sm font-medium text-bordo">
            {T.zbirGreska}
          </p>
        )}
        {zbir.podaci && (
          <>
            <p className="text-xs font-medium text-mastilo-2">{T.ukupno}</p>
            <p className="font-naslov text-[40px] font-extrabold leading-none tracking-[-0.04em] text-bordo">{g.ukupno}</p>
            <p className="mt-1 text-xs text-mastilo-2">{T.ukupnoPomoc}</p>
            {g.spojenih > 0 && <p className="text-xs text-mastilo-2">{popuni(T.spojenih, { n: g.spojenih })}</p>}

            <h2 className="mt-4 text-sm font-semibold">{T.poIzvoru}</h2>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {g.izvori.map((x) => (
                <Broj key={x.kljuc} broj={x.broj} natpis={T.izvori[x.kljuc]} />
              ))}
            </div>

            <h2 className="mt-4 text-sm font-semibold">{T.poOdluci}</h2>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {g.odluke.map((x) => (
                <Broj key={x.kljuc} broj={x.broj} natpis={T.odluke[x.kljuc]} />
              ))}
            </div>
          </>
        )}
      </section>

      <div className="mt-5">
        <label htmlFor="pregled-pretraga" className="text-sm font-medium text-mastilo-2">
          {T.pretraga}
        </label>
        <input id="pregled-pretraga" type="search" autoComplete="off" placeholder={T.pretragaPrazno} value={upit} onChange={(e) => setUpit(e.target.value)} className={`${stil.polje} mt-1.5`} />
      </div>

      <div className="mt-4">
        <p className="text-sm font-medium text-mastilo-2">{T.filterIzvor}</p>
        <div role="group" aria-label={T.filterIzvor} className="mt-1.5 flex flex-wrap gap-2">
          {["", ...IZVORI].map((v) => (
            <button key={v || "sve"} type="button" aria-pressed={izvor === v} onClick={() => postavi({ izvor: v })} className={stil.cip}>
              {v ? T.izvoriKratko[v] : T.sve}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4">
        <p className="text-sm font-medium text-mastilo-2">{T.filterOdluka}</p>
        <div role="group" aria-label={T.filterOdluka} className="mt-1.5 flex flex-wrap gap-2">
          {["", ...ODLUKE].map((v) => (
            <button key={v || "sve"} type="button" aria-pressed={odluka === v} onClick={() => postavi({ odluka: v })} className={stil.cip}>
              {v ? T.odluke[v] : T.sve}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4">
        <label htmlFor="pregled-izdavac" className="text-sm font-medium text-mastilo-2">
          {T.filterIzdavac}
        </label>
        <select id="pregled-izdavac" value={izdavac} onChange={(e) => postavi({ izdavac: e.target.value })} className={`${stil.polje} mt-1.5`}>
          <option value="">{T.sviIzdavaci}</option>
          {opcijeIzd.map((o) => (
            <option key={o.kljuc} value={o.kljuc}>
              {o.natpis}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-4">
        <p className="text-sm font-medium text-mastilo-2">{T.redosled}</p>
        <div role="group" aria-label={T.redosled} className="mt-1.5 flex flex-wrap gap-2">
          {REDOSLEDI.map((v) => (
            <button key={v} type="button" aria-pressed={redosled === v} onClick={() => postavi({ redosled: v })} className={stil.cip}>
              {T.redosledi[v]}
            </button>
          ))}
        </div>
      </div>

      <section className="mt-5" aria-label={T.naslov}>
        {ucitava && <Skeleton blokova={3} visina="h-36" razmak="" />}
        {!ucitava && lista.greska && (
          <p role="alert" className="text-base font-medium text-bordo">
            {T.greska}
          </p>
        )}
        {!ucitava && !lista.greska && lista.redovi.length === 0 && <p className={`${stil.karta} text-sm text-mastilo-2`}>{T.nema}</p>}
        {!ucitava && lista.redovi.length > 0 && (
          <>
            <p className="mb-3 text-sm text-mastilo-2" aria-live="polite">
              {popuni(T.prikazano, { n: lista.redovi.length, ukupno: lista.ukupno })}
            </p>
            <ul className="space-y-3">
              {lista.redovi.map((k) => (
                <RedKnjige key={k.id} k={k} />
              ))}
            </ul>
            {imaJos(lista.redovi.length, lista.ukupno) && (
              <button type="button" disabled={jos} onClick={ucitajJos} className={`${stil.okvirno} mt-4`}>
                {jos ? T.ucitavamJos : T.jos}
              </button>
            )}
          </>
        )}
      </section>
    </>
  );
}
