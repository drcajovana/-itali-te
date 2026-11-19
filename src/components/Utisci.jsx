import { useEffect, useState } from "react";
import PrijaviStavku from "./PrijaviStavku.jsx";
import { useAuth } from "../lib/auth-context.js";
import { formaUtiska, NAJDUZI_UTISAK, VIDLJIVOSTI } from "../lib/polica-logika.js";
import { obrisiUtisak, sacuvajUtisak, ucitajMojUtisak, ucitajTudjeUtiske } from "../lib/polica.js";
import { stil } from "../lib/stil.js";
import { tekst } from "../lib/tekst.js";

const T = tekst.utisak;
const OCENE = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const naslovOdeljka = "mb-3 font-naslov text-[15px] font-bold tracking-tight";

const opisOcene = (n) => T.ocenaOpis.replace("{ocena}", String(n)).replace("{opis}", T.ocene[n]);

// Tuđ utisak: tekst sa spojlerom je zamagljen dok se ne dodirne (i skriven od čitača ekrana dok je zamagljen).
function TudjiUtisak({ u }) {
  const [otkriven, setOtkriven] = useState(false);
  const zamagljen = u.spojler && Boolean(u.tekst) && !otkriven;
  return (
    <li className={stil.karta}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[14.5px] font-semibold tracking-tight">{u.autor || T.tudji.autorBezImena}</span>
        {u.ocena != null && (
          <span className="font-naslov text-[15px] font-bold tracking-[-0.03em] text-bordo" title={opisOcene(u.ocena)}>
            {opisOcene(u.ocena)}
          </span>
        )}
      </div>
      {(u.skriven || u.vidljivost !== "javno") && (
        <p className="mt-1 text-xs text-mastilo-2">
          {[u.skriven ? T.tudji.sakriven : null, u.vidljivost !== "javno" ? T.vidljivosti[u.vidljivost] : null].filter(Boolean).join(" · ")}
        </p>
      )}
      {u.tekst && (
        <div className="relative mt-3 border-l-2 border-bordo-svetla pl-3">
          <p aria-hidden={zamagljen} className={`whitespace-pre-line text-sm leading-[1.55] ${zamagljen ? "select-none blur-md" : ""}`}>
            {u.tekst}
          </p>
          {zamagljen && (
            <button type="button" onClick={() => setOtkriven(true)} className="absolute inset-0 flex min-h-11 items-center justify-center rounded-mali text-center text-sm font-semibold text-bordo">
              <span className="rounded-full bg-pozadina px-3 py-1.5">{T.tudji.spojler}</span>
            </button>
          )}
        </div>
      )}
      {u.spojler && u.tekst && otkriven && (
        <button type="button" onClick={() => setOtkriven(false)} className="mt-1 inline-flex min-h-11 items-center text-sm font-medium text-bordo underline">
          {T.tudji.sakrijSpojler}
        </button>
      )}
      <div className="mt-1">
        <PrijaviStavku tip="utisak" stavkaId={u.id} />
      </div>
    </li>
  );
}

