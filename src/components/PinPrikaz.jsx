import { createPortal } from "react-dom";
import { stil } from "../lib/stil.js";
import { tekst } from "../lib/tekst.js";

const T = tekst.clanovi;

// Kartica za štampu: jedino što se štampa (index.css, @media print sakriva sve ostalo na stranici).
// Na ekranu je skrivena; ide direktno u <body> (portal), pa pravilo za štampu može da sakrije
// ostatak aplikacije bez praznih stranica od sakrivenog sadržaja.
function KarticaZaStampu({ clan, pin }) {
  return createPortal(
    <div className="stampa-kartica" aria-hidden="true">
      <div className="mx-auto w-[90mm] rounded-srednji border-2 border-bordo p-5 text-center">
        <div className="mx-auto flex size-14 items-center justify-center rounded-full border-2 border-bordo font-naslov text-base font-bold text-bordo">
          {tekst.aplikacija.godina}
        </div>
        <p className="mt-2 text-sm font-semibold">{tekst.aplikacija.ustanova}</p>
        <p className="mt-4 font-naslov text-lg font-bold text-bordo">{T.kartica.naslov}</p>
        <dl className="mt-3 space-y-2 text-left">
          <div>
            <dt className="text-xs text-mastilo-2">{T.kartica.ime}</dt>
            <dd className="text-base font-semibold">{clan.ime}</dd>
          </div>
          <div>
            <dt className="text-xs text-mastilo-2">{T.kartica.broj}</dt>
            <dd className="font-naslov text-xl font-bold tracking-[.12em]">{clan.broj_kartice}</dd>
          </div>
          <div>
            <dt className="text-xs text-mastilo-2">{T.kartica.pin}</dt>
            <dd className="font-naslov text-xl font-bold tracking-[.2em]">{pin}</dd>
          </div>
        </dl>
        <p className="mt-4 text-xs leading-snug">{T.kartica.uputstvo.replace("{naziv}", tekst.aplikacija.naziv)}</p>
      </div>
    </div>,
    document.body
  );
}

// Prikaz PIN-a posle upisa člana ili novog PIN-a. PIN postoji samo u stanju ovog ekrana: kad se
// panel zatvori, nema ga nigde (ni na serveru, ni u pregledaču). Zato je upozorenje uz njega.
export default function PinPrikaz({ nov, clan, pin, onZatvori }) {
  return (
    <section className={`${stil.karta} mt-4 border-2 border-bordo`} aria-labelledby="pin-naslov">
      <h2 id="pin-naslov" className="font-naslov text-[17px] font-bold">
        {nov ? T.pin.naslovNovi : T.pin.naslovReset}
      </h2>
      <p className="mt-1 text-sm text-mastilo-2">{T.pin.clan.replace("{ime}", clan.ime).replace("{karta}", clan.broj_kartice)}</p>

      <p className="mt-3 text-xs text-mastilo-2">{T.pin.oznaka}</p>
      <p className="font-naslov text-[34px] font-extrabold leading-tight tracking-[.18em] text-bordo">
        {pin}
      </p>
      <p className="mt-2 text-sm">{T.pin.upozorenje}</p>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <button type="button" onClick={() => window.print()} className={stil.veliko}>
          {T.pin.stampaj}
        </button>
        <button type="button" onClick={onZatvori} className={stil.tiho}>
          {T.pin.zatvori}
        </button>
      </div>
      <KarticaZaStampu clan={clan} pin={pin} />
    </section>
  );
}
