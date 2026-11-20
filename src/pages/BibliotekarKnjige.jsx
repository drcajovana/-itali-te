import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import Dijalog from "../components/Dijalog.jsx";
import Korica from "../components/Korica.jsx";
import SlikajKoricu from "../components/SlikajKoricu.jsx";
import Skeleton from "../components/Skeleton.jsx";
import { useAuth } from "../lib/auth-context.js";
import { izmeniKnjigu, obrisiKnjigu } from "../lib/knjige-admin.js";
import { ukloniKoricu } from "../lib/knjige.js";
import { postaviOdluku } from "../lib/nabavka.js";
import { datumIzVremena } from "../lib/osoblje-logika.js";
import { formatDatum } from "../lib/polica-logika.js";
import { IZVORI, KORICE, ODLUKE, REDOSLEDI, filteriIzAdrese, filteriUAdresu, grupeZbira, imaJos, kljucFiltera, kljucGreskeIzmene, mozeDaBrise, opcijeIzdavaca, poljaIzmene } from "../lib/pregled-knjiga-logika.js";
import { ucitajIzdavace, ucitajStranuKnjiga, ucitajZbirKnjiga } from "../lib/pregled-knjiga.js";
import { popuni } from "../lib/prijave-logika.js";
import { stil } from "../lib/stil.js";
import { tekst } from "../lib/tekst.js";

const T = tekst.pregledKnjiga;
const TK = tekst.korice;

// Jedan broj iz zbira: veliki broj i natpis ispod.
function Broj({ broj, natpis }) {
  return (
    <div className="rounded-srednji bg-pozadina px-3 py-2.5">
      <p className="font-naslov text-[22px] font-bold leading-none tracking-[-0.03em] text-bordo">{broj}</p>
      <p className="mt-1 text-xs leading-tight text-mastilo-2">{natpis}</p>
    </div>
  );
}

// Dugmad u dijalogu sa podacima o knjizi (Измени, Обриši). Na telefonu ostaju 44 px (prst), na računaru su manja (md): index.css postavlja
// min-height svim dugmadima van slojeva, pa se za manju visinu koristi „!".
const MALO_DUGME = "inline-flex min-h-11 md:min-h-9! items-center rounded-full border border-linija bg-povrsina px-4 text-[13px] font-medium transition hover:bg-bordo-svetla";

// Jedan red podataka u dijalogu: natpis levo, vrednost desno.
function Podatak({ natpis, vrednost }) {
  return (
    <div className="flex gap-3 border-b border-linija py-2 text-sm last:border-b-0">
      <dt className="w-28 flex-none text-mastilo-2">{natpis}</dt>
      <dd className="min-w-0 flex-1 break-words font-medium">{vrednost || "—"}</dd>
    </div>
  );
}

