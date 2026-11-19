import { usePwa } from "../lib/pwa-hook.js";
import { primeniNovuVerziju } from "../lib/pwa.js";
import { tekst } from "../lib/tekst.js";

// Dve trake iznad donje navigacije, na svim ekranima (i na prijavi): „Нема везе са интернетом" dok
// pregledač javlja da mreže nema, i „Нова верзија је спремна — Освежи" kad Service Worker ima novu verziju.
// Same ne menjaju ništa: nova verzija se primenjuje tek na dodir, da se ne izgubi uneto u polju.
export default function TrakeLjuske() {
  const { bezVeze, novaVerzija } = usePwa();
  if (!bezVeze && !novaVerzija) return null;

  return (
    <div className="fixed inset-x-0 bottom-[calc(88px+env(safe-area-inset-bottom))] z-50 mx-auto flex max-w-[520px] flex-col gap-2 px-4">
      {bezVeze && (
        <p role="status" className="rounded-srednji bg-mastilo px-4 py-3 text-sm text-white shadow-senka">
          <span className="block font-semibold">{tekst.mreza.nemaVeze}</span>
          <span className="block opacity-80">{tekst.mreza.nemaVezePomoc}</span>
        </p>
      )}
      {novaVerzija && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-srednji bg-bordo py-2 pl-4 pr-2 text-sm text-white shadow-senka">
          <span className="font-semibold">{tekst.verzija.spremna}</span>
          <button type="button" onClick={primeniNovuVerziju} className="flex min-h-11 items-center rounded-full bg-white px-5 text-sm font-semibold text-bordo">
            {tekst.verzija.osvezi}
          </button>
        </div>
      )}
    </div>
  );
}
