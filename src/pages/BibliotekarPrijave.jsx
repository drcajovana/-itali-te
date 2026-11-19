import { useEffect, useId, useState } from "react";
import { useAuth } from "../lib/auth-context.js";
import { postaviAktivnost } from "../lib/clanovi.js";
import { mozeDaUpravlja, datumIzVremena } from "../lib/osoblje-logika.js";
import { formatDatum } from "../lib/polica-logika.js";
import { FILTERI, NAJDUZA_BELESKA, imeClana, popuni, urediBelesku } from "../lib/prijave-logika.js";
import { javiPromenuPrijava, postaviSakrivenUtisak, postaviSakrivenuPreporuku, resiPrijavu, ucitajPrijave, vratiPrijavu } from "../lib/prijave.js";
import { stil } from "../lib/stil.js";
import { tekst } from "../lib/tekst.js";

const T = tekst.moderacija;
const kada = (iso) => formatDatum(datumIzVremena(iso));

// Prijavljena stavka onako kako je vidi osoblje: utisak, preporuka ili član. Stavka može da ne postoji
// (prijava preživi brisanje), a to je običan slučaj.
function Stavka({ p }) {
  const s = p.stavka;
  if (!s.postoji) return <p className="text-sm text-mastilo-2">{T.nePostoji[p.tip]}</p>;

  if (p.tip === "utisak") {
    const meta = [s.ocena != null ? popuni(T.ocena, { ocena: s.ocena }) : T.bezOcene, tekst.utisak.vidljivosti[s.vidljivost], s.spojler ? T.spojler : null, s.skriven ? T.sakriven : null];
    return (
      <>
        <p className="text-sm font-semibold">{popuni(T.utisak, { ime: imeClana(s.autor, T.nepoznat), naslov: s.knjiga?.naslov ?? T.bezKnjige })}</p>
        <p className="mt-0.5 text-xs text-mastilo-2">{meta.filter(Boolean).join(" · ")}</p>
        {s.tekst && <p className="mt-2 whitespace-pre-line border-l-2 border-bordo-svetla pl-3 text-sm leading-[1.55]">{s.tekst}</p>}
      </>
    );
  }

  if (p.tip === "preporuka") {
    return (
      <>
        <p className="text-sm font-semibold">{popuni(T.preporuka, { od: imeClana(s.posiljalac, T.nepoznat), za: imeClana(s.primalac, T.nepoznat), naslov: s.knjiga?.naslov ?? T.bezKnjige })}</p>
        {s.skrivena && <p className="mt-0.5 text-xs text-mastilo-2">{T.sakrivena}</p>}
        {s.poruka && <p className="mt-2 whitespace-pre-line border-l-2 border-bordo-svetla pl-3 text-sm leading-[1.55]">{s.poruka}</p>}
      </>
    );
  }

  const c = s.clan;
  return (
    <>
      <p className="text-sm font-semibold">{imeClana(c, T.nepoznat)}</p>
      <p className="mt-0.5 text-xs text-mastilo-2">
        {[popuni(tekst.clanovi.karta, { karta: c.broj_kartice }), tekst.clanovi.uloge[c.uloga], c.nadimak ? popuni(T.nadimak, { nadimak: c.nadimak }) : null, c.aktivan ? null : tekst.clanovi.neaktivan]
          .filter(Boolean)
          .join(" · ")}
      </p>
    </>
  );
}