// Dijalog sa podacima o knjizi (klik na karticu): veća korica, svi podaci, i opcije „Измени" (bibliotekar i administrator) i „Обриши"
// (samo administrator, uz potvrdu). Izmena menja samo naslov, autora, izdavača, godinu i ISBN (iste provere kao pri unosu); ostala polja se ne
// dodiruju. Brisanje odnosi i stavke na policama, utiske i preporuke, pa potvrda piše koliko čitalaca knjigu ima na polici.
function KnjigaDijalog({ k: pocetna, uloga, onZatvori, naIzmenjeno, naObrisano }) {
  const [k, setK] = useState(pocetna);
  const [rezim, setRezim] = useState("pregled"); // "pregled" | "izmena" | "brisanje"
  const [forma, setForma] = useState(() => poljaIzmene(pocetna));
  const [zauzet, setZauzet] = useState(false);
  const [greska, setGreska] = useState(null);
  const [slikaOk, setSlikaOk] = useState(false);
  const [uklanjanje, setUklanjanje] = useState(false); // pitanje „Уклонити корицу?” je otvoreno
  const [koricaUklonjena, setKoricaUklonjena] = useState(false);
  const [stanjeOk, setStanjeOk] = useState(false);

  async function sacuvaj(e) {
    e.preventDefault();
    if (zauzet) return;
    setZauzet(true);
    setGreska(null);
    try {
      const nova = await izmeniKnjigu(k.id, forma);
      naIzmenjeno(k.id, nova);
      setK((x) => ({ ...x, ...nova }));
      setRezim("pregled");
    } catch (err) {
      const kljuc = kljucGreskeIzmene(err);
      if (kljuc === "opste") console.error("izmena knjige:", err?.code ?? err?.message);
      setGreska(T.izmena.greske[kljuc]);
    }
    setZauzet(false);
  }

  // Stanje knjige (U fondu / Nabavljamo / Ne nabavljamo): ista odluka kao na ekranu „Набавка” (knjige.odluka_nabavke). „У фонду” (imamo) okidač u bazi
  // pretvara u u_fondu = true, ostale dve u false. Tako bibliotekar ili administrator knjigu koju je uneo član proglašava delom fonda (ili ne).
  async function promeniStanje(novo) {
    if (zauzet || !novo || novo === k.odluka) return;
    setZauzet(true);
    setGreska(null);
    setStanjeOk(false);
    try {
      await postaviOdluku(k.id, novo);
      const nova = { odluka: novo };
      setK((x) => ({ ...x, ...nova }));
      naIzmenjeno(k.id, nova);
      setStanjeOk(true);
    } catch (err) {
      console.error("promena stanja knjige:", err?.kod ?? err?.code);
      setGreska(err?.kod === "nema_dozvole" ? T.detalji.stanjeNemaDozvole : T.detalji.stanjeGreska);
    }
    setZauzet(false);
  }

  // Uklanjanje korice (isti tok kao na stranici knjige: knjiga prvo gubi adresu, pa se briše fajl iz našeg Storage-a).
  async function ukloniSliku() {
    if (zauzet) return;
    setZauzet(true);
    setGreska(null);
    try {
      await ukloniKoricu(k.id, k.korice_url);
      const nova = { korice_url: null, korice_izvor: null };
      setK((x) => ({ ...x, ...nova }));
      naIzmenjeno(k.id, nova);
      setUklanjanje(false);
      setSlikaOk(false);
      setKoricaUklonjena(true);
    } catch (err) {
      console.error("uklanjanje korice:", err?.kod ?? err?.code);
      setGreska(TK.greske[err?.kod] ?? TK.greske.korica_upis);
    }
    setZauzet(false);
  }

  async function obrisi() {
    if (zauzet) return;
    setZauzet(true);
    setGreska(null);
    try {
      await obrisiKnjigu(k);
      naObrisano(k.id);
      onZatvori();
    } catch (err) {
      console.error("brisanje knjige:", err?.kod ?? err?.code);
      setGreska(err?.kod === "nema_dozvole" ? T.brisanje.nemaDozvole : T.brisanje.greska);
      setZauzet(false);
    }
  }

  const polje = (ime, oznaka, opcije = {}) => (
    <div>
      <label htmlFor={`izmena-${ime}`} className="text-sm font-medium text-mastilo-2">
        {oznaka}
      </label>
      <input
        id={`izmena-${ime}`}
        type="text"
        autoComplete="off"
        autoFocus={ime === "naslov"}
        value={forma[ime]}
        onChange={(e) => setForma((f) => ({ ...f, [ime]: e.target.value }))}
        inputMode={opcije.inputMode}
        className={`${stil.polje} mt-1`}
      />
    </div>
  );
  const poruka = greska && (
    <p role="alert" className="mt-3 text-sm font-medium text-bordo">
      {greska}
    </p>
  );

  if (rezim === "izmena") {
    return (
      <Dijalog naslov={T.izmena.naslov} onZatvori={onZatvori} zauzet={zauzet}>
        <form onSubmit={sacuvaj} noValidate className="mt-4 space-y-3">
          {polje("naslov", T.izmena.polja.naslov)}
          {polje("autor", T.izmena.polja.autor)}
          {polje("izdavac", T.izmena.polja.izdavac)}
          <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-3">
            {polje("godina", T.izmena.polja.godina, { inputMode: "numeric" })}
            {polje("isbn", T.izmena.polja.isbn)}
          </div>
          {poruka}
          <div className="flex flex-wrap gap-2 pt-1">
            <button type="submit" disabled={zauzet} className={stil.veliko}>
              {zauzet ? T.izmena.cuvam : T.izmena.sacuvaj}
            </button>
            <button
              type="button"
              disabled={zauzet}
              onClick={() => {
                setRezim("pregled");
                setForma(poljaIzmene(k));
                setGreska(null);
              }}
              className={stil.tiho}
            >
              {T.izmena.odustani}
            </button>
          </div>
        </form>
      </Dijalog>
    );
  }

  if (rezim === "brisanje") {
    return (
      <Dijalog naslov={popuni(T.brisanje.pitanje, { naslov: k.naslov })} onZatvori={onZatvori} zauzet={zauzet}>
        <p className="mt-3 text-sm text-mastilo-2">{popuni(k.citaoca > 0 ? T.brisanje.upozorenje : T.brisanje.upozorenjeBez, { n: k.citaoca })}</p>
        {poruka}
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" disabled={zauzet} onClick={obrisi} className={stil.veliko}>
            {zauzet ? T.izmena.cuvam : T.brisanje.da}
          </button>
          <button
            type="button"
            disabled={zauzet}
            onClick={() => {
              setRezim("pregled");
              setGreska(null);
            }}
            className={stil.tiho}
          >
            {T.izmena.odustani}
          </button>
        </div>
      </Dijalog>
    );
  }

  return (
    <Dijalog naslov={k.naslov} onZatvori={onZatvori}>
      <div className="mt-4 flex gap-4">
        <div className="w-28 flex-none">
          <Korica knjiga={k} autor={k.autor} velicina="puna" />
        </div>
        <dl className="min-w-0 flex-1">
          <Podatak natpis={T.izmena.polja.autor} vrednost={k.autor} />
          <Podatak natpis={T.izmena.polja.izdavac} vrednost={k.izdavac} />
          <Podatak natpis={T.izmena.polja.godina} vrednost={k.godina} />
          <Podatak natpis={T.izmena.polja.isbn} vrednost={k.isbn} />
        </dl>
      </div>
      <dl className="mt-2">
        <Podatak natpis={T.detalji.izvor} vrednost={T.izvori[k.izvor] ?? k.izvor} />
        <div className="flex items-center gap-3 border-b border-linija py-2 text-sm">
          <label htmlFor="stanje-knjige" className="w-28 flex-none text-mastilo-2">
            {T.detalji.odluka}
          </label>
          <select id="stanje-knjige" value={k.odluka ?? ""} disabled={zauzet} onChange={(e) => promeniStanje(e.target.value)} className={`${stil.polje} min-w-0 flex-1 py-1.5`}>
            {!k.odluka && (
              <option value="" disabled>
                {T.odluke.bez}
              </option>
            )}
            {["imamo", "nabavljamo", "ne_nabavljamo"].map((v) => (
              <option key={v} value={v}>
                {T.odluke[v]}
              </option>
            ))}
          </select>
        </div>
        <Podatak natpis={T.detalji.citaoca} vrednost={String(k.citaoca)} />
        <Podatak natpis={T.detalji.uneto} vrednost={formatDatum(datumIzVremena(k.kreirana))} />
      </dl>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => {
            setForma(poljaIzmene(k));
            setGreska(null);
            setRezim("izmena");
          }}
          className={`${MALO_DUGME} text-bordo`}
        >
          {T.izmeni}
        </button>
        {mozeDaBrise(uloga) && (
          <button
            type="button"
            onClick={() => {
              setGreska(null);
              setRezim("brisanje");
            }}
            className={`${MALO_DUGME} text-mastilo-2 hover:text-bordo`}
          >
            {T.obrisi}
          </button>
        )}
        {/* samo slika: postavlja ili zamenjuje koricu postojeće knjige, ostali podaci se ne diraju (isti tok kao na stranici knjige) */}
        <SlikajKoricu
          knjigaId={k.id}
          staraAdresa={k.korice_url}
          kamera={false}
          glavno={false}
          mala
          oznaka={k.korice_url ? T.detalji.zameniSliku : T.detalji.postaviSliku}
          onPostavljena={(adresa, izvor) => {
            const nova = { korice_url: adresa, korice_izvor: izvor };
            setK((x) => ({ ...x, ...nova }));
            naIzmenjeno(k.id, nova);
            setSlikaOk(true);
            setKoricaUklonjena(false);
          }}
        />
        {k.korice_url && !uklanjanje && (
          <button
            type="button"
            disabled={zauzet}
            onClick={() => {
              setGreska(null);
              setUklanjanje(true);
            }}
            className={`${MALO_DUGME} text-mastilo-2 hover:text-bordo`}
          >
            {TK.ukloni}
          </button>
        )}
        <Link to={`/knjiga/${encodeURIComponent(k.id)}`} className={`${MALO_DUGME} text-bordo`}>
          {T.detalji.stranica}
        </Link>
        <button type="button" onClick={onZatvori} className={`${MALO_DUGME} ml-auto text-mastilo-2`}>
          {T.zatvori}
        </button>
      </div>
      {uklanjanje && (
        <div role="group" aria-label={TK.ukloniPitanje} className="mt-4 space-y-2 rounded-srednji border border-bordo p-3">
          <p className="text-base font-semibold">{TK.ukloniPitanje}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={zauzet} onClick={ukloniSliku} className={stil.veliko}>
              {zauzet ? TK.uklanjam : TK.ukloniDa}
            </button>
            <button type="button" disabled={zauzet} onClick={() => setUklanjanje(false)} className={stil.tiho}>
              {TK.ukloniNe}
            </button>
          </div>
        </div>
      )}
      {poruka}
      {slikaOk && (
        <p role="status" className="mt-3 text-sm font-medium">
          {T.detalji.slikaPostavljena}
        </p>
      )}
      {stanjeOk && (
        <p role="status" className="mt-3 text-sm font-medium">
          {T.detalji.stanjeOk}
        </p>
      )}
      {koricaUklonjena && (
        <p role="status" className="mt-3 text-sm font-medium">
          {T.detalji.koricaUklonjena}
        </p>
      )}
    </Dijalog>
  );
}

