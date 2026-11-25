import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import Korica from "../components/Korica.jsx";
import Skeleton from "../components/Skeleton.jsx";
import { popuni } from "../lib/prijave-logika.js";
import { KLJUCEVI_OBLIKA, josIstogAutora, naziviOblika, oblikZaTaster, radnjaZaSlovo, saOblikom } from "../lib/razvrstavanje-logika.js";
import { postaviOblik, postaviOblikAutoru, ucitajBrojPreostalih, ucitajRed } from "../lib/razvrstavanje.js";
import { stil } from "../lib/stil.js";
import { tekst } from "../lib/tekst.js";

const T = tekst.razvrstavanje;
const NAZIVI = naziviOblika(T.oblici);
const GRUPE = T.knjizevneGrupe;
// Kad u redu ostane ovoliko knjiga ili manje (a ima ih još u bazi), red se dopunjuje iz baze.
const DOPUNI_ISPOD = 4;

// Ekran „Разврставање књига" (/bibliotekar/razvrstavanje): književne knjige bez oblika, jedna po jedna. Jedan klik (ili taster 1–6) upisuje oblik kao
// žanr knjige i pokazuje sledeću; „Прескочи" preskače u ovoj sesiji; „Поништи последње" vraća poslednji izbor. Opciono se isti oblik upisuje svim
// knjigama istog autora koje ga nemaju. Samo bibliotekar i administrator (RutaZaBibliotekare, a izmenu štiti RLS knjige_update_bibliotekar).
export default function BibliotekarRazvrstavanje() {
  const [red, setRed] = useState([]);
  const [broj, setBroj] = useState(0);
  const [stanje, setStanje] = useState("ucitava"); // "ucitava" | "spremno" | "greska"
  const [zauzet, setZauzet] = useState(false);
  const [zaAutora, setZaAutora] = useState(false);
  const [poruka, setPoruka] = useState(null); // { vrsta: "ok" | "greska", tekst }
  const [poslednje, setPoslednje] = useState(null); // [{ id, zanrovi, knjiga | null }] za poništavanje
  const preskoceno = useRef([]);

  const dopuni = useCallback(async () => {
    try {
      const novi = await ucitajRed({ knjizevneGrupe: GRUPE, nazivi: NAZIVI, preskoceno: preskoceno.current });
      setRed(novi);
    } catch (e) {
      console.error("red za razvrstavanje:", e?.code ?? e?.message);
      setPoruka({ vrsta: "greska", tekst: T.greska });
    }
  }, []);

  useEffect(() => {
    let otkazano = false;
    Promise.all([ucitajRed({ knjizevneGrupe: GRUPE, nazivi: NAZIVI }), ucitajBrojPreostalih({ knjizevneGrupe: GRUPE, nazivi: NAZIVI })])
      .then(([r, n]) => {
        if (otkazano) return;
        setRed(r);
        setBroj(n);
        setStanje("spremno");
      })
      .catch((e) => {
        console.error("razvrstavanje:", e?.code ?? e?.message);
        if (!otkazano) setStanje("greska");
      });
    return () => {
      otkazano = true;
    };
  }, []);

  const knjiga = red[0] ?? null;
  const istih = knjiga ? josIstogAutora(red, knjiga) : 0;

  const poruciGresku = (e) => setPoruka({ vrsta: "greska", tekst: e?.kod === "nema_dozvole" || e?.code === "42501" ? T.nemaDozvole : T.greskaCuvanja });

  async function izaberi(oblik) {
    if (!knjiga || zauzet) return;
    setZauzet(true);
    setPoruka(null);
    try {
      let stare;
      if (zaAutora && String(knjiga.autor ?? "").trim()) {
        stare = await postaviOblikAutoru({ autor: knjiga.autor, oblik, knjizevneGrupe: GRUPE, nazivi: NAZIVI });
      } else {
        await postaviOblik(knjiga.id, saOblikom(knjiga.zanrovi, oblik, NAZIVI));
        stare = [{ id: knjiga.id, zanrovi: knjiga.zanrovi }];
      }
      const ids = new Set(stare.map((s) => s.id));
      const zapamti = stare.map((s) => ({ ...s, knjiga: red.find((k) => k.id === s.id) ?? null }));
      const ostalo = red.filter((k) => !ids.has(k.id));
      setPoslednje(zapamti);
      setRed(ostalo);
      setBroj((b) => Math.max(0, b - stare.length));
      setPoruka({ vrsta: "ok", tekst: stare.length > 1 ? popuni(T.sacuvanoViseKnjiga, { n: stare.length, oblik }) : popuni(T.sacuvano, { naslov: knjiga.naslov, oblik }) });
      setZaAutora(false);
      if (ostalo.length <= DOPUNI_ISPOD) await dopuni();
    } catch (e) {
      console.error("upis oblika:", e?.code ?? e?.kod ?? e?.message);
      // deo knjiga je možda već upisan: red i broj se učitavaju iznova, da ekran pokazuje stvarno stanje
      if (e?.stare?.length) {
        try {
          setRed(await ucitajRed({ knjizevneGrupe: GRUPE, nazivi: NAZIVI, preskoceno: preskoceno.current }));
          setBroj(await ucitajBrojPreostalih({ knjizevneGrupe: GRUPE, nazivi: NAZIVI }));
        } catch {
          /* ostaje poruka o grešci */
        }
      }
      poruciGresku(e);
    }
    setZauzet(false);
  }

  function preskoci() {
    if (!knjiga || zauzet) return;
    preskoceno.current = [...preskoceno.current, knjiga.id];
    const ostalo = red.slice(1);
    setRed(ostalo);
    setPoruka(null);
    setZaAutora(false);
    if (ostalo.length <= DOPUNI_ISPOD) dopuni();
  }

  async function ponisti() {
    if (!poslednje?.length || zauzet) return;
    setZauzet(true);
    setPoruka(null);
    try {
      for (const s of poslednje) await postaviOblik(s.id, s.zanrovi);
      const vracene = poslednje.map((s) => s.knjiga).filter(Boolean);
      const ids = new Set(vracene.map((k) => k.id));
      setRed((r) => [...vracene, ...r.filter((k) => !ids.has(k.id))]);
      setBroj((b) => b + poslednje.length);
      setPoslednje(null);
      setPoruka({ vrsta: "ok", tekst: T.ponisteno });
      // knjige koje nisu bile u redu (isti autor) vraćaju se iz baze
      if (vracene.length < poslednje.length) await dopuni();
    } catch (e) {
      console.error("poništavanje:", e?.code ?? e?.kod ?? e?.message);
      poruciGresku(e);
    }
    setZauzet(false);
  }

  // Tasteri: 1–6 oblik (cifre su na istom mestu na svakoj tastaturi), S/С preskoči, Z/З poništi (po slovu koje taster ispisuje). Ne smeta kucanju u poljima.
  const izaberiRef = useRef(izaberi);
  const preskociRef = useRef(preskoci);
  const ponistiRef = useRef(ponisti);
  useEffect(() => {
    izaberiRef.current = izaberi;
    preskociRef.current = preskoci;
    ponistiRef.current = ponisti;
  });
  useEffect(() => {
    function naTaster(e) {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const meta = e.target;
      if (meta instanceof HTMLElement && (meta.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(meta.tagName))) return;
      const oblik = oblikZaTaster(e.code, NAZIVI);
      const radnja = radnjaZaSlovo(e.key);
      if (oblik) {
        e.preventDefault();
        izaberiRef.current(oblik);
      } else if (radnja === "preskoci") {
        e.preventDefault();
        preskociRef.current();
      } else if (radnja === "ponisti") {
        e.preventDefault();
        ponistiRef.current();
      }
    }
    window.addEventListener("keydown", naTaster);
    return () => window.removeEventListener("keydown", naTaster);
  }, []);

  return (
    <>
      <h1 className={`${stil.naslov} pt-2`}>{T.naslov}</h1>
      <p className={stil.uvod}>{T.uvod}</p>

      {stanje === "ucitava" && <Skeleton blokova={2} visina="h-40" razmak="" />}
      {stanje === "greska" && (
        <p role="alert" className="mt-4 text-base font-medium text-bordo">
          {T.greska}
        </p>
      )}

      {stanje === "spremno" && (
        <>
          <p className="mt-3 text-sm font-medium text-bordo" aria-live="polite">
            {popuni(T.preostalo, { n: broj })}
          </p>

          {poruka && (
            <p role={poruka.vrsta === "greska" ? "alert" : "status"} className={`mt-3 text-sm font-medium ${poruka.vrsta === "greska" ? "text-bordo" : "text-mastilo-2"}`}>
              {poruka.tekst}
            </p>
          )}

          {!knjiga && (
            <section className={`${stil.karta} mt-4`}>
              <p className="font-naslov text-[17px] font-bold tracking-tight">{T.prazno}</p>
              <p className="mt-1 text-sm text-mastilo-2">{T.praznoPomoc}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link to="/bibliotekar" className={stil.okvirno}>
                  {T.povratak}
                </Link>
                <Link to="/bibliotekar/knjige" className={stil.okvirno}>
                  {T.pregled}
                </Link>
              </div>
            </section>
          )}

          {knjiga && (
            <section className={`${stil.karta} mt-4`} aria-label={T.trenutna}>
              <div className="flex gap-4">
                <div className="w-24 flex-none">
                  <Korica knjiga={knjiga} autor={knjiga.autor} velicina="puna" />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="break-words font-naslov text-[19px] font-bold leading-tight tracking-[-0.02em]">{knjiga.naslov}</h2>
                  <p className="mt-1 text-sm text-mastilo-2">{knjiga.autor || T.bezAutora}</p>
                  <p className="text-xs text-mastilo-2">{[knjiga.izdavac, knjiga.godina].filter(Boolean).join(", ")}</p>
                  {knjiga.zanrovi?.length > 0 && (
                    <p className="mt-2 flex flex-wrap items-center gap-1.5">
                      <span className="text-xs text-mastilo-2">{T.zanrovi}:</span>
                      {knjiga.zanrovi.map((z) => (
                        <span key={z} className={stil.izvor}>
                          {z}
                        </span>
                      ))}
                    </p>
                  )}
                </div>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {KLJUCEVI_OBLIKA.map((k, i) => (
                  <button key={k} type="button" disabled={zauzet} onClick={() => izaberi(T.oblici[k])} className={stil.veliko}>
                    <span className="mr-2 text-sm font-normal opacity-70">{i + 1}</span>
                    {T.oblici[k]}
                  </button>
                ))}
              </div>

              {String(knjiga.autor ?? "").trim() && (
                <label className="mt-4 flex min-h-11 items-start gap-3 text-sm">
                  <input type="checkbox" checked={zaAutora} disabled={zauzet} onChange={(e) => setZaAutora(e.target.checked)} className="mt-0.5 size-5 flex-none accent-bordo" />
                  <span>
                    <span className="font-medium">{T.zaAutora}</span>
                    {istih > 0 && <span className="text-mastilo-2"> ({istih})</span>}
                    <span className="block text-xs text-mastilo-2">{T.zaAutoraPomoc}</span>
                  </span>
                </label>
              )}

              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" disabled={zauzet} onClick={preskoci} className={stil.tiho}>
                  {T.preskoci}
                </button>
                <button type="button" disabled={zauzet || !poslednje?.length} onClick={ponisti} className={stil.okvirno}>
                  {T.ponisti}
                </button>
              </div>
              <p className="mt-3 hidden text-xs text-mastilo-2 md:block">{T.precice}</p>
            </section>
          )}
        </>
      )}
    </>
  );
}
