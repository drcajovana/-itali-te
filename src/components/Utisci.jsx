import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth-context.js";
import { formaUtiska, NAJDUZI_UTISAK, VIDLJIVOSTI } from "../lib/polica-logika.js";
import { obrisiUtisak, sacuvajUtisak, ucitajMojUtisak, ucitajTudjeUtiske } from "../lib/polica.js";
import { tekst } from "../lib/tekst.js";

const T = tekst.utisak;
const dugme = "flex min-h-12 w-full items-center justify-center rounded-lg px-5 py-3 text-xl font-semibold disabled:opacity-60 sm:w-auto";
const OCENE = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

const opisOcene = (n) => T.ocenaOpis.replace("{ocena}", String(n)).replace("{opis}", T.ocene[n]);

// Tuđ utisak: tekst sa spojlerom je zamagljen dok se ne dodirne (i skriven od čitača ekrana dok je zamagljen).
function TudjiUtisak({ u }) {
  const [otkriven, setOtkriven] = useState(false);
  const zamagljen = u.spojler && Boolean(u.tekst) && !otkriven;
  return (
    <li className="rounded-lg border-2 border-ivica bg-white p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-lg font-semibold">{u.autor || T.tudji.autorBezImena}</span>
        {u.ocena != null && (
          <span className="text-base font-medium" title={opisOcene(u.ocena)}>
            {opisOcene(u.ocena)}
          </span>
        )}
      </div>
      {(u.skriven || u.vidljivost !== "javno") && (
        <p className="mt-1 text-sm text-mastilo/70">
          {[u.skriven ? T.tudji.sakriven : null, u.vidljivost !== "javno" ? T.vidljivosti[u.vidljivost] : null].filter(Boolean).join(" · ")}
        </p>
      )}
      {u.tekst && (
        <div className="relative mt-2">
          <p aria-hidden={zamagljen} className={`whitespace-pre-line text-lg ${zamagljen ? "select-none blur-md" : ""}`}>
            {u.tekst}
          </p>
          {zamagljen && (
            <button type="button" onClick={() => setOtkriven(true)} className="absolute inset-0 flex min-h-11 items-center justify-center rounded-lg text-center text-base font-semibold text-pecat">
              <span className="rounded bg-papir px-2 py-1">{T.tudji.spojler}</span>
            </button>
          )}
        </div>
      )}
      {u.spojler && u.tekst && otkriven && (
        <button type="button" onClick={() => setOtkriven(false)} className="mt-1 inline-flex min-h-11 items-center text-base text-pecat underline">
          {T.tudji.sakrijSpojler}
        </button>
      )}
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

  const postavi = (ime) => (e) => setForma((f) => ({ ...f, [ime]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

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
      <section className="mt-8" aria-labelledby="moj-utisak">
        <h2 id="moj-utisak" className="text-2xl font-semibold">
          {T.naslov}
        </h2>

        {moj === undefined && <p className="mt-2 text-lg text-mastilo/70">{tekst.opste.ucitava}</p>}

        {moj && !uredjuje && (
          <div className="mt-3 space-y-3 rounded-lg border-2 border-ivica bg-white p-3">
            <p className="text-lg font-semibold">{moj.ocena != null ? opisOcene(moj.ocena) : T.bezOcene}</p>
            <p className="text-base text-mastilo/70">
              {T.vidljivosti[moj.vidljivost]}
              {moj.spojler ? ` · ${T.spojler}` : ""}
            </p>
            {moj.skriven && <p className="text-base font-medium text-pecat">{T.sakrivenMoj}</p>}
            {moj.tekst && <p className="whitespace-pre-line text-lg">{moj.tekst}</p>}
            {!potvrda ? (
              <div className="flex flex-col gap-2 sm:flex-row">
                <button type="button" disabled={zauzet} onClick={() => setUredjuje(true)} className={`${dugme} border-2 border-pecat text-pecat`}>
                  {T.izmeni}
                </button>
                <button type="button" disabled={zauzet} onClick={() => setPotvrda(true)} className={`${dugme} border-2 border-ivica`}>
                  {T.obrisi}
                </button>
              </div>
            ) : (
              <div role="group" aria-label={T.obrisiPitanje} className="space-y-2 rounded-lg border-2 border-pecat p-3">
                <p className="text-lg font-semibold">{T.obrisiPitanje}</p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <button type="button" disabled={zauzet} onClick={obrisi} className={`${dugme} bg-pecat text-white`}>
                    {T.obrisiDa}
                  </button>
                  <button type="button" disabled={zauzet} onClick={() => setPotvrda(false)} className={`${dugme} border-2 border-ivica`}>
                    {T.obrisiNe}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {pisanje && moj !== undefined && (
          <form onSubmit={sacuvaj} className="mt-3 space-y-4" noValidate>
            {moj === null && <p className="text-base text-mastilo/70">{T.nemaMog}</p>}

            <fieldset>
              <legend className="text-base font-medium">{T.ocena}</legend>
              <div className="mt-2 grid grid-cols-5 gap-2">
                {OCENE.map((n) => (
                  <button
                    key={n}
                    type="button"
                    aria-pressed={ocena === n}
                    aria-label={opisOcene(n)}
                    onClick={() => setForma((f) => ({ ...f, ocena: f.ocena === n ? "" : n }))}
                    className={`flex min-h-12 items-center justify-center rounded-lg border-2 border-pecat text-xl font-semibold ${ocena === n ? "bg-pecat text-white" : "bg-white text-pecat"}`}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <p className="mt-2 min-h-6 text-base font-medium" aria-live="polite">
                {ocena ? opisOcene(ocena) : T.bezOcene}
              </p>
            </fieldset>

            <div>
              <label htmlFor="utisak-tekst" className="text-base font-medium">
                {T.tekst}
              </label>
              <textarea
                id="utisak-tekst"
                rows={5}
                maxLength={NAJDUZI_UTISAK}
                value={forma.tekst}
                onChange={postavi("tekst")}
                className="mt-1 block w-full rounded-lg border-2 border-ivica bg-white px-3 py-2 text-lg focus:border-pecat focus:outline-none"
              />
            </div>

            <fieldset>
              <legend className="text-base font-medium">{T.vidljivost}</legend>
              <div className="mt-1 flex flex-col">
                {VIDLJIVOSTI.map((v) => (
                  <label key={v} className="flex min-h-11 items-center gap-3 text-lg">
                    <input type="radio" name="utisak-vidljivost" value={v} checked={forma.vidljivost === v} onChange={postavi("vidljivost")} className="h-6 w-6 accent-pecat" />
                    {T.vidljivosti[v]}
                  </label>
                ))}
              </div>
            </fieldset>

            <label className="flex min-h-11 items-center gap-3 text-lg">
              <input type="checkbox" checked={forma.spojler} onChange={postavi("spojler")} className="h-6 w-6 accent-pecat" />
              {T.spojler}
            </label>

            <div className="flex flex-col gap-2 sm:flex-row">
              <button type="submit" disabled={zauzet} className={`${dugme} bg-pecat text-white`}>
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
                  className={`${dugme} border-2 border-ivica`}
                >
                  {T.odustani}
                </button>
              )}
            </div>
          </form>
        )}

        {poruka && (
          <p role={poruka.greska ? "alert" : "status"} className={`mt-3 text-base font-medium ${poruka.greska ? "text-pecat" : ""}`}>
            {poruka.tekst}
          </p>
        )}
      </section>

      <section className="mt-8" aria-labelledby="tudji-utisci">
        <h2 id="tudji-utisci" className="text-2xl font-semibold">
          {T.tudji.naslov}
        </h2>
        {tudji.ucitava && <p className="mt-2 text-lg text-mastilo/70">{T.tudji.ucitava}</p>}
        {tudji.greska && (
          <p role="alert" className="mt-2 text-lg font-medium text-pecat">
            {T.tudji.greska}
          </p>
        )}
        {!tudji.ucitava && !tudji.greska && tudji.lista.length === 0 && <p className="mt-2 rounded-lg border-2 border-ivica bg-white p-4 text-lg">{T.tudji.nema}</p>}
        {tudji.lista.length > 0 && (
          <ul className="mt-3 space-y-3">
            {tudji.lista.map((u) => (
              <TudjiUtisak key={u.id} u={u} />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