// Moj utisak (ocena 1–10, tekst, vidljivost, spojler; izmena i brisanje) i utisci drugih čitalaca.
// Tuđe utiske pokazuje samo ono što RLS dozvoli; ovde se ne filtrira po vidljivosti.
// `naPromenjeno`: javlja stranici da osveži prosečnu ocenu.
export default function Utisci({ knjigaId, naPromenjeno }) {
  const { clan } = useAuth();
  const [moj, setMoj] = useState(undefined); // undefined: učitava se; null: nema
  const [tudji, setTudji] = useState({ ucitava: true, lista: [], greska: false });
  const [forma, setForma] = useState(formaUtiska(null));
  const [uredjuje, setUredjuje] = useState(false);
  const [potvrda, setPotvrda] = useState(false);
  const [zauzet, setZauzet] = useState(false);
  const [poruka, setPoruka] = useState(null);

  useEffect(() => {
    let otkazano = false;
    ucitajMojUtisak(clan.id, knjigaId)
      .then((u) => {
        if (otkazano) return;
        setMoj(u);
        setForma(formaUtiska(u));
      })
      .catch((e) => {
        console.error("moj utisak:", e);
        if (!otkazano) setMoj(null);
      });
    ucitajTudjeUtiske(clan.id, knjigaId)
      .then((lista) => !otkazano && setTudji({ ucitava: false, lista, greska: false }))
      .catch((e) => {
        console.error("tuđi utisci:", e);
        if (!otkazano) setTudji({ ucitava: false, lista: [], greska: true });
      });
    return () => {
      otkazano = true;
    };
  }, [clan.id, knjigaId]);

  async function sacuvaj(e) {
    e.preventDefault();
    if (zauzet) return;
    setZauzet(true);
    setPoruka(null);
    try {
      const u = await sacuvajUtisak(clan.id, knjigaId, forma, moj?.id ?? null);
      setMoj(u);
      setForma(formaUtiska(u));
      setUredjuje(false);
      setPoruka({ tekst: T.sacuvano });
      naPromenjeno?.();
    } catch (err) {
      console.error("čuvanje utiska:", err);
      setPoruka({ tekst: T.greske[err?.kod] ?? T.greske.opste, greska: true });
    }
    setZauzet(false);
  }

  async function obrisi() {
    if (zauzet) return;
    setZauzet(true);
    setPoruka(null);
    setPotvrda(false);
    try {
      await obrisiUtisak(moj.id);
      setMoj(null);
      setForma(formaUtiska(null));
      setUredjuje(false);
      setPoruka({ tekst: T.obrisano });
      naPromenjeno?.();
    } catch (err) {
      console.error("brisanje utiska:", err);
      setPoruka({ tekst: T.greske[err?.kod] ?? T.greske.utisak_nije_obrisan, greska: true });
    }
    setZauzet(false);
  }

  const pisanje = moj === null || uredjuje;
  const ocena = forma.ocena === "" ? null : Number(forma.ocena);

  return (
    <>
      <section className="mt-7" aria-labelledby="moj-utisak">
        <h2 id="moj-utisak" className={naslovOdeljka}>
          {T.naslov}
        </h2>

        {moj === undefined && <p className="text-base text-mastilo-2">{tekst.opste.ucitava}</p>}

        {moj && !uredjuje && (
          <div className={`${stil.karta} space-y-3`}>
            <p className="font-naslov text-[17px] font-bold tracking-[-0.03em] text-bordo">{moj.ocena != null ? opisOcene(moj.ocena) : T.bezOcene}</p>
            <p className="text-xs text-mastilo-2">
              {T.vidljivosti[moj.vidljivost]}
              {moj.spojler ? ` · ${T.spojler}` : ""}
            </p>
            {moj.skriven && <p className="text-sm font-medium text-bordo">{T.sakrivenMoj}</p>}
            {moj.uneo_bibliotekar_id && <p className="rounded-srednji bg-pozadina px-3 py-2 text-sm text-mastilo-2">{T.zapisanNaPultu}</p>}
            {moj.tekst && <p className="whitespace-pre-line border-l-2 border-bordo-svetla pl-3 text-sm leading-[1.55]">{moj.tekst}</p>}
            {!potvrda ? (
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={zauzet} onClick={() => setUredjuje(true)} className={stil.okvirno}>
                  {T.izmeni}
                </button>
                <button type="button" disabled={zauzet} onClick={() => setPotvrda(true)} className={stil.tiho}>
                  {T.obrisi}
                </button>
              </div>
            ) : (
              <div role="group" aria-label={T.obrisiPitanje} className="space-y-2 rounded-srednji border border-bordo p-3">
                <p className="text-base font-semibold">{T.obrisiPitanje}</p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" disabled={zauzet} onClick={obrisi} className={stil.veliko}>
                    {T.obrisiDa}
                  </button>
                  <button type="button" disabled={zauzet} onClick={() => setPotvrda(false)} className={stil.tiho}>
                    {T.obrisiNe}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {pisanje && moj !== undefined && (
          <form onSubmit={sacuvaj} className={`${stil.karta} space-y-5`} noValidate>
            {moj === null && <p className="text-sm text-mastilo-2">{T.nemaMog}</p>}

            {/* skala ocene 1–10 (prototip: .skala); u dva reda po pet da svako dugme bude najmanje 44 px */}
            <fieldset>
              <legend className="text-sm font-medium text-mastilo-2">{T.ocena}</legend>
              <div className="mt-2 grid grid-cols-5 gap-2">
                {OCENE.map((n) => (
                  <button
                    key={n}
                    type="button"
                    aria-pressed={ocena === n}
                    aria-label={opisOcene(n)}
                    onClick={() => setForma((f) => ({ ...f, ocena: f.ocena === n ? "" : n }))}
                    className="flex min-h-12 items-center justify-center rounded-mali bg-pozadina text-[15px] font-semibold text-mastilo-2 transition hover:bg-bordo-svetla hover:text-bordo aria-pressed:scale-[1.06] aria-pressed:bg-bordo aria-pressed:text-white"
                  >
                    {n}
                  </button>
                ))}
              </div>
              <p className="mt-3 min-h-5 text-[13px] text-mastilo-2" aria-live="polite">
                {ocena ? opisOcene(ocena) : T.bezOcene}
              </p>
            </fieldset>

            <div>
              <label htmlFor="utisak-tekst" className="text-sm font-medium text-mastilo-2">
                {T.tekst}
              </label>
              <textarea
                id="utisak-tekst"
                rows={5}
                maxLength={NAJDUZI_UTISAK}
                value={forma.tekst}
                onChange={(e) => setForma((f) => ({ ...f, tekst: e.target.value }))}
                className={`${stil.polje} mt-1.5 min-h-24`}
              />
            </div>

            <fieldset>
              <legend className="text-sm font-medium text-mastilo-2">{T.vidljivost}</legend>
              <div role="group" aria-label={T.vidljivost} className="mt-2 flex flex-wrap gap-2">
                {VIDLJIVOSTI.map((v) => (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={forma.vidljivost === v}
                    onClick={() => setForma((f) => ({ ...f, vidljivost: v }))}
                    className={stil.cip}
                  >
                    {T.vidljivosti[v]}
                  </button>
                ))}
              </div>
            </fieldset>

            <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-mastilo-2">
              <input type="checkbox" checked={forma.spojler} onChange={(e) => setForma((f) => ({ ...f, spojler: e.target.checked }))} className="size-[18px] accent-bordo" />
              {T.spojler}
            </label>

            <div className="flex flex-wrap gap-2">
              <button type="submit" disabled={zauzet} className={stil.veliko}>
                {zauzet ? T.cuvam : T.sacuvaj}
              </button>
              {uredjuje && (
                <button
                  type="button"
                  disabled={zauzet}
                  onClick={() => {
                    setUredjuje(false);
                    setForma(formaUtiska(moj));
                    setPoruka(null);
                  }}
                  className={stil.tiho}
                >
                  {T.odustani}
                </button>
              )}
            </div>
          </form>
        )}

        {poruka && (
          <p role={poruka.greska ? "alert" : "status"} className={`mt-3 text-sm font-medium ${poruka.greska ? "text-bordo" : ""}`}>
            {poruka.tekst}
          </p>
        )}
      </section>

      <section className="mt-7" aria-labelledby="tudji-utisci">
        <h2 id="tudji-utisci" className={naslovOdeljka}>
          {T.tudji.naslov}
        </h2>
        {tudji.ucitava && <p className="text-base text-mastilo-2">{T.tudji.ucitava}</p>}
        {tudji.greska && (
          <p role="alert" className="text-base font-medium text-bordo">
            {T.tudji.greska}
          </p>
        )}
        {!tudji.ucitava && !tudji.greska && tudji.lista.length === 0 && <p className={`${stil.karta} text-sm text-mastilo-2`}>{T.tudji.nema}</p>}
        {tudji.lista.length > 0 && (
          <ul className="space-y-3">
            {tudji.lista.map((u) => (
              <TudjiUtisak key={u.id} u={u} />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
