// Ekran za bibliotekare, unos knjiga linkovima: čista logika, bez klijenta i bez
// import.meta, da se testira u `npm run test:api`.
//
// Granice (zadate): najviše 20 adresa odjednom; obrada REDOM, jedna po jedna, sa
// kratkom pauzom; nikad paralelni zahtevi; samo adrese koje je korisnik nalepio, jedna
// stranica po adresi (nikakvo „pretraživanje" kataloga izdavača).
import { redZaUpis, urediPotvrdu } from "./red-knjige.js";

export const NAJVISE_LINKOVA = 20;
export const PAUZA_MS = 1200;
export const NAJVISE_PRIMERAKA = 999;

const urediTekst = (v) => String(v ?? "").replace(/\s+/g, " ").trim();

// Tekst iz polja → adrese, jedna po redu. Prazni redovi i tačne ponovljene adrese se
// izbacuju (druga ista adresa bi samo potrošila ograničenje).
export function razdvojiLinkove(tekst) {
  const sve = String(tekst ?? "").split(/\r?\n/).map((r) => r.trim()).filter(Boolean);
  const linkovi = [...new Set(sve)];
  return { linkovi, ponovljenih: sve.length - linkovi.length, previse: linkovi.length > NAJVISE_LINKOVA };
}

// Brza provera pre ikakvog zahteva; pravu proveru (bela lista, privatne adrese...) radi server.
export const lokalnoNeispravan = (adresa) => !/^https:\/\/\S+$/i.test(adresa);

// „prepoznato": ima naslov, autora i izdavača ili ISBN; „delimično": ima bar naslov
// (npr. samo <title> stranice), pa bibliotekar dopunjuje.
export function proceniRezultat(r) {
  const naslov = urediTekst(r?.naslov);
  const imaAutora = Array.isArray(r?.autori) && r.autori.some((a) => urediTekst(a));
  const imaIzdavacaIliIsbn = Boolean(urediTekst(r?.izdavac) || r?.isbn);
  return naslov && imaAutora && imaIzdavacaIliIsbn ? "prepoznato" : "delimicno";
}

const spavaj = (ms) => new Promise((r) => setTimeout(r, ms));

// Obrada adresa REDOM. Svaki zahtev čeka da prethodni završi (await), pa paralelnih
// zahteva nema; između dva zahteva je pauza. Zaustavlja se kad pozivalac traži
// (`stop()`) ili kad server javi ograničenje (previse_zahteva): preostale adrese se
// tada ne šalju, nego se označavaju kao preskočene.
//   obradi(adresa) → rezultat ili baca grešku (sa .kod);
//   naStatus(i, status, podaci): status = trazi | prepoznato | delimicno | nije_uspelo | preskoceno
export async function obradiRedom(linkovi, { obradi, naStatus, stop = () => false, pauzaMs = PAUZA_MS, cekaj = spavaj }) {
  let prekinuto = null; // null | 'korisnik' | 'limit'
  for (let i = 0; i < linkovi.length; i++) {
    if (prekinuto || stop()) {
      prekinuto ??= "korisnik";
      naStatus(i, "preskoceno");
      continue;
    }
    naStatus(i, "trazi");
    try {
      const rezultat = await obradi(linkovi[i]);
      naStatus(i, proceniRezultat(rezultat), { rezultat });
    } catch (greska) {
      naStatus(i, "nije_uspelo", { greska });
      if (greska?.kod === "previse_zahteva") prekinuto = "limit";
    }
    if (i < linkovi.length - 1 && !prekinuto && !stop()) await cekaj(pauzaMs);
  }
  return { prekinuto };
}

// Žanrovi: odvojeni zarezom ili tačka-zarezom, najviše 5, svaki do 50 znakova.
function urediZanrove(tekst) {
  const lista = [...new Set(String(tekst ?? "").split(/[,;]/).map(urediTekst).filter(Boolean))];
  if (lista.length > 5) return { ok: false, razlog: "previse" };
  if (lista.some((z) => z.length > 50)) return { ok: false, razlog: "predugo" };
  return { ok: true, lista };
}

