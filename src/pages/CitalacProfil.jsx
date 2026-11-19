import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import Avatar from "../components/Avatar.jsx";
import Korica from "../components/Korica.jsx";
import PreporuciKnjigu from "../components/PreporuciKnjigu.jsx";
import UtisakCitaoca from "../components/UtisakCitaoca.jsx";
import { GreskaApija } from "../lib/api.js";
import { useAuth } from "../lib/auth-context.js";
import { ocenePoKnjizi, prikaznoIme, urediRazlog, utisciSaKnjigama } from "../lib/citaoci-logika.js";
import { blokiraj, javiPromenu, prijavi, raskiniVezu, ucitajPolicuCitaoca, ucitajUtiskeCitaoca, ucitajVezuSaClanom } from "../lib/citaoci.js";
import { grupisiPolicu, prikazaniNapredak } from "../lib/polica-logika.js";
import { stil } from "../lib/stil.js";
import { tekst } from "../lib/tekst.js";

const T = tekst.citalac;
const LISTE = [
  ["citam", "cita", "nemaCita"],
  ["procitano", "procitano", "nemaProcitano"],
  ["zelim", "zeli", "nemaZeli"],
];

// Jedna knjiga sa police povezanog čitaoca: korica, naslov, autor, ocena (ako je ima) i napredak.
function RedKnjige({ red, ocena }) {
  const k = red.knjiga;
  return (
    <li>
      <Link to={`/knjiga/${k.id}`} aria-label={T.otvoriKnjigu.replace("{naslov}", k.naslov)} className={`${stil.karta} flex min-h-14 items-center gap-3 py-3`}>
        <div className="w-11 flex-none">
          <Korica knjiga={k} autor={k.autor} velicina="sitna" />
        </div>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold leading-tight">{k.naslov}</span>
          {k.autor && <span className="block text-xs text-mastilo-2">{k.autor}</span>}
          {red.status === "citam" && <span className="block text-xs tabular-nums text-mastilo-2">{T.napredak.replace("{n}", String(prikazaniNapredak(red)))}</span>}
        </span>
        {ocena != null && <span className="flex-none font-naslov text-[14px] font-bold tracking-[-0.03em] text-bordo">{T.ocena.replace("{ocena}", String(ocena))}</span>}
      </Link>
    </li>
  );
}

// Profil povezanog čitaoca (/citaoci/:id): nadimak, tri liste sa njegove police, njegovi utisci i radnje
// (preporuka, raskid, blokada, prijava). Sve što se vidi vraća baza (RLS); ako veza nije prihvaćena ili
// postoji blokada, upit ne vraća ništa i prikazuje se samo prazno stanje. Prava imena, brojevi karte i
// šifre poziva ovde nikad ne stižu.
export default function CitalacProfil() {
  const { id } = useParams();
  return <Profil key={id} id={id} />;
}

