import { useId } from "react";
import { uIsbn13 } from "../lib/isbn.js";
import { stil } from "../lib/stil.js";
import { tekst } from "../lib/tekst.js";
import { adresaZaOtvaranje, primeraka } from "../lib/unos-knjiga.js";
import Korica from "./Korica.jsx";
import { izborKorice } from "../lib/korica-tok.js";
import KoricaIzbor from "./KoricaIzbor.jsx";
import KoricaPrePregled from "./KoricaPrePregled.jsx";

const T = tekst.unos;
const polje = `${stil.polje} mt-1`;

const OZNAKA_STATUSA = {
  ceka: "border border-linija",
  trazi: "border border-linija",
  prepoznato: "bg-linija",
  delimicno: "border border-linija",
  nije_uspelo: "border border-bordo text-bordo",
  preskoceno: "border border-linija text-mastilo-2",
  sacuvano: "bg-bordo text-white",
};

function Duplikati({ stavka, onDodajPrimerke, onIpak }) {
  const { duplikati, forma, saljem } = stavka;
  const stavke = [
    ...duplikati.poIsbn.map((k) => ({ k, vrsta: T.duplikat.isbn })),
    ...duplikati.poTekstu.map((k) => ({ k, vrsta: T.duplikat.slican })),
  ];
  const primerci = /^\d{1,3}$/.test(String(forma.primerci).trim()) ? Number(forma.primerci) : 0;

  return (
    <div className="mt-3 space-y-3 rounded-srednji border border-bordo p-3" role="group" aria-label={T.duplikat.naslov}>
      <h4 className="text-base font-semibold text-bordo">{T.duplikat.naslov}</h4>
      <ul className="space-y-3">
        {stavke.map(({ k, vrsta }) => (
          <li key={k.id} className="rounded-srednji border border-linija bg-pozadina p-3">
            <p className="text-base font-medium text-bordo">{vrsta}</p>
            <p className="text-base font-semibold leading-snug">{k.naslov}</p>
            <p className="text-base">{[k.autor, k.izdavac, k.godina].filter(Boolean).join(" · ")}</p>
            <p className="text-base text-mastilo-2">
              {k.u_fondu ? T.duplikat.stanjeFond.replace("{primeraka}", primeraka(k.broj_primeraka)) : T.duplikat.stanjeNije}
            </p>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <a
                href={adresaZaOtvaranje(k)}
                target="_blank"
                rel="noopener noreferrer"
                className={stil.okvirno}
              >
                {T.duplikat.otvori}
              </a>
              {forma.stanje === "fond" && (
                <button
                  type="button"
                  disabled={saljem || !primerci}
                  onClick={() => onDodajPrimerke(k)}
                  className={`${stil.pilulaPuna} flex-none disabled:opacity-50`}
                >
                  {T.duplikat.dodajPrimerke.replace("{primeraka}", primerci ? primeraka(primerci) : T.duplikat.primerkeBezBroja)}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      <button
        type="button"
        disabled={saljem}
        onClick={onIpak}
        className={`${stil.okvirno} disabled:opacity-50`}
      >
        {T.duplikat.ipak}
      </button>
    </div>
  );
}

// Jedna kartica: jedna adresa i izmenljivi podaci iz nje. Sve stanje je u roditelju
// (stavka), da „Sačuvaj sve potvrđene" vidi i ono što je bibliotekar upravo ispravio.
export default function KarticaUnosa({ stavka, onPromeni, onSacuvaj, onDodajPrimerke, onIpak, onKorica, onBezKorice, onKoricaPonovi, onSledeca, imaSledecu }) {
  const id = useId();
  const { link, status, forma, rezultat, poruka, greskaPolja, sacuvano, saljem, potvrdjeno, duplikati } = stavka;
  const prikazaniStatus = sacuvano ? "sacuvano" : status;
  const host = (() => {
    try {
      return new URL(link).hostname.replace(/^www\./, "");
    } catch {
      return link;
    }
  })();
  const imaFormu = Boolean(forma) && !sacuvano;
  const unesi = (ime) => (e) => onPromeni(ime, e.target.value);

  return (
    <li data-kartica={stavka.id} tabIndex={-1} className="rounded-srednji border border-linija bg-povrsina p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded px-2 py-0.5 text-base font-semibold ${OZNAKA_STATUSA[prikazaniStatus]}`}>{T.status[prikazaniStatus]}</span>
        <a href={link} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 min-w-0 items-center break-all text-base text-bordo underline">
          {host}
        </a>
      </div>

      {status === "nije_uspelo" && (
        <p role="alert" className="mt-2 text-base font-medium text-bordo">
          {poruka} {T.nijeUspeloPomoc}
        </p>
      )}

      {sacuvano && (
        <div className="mt-3 space-y-3">
          <div className="flex gap-3">
            <Korica
              knjiga={{ naslov: sacuvano.naslov, isbn: sacuvano.isbn, korice_url: sacuvano.korica, korice_izvor: sacuvano.korica ? "fotografija" : null }}
              autor={forma?.autor}
            />
            <p role="status" className="min-w-0 flex-1 text-base font-medium">
              {sacuvano.primerci ? T.sacuvanoPrimerci : T.sacuvano} <span className="font-semibold">{sacuvano.naslov}</span>{" "}
              <a href={adresaZaOtvaranje({ id: sacuvano.id, naslov: sacuvano.naslov, isbn: sacuvano.isbn })} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-bordo underline">
                {T.otvori}
              </a>
            </p>
          </div>

          {sacuvano.koricaStanje === "radi" && (
            <p role="status" className="text-base font-medium">
              {izborKorice(stavka) === "slika" ? tekst.korice.radi : tekst.korice.preuzimam}
            </p>
          )}
          {sacuvano.koricaStanje === "greska" && (
            <div role="alert" className="space-y-2 rounded-srednji border border-bordo p-3">
              <p className="text-base font-medium text-bordo">{tekst.korice.sacuvanaBezKorice.replace("{razlog}", sacuvano.koricaRazlog ?? "")}</p>
              <button type="button" onClick={onKoricaPonovi} className="flex min-h-12 w-full items-center justify-center rounded-full bg-bordo px-5 py-3 text-base font-semibold text-white sm:w-auto">
                {tekst.korice.ponovo}
              </button>
            </div>
          )}

          {(sacuvano.uFondu || rezultat?.korica) && (
            <KoricaIzbor
              knjigaId={sacuvano.id}
              naslov={sacuvano.naslov}
              zauzetVani={sacuvano.koricaStanje === "radi"}
              predlog={!sacuvano.korica && izborKorice(stavka) !== "preuzmi" ? (rezultat?.korica ?? null) : null}
              korica={sacuvano.korica}
              bezKorice={Boolean(sacuvano.bezKorice)}
              onKorica={onKorica}
              onBez={onBezKorice}
            />
          )}

          {imaSledecu ? (
            <button
              type="button"
              onClick={onSledeca}
              className={`flex min-h-12 w-full items-center justify-center rounded-full px-5 py-3 text-base font-semibold sm:w-auto ${
                sacuvano.uFondu && !sacuvano.korica && !sacuvano.bezKorice ? "border border-bordo text-bordo" : "bg-bordo text-white"
              }`}
            >
              {tekst.korice.sledeca}
            </button>
          ) : (
            <p className="text-base text-mastilo-2">{tekst.korice.poslednja}</p>
          )}
        </div>
      )}

      {imaFormu && (
        <div className="mt-3 flex gap-3">
          <Korica knjiga={{ naslov: forma.naslov, isbn: uIsbn13(forma.isbn) }} autor={forma.autor} />
          <div className="min-w-0 flex-1 space-y-3">
            {status === "delimicno" && <p className="text-base font-medium">{T.delimicnoPomoc}</p>}
            {[
              ["naslov", T.kartica.naslov, 300],
              ["autor", T.kartica.autori, 200],
              ["izdavac", T.kartica.izdavac, 150],
              ["godina", T.kartica.godina, 4],
              ["isbn", T.kartica.isbn, 20],
              ["zanr", T.kartica.zanr, 300],
            ].map(([ime, oznaka, najvise]) => (
              <div key={ime}>
                <label htmlFor={`${id}-${ime}`} className="text-base font-medium">
                  {oznaka}
                </label>
                <input
                  id={`${id}-${ime}`}
                  type="text"
                  inputMode={ime === "godina" ? "numeric" : undefined}
                  autoComplete="off"
                  maxLength={najvise}
                  value={forma[ime]}
                  onChange={unesi(ime)}
                  className={polje}
                />
              </div>
            ))}

            <div>
              <label htmlFor={`${id}-opis`} className="text-base font-medium">
                {T.kartica.opis}
              </label>
              <textarea id={`${id}-opis`} rows={3} maxLength={2000} value={forma.opis} onChange={unesi("opis")} className={polje} />
            </div>

            <fieldset>
              <legend className="text-base font-medium">{T.kartica.stanje}</legend>
              <div className="mt-1 flex flex-col gap-1 sm:flex-row sm:gap-6">
                {[
                  ["fond", T.kartica.uFondu],
                  ["nabavka", T.kartica.zaNabavku],
                ].map(([vrednost, oznaka]) => (
                  <label key={vrednost} className="flex min-h-11 items-center gap-3 text-base">
                    <input
                      type="radio"
                      name={`${id}-stanje`}
                      value={vrednost}
                      checked={forma.stanje === vrednost}
                      onChange={unesi("stanje")}
                      className="h-6 w-6 accent-bordo"
                    />
                    {oznaka}
                  </label>
                ))}
              </div>
            </fieldset>

            {forma.stanje === "fond" && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor={`${id}-primerci`} className="text-base font-medium">
                    {T.kartica.primerci}
                  </label>
                  <input
                    id={`${id}-primerci`}
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={3}
                    value={forma.primerci}
                    onChange={unesi("primerci")}
                    className={polje}
                  />
                </div>
                <div>
                  <label htmlFor={`${id}-signatura`} className="text-base font-medium">
                    {T.kartica.signatura}
                  </label>
                  <input
                    id={`${id}-signatura`}
                    type="text"
                    autoComplete="off"
                    maxLength={50}
                    value={forma.signatura}
                    onChange={unesi("signatura")}
                    className={polje}
                  />
                </div>
              </div>
            )}

            {rezultat?.korica ? (
              <KoricaPrePregled
                naslov={forma.naslov}
                predlog={rezultat.korica}
                izbor={izborKorice(stavka)}
                slika={stavka.slika ?? null}
                onIzbor={(izbor) => onPromeni("koricaIzbor", izbor)}
                onSlika={(slika) => {
                  onPromeni("slika", slika);
                  onPromeni("koricaIzbor", "slika");
                }}
                onemoguceno={saljem}
              />
            ) : (
              forma.stanje === "fond" && <p className="text-base text-mastilo-2">{T.kartica.koricaNapomena}</p>
            )}

            {greskaPolja && (
              <p role="alert" className="text-base font-medium text-bordo">
                {greskaPolja}
              </p>
            )}

            <label className="flex min-h-11 items-center gap-3 text-base">
              <input
                type="checkbox"
                checked={potvrdjeno}
                onChange={(e) => onPromeni("potvrdjeno", e.target.checked)}
                className="h-6 w-6 accent-bordo"
              />
              {T.kartica.potvrdjeno}
            </label>

            <button
              type="button"
              disabled={saljem}
              onClick={onSacuvaj}
              className="w-full rounded-full bg-bordo px-5 py-3 text-base font-semibold text-white disabled:opacity-60 sm:w-auto"
            >
              {saljem ? T.kartica.cuvam : T.kartica.sacuvaj}
            </button>

            {duplikati && <Duplikati stavka={stavka} onDodajPrimerke={onDodajPrimerke} onIpak={onIpak} />}
          </div>
        </div>
      )}
    </li>
  );
}
