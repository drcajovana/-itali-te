import { useState } from "react";
import { useAuth } from "../lib/auth-context.js";
import { stil } from "../lib/stil.js";
import { tekst } from "../lib/tekst.js";

const T = tekst.citaoci;

// Čitaoci (prototip, ekran Čitaoci). Ovde je za sada samo šifra za poziv člana: povezivanje
// čitalaca (pozivnice, povezani, preporuke) je sledeći korak plana, pa ostali odeljci imaju prazna
// stanja, a ne izmišljene podatke.
export default function Citaoci() {
  const { clan } = useAuth();
  const [poruka, setPoruka] = useState(null);

  async function kopiraj() {
    try {
      await navigator.clipboard.writeText(clan.sifra_poziva);
      setPoruka({ tekst: T.kopirano });
    } catch {
      setPoruka({ tekst: T.nijeKopirano, greska: true });
    }
  }

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
        {poruka && (
          <p role={poruka.greska ? "alert" : "status"} className="relative mt-2 text-sm font-medium">
            {poruka.tekst}
          </p>
        )}
      </div>
      <p className="mt-3 text-sm text-mastilo-2">{T.sifraPomoc}</p>

      <h2 className={stil.odeljak}>{T.preporuke}</h2>
      <p className="px-2 py-4 text-center text-sm text-mastilo-2">{T.nemaPreporuka}</p>

      <h2 className={stil.odeljak}>{T.povezani}</h2>
      <div className={stil.karta}>
        <p className="text-base">{T.nemaPovezanih}</p>
        <p className="mt-2 text-sm text-mastilo-2">{T.uIzradi}</p>
      </div>
    </>
  );
}
