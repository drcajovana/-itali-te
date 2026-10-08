import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Korica from "../components/Korica.jsx";
import KoricaIzbor from "../components/KoricaIzbor.jsx";
import { useAuth } from "../lib/auth-context.js";
import { ucitajKnjigu } from "../lib/knjige.js";
import { nasaFotografija } from "../lib/korica-slika.js";
import { tekst } from "../lib/tekst.js";
import { primeraka } from "../lib/unos-knjiga.js";
import { jeBibliotekar } from "../lib/uloge.js";

const T = tekst.knjigaEkran;

function Red({ naziv, children }) {
  return (
    <div className="border-b border-ivica py-2">
      <dt className="text-base text-mastilo/70">{naziv}</dt>
      <dd className="mt-0.5 text-lg">{children}</dd>
    </div>
  );
}

function KnjigaSadrzaj({ id }) {
  const { clan } = useAuth();
  const [stanje, setStanje] = useState({ ucitava: true, knjiga: null, greska: false });

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

  const { ucitava, knjiga, greska } = stanje;
  if (ucitava) return <p className="text-lg text-mastilo/70">{tekst.opste.ucitava}</p>;
  if (greska || !knjiga) {
    return (
      <>
        <p role="alert" className="text-lg font-medium text-pecat">
          {greska ? T.greska : T.nijeNadjena}
        </p>
        <Link to="/pretraga" className="mt-3 inline-flex min-h-11 items-center text-lg text-pecat underline">
          {T.nazad}
        </Link>
      </>
    );
  }

  const dostupnost = knjiga.u_fondu
    ? knjiga.broj_slobodnih > 0
      ? tekst.pretraga.knjiga.slobodna
      : tekst.pretraga.knjiga.izdata
    : tekst.pretraga.knjiga.nijeUFondu;

  return (
    <>
      <Link to="/pretraga" className="inline-flex min-h-11 items-center text-lg text-pecat underline">
        {T.nazad}
      </Link>
      <div className="mt-2 flex gap-4">
        <Korica knjiga={knjiga} autor={knjiga.autor} velicina="velika" />
        <div className="min-w-0 flex-1">
          <h1 className="text-3xl font-semibold leading-tight text-pecat">{knjiga.naslov}</h1>
          <p className="mt-1 text-xl">{knjiga.autor || tekst.pretraga.knjiga.bezAutora}</p>
          <p className={`mt-2 inline-block rounded px-2 py-0.5 text-base font-medium ${knjiga.u_fondu ? "bg-ivica" : "border border-ivica"}`}>{dostupnost}</p>
        </div>
      </div>

      {jeBibliotekar(clan?.uloga) && (
        <section className="mt-4" aria-label={T.koricaOdeljak}>
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
        </section>
      )}

      <dl className="mt-4">
        {knjiga.izdavac && <Red naziv={T.izdavac}>{[knjiga.izdavac, knjiga.godina].filter(Boolean).join(", ")}</Red>}
        {!knjiga.izdavac && knjiga.godina && <Red naziv={T.godina}>{knjiga.godina}</Red>}
        {knjiga.isbn && <Red naziv={T.isbn}>{knjiga.isbn}</Red>}
        {knjiga.zanrovi?.length > 0 && <Red naziv={T.zanrovi}>{knjiga.zanrovi.join(", ")}</Red>}
        {knjiga.u_fondu && <Red naziv={T.primerci}>{T.primerciVrednost.replace("{ukupno}", primeraka(knjiga.broj_primeraka)).replace("{slobodnih}", String(knjiga.broj_slobodnih))}</Red>}
        {knjiga.signatura && <Red naziv={T.signatura}>{knjiga.signatura}</Red>}
        {jeBibliotekar(clan?.uloga) && knjiga.korice_izvor === "preuzeto" && knjiga.korice_poreklo && (
          <Red naziv={T.koricaPoreklo}>
            <a href={knjiga.korice_poreklo} target="_blank" rel="noopener noreferrer" className="break-all text-pecat underline">
              {new URL(knjiga.korice_poreklo).hostname.replace(/^www\./, "")}
            </a>
          </Red>
        )}
      </dl>

      {knjiga.opis && (
        <section className="mt-4">
          <h2 className="text-xl font-semibold">{T.opis}</h2>
          <p className="mt-1 whitespace-pre-line text-lg">{knjiga.opis}</p>
        </section>
      )}
    </>
  );
}

export default function Knjiga() {
  const { id } = useParams();
  // key: pri prelasku sa knjige na knjigu stanje se učitava iznova
  return <KnjigaSadrzaj key={id} id={id} />;
}
