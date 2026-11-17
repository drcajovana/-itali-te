import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Avatar from "./Avatar.jsx";
import { useAuth } from "../lib/auth-context.js";
import { GreskaApija } from "../lib/api.js";
import { NAJDUZA_NAPOMENA, povezaniSamo, prikaznoIme, urediNapomenu } from "../lib/citaoci-logika.js";
import { posaljiPreporuku, ucitajVeze } from "../lib/citaoci.js";
import { stil } from "../lib/stil.js";
import { tekst } from "../lib/tekst.js";

const T = tekst.knjigaEkran.preporuci;
const P = tekst.preporuka;

// Odeljak „Preporuči čitaocu" na stranici knjige: povezani čitaoci (samo nadimci, iz pogleda moje_veze)
// sa dugmetom „Pošalji" i jedna zajednička kratka napomena (najviše 280 znakova). Upis štiti RLS:
// preporuka može da se upiše samo ako smo povezani.
export default function PreporuciCitaocu({ knjigaId }) {
  const { clan } = useAuth();
  const [stanje, setStanje] = useState({ ucitava: true, povezani: [] });
  const [napomena, setNapomena] = useState("");
  const [zauzet, setZauzet] = useState(null);
  const [poruke, setPoruke] = useState({}); // veza.id → { tekst, greska }

  useEffect(() => {
    let otkazano = false;
    ucitajVeze()
      .then((veze) => !otkazano && setStanje({ ucitava: false, povezani: povezaniSamo(veze) }))
      .catch((e) => {
        console.error("povezani za preporuku:", e);
        if (!otkazano) setStanje({ ucitava: false, povezani: [] });
      });
    return () => {
      otkazano = true;
    };
  }, []);

  async function posalji(v) {
    if (zauzet) return;
    const ime = prikaznoIme(v.nadimak, tekst.citaoci.anonimno);
    const n = urediNapomenu(napomena);
    if (!n.ok) return setPoruke((p) => ({ ...p, [v.id]: { tekst: P.napomenaPredugo, greska: true } }));
    setZauzet(v.id);
    setPoruke((p) => ({ ...p, [v.id]: null }));
    try {
      await posaljiPreporuku(clan.id, v.clan_id, knjigaId, n.vrednost);
      setPoruke((p) => ({ ...p, [v.id]: { tekst: T.poslato.replace("{nadimak}", ime) } }));
    } catch (e) {
      console.error("preporuka sa stranice knjige:", e?.kod ?? e?.code);
      const kod = e instanceof GreskaApija ? e.kod : null;
      setPoruke((p) => ({ ...p, [v.id]: { tekst: kod === "vec_poslato" ? P.vecPoslato : kod === "nije_povezan" ? P.nijePovezan : T.greska, greska: true } }));
    }
    setZauzet(null);
  }

  return (
    <section className="mt-7" aria-labelledby="preporuci">
      <h2 id="preporuci" className="mb-3 font-naslov text-[15px] font-bold tracking-tight">
        {T.naslov}
      </h2>
      <div className={stil.karta}>
        {stanje.ucitava && <p className="text-sm text-mastilo-2">{tekst.opste.ucitava}</p>}
        {!stanje.ucitava && stanje.povezani.length === 0 && (
          <>
            <p className="text-sm text-mastilo-2">{T.nema}</p>
            <Link to="/citaoci" className={`${stil.tiho} mt-3`}>
              {T.dugme}
            </Link>
          </>
        )}
        {stanje.povezani.length > 0 && (
          <>
            <label htmlFor="napomena-knjige" className="text-sm font-medium text-mastilo-2">
              {P.napomena}
            </label>
            <textarea id="napomena-knjige" rows={2} maxLength={NAJDUZA_NAPOMENA} value={napomena} onChange={(e) => setNapomena(e.target.value)} className={`${stil.polje} mt-1.5 min-h-16`} />
            <p className="mt-1 text-xs tabular-nums text-mastilo-2">{P.napomenaBroj.replace("{n}", String(napomena.length))}</p>
            <ul className="mt-3 space-y-3">
              {stanje.povezani.map((v) => {
                const ime = prikaznoIme(v.nadimak, tekst.citaoci.anonimno);
                const p = poruke[v.id];
                return (
                  <li key={v.id}>
                    <div className="flex items-center gap-3">
                      <Avatar id={v.clan_id} nadimak={v.nadimak} />
                      <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{ime}</span>
                      <button type="button" disabled={zauzet === v.id} onClick={() => posalji(v)} className={`${stil.pilulaPuna} flex-none`}>
                        {T.posalji}
                      </button>
                    </div>
                    {p && (
                      <p role={p.greska ? "alert" : "status"} className={`mt-1 pl-14 text-sm font-medium ${p.greska ? "text-bordo" : ""}`}>
                        {p.tekst}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}
