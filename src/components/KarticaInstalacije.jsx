import { useState } from "react";
import { nacinInstalacije } from "../lib/pwa-logika.js";
import { usePwa } from "../lib/pwa-hook.js";
import { instaliraj } from "../lib/pwa.js";
import { stil } from "../lib/stil.js";
import { tekst } from "../lib/tekst.js";

const T = tekst.instalacija;

// Kartica na Profilu: „Инсталирај апликацију". Chrome/Android: pravo dugme (beforeinstallprompt).
// iPhone/iPad: Safari to ne podržava, pa kratko uputstvo „Подели → Додај на почетни екран".
// Već instalirana aplikacija (ili pregledač bez instalacije): kartice nema.
export default function KarticaInstalacije() {
  const pwa = usePwa();
  const [odbijeno, setOdbijeno] = useState(false);
  const nacin = nacinInstalacije(pwa);

  async function klik() {
    const ishod = await instaliraj();
    if (ishod === "dismissed") setOdbijeno(true);
  }

  if (nacin === "nista" && !odbijeno) return null;

  return (
    <section className={`${stil.karta} mt-5 space-y-3`} aria-label={T.naslov}>
      <h2 className="font-naslov text-[17px] font-bold">{nacin === "uputstvo" ? T.iosNaslov : T.naslov}</h2>
      {nacin === "dugme" && (
        <>
          <p className="text-sm text-mastilo-2">{T.opis}</p>
          <button type="button" onClick={klik} className={stil.veliko}>
            {T.dugme}
          </button>
        </>
      )}
      {nacin === "uputstvo" && <p className="text-sm text-mastilo-2">{T.ios}</p>}
      {odbijeno && (
        <p role="status" className="text-sm font-medium">
          {T.odbijeno}
        </p>
      )}
    </section>
  );
}
