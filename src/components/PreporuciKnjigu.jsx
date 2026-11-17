import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth-context.js";
import { GreskaApija } from "../lib/api.js";
import { NAJDUZA_NAPOMENA, urediNapomenu } from "../lib/citaoci-logika.js";
import { posaljiPreporuku } from "../lib/citaoci.js";
import { pretraziNasuBazu } from "../lib/knjige.js";
import { ucitajPolicu } from "../lib/polica.js";
import { stil } from "../lib/stil.js";
import { tekst } from "../lib/tekst.js";

const T = tekst.preporuka;

// Preporuka knjige jednom povezanom čitaocu (profil čitaoca): knjiga sa MOJE police ili iz
// pretrage naše baze, uz kratku napomenu (najviše 280 znakova). Upis štiti RLS: preporuka se može
// upisati samo ako smo povezani; ovde se to ne proverava.
export default function PreporuciKnjigu({ primalacId, nadimak, onZatvori }) {
  const { clan } = useAuth();
  const [izvor, setIzvor] = useState("polica"); // "polica" | "pretraga"
  const [polica, setPolica] = useState({ ucitava: true, lista: [] });
  const [upit, setUpit] = useState("");
  const [rezultati, setRezultati] = useState(null); // null: još se nije tražilo
  const [trazi, setTrazi] = useState(false);
  const [knjiga, setKnjiga] = useState(null);
  const [napomena, setNapomena] = useState("");
  const [zauzet, setZauzet] = useState(false);
  const [poruka, setPoruka] = useState(null);

  useEffect(() => {
    let otkazano = false;
    ucitajPolicu(clan.id)
      .then((redovi) => !otkazano && setPolica({ ucitava: false, lista: redovi.map((r) => r.knjiga) }))
      .catch((e) => {
        console.error("polica za preporuku:", e);
        if (!otkazano) setPolica({ ucitava: false, lista: [] });
      });
    return () => {
      otkazano = true;
    };
  }, [clan.id]);

  async function trazi_(e) {
    e.preventDefault();
    if (trazi || upit.trim().length < 2) return;
    setTrazi(true);
    try {
      setRezultati(await pretraziNasuBazu(upit.trim()));
    } catch (err) {
      console.error("pretraga za preporuku:", err);
      setRezultati([]);
    }
    setTrazi(false);
  }

  async function posalji(e) {
    e.preventDefault();
    if (zauzet) return;
    if (!knjiga) return setPoruka({ tekst: T.nijeIzabrano, greska: true });
    const n = urediNapomenu(napomena);
    if (!n.ok) return setPoruka({ tekst: T.napomenaPredugo, greska: true });
    setZauzet(true);
    setPoruka(null);
    try {
      await posaljiPreporuku(clan.id, primalacId, knjiga.id, n.vrednost);
      setPoruka({ tekst: T.poslato.replace("{nadimak}", nadimak) });
      setKnjiga(null);
      setNapomena("");
    } catch (err) {
      console.error("preporuka:", err?.kod ?? err?.code);
      const kod = err instanceof GreskaApija ? err.kod : null;
      setPoruka({ tekst: kod === "vec_poslato" ? T.vecPoslato : kod === "nije_povezan" ? T.nijePovezan : T.greska, greska: true });
    }
    setZauzet(false);
  }

  const lista = izvor === "polica" ? polica.lista : (rezultati ?? []);

  return (
    <form onSubmit={posalji} className={`${stil.karta} mt-4 space-y-4`} noValidate>
      <h2 className="font-naslov text-[17px] font-bold">{T.naslov}</h2>

      <div role="group" aria-label={T.izaberi} className="flex flex-wrap gap-2">
        <button type="button" aria-pressed={izvor === "polica"} onClick={() => setIzvor("polica")} className={stil.cip}>
          {T.saPolice}
        </button>
        <button type="button" aria-pressed={izvor === "pretraga"} onClick={() => setIzvor("pretraga")} className={stil.cip}>
          {T.izPretrage}
        </button>
      </div>

      {izvor === "pretraga" && (
        <div className="flex gap-2">
          <input
            type="search"
            aria-label={T.pretragaPolje}
            placeholder={T.pretragaPolje}
            autoComplete="off"
            value={upit}
            onChange={(e) => setUpit(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && trazi_(e)}
            className={`${stil.polje} min-w-0 flex-1`}
          />
          <button type="button" onClick={trazi_} disabled={trazi} className={`${stil.okvirno} w-auto! shrink-0 px-4 text-sm`}>
            {trazi ? T.trazim : T.pretrazi}
          </button>
        </div>
      )}

      {izvor === "polica" && !polica.ucitava && polica.lista.length === 0 && <p className="text-sm text-mastilo-2">{T.nemaPolice}</p>}
      {izvor === "pretraga" && rezultati && rezultati.length === 0 && <p className="text-sm text-mastilo-2">{T.nemaRezultata}</p>}

      {lista.length > 0 && (
        <ul className="max-h-64 space-y-1 overflow-y-auto" aria-label={T.izaberi}>
          {lista.map((k) => (
            <li key={k.id}>
              <button
                type="button"
                aria-pressed={knjiga?.id === k.id}
                onClick={() => setKnjiga(k)}
                className="flex min-h-11 w-full flex-col items-start justify-center rounded-mali bg-pozadina px-3 py-2 text-left transition aria-pressed:bg-bordo aria-pressed:text-white"
              >
                <span className="text-sm font-semibold leading-tight">{k.naslov}</span>
                {k.autor && <span className="text-xs opacity-80">{k.autor}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}

      {knjiga && <p className="text-sm font-medium">{T.izabrano.replace("{naslov}", knjiga.naslov)}</p>}

      <div>
        <label htmlFor="napomena-preporuke" className="text-sm font-medium text-mastilo-2">
          {T.napomena}
        </label>
        <textarea id="napomena-preporuke" rows={3} maxLength={NAJDUZA_NAPOMENA} value={napomena} onChange={(e) => setNapomena(e.target.value)} className={`${stil.polje} mt-1.5 min-h-20`} />
        <p className="mt-1 text-xs tabular-nums text-mastilo-2">{T.napomenaBroj.replace("{n}", String(napomena.length))}</p>
      </div>

      {poruka && (
        <p role={poruka.greska ? "alert" : "status"} className={`text-sm font-medium ${poruka.greska ? "text-bordo" : ""}`}>
          {poruka.tekst}
        </p>
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        <button type="submit" disabled={zauzet} className={stil.veliko}>
          {zauzet ? T.saljem : T.posalji}
        </button>
        <button type="button" disabled={zauzet} onClick={onZatvori} className={stil.tiho}>
          {T.odustani}
        </button>
      </div>
    </form>
  );
}