// Jedna knjiga u listi: cela kartica je dugme koje otvara podatke o knjizi. Sve kartice su iste veličine (mreža sa redovima jednake visine,
// naslov i ostali redovi su skraćeni). Samo podaci o knjizi i ZBIRNI broj čitalaca; nikad ko je unosilac ni ko je knjigu stavio na policu.
function RedKnjige({ k, naOtvori }) {
  const odluka = k.odluka ? T.odluke[k.odluka] : T.odluke.bez;
  return (
    <li>
      <button type="button" onClick={() => naOtvori(k)} aria-label={popuni(T.otvori, { naslov: k.naslov })} className={`${stil.karta} flex h-full w-full gap-3.5 text-left transition hover:shadow-md active:scale-[.99]`}>
        <span className="block w-20 flex-none">
          <Korica knjiga={k} autor={k.autor} velicina="mala" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="line-clamp-3 font-naslov text-[15.5px] font-bold leading-tight tracking-[-0.02em]">{k.naslov}</span>
          <span className="mt-0.5 line-clamp-1 text-sm text-mastilo-2">{k.autor || T.bezAutora}</span>
          <span className="line-clamp-1 text-xs text-mastilo-2">{[k.izdavac, k.godina].filter(Boolean).join(", ") || "\u00A0"}</span>
          <span className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className={k.izvor === "fond" ? stil.izvorFond : stil.izvor}>{T.izvoriKratko[k.izvor] ?? k.izvor}</span>
            <span className={k.odluka === "imamo" ? stil.izvorFond : stil.izvor}>{odluka}</span>
          </span>
          <span className="mt-auto block pt-2 text-xs text-mastilo-2">{popuni(T.citaoca, { n: k.citaoca })}</span>
        </span>
      </button>
    </li>
  );
}

