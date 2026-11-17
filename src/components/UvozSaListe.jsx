import { useState } from "react";
import { porukaGreske } from "../lib/api.js";
import { izListe } from "../lib/knjige.js";
import { NAJVISE_LINKOVA } from "../lib/unos-knjiga.js";
import { stil } from "../lib/stil.js";
import { tekst } from "../lib/tekst.js";

const T = tekst.unos.lista;

// Uvoz sa stranice izdavača (samo za bibliotekare i administratore): nalepi se adresa stranice SA SPISKOM
// knjiga, na dugme se čita ta jedna stranica (api/iz-liste.js) i izvlači najviše 50 linkova. Bibliotekar
// štiklira koje želi (najviše NAJVISE_LINKOVA, koliko i postojeća obrada), a izabrane adrese predaje
// roditelju, koji ih šalje kroz POSTOJEĆU obradu (jedna po jedna, sa pauzom). Ovde se ništa ne upisuje u
// bazu i ne čita se nijedna stranica knjige. Nema automatskog čitanja: sve ide na klik; i „sledeća
// stranica” je novi klik.
export default function UvozSaListe({ zauzet, onIzabrano }) {
  const [adresa, setAdresa] = useState("");
  const [citam, setCitam] = useState(false);
  const [rezultat, setRezultat] = useState(null); // odgovor api/iz-liste
  const [izabrani, setIzabrani] = useState([]); // adrese, redom izbora
  const [poruka, setPoruka] = useState(null);

  async function procitaj(url) {
    if (citam || !url.trim()) return;
    setCitam(true);
    setPoruka(null);
    try {
      const r = await izListe(url.trim());
      setRezultat(r);
      setIzabrani([]);
      if (!r.linkovi.length) setPoruka({ tekst: T.nema, greska: true });
    } catch (e) {
      console.error("uvoz sa stranice izdavača:", e?.kod ?? e?.message);
      setRezultat(null);
      setPoruka({ tekst: porukaGreske(e), greska: true });
    }
    setCitam(false);
  }

  const prebaci = (url) => setIzabrani((s) => (s.includes(url) ? s.filter((x) => x !== url) : s.length < NAJVISE_LINKOVA ? [...s, url] : s));

  const linkovi = rezultat?.linkovi ?? [];
  const pun = izabrani.length >= NAJVISE_LINKOVA;

  return (
    <section className={`${stil.karta} mt-4 space-y-3`} aria-labelledby="uvoz-naslov">
      <h2 id="uvoz-naslov" className="font-naslov text-[17px] font-bold">
        {T.naslov}
      </h2>
      <p className="text-sm text-mastilo-2">{T.uvod}</p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          procitaj(adresa);
        }}
        className="space-y-3"
        noValidate
      >
        <label htmlFor="adresa-spiska" className="text-sm font-medium text-mastilo-2">
          {T.polje}
        </label>
        <input
          id="adresa-spiska"
          type="url"
          inputMode="url"
          autoCapitalize="off"
          autoComplete="off"
          spellCheck={false}
          value={adresa}
          onChange={(e) => setAdresa(e.target.value)}
          disabled={zauzet}
          className={`${stil.polje} font-mono`}
        />
        <button type="submit" disabled={citam || zauzet} className={stil.veliko}>
          {citam ? T.citam : T.dugme}
        </button>
      </form>

      {poruka && (
        <p role={poruka.greska ? "alert" : "status"} className={`text-sm font-medium ${poruka.greska ? "text-bordo" : ""}`}>
          {poruka.tekst}
        </p>
      )}

      {rezultat && linkovi.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm text-mastilo-2">
            {T.nadjeno.replace("{n}", String(rezultat.ukupno))}
            {rezultat.skraceno && ` ${T.skraceno.replace("{n}", String(linkovi.length))}`}
            {rezultat.izbacenoRobots > 0 && ` ${T.izbaceno.replace("{n}", String(rezultat.izbacenoRobots))}`}
            {rezultat.pauzaSekundi > 0 && ` ${T.pauza.replace("{n}", String(rezultat.pauzaSekundi))}`}
          </p>

          <div className="flex flex-col gap-2 sm:flex-row">
            <button type="button" disabled={zauzet} onClick={() => setIzabrani(linkovi.slice(0, NAJVISE_LINKOVA).map((l) => l.url))} className={stil.pilula}>
              {T.izaberiSve.replace("{n}", String(Math.min(NAJVISE_LINKOVA, linkovi.length)))}
            </button>
            <button type="button" disabled={zauzet || izabrani.length === 0} onClick={() => setIzabrani([])} className={stil.pilula}>
              {T.ponisti}
            </button>
          </div>

          <ul className="max-h-96 space-y-1 overflow-y-auto" aria-label={T.spisak}>
            {linkovi.map((l) => {
              const oznacen = izabrani.includes(l.url);
              return (
                <li key={l.url}>
                  <label className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-mali px-2 py-2 ${oznacen ? "bg-bordo-svetla" : "bg-pozadina"}`}>
                    <input type="checkbox" checked={oznacen} disabled={zauzet || (pun && !oznacen)} onChange={() => prebaci(l.url)} className="mt-0.5 size-[18px] flex-none accent-bordo" />
                    <span className="min-w-0 text-sm leading-tight">
                      <span className="block font-semibold">{l.naslov}</span>
                      <span className="block break-all text-xs text-mastilo-2">{l.url}</span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>

          <p className="text-sm font-medium tabular-nums">
            {T.izabrano.replace("{n}", String(izabrani.length)).replace("{max}", String(NAJVISE_LINKOVA))}
            {pun && ` ${T.najvise.replace("{max}", String(NAJVISE_LINKOVA))}`}
          </p>

          <button type="button" disabled={zauzet || izabrani.length === 0} onClick={() => onIzabrano(izabrani, rezultat.pauzaSekundi)} className={stil.veliko}>
            {T.obradi}
          </button>

          {rezultat.sledeca && (
            <button
              type="button"
              disabled={citam || zauzet}
              onClick={() => {
                setAdresa(rezultat.sledeca);
                procitaj(rezultat.sledeca);
              }}
              className={stil.okvirno}
            >
              {T.sledeca}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
