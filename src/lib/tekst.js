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

  opste: {
    ucitava: "Učitavanje…",
    sacekajte: "Sačekajte…",
  },

  meni: {
    pocetna: "Početna",
    pretraga: "Pretraga",
    profil: "Moj profil",
    odjava: "Odjavi se",
  },

  prijava: {
    naslov: "Prijava",
    uvod: "Prijavite se brojem članske karte i PIN-om.",
    kartica: "Broj članske karte",
    pin: "PIN",
    prikaziPin: "Prikaži PIN",
    sakrijPin: "Sakrij PIN",
    dugme: "Prijavi se",
    pomoc: "PIN ste dobili od bibliotekara. Ako ste ga zaboravili ili nemate nalog, javite se bibliotekaru.",
    // Isto za pogrešnu kartu i pogrešan PIN — da se ne sazna koje karte postoje.
    greske: {
      prazno: "Upišite broj karte i PIN.",
      greska: "Broj karte ili PIN nisu tačni.",
      nemaVeze: "Ne mogu da se povežem sa serverom. Proverite internet i pokušajte ponovo.",
      previse: "Previše pokušaja. Sačekajte nekoliko minuta pa pokušajte ponovo.",
    },
    neaktivan: "Vaše članstvo nije aktivno. Javite se bibliotekaru.",
  },

  pocetna: {
    pozdrav: "Dobro došli",
    uIzradi: "Aplikacija je u izradi.",
    trazi: "Potražite knjigu",
  },

  profil: {
    naslov: "Moj profil",
    ime: "Ime i prezime",
    nadimak: "Nadimak za prikaz",
    nadimakPomoc: "Ovo ime vide drugi čitaoci. Možete ga promeniti kad god hoćete.",
    nadimakPrazno: "Nije upisan",
    kartica: "Broj članske karte",
    sifra: "Vaša šifra za poziv",
    sifraPomoc:
      "Ovu šifru dajete samo osobama koje želite da povežete sa sobom. Bez nje vas niko ne može naći.",
    sacuvaj: "Sačuvaj nadimak",
    sacuvano: "Nadimak je sačuvan.",
    nijeSacuvano: "Nadimak nije sačuvan. Pokušajte ponovo.",
  },

  pretraga: {
    naslov: "Pretraga knjiga",
    uvod: "Upišite naslov, autora ili ISBN.",
    polje: "Naslov, autor ili ISBN",
    dugme: "Traži",
    trazi: "Tražim…",
    prekratko: "Upišite bar dva slova.",

    nase: {
      naslov: "U našoj biblioteci",
      nema: "Nema takve knjige u našoj bazi.",
    },

    knjiga: {
      slobodna: "Slobodna je",
      izdata: "Trenutno je izdata",
      nijeUFondu: "Nije u fondu biblioteke",
      sa: "Izvor",
      googleBooks: "Google Books",
      saLinka: "Sa linka",
      pogledaj: "Pogledaj na Google Books",
      godina: "godina",
      bezAutora: "Autor nije poznat",
      koricaZa: "Korica knjige",
    },

    google: {
      naslov: "Na internetu (Google Books)",
      uvod: "Nema je kod nas? Potražite je na internetu.",
      dugme: "Traži na Google Books",
      nema: "Google Books nema ništa za ovaj upit.",
    },

    link: {
      naslov: "Zalepite link",
      uvod: "Imate adresu knjige sa sajta izdavača? Zalepite je i pročitaćemo podatke.",
      polje: "Adresa knjige (počinje sa https://)",
      dugme: "Pročitaj link",
      nema: "Sa ove stranice nisam uspeo da pročitam knjigu. Upišite je ručno.",
    },

    rucno: {
      naslov: "Ne nalazite je? Upišite sami",
      uvod: "Upišite naslov i autora. Knjiga ide na vašu policu, a biblioteka vidi da ste je tražili.",
      naslovPolje: "Naslov",
      autorPolje: "Autor",
      dugme: "Dodaj na moju policu",
      obavezno: "Upišite i naslov i autora.",
    },

    polica: {
      dodajKao: "Dodaj kao",
      citam: "Čitam",
      procitano: "Pročitano",
      zelim: "Želim da pročitam",
      dodaj: "Dodaj na policu",
      dodato: "Dodato na vašu policu.",
      dodatoNijeUFondu: "Dodato na vašu policu. Ove knjige nema u fondu; biblioteka će videti da ste je tražili.",
      nijeDodato: "Nije dodato. Pokušajte ponovo.",
    },

    greske: {
      nije_prijavljen: "Sesija je istekla. Prijavite se ponovo.",
      clanstvo_nije_aktivno: "Vaše članstvo nije aktivno. Javite se bibliotekaru.",
      previse_zahteva: "Previše pretraga u poslednjih sat vremena. Pokušajte ponovo za {minuta} min.",
      mreza: "Ne mogu da se povežem. Proverite internet i pokušajte ponovo.",
      api_nedostupan: "Pretraga na internetu ovde nije dostupna.",
      google_nije_podeseno: "Pretraga na Google Books trenutno nije podešena. Obavestite bibliotekara.",
      google_zauzet: "Google Books je trenutno zauzet. Pokušajte kasnije.",
      google_greska: "Google Books ne odgovara. Pokušajte kasnije.",
      predugo: "Odgovor predugo traje. Pokušajte ponovo.",
      neispravan_link: "Ova adresa nije ispravna.",
      nije_https: "Adresa mora da počinje sa https://.",
      domen_nije_dozvoljen: "Sa ovog sajta ne mogu da čitam knjige. Upišite je ručno.",
      preusmerenje_van_liste: "Ovaj link vodi na sajt sa kog ne mogu da čitam knjige. Upišite je ručno.",
      previse_preusmeravanja: "Ovaj link ne mogu da otvorim. Upišite knjigu ručno.",
      ne_mogu_da_procitam: "Ne mogu da otvorim ovaj link. Upišite knjigu ručno.",
      nije_stranica: "Ovaj link nije stranica knjige. Upišite je ručno.",
      prevelika_stranica: "Ova stranica je prevelika. Upišite knjigu ručno.",
      nema_podataka: "Na ovoj stranici nema podataka o knjizi. Upišite je ručno.",
      neispravan_isbn: "ISBN nije ispravan.",
      prazan_upit: "Upišite naslov, autora ili ISBN.",
      neispravan_upit: "Upit nije ispravan.",
      greska_servera: "Nešto je pošlo naopako. Pokušajte ponovo.",
    },
  },

  zasticeno: {
    profilGreska: "Ne mogu da učitam vaš profil.",
    profilGreskaPomoc: "Proverite internet pa pokušajte ponovo, ili se odjavite.",
    ponovo: "Pokušaj ponovo",
  },
};

const prevodi = { lat };

export const tekst = prevodi.lat;
