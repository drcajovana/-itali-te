import { useEffect, useState } from "react";
import PinPrikaz from "../components/PinPrikaz.jsx";
import { useAuth } from "../lib/auth-context.js";
import { ocistiIme, proveriBrojKarte } from "../lib/clan-unos.js";
import { NAJVISE_CLANOVA, napraviClana, porukaClanova, postaviAktivnost, resetujPin, ucitajClanove } from "../lib/clanovi.js";
import { mozeDaUpravlja } from "../lib/osoblje-logika.js";
import { stil } from "../lib/stil.js";
import { tekst } from "../lib/tekst.js";

const T = tekst.clanovi;

// Lista članova sa pretragom, upisom novog člana, novim PIN-om i aktivnošću. Samo za bibliotekare i
// administratore (RutaZaBibliotekare je udobnost; prava proveravaju RLS i api/ funkcije).
export default function BibliotekarClanovi() {
  const { clan: ja } = useAuth();
  const [upit, setUpit] = useState("");
  const [trazi, setTrazi] = useState("");
  const [stanje, setStanje] = useState({ ucitava: true, lista: [], imaJos: false, greska: false });
  const [osvezi, setOsvezi] = useState(0);
  const [formaOtvorena, setFormaOtvorena] = useState(false);
  const [karta, setKarta] = useState("");
  const [ime, setIme] = useState("");
  const [greskaForme, setGreskaForme] = useState(null);
  const [pin, setPin] = useState(null); // { nov, clan, pin } dok se prikazuje; nigde se ne čuva
  const [potvrda, setPotvrda] = useState(null); // { id, vrsta: "pin" | "deaktiviraj" }
  const [zauzet, setZauzet] = useState(false);
  const [poruka, setPoruka] = useState(null); // { tekst, greska }

  // Pretraga se šalje tek kad se kucanje zaustavi.
  useEffect(() => {
    const t = setTimeout(() => setTrazi(upit), 300);
    return () => clearTimeout(t);
  }, [upit]);

  useEffect(() => {
    let otkazano = false;
    ucitajClanove(trazi)
      .then(({ lista, imaJos }) => !otkazano && setStanje({ ucitava: false, lista, imaJos, greska: false }))
      .catch((e) => {
        console.error("učitavanje članova:", e);
        if (!otkazano) setStanje({ ucitava: false, lista: [], imaJos: false, greska: true });
      });
    return () => {
      otkazano = true;
    };
  }, [trazi, osvezi]);

  async function uradi(posao) {
    if (zauzet) return;
    setZauzet(true);
    setPoruka(null);
    try {
      await posao();
    } catch (e) {
      console.error("članovi:", e?.kod ?? e?.message);
      setPoruka({ tekst: porukaClanova(e), greska: true });
    }
    setZauzet(false);
  }

  async function sacuvajNovog(e) {
    e.preventDefault();
    if (zauzet) return;
    // ista pravila kao na serveru (src/lib/clan-unos.js), da se greška vidi pre slanja
    if (!proveriBrojKarte(karta)) return setGreskaForme(T.greske.neispravna_kartica);
    if (!ocistiIme(ime)) return setGreskaForme(T.greske.neispravno_ime);
    setGreskaForme(null);
    setZauzet(true);
    setPoruka(null);
    try {
      const r = await napraviClana(karta, ime);
      setPin({ nov: true, clan: r.clan, pin: r.pin });
      setFormaOtvorena(false);
      setKarta("");
      setIme("");
      setOsvezi((n) => n + 1);
    } catch (err) {
      console.error("novi član:", err?.kod ?? err?.message);
      setGreskaForme(porukaClanova(err));
    }
    setZauzet(false);
  }

  const noviPin = (c) =>
    uradi(async () => {
      setPotvrda(null);
      const r = await resetujPin(c.id);
      setPin({ nov: false, clan: r.clan, pin: r.pin });
    });

  const promeniAktivnost = (c) =>
    uradi(async () => {
      setPotvrda(null);
      const r = await postaviAktivnost(c.id, !c.aktivan);
      setStanje((s) => ({ ...s, lista: s.lista.map((x) => (x.id === c.id ? { ...x, aktivan: r.aktivan } : x)) }));
      setPoruka({ tekst: r.aktivan ? T.aktivirano : T.deaktivirano });
    });

  return (
    <>
      <h1 className={`${stil.naslov} pt-2`}>{T.naslov}</h1>
      <p className={stil.uvod}>{T.uvod}</p>

      {pin && <PinPrikaz nov={pin.nov} clan={pin.clan} pin={pin.pin} onZatvori={() => setPin(null)} />}

      {!formaOtvorena ? (
        <button type="button" onClick={() => setFormaOtvorena(true)} className={`${stil.veliko} mt-4`}>
          {T.novi}
        </button>
      ) : (
        <form onSubmit={sacuvajNovog} className={`${stil.karta} mt-4 space-y-4`} noValidate>
          <h2 className="font-naslov text-[17px] font-bold">{T.forma.naslov}</h2>
          <div>
            <label htmlFor="nova-karta" className="text-sm font-medium text-mastilo-2">
              {T.forma.karta}
            </label>
            {/* broj karte je tekst, ne broj: vodeća nula mora da ostane (type="number" bi je izgubio) */}
            <input
              id="nova-karta"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={7}
              autoComplete="off"
              value={karta}
              onChange={(e) => setKarta(e.target.value)}
              className={`${stil.polje} mt-1.5`}
            />
            <p className="mt-1 text-xs text-mastilo-2">{T.forma.kartaPomoc}</p>
          </div>
          <div>
            <label htmlFor="novo-ime" className="text-sm font-medium text-mastilo-2">
              {T.forma.ime}
            </label>
            <input id="novo-ime" type="text" autoComplete="off" maxLength={80} value={ime} onChange={(e) => setIme(e.target.value)} className={`${stil.polje} mt-1.5`} />
          </div>
          {greskaForme && (
            <p role="alert" className="text-sm font-medium text-bordo">
              {greskaForme}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={zauzet} className={stil.veliko}>
              {zauzet ? T.forma.pravim : T.forma.napravi}
            </button>
            <button
              type="button"
              disabled={zauzet}
              onClick={() => {
                setFormaOtvorena(false);
                setGreskaForme(null);
              }}
              className={stil.tiho}
            >
              {T.odustani}
            </button>
          </div>
        </form>
      )}

      <div className="mt-5">
        <label htmlFor="pretraga-clanova" className="text-sm font-medium text-mastilo-2">
          {T.pretraga}
        </label>
        <input
          id="pretraga-clanova"
          type="search"
          autoComplete="off"
          placeholder={T.pretragaPrazno}
          value={upit}
          onChange={(e) => setUpit(e.target.value)}
          className={`${stil.polje} mt-1.5`}
        />
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
        {!stanje.ucitava && !stanje.greska && stanje.lista.length === 0 && <p className={`${stil.karta} text-sm text-mastilo-2`}>{trazi ? T.nemaPoPretrazi : T.nema}</p>}

        <ul className="space-y-3">
          {stanje.lista.map((c) => {
            const upravlja = mozeDaUpravlja(ja.uloga, c.uloga);
            const mozeAktivnost = upravlja && c.id !== ja.id;
            const pita = potvrda?.id === c.id ? potvrda.vrsta : null;
            return (
              <li key={c.id} className={stil.karta}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-base font-semibold tracking-tight">{c.ime}</p>
                  {!c.aktivan && <span className={stil.izvor}>{T.neaktivan}</span>}
                </div>
                <p className="mt-0.5 text-sm text-mastilo-2">
                  {T.karta.replace("{karta}", c.broj_kartice)} · {T.uloge[c.uloga]}
                </p>

                {pita === "pin" && (
                  <div role="group" aria-label={T.pinPitanje.replace("{ime}", c.ime)} className="mt-3 space-y-2 rounded-srednji border border-bordo p-3">
                    <p className="text-sm font-semibold">{T.pinPitanje.replace("{ime}", c.ime)}</p>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" disabled={zauzet} onClick={() => noviPin(c)} className={stil.veliko}>
                        {T.pinDa}
                      </button>
                      <button type="button" disabled={zauzet} onClick={() => setPotvrda(null)} className={stil.tiho}>
                        {T.odustani}
                      </button>
                    </div>
                  </div>
                )}
                {pita === "deaktiviraj" && (
                  <div role="group" aria-label={T.deaktivirajPitanje.replace("{ime}", c.ime)} className="mt-3 space-y-2 rounded-srednji border border-bordo p-3">
                    <p className="text-sm font-semibold">{T.deaktivirajPitanje.replace("{ime}", c.ime)}</p>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" disabled={zauzet} onClick={() => promeniAktivnost(c)} className={stil.veliko}>
                        {T.deaktivirajDa}
                      </button>
                      <button type="button" disabled={zauzet} onClick={() => setPotvrda(null)} className={stil.tiho}>
                        {T.odustani}
                      </button>
                    </div>
                  </div>
                )}

                {!pita && (upravlja || mozeAktivnost) && (
                  <div className="mt-3 flex gap-2">
                    {upravlja && (
                      <button type="button" disabled={zauzet} onClick={() => setPotvrda({ id: c.id, vrsta: "pin" })} className={stil.pilula}>
                        {T.noviPin}
                      </button>
                    )}
                    {mozeAktivnost && (
                      <button
                        type="button"
                        disabled={zauzet}
                        onClick={() => (c.aktivan ? setPotvrda({ id: c.id, vrsta: "deaktiviraj" }) : promeniAktivnost(c))}
                        className={c.aktivan ? stil.pilula : stil.pilulaPuna}
                      >
                        {c.aktivan ? T.deaktiviraj : T.aktiviraj}
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        {stanje.imaJos && <p className="mt-3 text-sm text-mastilo-2">{T.viseRezultata.replace("{n}", String(NAJVISE_CLANOVA))}</p>}
      </section>
    </>
  );
}