function Profil({ id }) {
  const { clan } = useAuth();
  const navigate = useNavigate();
  const [stanje, setStanje] = useState({ ucitava: true, veza: null, polica: [], utisci: [], knjige: new Map(), greska: false });
  const [radnja, setRadnja] = useState(null); // null | "raskini" | "blokiraj" | "prijavi" | "preporuka"
  const [razlog, setRazlog] = useState("");
  const [zauzet, setZauzet] = useState(false);
  const [poruka, setPoruka] = useState(null);

  useEffect(() => {
    let otkazano = false;
    (async () => {
      try {
        const veza = await ucitajVezuSaClanom(id);
        if (!veza) return !otkazano && setStanje({ ucitava: false, veza: null, polica: [], utisci: [], knjige: new Map(), greska: false });
        const [polica, u] = await Promise.all([ucitajPolicuCitaoca(id), ucitajUtiskeCitaoca(id)]);
        if (!otkazano) setStanje({ ucitava: false, veza, polica, utisci: u.utisci, knjige: u.knjige, greska: false });
      } catch (e) {
        console.error("profil čitaoca:", e);
        if (!otkazano) setStanje({ ucitava: false, veza: null, polica: [], utisci: [], knjige: new Map(), greska: true });
      }
    })();
    return () => {
      otkazano = true;
    };
  }, [id]);

  const { veza } = stanje;
  const nadimak = prikaznoIme(veza?.nadimak, tekst.citaoci.anonimno);

  async function uradi(posao) {
    if (zauzet) return;
    setZauzet(true);
    setPoruka(null);
    try {
      await posao();
    } catch (e) {
      console.error("radnja na profilu:", e?.kod ?? e?.code);
      setPoruka({ tekst: T.greskaRadnje, greska: true });
    }
    setZauzet(false);
  }

  const raskini = () =>
    uradi(async () => {
      await raskiniVezu(veza.id);
      javiPromenu();
      navigate("/citaoci", { replace: true });
    });

  const blokirajClana = () =>
    uradi(async () => {
      await blokiraj(clan.id, id, veza.id);
      javiPromenu();
      navigate("/citaoci", { replace: true });
    });

  async function posaljiPrijavu(e) {
    e.preventDefault();
    const r = urediRazlog(razlog);
    if (!r.ok) return setPoruka({ tekst: r.razlog === "prazno" ? T.razlogPrazno : T.razlogPredugo, greska: true });
    await uradi(async () => {
      try {
        await prijavi(clan.id, "clan", id, r.vrednost);
        setPoruka({ tekst: T.prijavljen });
        setRazlog("");
        setRadnja(null);
      } catch (err) {
        if (err instanceof GreskaApija && err.kod === "vec_prijavljeno") {
          setPoruka({ tekst: T.vecPrijavljen, greska: true });
          setRadnja(null);
        } else throw err;
      }
    });
  }

  if (stanje.ucitava) return <p className="pt-2 text-base text-mastilo-2">{T.ucitava}</p>;

  const nazad = (
    <Link to="/citaoci" className="inline-flex min-h-11 min-w-11 items-center text-sm font-semibold text-bordo underline">
      {T.nazad}
    </Link>
  );

  if (stanje.greska) {
    return (
      <>
        <p role="alert" className="pt-2 text-base font-medium text-bordo">
          {T.greska}
        </p>
        {nazad}
      </>
    );
  }
  // Nema veze (ili je blokada): isti prazan ekran, bez razlike.
  if (!veza) {
    return (
      <>
        {nazad}
        <p className={`${stil.karta} mt-3 text-sm text-mastilo-2`}>{T.nijePovezan}</p>
      </>
    );
  }

  const grupe = grupisiPolicu(stanje.polica);
  const ocene = ocenePoKnjizi(stanje.utisci);
  const utisci = utisciSaKnjigama(stanje.utisci, stanje.knjige);

  return (
    <>
      {nazad}
      <div className="mt-2 flex items-center gap-3">
        <Avatar id={id} nadimak={veza.nadimak} velika />
        <h1 className={`${stil.naslov} min-w-0 break-words`}>{nadimak}</h1>
      </div>

      <button type="button" onClick={() => setRadnja(radnja === "preporuka" ? null : "preporuka")} aria-expanded={radnja === "preporuka"} className={`${stil.veliko} mt-4`}>
        {tekst.preporuka.naslov}
      </button>
      {radnja === "preporuka" && <PreporuciKnjigu primalacId={id} nadimak={nadimak} onZatvori={() => setRadnja(null)} />}

      {LISTE.map(([stanjeKljuc, naslovKljuc, prazno]) => (
        <section key={stanjeKljuc} aria-label={T[naslovKljuc]}>
          <h2 className={stil.odeljak}>{T[naslovKljuc]}</h2>
          {grupe[stanjeKljuc].length === 0 ? (
            <p className={`${stil.karta} text-sm text-mastilo-2`}>{T[prazno]}</p>
          ) : (
            <ul className="space-y-2">
              {grupe[stanjeKljuc].map((r) => (
                <RedKnjige key={r.id} red={r} ocena={ocene.get(r.knjiga.id)} />
              ))}
            </ul>
          )}
        </section>
      ))}

      <section aria-label={T.utisci}>
        <h2 className={stil.odeljak}>{T.utisci}</h2>
        {utisci.length === 0 ? (
          <p className={`${stil.karta} text-sm text-mastilo-2`}>{T.nemaUtisaka}</p>
        ) : (
          <ul className="space-y-3">
            {utisci.map(({ utisak, knjiga }) => (
              <UtisakCitaoca key={utisak.id} utisak={utisak} knjiga={knjiga} />
            ))}
          </ul>
        )}
      </section>

      <section aria-label={T.radnje}>
        <h2 className={stil.odeljak}>{T.radnje}</h2>
        {poruka && (
          <p role={poruka.greska ? "alert" : "status"} className={`mb-3 text-sm font-medium ${poruka.greska ? "text-bordo" : ""}`}>
            {poruka.tekst}
          </p>
        )}

        {radnja === "raskini" && (
          <div role="group" aria-label={T.raskiniPitanje.replace("{nadimak}", nadimak)} className="space-y-2 rounded-srednji border border-bordo p-3">
            <p className="text-sm font-semibold">{T.raskiniPitanje.replace("{nadimak}", nadimak)}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={zauzet} onClick={raskini} className={stil.veliko}>
                {T.raskiniDa}
              </button>
              <button type="button" disabled={zauzet} onClick={() => setRadnja(null)} className={stil.tiho}>
                {T.odustani}
              </button>
            </div>
          </div>
        )}
        {radnja === "blokiraj" && (
          <div role="group" aria-label={T.blokirajPitanje.replace("{nadimak}", nadimak)} className="space-y-2 rounded-srednji border border-bordo p-3">
            <p className="text-sm font-semibold">{T.blokirajPitanje.replace("{nadimak}", nadimak)}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={zauzet} onClick={blokirajClana} className={stil.veliko}>
                {T.blokirajDa}
              </button>
              <button type="button" disabled={zauzet} onClick={() => setRadnja(null)} className={stil.tiho}>
                {T.odustani}
              </button>
            </div>
          </div>
        )}
        {radnja === "prijavi" && (
          <form onSubmit={posaljiPrijavu} className={`${stil.karta} space-y-3`} noValidate>
            <p className="text-sm text-mastilo-2">{T.prijavaOpis}</p>
            <label htmlFor="razlog-prijave" className="text-sm font-medium text-mastilo-2">
              {T.razlog}
            </label>
            <textarea id="razlog-prijave" rows={3} maxLength={300} value={razlog} onChange={(e) => setRazlog(e.target.value)} className={`${stil.polje} min-h-20`} />
            <div className="flex flex-wrap gap-2">
              <button type="submit" disabled={zauzet} className={stil.veliko}>
                {T.prijaviPosalji}
              </button>
              <button type="button" disabled={zauzet} onClick={() => setRadnja(null)} className={stil.tiho}>
                {T.odustani}
              </button>
            </div>
          </form>
        )}

        {!["raskini", "blokiraj", "prijavi"].includes(radnja) && (
          <div className="flex flex-col gap-2">
            <button type="button" onClick={() => setRadnja("raskini")} className={stil.okvirno}>
              {T.raskini}
            </button>
            <button type="button" onClick={() => setRadnja("blokiraj")} className={stil.okvirno}>
              {T.blokiraj}
            </button>
            <button type="button" onClick={() => setRadnja("prijavi")} className={stil.okvirno}>
              {T.prijavi}
            </button>
          </div>
        )}
      </section>
    </>
  );
}
