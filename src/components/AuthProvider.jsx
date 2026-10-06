import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase.js";
import { AuthContext } from "../lib/auth-context.js";
import { jeIspravnaKartica, kartaUEmail, normalizujKarticu } from "../lib/kartica.js";

const KOLONE = "id, broj_kartice, ime, nadimak, uloga, aktivan, sifra_poziva";

// Greška prijave → razlog za prikaz. Pogrešna karta i pogrešan PIN su namerno
// isti razlog: Auth ih ionako vraća kao istu grešku (invalid_credentials).
function razlogGreske(error) {
  if (error.status === 429 || error.code === "over_request_rate_limit") return "previse";
  if (error.name === "AuthRetryableFetchError" || error.status === 0 || error.status >= 500) return "nemaVeze";
  return "greska";
}

async function ucitajClana(id) {
  const { data, error } = await supabase.from("clanovi").select(KOLONE).eq("id", id).maybeSingle();
  return { clan: data ?? null, greska: !!error };
}

export default function AuthProvider({ children }) {
  const [sesija, setSesija] = useState(undefined); // undefined = još se proverava
  const [profil, setProfil] = useState(null); // { id, clan, greska } za člana čiji je profil poslednji stigao
  const [obavest, setObavest] = useState(null);

  useEffect(() => {
    let otkazano = false;
    supabase.auth.getSession().then(({ data }) => {
      if (!otkazano) setSesija(data.session ?? null);
    });
    // U callback-u se ne zovu druge Supabase metode (može da zaglavi Auth);
    // samo se pamti sesija, a profil učitava efekat niže.
    const { data } = supabase.auth.onAuthStateChange((_dogadjaj, nova) => setSesija(nova ?? null));
    return () => {
      otkazano = true;
      data.subscription.unsubscribe();
    };
  }, []);

  const proverava = sesija === undefined;
  const idClana = sesija?.user?.id ?? null;

  useEffect(() => {
    if (!idClana) return;
    let otkazano = false;
    ucitajClana(idClana).then(async ({ clan, greska }) => {
      if (otkazano) return;
      if (!greska && (!clan || !clan.aktivan)) {
        // Prijava je uspela, ali članstvo ne postoji ili nije aktivno
        // (plan, tačka 3: nalog postoji samo ako je članstvo aktivno).
        setObavest("neaktivan");
        setProfil({ id: idClana, clan: null, greska: false });
        await supabase.auth.signOut();
        return;
      }
      setProfil({ id: idClana, clan, greska });
    });
    return () => {
      otkazano = true;
    };
  }, [idClana]);

  // Stanje se izvodi, ne postavlja sinhrono iz efekta: profil „važi" samo ako je
  // za člana koji je trenutno prijavljen.
  const profilStigao = idClana !== null && profil?.id === idClana;
  const ucitava = proverava || (idClana !== null && !profilStigao);
  const clan = profilStigao ? profil.clan : null;
  const profilGreska = profilStigao && profil.greska;

  const prijavi = useCallback(async (unosKartice, pin) => {
    const kartica = normalizujKarticu(unosKartice);
    if (!kartica || !pin) return { ok: false, razlog: "prazno" };
    // Neispravan oblik se ne šalje na server, a odgovor je isti kao za pogrešne podatke.
    if (!jeIspravnaKartica(kartica)) return { ok: false, razlog: "greska" };
    const { error } = await supabase.auth.signInWithPassword({ email: kartaUEmail(kartica), password: pin });
    return error ? { ok: false, razlog: razlogGreske(error) } : { ok: true };
  }, []);

  const odjavi = useCallback(() => supabase.auth.signOut(), []);

  const osveziClana = useCallback(async () => {
    if (!idClana) return;
    const { clan: novi, greska } = await ucitajClana(idClana);
    setProfil({ id: idClana, clan: novi, greska });
  }, [idClana]);

  const ocistiObavest = useCallback(() => setObavest(null), []);

  const vrednost = useMemo(
    () => ({ sesija, clan, ucitava, profilGreska, obavest, prijavi, odjavi, osveziClana, ocistiObavest }),
    [sesija, clan, ucitava, profilGreska, obavest, prijavi, odjavi, osveziClana, ocistiObavest]
  );

  return <AuthContext.Provider value={vrednost}>{children}</AuthContext.Provider>;
}
