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
    unos: "Unos knjiga",
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
      koricaAlt: "Korica knjige „{naslov}”",
      koricaAltAutor: "Korica knjige „{naslov}”, autor: {autor}",
      detalji: "Detalji",
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

    // Pre dodavanja spoljne knjige član vidi izmenljiva polja; upis ide tek na dugme.
    potvrda: {
      naslov: "Proverite podatke pre dodavanja",
      uvodGoogle:
        "Ovo su podaci koje smo našli na Google Books. Ispravite ih ako treba. Trajno se čuva samo ono što ovde potvrdite: naslov, autor, izdavač, godina i ISBN. Opis i korica sa Google Books se ne čuvaju.",
      uvodLink:
        "Ovo su podaci sa stranice koju ste zalepili. Ispravite ih ako treba. Trajno se čuva samo ono što ovde potvrdite: naslov, autor, izdavač, godina i ISBN. Opis i slika sa tog sajta se ne čuvaju.",
      polja: {
        naslov: "Naslov",
        autor: "Autor (ili autori)",
        izdavac: "Izdavač",
        godina: "Godina izdanja",
        isbn: "ISBN",
      },
      potvrdi: "Potvrdi i dodaj na policu",
      odustani: "Odustani",
      greske: {
        naslov_prazno: "Upišite naslov.",
        godina_neispravno: "Godina mora da ima 4 cifre (od 1400 do 2200).",
        isbn_neispravno: "ISBN nije ispravan. Proverite cifre ili obrišite polje.",
        predugo: "Neko polje je predugačko.",
      },
    },

    greske: {
      nije_prijavljen: "Sesija je istekla. Prijavite se ponovo.",
      clanstvo_nije_aktivno: "Vaše članstvo nije aktivno. Javite se bibliotekaru.",
      previse_zahteva: "Previše pretraga u poslednjih sat vremena. Pokušajte ponovo za {minuta} min.",
      izmenjeno_u_medjuvremenu: "Zapis je u međuvremenu promenjen. Proverite ga ponovo.",
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
      nije_bibliotekar: "Koricu sa linka može da preuzme samo bibliotekar.",
      nije_slika: "Ova adresa ne vodi do slike.",
      prevelika_slika: "Slika je prevelika (najviše 1.5 MB).",
      slika_nije_podrzana: "Dozvoljene su samo jpeg, png i webp slike.",
      knjiga_ne_postoji: "Ova knjiga ne postoji u bazi.",
      cuvanje_slike_nije_uspelo: "Slika nije sačuvana. Pokušajte ponovo.",
      neispravan_isbn: "ISBN nije ispravan.",
      prazan_upit: "Upišite naslov, autora ili ISBN.",
      neispravan_upit: "Upit nije ispravan.",
      greska_servera: "Nešto je pošlo naopako. Pokušajte ponovo.",
    },
  },

  // Ekran za bibliotekare: unos knjiga linkovima (/bibliotekar/unos).
  unos: {
    naslov: "Unos knjiga linkovima",
    uvod: "Nalepite adrese knjiga sa sajtova izdavača, jednu u svakom redu (najviše 20). Obrađuju se jedna po jedna, redom, a za svaku se čita samo ta jedna stranica. Opis se ne preuzima: njega piše bibliotekar. Koricu slikate telefonom čim sačuvate knjigu.",
    polje: "Adrese knjiga (jedna u svakom redu)",
    procitaj: "Pročitaj adrese",
    citam: "Čitam adrese…",
    prekini: "Prekini obradu",
    obradjeno: "Obrađeno {n} od {ukupno}.",
    prekinuto: "Obrada je prekinuta. Preostale adrese nisu poslate.",
    ogranicenje: "Dostignut je dozvoljeni broj zahteva na sat. Preostale adrese nisu obrađene. Pokušajte ponovo za {minuta} min.",
    ponovljene: "Ponovljene adrese su izbačene: {n}.",
    greske: {
      prazno: "Nalepite bar jednu adresu.",
      previse: "Najviše 20 adresa odjednom. Ostavite prvih 20 u polju, ostale unesite posle.",
    },
    status: {
      ceka: "Čeka",
      trazi: "Čitam…",
      prepoznato: "Prepoznato",
      delimicno: "Delimično",
      nije_uspelo: "Nije uspelo",
      preskoceno: "Preskočeno",
      sacuvano: "Sačuvano",
    },
    delimicnoPomoc: "Nije pronađeno sve. Proverite i dopunite podatke.",
    nijeUspeloPomoc: "Ručni unos je na ekranu „Pretraga”.",

    kartica: {
      naslov: "Naslov",
      autori: "Autor (ili autori)",
      izdavac: "Izdavač",
      godina: "Godina izdanja",
      isbn: "ISBN",
      zanr: "Žanr (više njih odvojite zarezom)",
      opis: "Opis (piše bibliotekar; ne preuzima se sa sajta)",
      stanje: "Stanje",
      uFondu: "U fondu",
      zaNabavku: "Za nabavku",
      primerci: "Broj primeraka",
      signatura: "Signatura (po želji)",
      potvrdjeno: "Potvrđeno, uključi u „Sačuvaj sve”",
      sacuvaj: "Sačuvaj",
      cuvam: "Čuvam…",
      koricaNapomena: "Koricu slikate čim sačuvate knjigu (samo za knjige u fondu).",
    },

    sacuvajSve: {
      dugme: "Sačuvaj sve potvrđene ({n})",
      nema: "Nijedna kartica nije označena kao potvrđena.",
      zbir: "Sačuvano: {n}. Čeka vašu odluku (već postoji ili ima grešku): {m}.",
    },

    sacuvano: "Sačuvano u bazu.",
    sacuvanoPrimerci: "Broj primeraka je povećan.",
    otvori: "Otvori",

    duplikat: {
      naslov: "Ova knjiga već postoji u bazi",
      isbn: "Isti ISBN",
      slican: "Sličan naslov i autor",
      otvori: "Otvori",
      dodajPrimerke: "Dodaj {primeraka} ovom zapisu",
      ipak: "Ipak sačuvaj kao novi zapis",
      stanjeFond: "U fondu: {primeraka}",
      stanjeNije: "Nije u fondu",
      izmenjeno: "Zapis je u međuvremenu promenjen. Proverite ga ponovo.",
    },

    greskeKartice: {
      naslov_prazno: "Upišite naslov.",
      godina_neispravno: "Godina mora da ima 4 cifre (od 1400 do 2200).",
      isbn_neispravno: "ISBN nije ispravan. Proverite cifre ili obrišite polje.",
      zanr_previse: "Najviše 5 žanrova.",
      zanr_predugo: "Žanr je predugačak.",
      opis_predugo: "Opis je predugačak (najviše 2000 znakova).",
      primerci_prazno: "Upišite broj primeraka.",
      primerci_neispravno: "Broj primeraka mora biti ceo broj od 1 do 999.",
      signatura_predugo: "Signatura je predugačka.",
      predugo: "Neko polje je predugačko.",
      upis: "Nije sačuvano. Pokušajte ponovo.",
    },
  },

  // Fotografije korica (dugme „Slikaj koricu", brzi tok „Sledeća knjiga").
  korice: {
    slikaj: "Slikaj koricu",
    zameni: "Zameni koricu",
    radi: "Šaljem sliku…",
    koristi: "Koristi ovu koricu",
    preuzimam: "Preuzimam koricu sa sajta…",
    izaberi: "Izaberi sliku sa računara ili telefona",
    bez: "Bez korice",
    bezOdluka: "Knjiga ostaje bez korice.",
    predomislio: "Predomislio sam se",
    predlog: "Predložena korica sa sajta",
    predlogNapomena: "Slika se u našu bazu kopira tek kad izaberete „Koristi ovu koricu”.",
    predlogNijeUcitan: "Sliku sa sajta ne mogu da prikažem. Server je možda ipak može da preuzme.",
    predlogAlt: "Predložena korica sa sajta za knjigu „{naslov}”",
    ukloni: "Ukloni koricu",
    ukloniPitanje: "Ukloniti koricu? Slika se briše iz baze.",
    ukloniDa: "Da, ukloni",
    ukloniNe: "Ne, ostavi",
    uklanjam: "Uklanjam koricu…",
    uklonjena: "Korica je uklonjena.",
    uklonjenaBezFajla: "Korica je uklonjena, ali fajl nije obrisan iz baze (javite administratoru).",
    sacuvana: "Korica je sačuvana.",
    sledeca: "Sledeća knjiga",
    poslednja: "Nema više knjiga koje čekaju. Za nove nalepite adrese.",
    greske: {
      slika_tip: "Ovo nije slika u dozvoljenom obliku (jpeg, png ili webp). Izaberite fotografiju.",
      slika_velika: "Slika je prevelika. Snimite je ponovo ili izaberite manju.",
      nema_dozvole: "Nemate dozvolu da menjate korice. Prijavite se kao bibliotekar.",
      slika_neispravna: "Ne mogu da otvorim ovu sliku. Snimite je ponovo.",
      korica_upload: "Slika nije poslata. Proverite internet i pokušajte ponovo.",
      korica_upis: "Korica nije sačuvana. Pokušajte ponovo.",
      korica_nije_prihvacena: "Korica nije prihvaćena. Obavestite administratora.",
      knjiga_neispravna: "Knjiga nije ispravna. Osvežite stranicu.",
    },
  },

  // Stranica jedne knjige (/knjiga/:id).
  knjigaEkran: {
    nazad: "Nazad na pretragu",
    nijeNadjena: "Ove knjige nema.",
    greska: "Ne mogu da učitam knjigu. Proverite internet i pokušajte ponovo.",
    koricaOdeljak: "Korica",
    izdavac: "Izdavač i godina",
    godina: "Godina izdanja",
    isbn: "ISBN",
    zanrovi: "Žanr",
    primerci: "Primerci",
    primerciVrednost: "{ukupno}, slobodnih: {slobodnih}",
    signatura: "Signatura",
    koricaPoreklo: "Korica preuzeta sa",
    opis: "Opis",
  },

  zasticeno: {
    profilGreska: "Ne mogu da učitam vaš profil.",
    profilGreskaPomoc: "Proverite internet pa pokušajte ponovo, ili se odjavite.",
    ponovo: "Pokušaj ponovo",
  },
};

const prevodi = { lat };

export const tekst = prevodi.lat;
