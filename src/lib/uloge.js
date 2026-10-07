// Uloge u interfejsu. Ovo je samo udobnost (sakriven meni, preusmeravanje): prava
// stvarno proveravaju RLS i okidači u bazi, a ograničenja api/ funkcija čitaju ulogu
// na serveru iz baze. Nikad se na ovo ne oslanja bezbednost.
export const jeBibliotekar = (uloga) => uloga === "bibliotekar" || uloga === "administrator";