// Provera kartice i red za INSERT u `knjige`.
//   unos:  { naslov, autor, izdavac, godina, isbn, zanr, opis, stanje: 'fond'|'nabavka',
//            primerci, signatura }  (sve tekst, kako stoji u formi)
//   opcije: { uneoId, korica }       korica = adresa sa linka (domen je već proverio server;
//                                    baza je svakako postavlja na NULL ako domen nije na listi)
// Vraća { ok: true, podaci, red } ili { ok: false, polje, razlog }.
//
// Opis dolazi ISKLJUČIVO od bibliotekara (polje je u formi prazno): nikad se ne uzima
// sa sajta. Izvor knjige: 'fond' za „U fondu", 'link' za „Za nabavku".
export function urediUnos(unos, { uneoId = null, korica = null } = {}) {
  const osnova = urediPotvrdu(unos);
  if (!osnova.ok) return osnova;

  const zanrovi = urediZanrove(unos?.zanr);
  if (!zanrovi.ok) return { ok: false, polje: "zanr", razlog: zanrovi.razlog };

  const opis = String(unos?.opis ?? "").trim();
  if (opis.length > 2000) return { ok: false, polje: "opis", razlog: "predugo" };

  const stanje = unos?.stanje;
  if (stanje !== "fond" && stanje !== "nabavka") return { ok: false, polje: "stanje", razlog: "prazno" };

  let primerci = 0;
  let signatura = null;
  if (stanje === "fond") {
    const tekst = urediTekst(unos?.primerci);
    if (!tekst) return { ok: false, polje: "primerci", razlog: "prazno" };
    if (!/^\d{1,3}$/.test(tekst) || Number(tekst) < 1 || Number(tekst) > NAJVISE_PRIMERAKA) {
      return { ok: false, polje: "primerci", razlog: "neispravno" };
    }
    primerci = Number(tekst);
    signatura = urediTekst(unos?.signatura) || null;
    if (signatura && signatura.length > 50) return { ok: false, polje: "signatura", razlog: "predugo" };
  }

  // Osnova je ista kao za člana (red-knjige.js): naslov, autor, izdavač, godina, ISBN-13 i
  // korica sa linka. Ostalo je ono što sme samo bibliotekar (RLS i okidači to proveravaju).
  const red = {
    ...redZaUpis(osnova.podaci, "link", korica),
    zanrovi: zanrovi.lista,
    opis: opis || null,
    signatura,
    u_fondu: stanje === "fond",
    broj_primeraka: primerci,
    broj_slobodnih: primerci, // novi primerci su slobodni; zaduženja vodi COBISS
    izvor: stanje === "fond" ? "fond" : "link",
    uneo_id: uneoId,
  };
  return { ok: true, podaci: osnova.podaci, red };
}

// Adresa za „Otvori": postojeći zapis se nalazi običnom pretragom (posebne stranice knjige još nema).
export const adresaZaOtvaranje = (knjiga) => `/pretraga?upit=${encodeURIComponent(knjiga.isbn || knjiga.naslov)}`;

// Početne vrednosti kartice iz pročitanog rezultata. Opis je NAMERNO prazan: ne preuzima
// se sa sajta, piše ga bibliotekar. Stanje je podrazumevano „U fondu", 1 primerak.
export const pocetnaForma = (rezultat) => ({
  naslov: rezultat?.naslov ?? "",
  autor: (rezultat?.autori ?? []).join(", "),
  izdavac: rezultat?.izdavac ?? "",
  godina: rezultat?.godina ? String(rezultat.godina) : "",
  isbn: rezultat?.isbn ?? "",
  zanr: "",
  opis: "",
  stanje: "fond",
  primerci: "1",
  signatura: "",
});

// „1 primerak", „2 primerka", „5 primeraka", „11 primeraka", „21 primerak", „22 primerka".
export function primeraka(n) {
  const poslednja = n % 10;
  const poslednje2 = n % 100;
  const rec =
    poslednja === 1 && poslednje2 !== 11
      ? "primerak"
      : poslednja >= 2 && poslednja <= 4 && !(poslednje2 >= 12 && poslednje2 <= 14)
        ? "primerka"
        : "primeraka";
  return `${n} ${rec}`;
}
