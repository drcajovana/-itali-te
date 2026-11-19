import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Avatar from "../components/Avatar.jsx";
import Korica from "../components/Korica.jsx";
import PrijaviStavku from "../components/PrijaviStavku.jsx";
import { GreskaApija } from "../lib/api.js";
import { useAuth } from "../lib/auth-context.js";
import { grupisiVeze, prikaznoIme, urediSifru } from "../lib/citaoci-logika.js";
import { javiPromenu, oznaciObradjenom, posaljiPoziv, preporukaNaPolicu, prihvatiPoziv, ucitajPreporuke, ucitajVeze, ucitajVezu, ukloniPoziv } from "../lib/citaoci.js";
import { datumIzVremena } from "../lib/osoblje-logika.js";
import { formatDatum } from "../lib/polica-logika.js";
import { stil } from "../lib/stil.js";
import { tekst } from "../lib/tekst.js";

const T = tekst.citaoci;

// Čitaoci (prototip, ekran Čitaoci): moja šifra poziva, poziv drugom čitaocu, pozivi na čekanju,
// preporuke za mene i povezani čitaoci. Pravila: veza je samo pozivom (nema spiska članova ni pretrage),
// nepostojeća šifra i šifra blokiranog člana daju istu poruku, a o drugom članu se vidi samo nadimak
// (iz pogleda moje_veze i moje_preporuke, migracija 0019).
export default function Citaoci() {
  const { clan } = useAuth();
  const [kopirano, setKopirano] = useState(null);
  const [sifra, setSifra] = useState("");
  const [saljem, setSaljem] = useState(false);
  const [pozivPoruka, setPozivPoruka] = useState(null);
  const [stanje, setStanje] = useState({ ucitava: true, veze: [], preporuke: [], greska: false });
  const [zauzet, setZauzet] = useState(null); // id veze ili preporuke koja se menja
  const [poruka, setPoruka] = useState(null);

  const [osvezi, setOsvezi] = useState(0);
  const ucitaj = () => setOsvezi((n) => n + 1); // ponovo učitava veze i preporuke

  useEffect(() => {
    let otkazano = false;
    Promise.all([ucitajVeze(), ucitajPreporuke()])
      .then(([veze, preporuke]) => !otkazano && setStanje({ ucitava: false, veze, preporuke, greska: false }))
      .catch((e) => {
        console.error("čitaoci:", e);
        if (!otkazano) setStanje({ ucitava: false, veze: [], preporuke: [], greska: true });
      });
    return () => {
      otkazano = true;
    };
  }, [osvezi]);

  async function kopiraj() {
    try {
      await navigator.clipboard.writeText(clan.sifra_poziva);
      setKopirano({ tekst: T.kopirano });
    } catch {
      setKopirano({ tekst: T.nijeKopirano, greska: true });
    }
  }

  async function pozovi(e) {
    e.preventDefault();
    if (saljem) return;
    const s = urediSifru(sifra);
    if (!s) return setPozivPoruka({ tekst: T.poziv.prazno, greska: true });
    setSaljem(true);
    setPozivPoruka(null);
    try {
      const vezaId = await posaljiPoziv(s);
      const veza = await ucitajVezu(vezaId).catch(() => null);
      const odgovor = veza?.status === "prihvacena" ? T.poziv.vecPovezani : veza?.smer === "primljen" ? T.poziv.vecPozvao : T.poziv.poslat;
      setPozivPoruka({ tekst: odgovor });
      setSifra("");
      ucitaj();
      javiPromenu();
    } catch (err) {
      console.error("poziv:", err?.kod ?? err?.code);
      // nepostojeća šifra i blokada daju istu poruku (baza vraća istu grešku)
      setPozivPoruka({ tekst: err instanceof GreskaApija && err.kod === "sifra_nije_nadjena" ? T.poziv.nijeNadjena : T.poziv.greska, greska: true });
    }
    setSaljem(false);
  }

  async function uradi(id, posao, uspeh) {
    if (zauzet) return;
    setZauzet(id);
    setPoruka(null);
    try {
      await posao();
      setPoruka({ tekst: uspeh });
      ucitaj();
      javiPromenu();
    } catch (err) {
      console.error("čitaoci, radnja:", err?.kod ?? err?.code);
      setPoruka({ tekst: T.pozivi.greska, greska: true });
    }
    setZauzet(null);
  }

  const prihvati = (v) => uradi(v.id, () => prihvatiPoziv(v.id), T.pozivi.prihvaceno);
  const odbij = (v) => uradi(v.id, () => ukloniPoziv(v.id), T.pozivi.odbijeno);
  const povuci = (v) => uradi(v.id, () => ukloniPoziv(v.id), T.pozivi.povucen);

  const zelim = (p) =>
    uradi(p.id, async () => {
      await preporukaNaPolicu(clan.id, p.knjiga_id, "zelim");
      await oznaciObradjenom(p.id);
    }, T.preporuke.dodatoZelim);
  const procitanoVec = (p) =>
    uradi(p.id, async () => {
      await preporukaNaPolicu(clan.id, p.knjiga_id, "procitano");
      await oznaciObradjenom(p.id);
    }, T.preporuke.dodatoProcitano);
  const nijeZaMene = (p) => uradi(p.id, () => oznaciObradjenom(p.id), T.preporuke.sklonjena);

  const { primljeni, poslati, povezani } = grupisiVeze(stanje.veze);
  const kada = (iso) => formatDatum(datumIzVremena(iso));

  return (
    <>
      <h1 className={`${stil.naslov} pt-2`}>{T.naslov}</h1>
      <p className={stil.uvod}>{T.uvod}</p>

      <div className="relative mt-4 overflow-hidden rounded-velik bg-bordo p-5 text-white">
        <div aria-hidden="true" className="absolute -right-10 -top-10 size-[150px] rounded-full bg-white/[.07]" />
        <p className="relative text-xs opacity-80">{T.sifraOznaka}</p>
        <p className="relative mt-1 font-naslov text-[27px] font-extrabold tracking-[.02em]">{clan.sifra_poziva}</p>
        <button
          type="button"
          onClick={kopiraj}
          className="relative mt-3.5 flex min-h-11 w-full items-center justify-center rounded-full bg-white/15 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/25"
        >
          {T.podeli}
        </button>
        {kopirano && (
          <p role={kopirano.greska ? "alert" : "status"} className="relative mt-2 text-sm font-medium">
            {kopirano.tekst}
          </p>
        )}
      </div>
      <p className="mt-3 text-sm text-mastilo-2">{T.sifraPomoc}</p>

      <form onSubmit={pozovi} className={`${stil.karta} mt-5 space-y-3`} noValidate>
        <h2 className="font-naslov text-[17px] font-bold">{T.poziv.naslov}</h2>
        <p className="text-sm text-mastilo-2">{T.poziv.uvod}</p>
        <label htmlFor="sifra-poziva" className="text-sm font-medium text-mastilo-2">
          {T.poziv.polje}
        </label>
        <input
          id="sifra-poziva"
          type="text"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={40}
          value={sifra}
          onChange={(e) => {
            setSifra(e.target.value);
            setPozivPoruka(null);
          }}
          className={stil.polje}
        />
        {pozivPoruka && (
          <p role={pozivPoruka.greska ? "alert" : "status"} className={`text-sm font-medium ${pozivPoruka.greska ? "text-bordo" : ""}`}>
            {pozivPoruka.tekst}
          </p>
        )}
        <button type="submit" disabled={saljem} className={stil.veliko}>
          {saljem ? T.poziv.saljem : T.poziv.dugme}
        </button>
      </form>

      {poruka && (
        <p role={poruka.greska ? "alert" : "status"} className={`mt-4 text-sm font-medium ${poruka.greska ? "text-bordo" : ""}`}>
          {poruka.tekst}
        </p>
      )}
      {stanje.greska && (
        <p role="alert" className="mt-4 text-base font-medium text-bordo">
          {T.greska}
        </p>
      )}
      {stanje.ucitava && <p className="mt-4 text-base text-mastilo-2">{T.ucitava}</p>}

      {primljeni.length > 0 && (
        <section aria-label={T.pozivi.primljeni}>
          <h2 className={stil.odeljak}>{T.pozivi.primljeni}</h2>
          <ul className="space-y-3">
            {primljeni.map((v) => (
              <li key={v.id} className={stil.karta}>
                <div className="flex items-center gap-3">
                  <Avatar id={v.clan_id} nadimak={v.nadimak} />
                  <div className="min-w-0 flex-1">
                    {/* nadimak pošiljaoca se vidi samo dok poziv čeka (pogled moje_veze); bez njega „Нови позив" */}
                    <p className="text-[15px] font-semibold leading-tight">{v.nadimak ? T.pozivi.posiljalac.replace("{nadimak}", prikaznoIme(v.nadimak, "")) : T.pozivi.noviPoziv}</p>
                    <p className="text-xs text-mastilo-2">{T.pozivi.kada.replace("{datum}", kada(v.kreirana))}</p>
                  </div>
                </div>
                <div className="mt-3 flex gap-2">
                  <button type="button" disabled={zauzet === v.id} onClick={() => prihvati(v)} className={stil.pilulaPuna}>
                    {T.pozivi.prihvati}
                  </button>
                  <button type="button" disabled={zauzet === v.id} onClick={() => odbij(v)} className={stil.pilula}>
                    {T.pozivi.odbij}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {poslati.length > 0 && (
        <section aria-label={T.pozivi.poslati}>
          <h2 className={stil.odeljak}>{T.pozivi.poslati}</h2>
          <ul className="space-y-3">
            {poslati.map((v) => (
              <li key={v.id} className={stil.karta}>
                <div className="flex items-center gap-3">
                  <Avatar id={v.clan_id} nadimak={v.nadimak} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] font-semibold leading-tight">{v.nadimak ? T.pozivi.poslatKome.replace("{nadimak}", v.nadimak) : T.pozivi.poslatBezImena}</p>
                    <p className="text-xs text-mastilo-2">{kada(v.kreirana)}</p>
                  </div>
                </div>
                <div className="mt-3 flex">
                  <button type="button" disabled={zauzet === v.id} onClick={() => povuci(v)} className={stil.pilula}>
                    {T.pozivi.povuci}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <h2 className={stil.odeljak}>{T.preporukeNaslov}</h2>
      {!stanje.ucitava && stanje.preporuke.length === 0 && <p className="px-2 py-4 text-center text-sm text-mastilo-2">{T.preporuke.nema}</p>}
      <ul className="space-y-3">
        {stanje.preporuke.map((p) => (
          <li key={p.id} className={stil.karta}>
            <p className="text-sm font-semibold">{T.preporuke.od.replace("{nadimak}", prikaznoIme(p.posiljalac_nadimak, T.anonimno))}</p>
            <p className="text-xs text-mastilo-2">{kada(p.kreirana)}</p>
            <Link to={`/knjiga/${p.knjiga.id}`} className="mt-3 flex min-h-14 items-center gap-3">
              <div className="w-12 flex-none">
                <Korica knjiga={p.knjiga} autor={p.knjiga.autor} velicina="sitna" />
              </div>
              <span className="min-w-0">
                <span className="block font-naslov text-[16px] font-bold leading-tight tracking-[-0.02em]">{p.knjiga.naslov}</span>
                {p.knjiga.autor && <span className="block text-[13px] text-mastilo-2">{p.knjiga.autor}</span>}
              </span>
            </Link>
            {p.poruka && <p className="mt-3 whitespace-pre-line border-l-2 border-bordo-svetla pl-3 text-sm leading-[1.55]">{p.poruka}</p>}
            <div className="mt-3 flex flex-col gap-2">
              <button type="button" disabled={zauzet === p.id} onClick={() => zelim(p)} className={stil.veliko}>
                {T.preporuke.zelim}
              </button>
              <div className="flex gap-2">
                <button type="button" disabled={zauzet === p.id} onClick={() => procitanoVec(p)} className={stil.pilula}>
                  {T.preporuke.procitanoVec}
                </button>
                <button type="button" disabled={zauzet === p.id} onClick={() => nijeZaMene(p)} className={stil.pilula}>
                  {T.preporuke.nijeZaMene}
                </button>
              </div>
              <PrijaviStavku tip="preporuka" stavkaId={p.id} />
            </div>
          </li>
        ))}
      </ul>

      <h2 className={stil.odeljak}>
        {T.povezaniNaslov} {povezani.length > 0 && <span className="text-sm font-medium text-mastilo-2">{povezani.length}</span>}
      </h2>
      {!stanje.ucitava && povezani.length === 0 && (
        <div className={stil.karta}>
          <p className="text-base">{T.povezani.nema}</p>
        </div>
      )}
      <ul className="space-y-3">
        {povezani.map((v) => {
          const ime = prikaznoIme(v.nadimak, T.anonimno);
          return (
            <li key={v.id}>
              <Link to={`/citaoci/${v.clan_id}`} aria-label={T.povezani.otvori.replace("{nadimak}", ime)} className={`${stil.karta} flex min-h-14 items-center gap-3 py-3`}>
                <Avatar id={v.clan_id} nadimak={v.nadimak} />
                <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{ime}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}