// Jedna prijava: ko je prijavio, razlog, prijavljena stavka, radnje nad stavkom i rešavanje sa beleškom.
// Stanje stavke (sakriven, aktivan) menja roditelj (`izmeniRed`), da se prikaz uvek slaže sa bazom.
function Prijava({ p, ja, izmeniRed, ukloni }) {
  const idBeleske = useId();
  const [zauzet, setZauzet] = useState(false);
  const [poruka, setPoruka] = useState(null); // { tekst, greska }
  const [resava, setResava] = useState(false);
  const [beleska, setBeleska] = useState("");
  const [pita, setPita] = useState(false); // potvrda deaktivacije člana

  const s = p.stavka;
  const clan = p.tip === "clan" && s.postoji ? s.clan : null;
  const mozeClana = clan && clan.id !== ja.id && mozeDaUpravlja(ja.uloga, clan.uloga);

  async function uradi(posao, uspeh) {
    if (zauzet) return;
    setZauzet(true);
    setPoruka(null);
    try {
      await posao();
      if (uspeh) setPoruka({ tekst: uspeh });
    } catch (e) {
      const kod = e?.kod ?? e?.code;
      console.error("prijava, radnja:", kod);
      setPoruka({ tekst: T.greske[kod] ?? (kod === "42501" ? T.greske.nema_dozvole : T.greske.opste), greska: true });
    }
    setZauzet(false);
  }

  const promeniSakrivenost = () => {
    if (p.tip === "utisak") {
      const sad = !s.skriven;
      return uradi(async () => {
        await postaviSakrivenUtisak(s.id, sad);
        izmeniRed(p.id, (r) => ({ ...r, stavka: { ...r.stavka, skriven: sad } }));
      }, sad ? T.poruke.utisakSakriven : T.poruke.utisakVracen);
    }
    const sad = !s.skrivena;
    return uradi(async () => {
      await postaviSakrivenuPreporuku(s.id, sad);
      izmeniRed(p.id, (r) => ({ ...r, stavka: { ...r.stavka, skrivena: sad } }));
    }, sad ? T.poruke.preporukaSakrivena : T.poruke.preporukaVracena);
  };

  const promeniAktivnost = () =>
    uradi(async () => {
      const sad = !clan.aktivan;
      setPita(false);
      await postaviAktivnost(clan.id, sad);
      izmeniRed(p.id, (r) => ({ ...r, stavka: { ...r.stavka, clan: { ...r.stavka.clan, aktivan: sad } } }));
      setPoruka({ tekst: sad ? T.poruke.clanAktiviran : T.poruke.clanDeaktiviran });
    });

  async function resi(e) {
    e.preventDefault();
    const b = urediBelesku(beleska);
    if (!b.ok) return setPoruka({ tekst: T.beleskaPredugo, greska: true });
    await uradi(async () => {
      await resiPrijavu(p.id, b.vrednost);
      javiPromenuPrijava();
      ukloni(p.id, T.poruke.resena);
    });
  }

  const vrati = () =>
    uradi(async () => {
      await vratiPrijavu(p.id);
      javiPromenuPrijava();
      ukloni(p.id, T.poruke.vracena);
    });

  return (
    <li className={stil.karta}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={stil.izvor}>{T.vrste[p.tip]}</span>
        <span className="text-xs text-mastilo-2">{popuni(T.od, { datum: kada(p.kreirana) })}</span>
      </div>
      <p className="mt-2 text-xs text-mastilo-2">{popuni(T.prijavitelj, { ime: imeClana(p.prijavilac, T.nepoznat) })}</p>

      <p className="mt-3 text-xs font-medium text-mastilo-2">{T.razlog}</p>
      <p className="mt-0.5 whitespace-pre-line text-sm leading-[1.55]">{p.razlog || T.bezRazloga}</p>

      <div className="mt-3 rounded-srednji bg-pozadina p-3">
        <Stavka p={p} />
      </div>

      {p.resena ? (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-mastilo-2">{p.resio ? popuni(T.resenoOd, { datum: kada(p.resena_datum), ime: imeClana(p.resio, T.nepoznat) }) : popuni(T.resenoBezImena, { datum: kada(p.resena_datum) })}</p>
          {p.beleska && (
            <p className="whitespace-pre-line border-l-2 border-bordo-svetla pl-3 text-sm leading-[1.55]">
              <span className="block text-xs font-medium text-mastilo-2">{T.beleskaOznaka}</span>
              {p.beleska}
            </p>
          )}
          <button type="button" disabled={zauzet} onClick={vrati} className={stil.okvirno}>
            {T.vrati}
          </button>
        </div>
      ) : (
        <>
          {!resava && s.postoji && p.tip !== "clan" && (
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" disabled={zauzet} onClick={promeniSakrivenost} className={stil.pilula}>
                {p.tip === "utisak" ? (s.skriven ? T.vratiUtisak : T.sakrijUtisak) : s.skrivena ? T.vratiPreporuku : T.sakrijPreporuku}
              </button>
            </div>
          )}

          {!resava && mozeClana && !pita && (
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" disabled={zauzet} onClick={() => (clan.aktivan ? setPita(true) : promeniAktivnost())} className={stil.pilula}>
                {clan.aktivan ? T.deaktiviraj : T.aktiviraj}
              </button>
            </div>
          )}
          {pita && (
            <div role="group" aria-label={popuni(T.deaktivirajPitanje, { ime: clan.ime })} className="mt-3 space-y-2 rounded-srednji border border-bordo p-3">
              <p className="text-sm font-semibold">{popuni(T.deaktivirajPitanje, { ime: clan.ime })}</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={zauzet} onClick={promeniAktivnost} className={stil.veliko}>
                  {T.deaktivirajDa}
                </button>
                <button type="button" disabled={zauzet} onClick={() => setPita(false)} className={stil.tiho}>
                  {T.odustani}
                </button>
              </div>
            </div>
          )}

          {!resava ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" disabled={zauzet} onClick={() => setResava(true)} className={stil.pilulaPuna}>
                {T.resi}
              </button>
            </div>
          ) : (
            <form onSubmit={resi} noValidate className="mt-3 space-y-3 rounded-srednji border border-linija p-3">
              <div>
                <label htmlFor={idBeleske} className="text-sm font-medium text-mastilo-2">
                  {T.beleska}
                </label>
                <textarea id={idBeleske} rows={3} maxLength={NAJDUZA_BELESKA} value={beleska} onChange={(e) => setBeleska(e.target.value)} className={`${stil.polje} mt-1.5 min-h-20`} />
                <p className="mt-1 text-xs text-mastilo-2">{T.beleskaPomoc}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="submit" disabled={zauzet} className={stil.veliko}>
                  {T.resiPotvrdi}
                </button>
                <button type="button" disabled={zauzet} onClick={() => setResava(false)} className={stil.tiho}>
                  {T.odustani}
                </button>
              </div>
            </form>
          )}
        </>
      )}

      {poruka && (
        <p role={poruka.greska ? "alert" : "status"} className={`mt-3 text-sm font-medium ${poruka.greska ? "text-bordo" : ""}`}>
          {poruka.tekst}
        </p>
      )}
    </li>
  );
}

