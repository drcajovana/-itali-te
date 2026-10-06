import { createContext, useContext } from "react";

// Vrednost postavlja src/components/AuthProvider.jsx.
//   sesija         undefined dok se proverava, null kad nema prijave
//   clan           red iz `clanovi` prijavljenog člana (null dok se učitava)
//   ucitava        true dok se ne zna da li je neko prijavljen i ko je
//   profilGreska   prijava postoji, ali profil nije stigao (mreža)
//   obavest        'neaktivan' kad je prijava uspela, ali članstvo nije aktivno
export const AuthContext = createContext(null);

export function useAuth() {
  const vrednost = useContext(AuthContext);
  if (!vrednost) throw new Error("useAuth se zove izvan AuthProvider-a");
  return vrednost;
}
