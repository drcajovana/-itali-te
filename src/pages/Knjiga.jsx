import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import Korica from "../components/Korica.jsx";
import KoricaIzbor from "../components/KoricaIzbor.jsx";
import PreporuciCitaocu from "../components/PreporuciCitaocu.jsx";
import StanjePolice from "../components/StanjePolice.jsx";
import Utisci from "../components/Utisci.jsx";
import { useAuth } from "../lib/auth-context.js";
import { ucitajKnjigu } from "../lib/knjige.js";
import { nasaFotografija } from "../lib/korica-slika.js";
import { prosecnaOcena } from "../lib/polica-logika.js";
import { ucitajOcenu } from "../lib/polica.js";
import { stil } from "../lib/stil.js";
import { tekst } from "../lib/tekst.js";
import { jeBibliotekar } from "../lib/uloge.js";

const T = tekst.knjigaEkran;

function Red({ naziv, children }) {
  return (
    <div className="flex justify-between gap-4 border-b border-linija py-3 text-sm last:border-b-0">
      <dt className="text-mastilo-2">{naziv}</dt>
      <dd className="min-w-0 text-right font-medium">{children}</dd>
    </div>
  );
}

// Povratak na ekran sa kog je član došao (polica ili pretraga); kad je stranica otvorena direktno, na početnu.
function Nazad() {
  const navigate = useNavigate();
  const lokacija = useLocation();
  return (
    <button type="button" onClick={() => (lokacija.key === "default" ? navigate("/") : navigate(-1))} className="inline-flex min-h-11 min-w-11 items-center text-sm font-semibold text-bordo underline">
      {T.nazad}
    </button>
  );
}

function KnjigaSadrzaj({ id }) {
  const { clan } = useAuth();
  const [stanje, setStanje] = useState({ ucitava: true, knjiga: null, greska: false });
  const [ocena, setOcena] = useState(undefined); // red iz pogleda ocene_knjiga; null: nema utisaka
  const [osveziOcenu, setOsveziOcenu] = useState(0);

  useEffect(() => {
    let otkazano = false;
    ucitajKnjigu(id)
      .then((knjiga) => !otkazano && setStanje({ ucitava: false, knjiga, greska: false }))
      .catch((e) => {
        console.error("učitavanje knjige:", e);
        if (!otkazano) setStanje({ ucitava: false, knjiga: null, greska: true });
      });
    return () => {
      otkazano = true;
    };
  }, [id]);

  // Prosečna ocena: pogled ocene_knjiga je security_invoker, pa se računa od utisaka koje RLS pokazuje.
  useEffect(() => {
    let otkazano = false;
    ucitajOcenu(id)
      .then((r) => !otkazano && setOcena(r))
      .catch((e) => {
        console.error("prosečna ocena:", e);
        if (!otkazano) setOcena(null);
      });
    return () => {
      otkazano = true;
    };
  }, [id, osveziOcenu]);

  const { ucitava, knjiga, greska } = stanje;
  if (ucitava) return <p className="pt-2 text-base text-mastilo-2">{tekst.opste.ucitava}</p>;
  if (greska || !knjiga) {
    return (
      <>
        <p role="alert" className="pt-2 text-base font-medium text-bordo">
          {greska ? T.greska : T.nijeNadjena}
        </p>
        <div className="mt-3">
          <Nazad />
        </div>
      </>
    );
  }

  const prosek = prosecnaOcena(ocena);

  return (
    <>
      <Nazad />

      {/* zaglavlje: korica, naslov, autor, izdavač, prosečna ocena (prototip: .list-vrh) */}
      <div className="mt-1 flex gap-[15px]">
        <Korica knjiga={knjiga} autor={knjiga.autor} velicina="velika" />
        <div className="min-w-0 flex-1">
          <h1 className="font-naslov text-[21px] font-bold leading-[1.18] tracking-[-0.025em]">{knjiga.naslov}</h1>
          <p className="mt-[3px] text-[13.5px] text-mastilo-2">{knjiga.autor || tekst.pretraga.knjiga.bezAutora}</p>
          {(knjiga.izdavac || knjiga.godina || knjiga.zanrovi?.length > 0) && (
            <p className="mt-1.5 text-[12.5px] text-mastilo-2">{[[knjiga.izdavac, knjiga.godina].filter(Boolean).join(", "), knjiga.zanrovi?.join(", ")].filter(Boolean).join(" · ")}</p>
          )}
          <p className="mt-2" aria-label={T.ocenaNaslov}>
            {prosek ? (
              <>
                <span className="font-naslov text-[17px] font-bold tracking-[-0.03em] text-bordo">{T.ocenaVrednost.replace("{ocena}", prosek)}</span>{" "}
                <span className="text-[11.5px] tabular-nums text-mastilo-2">({T.ocenaBroj.replace("{n}", String(ocena.broj_ocena))})</span>
              </>
            ) : (
              <span className="text-sm text-mastilo-2">{ocena === undefined ? "" : T.ocenaNema}</span>
            )}
          </p>
        </div>
      </div>

      {knjiga.opis && <p className="mt-5 text-[15px] leading-relaxed text-mastilo-2">{knjiga.opis}</p>}

      {jeBibliotekar(clan?.uloga) && (
        <section className="mt-5" aria-label={T.koricaOdeljak}>
          <div className={stil.karta}>
            <KoricaIzbor
              knjigaId={knjiga.id}
              naslov={knjiga.naslov}
              korica={nasaFotografija(knjiga)}
              mozeUklanjanje
              onKorica={(adresa, izvor = "fotografija") =>
                setStanje((s) => ({ ...s, knjiga: { ...s.knjiga, korice_url: adresa, korice_izvor: izvor } }))
              }
              onUklonjena={() => setStanje((s) => ({ ...s, knjiga: { ...s.knjiga, korice_url: null, korice_izvor: null, korice_poreklo: null } }))}
            />
          </div>
        </section>
      )}

      <StanjePolice knjiga={knjiga} />

      {/* Preporuči čitaocu: povezani čitaoci (nadimci iz pogleda moje_veze), preporuka ide u tabelu preporuke */}
      <PreporuciCitaocu knjigaId={knjiga.id} />

      <Utisci knjigaId={knjiga.id} naPromenjeno={() => setOsveziOcenu((n) => n + 1)} />

      <section className="mt-7" aria-label={T.podaci}>
        <dl className={`${stil.karta} py-1`}>
          {knjiga.isbn && <Red naziv={T.isbn}>{knjiga.isbn}</Red>}
          {knjiga.signatura && <Red naziv={T.signatura}>{knjiga.signatura}</Red>}
          {jeBibliotekar(clan?.uloga) && knjiga.korice_izvor === "preuzeto" && knjiga.korice_poreklo && (
            <Red naziv={T.koricaPoreklo}>
              <a href={knjiga.korice_poreklo} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center break-all text-bordo underline">
                {new URL(knjiga.korice_poreklo).hostname.replace(/^www\./, "")}
              </a>
            </Red>
          )}
        </dl>
      </section>
    </>
  );
}

export default function Knjiga() {
  const { id } = useParams();
  // key: pri prelasku sa knjige na knjigu stanje se učitava iznova
  return <KnjigaSadrzaj key={id} id={id} />;
}