// Ekran „Пријаве" (/bibliotekar/prijave): nerešene i rešene prijave članova (utisci, preporuke, članovi).
// Samo za bibliotekare i administratore (RutaZaBibliotekare je udobnost; prava proveravaju RLS i okidači).
export default function BibliotekarPrijave() {
  const { clan: ja } = useAuth();
  const [filter, setFilter] = useState("otvorene");
  // Rezultat pamti za koji je filter učitan; dok se ne poklopi sa izabranim, ekran javlja da učitava.
  const [stanje, setStanje] = useState({ filter: null, lista: [], imaJos: false, greska: false });
  const [osvezi, setOsvezi] = useState(0);
  const [poruka, setPoruka] = useState(null);

  useEffect(() => {
    let otkazano = false;
    ucitajPrijave(filter === "resene")
      .then(({ lista, imaJos }) => !otkazano && setStanje({ filter, lista, imaJos, greska: false }))
      .catch((e) => {
        console.error("učitavanje prijava:", e);
        if (!otkazano) setStanje({ filter, lista: [], imaJos: false, greska: true });
      });
    return () => {
      otkazano = true;
    };
  }, [filter, osvezi]);

  const ucitava = stanje.filter !== filter;
  const izmeniRed = (id, f) => setStanje((s) => ({ ...s, lista: s.lista.map((r) => (r.id === id ? f(r) : r)) }));
  // Rešena prijava nestaje iz nerešenih (i vraćena iz rešenih); poruka ostaje iznad liste.
  const ukloni = (id, tekstPoruke) => {
    setStanje((s) => ({ ...s, lista: s.lista.filter((r) => r.id !== id) }));
    setPoruka({ tekst: tekstPoruke });
    setOsvezi((n) => n + 1);
  };

  return (
    <>
      <h1 className={`${stil.naslov} pt-2`}>{T.naslov}</h1>
      <p className={stil.uvod}>{T.uvod}</p>

      <div role="group" aria-label={T.filter} className="mt-4 flex flex-wrap gap-2">
        {FILTERI.map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={filter === f}
            onClick={() => {
              setFilter(f);
              setPoruka(null);
            }}
            className={stil.cip}
          >
            {T.filteri[f]}
          </button>
        ))}
      </div>

      {poruka && (
        <p role="status" className="mt-3 text-sm font-medium">
          {poruka.tekst}
        </p>
      )}

      <section className="mt-4" aria-label={T.filteri[filter]}>
        {ucitava && <p className="text-base text-mastilo-2">{T.ucitava}</p>}
        {!ucitava && stanje.greska && (
          <p role="alert" className="text-base font-medium text-bordo">
            {T.greska}
          </p>
        )}
        {!ucitava && !stanje.greska && stanje.lista.length === 0 && <p className={`${stil.karta} text-sm text-mastilo-2`}>{filter === "resene" ? T.nemaResenih : T.nema}</p>}
        {!ucitava && (
          <ul className="space-y-3">
            {stanje.lista.map((p) => (
              <Prijava key={p.id} p={p} ja={ja} izmeniRed={izmeniRed} ukloni={ukloni} />
            ))}
          </ul>
        )}
        {!ucitava && stanje.imaJos && <p className="mt-3 text-sm text-mastilo-2">{popuni(T.viseRezultata, { n: stanje.lista.length })}</p>}
      </section>
    </>
  );
}
