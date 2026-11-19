import { useState } from "react";
import KarticaInstalacije from "../components/KarticaInstalacije.jsx";
import { supabase } from "../lib/supabase.js";
import { useAuth } from "../lib/auth-context.js";
import { stil } from "../lib/stil.js";
import { tekst } from "../lib/tekst.js";

const NAJVISE_ZNAKOVA = 40;

function Red({ naziv, children }) {
  return (
    <div className="border-b border-linija py-3 last:border-b-0">
      <dt className="text-sm text-mastilo-2">{naziv}</dt>
      <dd className="mt-1 text-lg">{children}</dd>
    </div>
  );
}

export default function Profil() {
  const { clan, osveziClana, odjavi } = useAuth();
  const [nadimak, setNadimak] = useState(clan.nadimak ?? "");
  const [saljem, setSaljem] = useState(false);
  const [ishod, setIshod] = useState(null); // 'sacuvano' | 'nijeSacuvano'

  const unet = nadimak.trim();
  const promenjeno = unet !== (clan.nadimak ?? "");

  async function sacuvaj(e) {
    e.preventDefault();
    if (saljem || !promenjeno) return;
    setSaljem(true);
    setIshod(null);
    // RLS dozvoljava članu da menja svoj red, a okidač čuva zaštićena polja.
    const { error } = await supabase
      .from("clanovi")
      .update({ nadimak: unet || null })
      .eq("id", clan.id)
      .select("nadimak")
      .single();
    if (error) {
      setIshod("nijeSacuvano");
    } else {
      await osveziClana();
      setNadimak(unet); // polje prikazuje ono što je stvarno sačuvano (bez razmaka sa krajeva)
      setIshod("sacuvano");
    }
    setSaljem(false);
  }

  return (
    <>
      <h1 className={stil.naslov}>{tekst.profil.naslov}</h1>

      <dl className={`${stil.karta} mt-4 py-1`}>
        <Red naziv={tekst.profil.ime}>{clan.ime}</Red>
        <Red naziv={tekst.profil.kartica}>{clan.broj_kartice}</Red>
        <Red naziv={tekst.profil.sifra}>
          <span className="font-naslov text-2xl font-bold tracking-wide text-bordo">{clan.sifra_poziva}</span>
          <span className="mt-1 block text-sm text-mastilo-2">{tekst.profil.sifraPomoc}</span>
        </Red>
      </dl>

      <form onSubmit={sacuvaj} className={`${stil.karta} mt-5 space-y-3`}>
        <label htmlFor="nadimak" className="text-sm font-medium text-mastilo-2">
          {tekst.profil.nadimak}
        </label>
        <input
          id="nadimak"
          type="text"
          maxLength={NAJVISE_ZNAKOVA}
          autoComplete="nickname"
          placeholder={tekst.profil.nadimakPrazno}
          value={nadimak}
          onChange={(e) => {
            setNadimak(e.target.value);
            setIshod(null);
          }}
          className={stil.polje}
        />
        <p className="text-sm text-mastilo-2">{tekst.profil.nadimakPomoc}</p>

        {ishod && (
          <p role="status" className={`text-base font-medium ${ishod === "sacuvano" ? "text-mastilo" : "text-bordo"}`}>
            {tekst.profil[ishod]}
          </p>
        )}

        <button type="submit" disabled={saljem || !promenjeno} className={stil.veliko}>
          {saljem ? tekst.opste.sacekajte : tekst.profil.sacuvaj}
        </button>
      </form>

      <KarticaInstalacije />

      <button type="button" onClick={odjavi} className={`${stil.okvirno} mt-5`}>
        {tekst.meni.odjava}
      </button>
    </>
  );
}
