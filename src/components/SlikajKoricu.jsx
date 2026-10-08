import { useRef, useState } from "react";
import { postaviKoricu } from "../lib/knjige.js";
import { smanjiSliku } from "../lib/korica-slika.js";
import { tekst } from "../lib/tekst.js";

const T = tekst.korice;

// Dugme koje bira sliku, smanjuje je u pregledaču (najviše 600 px širine, webp ili jpeg), šalje
// u Storage OBIČNIM klijentom kao prijavljeni bibliotekar (ne preko service_role) i postavlja
// kao koricu knjige (korice_izvor 'fotografija').
//   kamera = true:  `capture="environment"`, na telefonu se odmah otvara kamera („Slikaj koricu”)
//   kamera = false: obična selekcija fajla; telefon sam nudi i kameru i galeriju, računar fajlove
// `staraAdresa`: korica koja se menja (briše se posle zamene).
// `glavno`: dugme je prvi korak koji se očekuje (pun pečat), inače je uz ivicu.
// `onemoguceno`: neka druga radnja je u toku; `onRadi(bool)`: javlja roditelju da slanje traje.
export default function SlikajKoricu({
  knjigaId,
  staraAdresa = null,
  onPostavljena,
  oznaka = T.slikaj,
  glavno = true,
  kamera = true,
  onemoguceno = false,
  onRadi = null,
}) {
  const ulaz = useRef(null);
  const [radi, setRadi] = useState(false);
  const [greska, setGreska] = useState(null);

  async function naIzbor(e) {
    const fajl = e.target.files?.[0];
    e.target.value = ""; // da se isti fajl može izabrati ponovo posle greške
    if (!fajl || radi || onemoguceno) return;
    setRadi(true);
    onRadi?.(true);
    setGreska(null);
    try {
      const { blob } = await smanjiSliku(fajl);
      const adresa = await postaviKoricu(knjigaId, blob, staraAdresa);
      onPostavljena(adresa, "fotografija");
    } catch (err) {
      console.error("korica:", err);
      setGreska(T.greske[err?.kod] ?? T.greske.korica_upload);
    }
    setRadi(false);
    onRadi?.(false);
  }

  return (
    <div>
      <input
        ref={ulaz}
        type="file"
        accept="image/*"
        capture={kamera ? "environment" : undefined}
        onChange={naIzbor}
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
      />
      <button
        type="button"
        disabled={radi || onemoguceno}
        onClick={() => ulaz.current?.click()}
        className={`flex min-h-12 w-full items-center justify-center rounded-lg px-5 py-3 text-xl font-semibold disabled:opacity-60 sm:w-auto ${
          glavno ? "bg-pecat text-white" : "border-2 border-pecat text-pecat"
        }`}
      >
        {radi ? T.radi : oznaka}
      </button>
      {greska && (
        <p role="alert" className="mt-2 text-base font-medium text-pecat">
          {greska}
        </p>
      )}
    </div>
  );
}
