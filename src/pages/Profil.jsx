import { useState } from "react";
import { supabase } from "../lib/supabase.js";
import { useAuth } from "../lib/auth-context.js";
import { tekst } from "../lib/tekst.js";

const NAJVISE_ZNAKOVA = 40;

function Red({ naziv, children }) {
  return (
    <div className="border-b border-ivica py-3">
      <dt className="text-base text-mastilo/70">{naziv}</dt>
      <dd className="mt-1 text-xl">{children}</dd>
    </div>
  );
}

export default function Profil() {
  const { clan, osveziClana } = useAuth();
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
      <h1 className="text-3xl font-semibold text-pecat">{tekst.profil.naslov}</h1>

      <dl className="mt-4">
        <Red naziv={tekst.profil.ime}>{clan.ime}</Red>
        <Red naziv={tekst.profil.kartica}>{clan.broj_kartice}</Red>
        <Red naziv={tekst.profil.sifra}>
          <span className="font-mono text-2xl font-semibold tracking-wide">{clan.sifra_poziva}</span>
          <span className="mt-1 block text-base text-mastilo/70">{tekst.profil.sifraPomoc}</span>
        </Red>
      </dl>

      <form onSubmit={sacuvaj} className="mt-6 space-y-3">
        <label htmlFor="nadimak" className="text-lg font-medium">
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
          className="block w-full rounded-lg border-2 border-ivica bg-white px-4 py-3 text-xl focus:border-pecat focus:outline-none"
        />
        <p className="text-base text-mastilo/70">{tekst.profil.nadimakPomoc}</p>

        {ishod && (
          <p role="status" className={`text-lg font-medium ${ishod === "sacuvano" ? "text-mastilo" : "text-pecat"}`}>
            {tekst.profil[ishod]}
          </p>
        )}

        <button
          type="submit"
          disabled={saljem || !promenjeno}
          className="block w-full rounded-lg bg-pecat px-5 py-4 text-xl font-semibold text-white disabled:opacity-50 sm:w-auto"
        >
          {saljem ? tekst.opste.sacekajte : tekst.profil.sacuvaj}
        </button>
      </form>
    </>
  );
}
