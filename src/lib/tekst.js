// Sav tekst koji korisnik vidi, na jednom mestu. Komponente ga čitaju odavde
// (`tekst.pocetna.naslov`) i nigde ne pišu natpise direktno.
//
// Ćirilični prevod se dodaje kao novi objekat pored `lat` i upisuje u
// `prevodi`, bez diranja komponenti. Ovaj fajl mora ostati običan JS bez
// uvoza — čita ga i `vite.config.js` (manifest, naslov stranice).

const lat = {
  aplikacija: {
    naziv: "Čitalište",
    ustanova: "Narodna biblioteka „Dositej Novaković” u Negotinu",
    opis: "Čitalačka platforma Narodne biblioteke „Dositej Novaković” u Negotinu",
    jezik: "sr-Latn-RS",
  },

  pocetna: {
    uIzradi: "Aplikacija je u izradi.",
  },
};

const prevodi = { lat };

export const tekst = prevodi.lat;