// Ekran „Све књиге" (/bibliotekar/knjige): na vrhu zbir i filteri, ispod mreža knjiga sa brojem čitalaca; klik na karticu otvara podatke o knjizi,
// a tamo su izmena i brisanje (samo administrator). Samo za bibliotekare i administratore (RutaZaBibliotekare je udobnost; funkcije iz 0024
// vraćaju prazno svima ostalima, a RLS štiti izmenu i brisanje). Ekran ne dobija nikakav trag do člana: nema unosioca, nema imena, nema
// onoga ko je knjigu stavio na policu.
export default function BibliotekarKnjige() {
  const { clan: ja } = useAuth();
  // Filteri žive u adresi (?q=&izvor=&odluka=&izdavac=&redosled=), pa se izbor čuva pri osvežavanju i povratku na ekran.
  // Svaka promena filtera menja adresu bez novog zapisa u istoriji, a lista počinje iznova od prve strane (ključ filtera).
  const [params, setParams] = useSearchParams();
  const { upit: trazi, izvor, odluka, izdavac, korica, redosled } = filteriIzAdrese(params);
  const postavi = (izmena) => setParams(filteriUAdresu({ upit: trazi, izvor, odluka, izdavac, korica, redosled, ...izmena }), { replace: true });
  // Polje za pretragu ima svoj tekst; u adresu ide tek kad se kucanje zaustavi.
  const [upit, setUpit] = useState(trazi);
  const [izdavaci, setIzdavaci] = useState({ kljuc: null, redovi: [] });
  const [zbir, setZbir] = useState({ ucitano: false, podaci: null, greska: false });
  // Rezultat pamti za koji je filter učitan; dok se ne poklopi sa izabranim, ekran javlja da učitava.
  const [lista, setLista] = useState({ kljuc: null, redovi: [], ukupno: 0, greska: false });
  const [jos, setJos] = useState(false);
  // posle izmene ili brisanja zbir i spisak izdavača se učitavaju ponovo
  const [osvezi, setOsvezi] = useState(0);
  const [otvorena, setOtvorena] = useState(null); // knjiga čiji su podaci otvoreni u dijalogu

  useEffect(() => {
    if (upit.trim() === trazi) return;
    const t = setTimeout(() => setParams(filteriUAdresu({ upit, izvor, odluka, izdavac, korica, redosled }), { replace: true }), 300);
    return () => clearTimeout(t);
  }, [upit, trazi, izvor, odluka, izdavac, korica, redosled, setParams]);

  useEffect(() => {
    let otkazano = false;
    ucitajZbirKnjiga()
      .then((podaci) => !otkazano && setZbir({ ucitano: true, podaci, greska: false }))
      .catch((e) => {
        console.error("zbir knjiga:", e?.code ?? e?.message);
        if (!otkazano) setZbir({ ucitano: true, podaci: null, greska: true });
      });
    return () => {
      otkazano = true;
    };
  }, [osvezi]);

  const filteri = { upit: trazi, izvor, odluka, izdavac, korica, redosled };
  const kljuc = kljucFiltera(filteri);

  useEffect(() => {
    let otkazano = false;
    const k = kljucFiltera({ upit: trazi, izvor, odluka, izdavac, korica, redosled });
    ucitajStranuKnjiga({ upit: trazi, izvor, odluka, izdavac, korica, redosled })
      .then(({ redovi, ukupno }) => !otkazano && setLista({ kljuc: k, redovi, ukupno, greska: false }))
      .catch((e) => {
        console.error("lista knjiga:", e?.code ?? e?.message);
        if (!otkazano) setLista({ kljuc: k, redovi: [], ukupno: 0, greska: true });
      });
    return () => {
      otkazano = true;
    };
  }, [trazi, izvor, odluka, izdavac, korica, redosled]);

  // Spisak izdavača prati pretragu, izvor, odluku i koricu (ne i izabranog izdavača), pa brojevi odgovaraju onome što bi se dobilo.
  useEffect(() => {
    let otkazano = false;
    const k = JSON.stringify([trazi, izvor, odluka, korica]);
    ucitajIzdavace({ upit: trazi, izvor, odluka, korica })
      .then((redovi) => !otkazano && setIzdavaci({ kljuc: k, redovi }))
      .catch((e) => {
        console.error("izdavači:", e?.code ?? e?.message);
        if (!otkazano) setIzdavaci({ kljuc: k, redovi: [] });
      });
    return () => {
      otkazano = true;
    };
  }, [trazi, izvor, odluka, korica, osvezi]);

  async function ucitajJos() {
    if (jos) return;
    setJos(true);
    try {
      const { redovi, ukupno } = await ucitajStranuKnjiga({ ...filteri, pomeraj: lista.redovi.length });
      setLista((l) => (l.kljuc === kljuc ? { ...l, redovi: [...l.redovi, ...redovi], ukupno } : l));
    } catch (e) {
      console.error("još knjiga:", e?.code ?? e?.message);
      setLista((l) => ({ ...l, greska: true }));
    }
    setJos(false);
  }

  // izmenjena knjiga ostaje u listi sa novim podacima; obrisana nestaje, a ukupan broj se smanjuje
  const naIzmenjeno = (id, nova) => {
    setLista((l) => ({ ...l, redovi: l.redovi.map((r) => (r.id === id ? { ...r, ...nova } : r)) }));
    setOsvezi((n) => n + 1);
  };
  const naObrisano = (id) => {
    setLista((l) => ({ ...l, redovi: l.redovi.filter((r) => r.id !== id), ukupno: Math.max(0, l.ukupno - 1) }));
    setOsvezi((n) => n + 1);
  };

  const ucitava = lista.kljuc !== kljuc;
  const g = grupeZbira(zbir.podaci);
  const opcijeIzd = opcijeIzdavaca(izdavaci.redovi, izdavac, T.izdavac);

  return (
    <>
      <h1 className={`${stil.naslov} pt-2`}>{T.naslov}</h1>

      {/* zbir: ukupno + po izvoru + po odluci, u jednom redu na širokom ekranu */}
      <section className={`${stil.karta} mt-4`} aria-label={T.ukupno}>
        {!zbir.ucitano && <Skeleton blokova={1} visina="h-[318px] md:h-[150px]" razmak="" />}
        {zbir.greska && (
          <p role="alert" className="text-sm font-medium text-bordo">
            {T.zbirGreska}
          </p>
        )}
        {zbir.podaci && (
          <div className="md:grid md:grid-cols-[190px_minmax(0,1fr)_minmax(0,1fr)] md:gap-6">
            <div>
              <p className="text-xs font-medium text-mastilo-2">{T.ukupno}</p>
              <p className="font-naslov text-[40px] font-extrabold leading-none tracking-[-0.04em] text-bordo">{g.ukupno}</p>
              <p className="mt-1 text-xs text-mastilo-2">{T.ukupnoPomoc}</p>
              {g.spojenih > 0 && <p className="text-xs text-mastilo-2">{popuni(T.spojenih, { n: g.spojenih })}</p>}
              <p className="mt-1 text-xs font-medium text-bordo">{popuni(T.bezKorice, { n: g.bezKorice })}</p>
            </div>
            <div>
              <h2 className="mt-4 text-sm font-semibold md:mt-0">{T.poIzvoru}</h2>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {g.izvori.map((x) => (
                  <Broj key={x.kljuc} broj={x.broj} natpis={T.izvori[x.kljuc]} />
                ))}
              </div>
            </div>
            <div>
              <h2 className="mt-4 text-sm font-semibold md:mt-0">{T.poOdluci}</h2>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {g.odluke.map((x) => (
                  <Broj key={x.kljuc} broj={x.broj} natpis={T.odluke[x.kljuc]} />
                ))}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* filteri: sve su padajući meniji (osim pretrage), u tri kolone na širokom ekranu */}
      <section className={`${stil.karta} mt-4 grid gap-4 md:grid-cols-3`} aria-label={T.filter}>
        <div>
          <label htmlFor="pregled-pretraga" className="text-sm font-medium text-mastilo-2">
            {T.pretraga}
          </label>
          <input id="pregled-pretraga" type="search" autoComplete="off" placeholder={T.pretragaPrazno} value={upit} onChange={(e) => setUpit(e.target.value)} className={`${stil.polje} mt-1.5`} />
        </div>

        <div>
          <label htmlFor="pregled-izdavac" className="text-sm font-medium text-mastilo-2">
            {T.filterIzdavac}
          </label>
          <select id="pregled-izdavac" value={izdavac} onChange={(e) => postavi({ izdavac: e.target.value })} className={`${stil.polje} mt-1.5`}>
            <option value="">{T.sviIzdavaci}</option>
            {opcijeIzd.map((o) => (
              <option key={o.kljuc} value={o.kljuc}>
                {o.natpis}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="pregled-izvor" className="text-sm font-medium text-mastilo-2">
            {T.filterIzvor}
          </label>
          <select id="pregled-izvor" value={izvor} onChange={(e) => postavi({ izvor: e.target.value })} className={`${stil.polje} mt-1.5`}>
            <option value="">{T.sve}</option>
            {IZVORI.map((v) => (
              <option key={v} value={v}>
                {T.izvori[v]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="pregled-odluka" className="text-sm font-medium text-mastilo-2">
            {T.filterOdluka}
          </label>
          <select id="pregled-odluka" value={odluka} onChange={(e) => postavi({ odluka: e.target.value })} className={`${stil.polje} mt-1.5`}>
            <option value="">{T.sve}</option>
            {ODLUKE.map((v) => (
              <option key={v} value={v}>
                {T.odluke[v]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="pregled-korica" className="text-sm font-medium text-mastilo-2">
            {T.filterKorica}
          </label>
          <select id="pregled-korica" value={korica} onChange={(e) => postavi({ korica: e.target.value })} className={`${stil.polje} mt-1.5`}>
            <option value="">{T.sve}</option>
            {KORICE.map((v) => (
              <option key={v} value={v}>
                {T.korice[v]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="pregled-redosled" className="text-sm font-medium text-mastilo-2">
            {T.redosled}
          </label>
          <select id="pregled-redosled" value={redosled} onChange={(e) => postavi({ redosled: e.target.value })} className={`${stil.polje} mt-1.5`}>
            {REDOSLEDI.map((v) => (
              <option key={v} value={v}>
                {T.redosledi[v]}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="mt-5" aria-label={T.naslov}>
        {ucitava && <Skeleton blokova={3} visina="h-36" razmak="" />}
        {!ucitava && lista.greska && (
          <p role="alert" className="text-base font-medium text-bordo">
            {T.greska}
          </p>
        )}
        {!ucitava && !lista.greska && lista.redovi.length === 0 && <p className={`${stil.karta} text-sm text-mastilo-2`}>{T.nema}</p>}
        {!ucitava && lista.redovi.length > 0 && (
          <>
            <p className="mb-3 text-sm text-mastilo-2" aria-live="polite">
              {popuni(T.prikazano, { n: lista.redovi.length, ukupno: lista.ukupno })}
            </p>
            <ul className="grid auto-rows-fr gap-3 md:grid-cols-2 xl:grid-cols-3">
              {lista.redovi.map((k) => (
                <RedKnjige key={k.id} k={k} naOtvori={setOtvorena} />
              ))}
            </ul>
            {imaJos(lista.redovi.length, lista.ukupno) && (
              <button type="button" disabled={jos} onClick={ucitajJos} className={`${stil.okvirno} mt-4`}>
                {jos ? T.ucitavamJos : T.jos}
              </button>
            )}
          </>
        )}
      </section>

      {otvorena && <KnjigaDijalog k={otvorena} uloga={ja.uloga} onZatvori={() => setOtvorena(null)} naIzmenjeno={naIzmenjeno} naObrisano={naObrisano} />}
    </>
  );
}
