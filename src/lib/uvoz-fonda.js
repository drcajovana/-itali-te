// Čista logika jednokratnog uvoza fonda iz CSV-a (scripts/uvezi-fond.mjs). Bez mreže i bez fajlova, da je proverava
// `npm run test:api`. Skripta samo čita CSV, čita knjige iz baze, pozove planiraj(), pa (tek sa --upisi) izvrši plan.
//
// Pravila (dogovor sa bibliotekom):
//   - svaka uvezena knjiga: izvor = 'fond', u_fondu = true; odluka_nabavke ostaje prazna (efektivno "Imamo"), uneo_id prazan;
//   - COBISS ID se NE upisuje (veza sa COBISS-om je uklonjena iz aplikacije), broj primeraka se ignoriše, opis i korice se ne uvoze;
//   - ISBN se normalizuje kao u aplikaciji i bazi (isbn.js, privatno.isbn13, migracija 0010);
//   - ista knjiga = isti ISBN I isti normalizovan naslov. Isti ISBN sa različitim naslovom su RAZLIČITE knjige (greška u
//     COBISS-u) i ne spajaju se. Bez ISBN-a: normalizovan naslov + autor + godina;
//   - postojeća knjiga se samo dopunjava (u_fondu, izvor, prazna polja), ništa popunjeno se ne prepisuje;
//   - idempotentno: posle uspešnog upisa novo planiranje daje nula novih i nula dopuna.
import { uIsbn13 } from "./isbn.js";

// Isto što i privatno.norm_tekst u bazi (migracija 0001): mala slova, ćirilica → latinica, bez kvačica.
const IZ = "\u0430\u0431\u0432\u0433\u0434\u0435\u0436\u0437\u0438\u0458\u043a\u043b\u043c\u043d\u043e\u043f\u0440\u0441\u0442\u045b\u0443\u0444\u0445\u0446\u0447\u0448\u010d\u0107\u0161\u017e"; // ćirilica i kvačice, isto kao u bazi
const U = "abvgdezzijklmnoprstcufhccsccsz";
export function normTekst(t) {
  let s = String(t ?? "").toLowerCase();
  s = s.replaceAll("\u0452", "dj").replaceAll("\u0459", "lj").replaceAll("\u045a", "nj").replaceAll("\u045f", "dz").replaceAll("\u0111", "dj");
  let r = "";
  for (const z of s) {
    const i = IZ.indexOf(z);
    r += i >= 0 ? U[i] : z;
  }
  return r;
}

// Za poređenje: normTekst, pa razmaci sabijeni i skinuti sa krajeva.
export const kljucTeksta = (t) => normTekst(String(t ?? "").normalize("NFC")).replace(/\s+/g, " ").trim();

// CSV (RFC 4180): UTF-8 sa BOM-om, CRLF ili LF, polja u navodnicima sa udvojenim navodnicima, zarez i novi red u polju.
// Vraća niz redova; svaki red je { linija, polja } (linija je broj reda u fajlu, računajući zaglavlje kao 1).
export function parsirajCsv(tekst) {
  const t = String(tekst ?? "").replace(/^\uFEFF/, "");
  const redovi = [];
  let polje = "";
  let red = [];
  let uNavodnicima = false;
  let linija = 1;
  let pocetak = 1;
  const zavrsi = () => {
    red.push(polje);
    polje = "";
    if (!(red.length === 1 && red[0] === "")) redovi.push({ linija: pocetak, polja: red });
    red = [];
  };
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (uNavodnicima) {
      if (c === '"') {
        if (t[i + 1] === '"') {
          polje += '"';
          i++;
        } else uNavodnicima = false;
      } else {
        if (c === "\n") linija++;
        polje += c;
      }
    } else if (c === '"') {
      uNavodnicima = true;
    } else if (c === ",") {
      red.push(polje);
      polje = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && t[i + 1] === "\n") i++;
      zavrsi();
      linija++;
      pocetak = linija;
    } else polje += c;
  }
  if (polje !== "" || red.length) zavrsi();
  return redovi;
}

const KOLONE = ["cobiss_id", "naslov", "autor", "izdavac", "godina", "isbn", "primeraka"];

// Zaglavlje mora da ima sve očekivane kolone (redosled nije bitan). Vraća mapu ime → indeks, ili { greska }.
export function indeksiKolona(zaglavlje) {
  const imena = (zaglavlje ?? []).map((x) => String(x).trim().toLowerCase());
  const m = {};
  for (const k of KOLONE) {
    const i = imena.indexOf(k);
    if (i < 0) return { greska: `u zaglavlju nema kolone „${k}"` };
    m[k] = i;
  }
  return m;
}

const cisto = (v) => String(v ?? "").normalize("NFC").replace(/\s+/g, " ").trim();

// Jedan red CSV-a → { ok, knjiga, upozorenja } ili { ok: false, razlog }.
// Neispravan ISBN ili godina NE odbijaju knjigu (knjiga postoji u fondu): polje se izostavlja, uz upozorenje.
export function urediRed(red, ind) {
  const naslov = cisto(red.polja[ind.naslov]);
  if (!naslov) return { ok: false, razlog: "prazan naslov" };
  const upozorenja = [];

  const sirovIsbn = cisto(red.polja[ind.isbn]);
  let isbn = null;
  if (sirovIsbn) {
    isbn = uIsbn13(sirovIsbn);
    if (!isbn) upozorenja.push(`neispravan ISBN „${sirovIsbn}": uvozi se bez ISBN-a`);
  }

  const sirovaGodina = cisto(red.polja[ind.godina]);
  let godina = null;
  if (sirovaGodina) {
    const g = Number(sirovaGodina);
    if (Number.isInteger(g) && g >= 1400 && g <= 2200) godina = g;
    else upozorenja.push(`godina „${sirovaGodina}" nije između 1400 i 2200: uvozi se bez godine`);
  }

  return {
    ok: true,
    upozorenja,
    knjiga: {
      linija: red.linija,
      cobiss_id: cisto(red.polja[ind.cobiss_id]) || null, // samo za izveštaj; u bazu se ne upisuje
      naslov,
      autor: cisto(red.polja[ind.autor]) || null,
      izdavac: cisto(red.polja[ind.izdavac]) || null,
      godina,
      isbn,
    },
  };
}

const kNaslov = (k) => kljucTeksta(k.naslov);
const kBezIsbn = (k) => `${kljucTeksta(k.naslov)}|${kljucTeksta(k.autor)}|${k.godina ?? ""}`;

// Postojeće knjige iz baze (samo matične, spojena_sa_id is null) → indeksi za poređenje.
function indeksirajBazu(postojece) {
  const poIsbn = new Map(); // isbn → [knjiga] (ISBN je jedinstven među matičnim knjigama, migracija 0026)
  const bezIsbn = new Map(); // naslov|autor|godina → [knjiga] (sve), za knjige bez ISBN-a
  const sveNaslovAutorGodina = new Map();
  const dodaj = (m, k, v) => (m.has(k) ? m.get(k).push(v) : m.set(k, [v]));
  for (const k of postojece) {
    if (k.spojena_sa_id) continue;
    if (k.isbn) dodaj(poIsbn, k.isbn, k);
    else dodaj(bezIsbn, kBezIsbn(k), k);
    dodaj(sveNaslovAutorGodina, kBezIsbn(k), k);
  }
  return { poIsbn, bezIsbn, sveNaslovAutorGodina };
}

// Šta je potrebno da postojeća knjiga postane „u fondu": dopuna samo praznih polja.
export function dopunaPostojece(post, nova) {
  const p = {};
  if (post.u_fondu !== true) p.u_fondu = true;
  if (post.izvor !== "fond") p.izvor = "fond";
  if (!post.autor && nova.autor) p.autor = nova.autor;
  if (!post.izdavac && nova.izdavac) p.izdavac = nova.izdavac;
  if (post.godina == null && nova.godina != null) p.godina = nova.godina;
  if (!post.isbn && nova.isbn) p.isbn = nova.isbn;
  return p;
}

// Red za upis nove knjige. Ništa osim ovih kolona: bez opisa, korica, cobiss_id, primeraka, uneo_id i odluke
// (odluka_nabavke ostaje prazna: knjiga u_fondu bez odluke je efektivno "Imamo").
export const redZaUpis = (k) => ({ naslov: k.naslov, autor: k.autor, izdavac: k.izdavac, godina: k.godina, isbn: k.isbn, izvor: "fond", u_fondu: true });

// Ceo plan. `redovi` su rezultat urediRed za sve redove (ili { ok: false } sa linijom), `postojece` knjige iz baze.
//   nove, dopune (po ISBN-u i naslovu), dopuneBezIsbna (po naslovu, autoru i godini kod knjige bez ISBN-a u bazi),
//   vecUFondu (poklapanje bez potrebe za izmenom), duplikatiUFajlu, odbijeni, upozorenja, spornoIsbn, viseSlucajeva,
//   saOdlukom (postojeće knjige koje postaju „u fondu", a imaju odluku nabavke različitu od „imamo": odluka se NE menja),
//   isbnRazlicitNaslov (isti ISBN u više redova CSV-a sa različitim naslovom: uvozi se samo prvi), isbnDrugiNaslovUBazi (ISBN već ima knjiga
//   sa drugim naslovom: to je ista knjiga, ne pravi se nova). ISBN je jedinstven u bazi (0026), pa se knjige uvek poklapaju po ISBN-u.
export function planiraj(unos, postojece) {
  const baza = indeksirajBazu(postojece);
  const plan = { nove: [], dopune: [], dopuneBezIsbna: [], vecUFondu: [], duplikatiUFajlu: [], odbijeni: [], upozorenja: [], viseSlucajeva: [], saOdlukom: [], isbnRazlicitNaslov: [], isbnDrugiNaslovUBazi: [] };
  const videno = new Map(); // ključ u fajlu → linija
  const videnoBezIsbn = new Map(); // naslov|autor|godina → linija (svi redovi)
  const isbnNaslovi = new Map(); // isbn → Map(naslov → linija)

  for (const u of unos) {
    if (!u.ok) {
      plan.odbijeni.push({ linija: u.linija, razlog: u.razlog, naslov: u.naslov ?? null });
      continue;
    }
    const k = u.knjiga;
    for (const w of u.upozorenja) plan.upozorenja.push({ linija: k.linija, naslov: k.naslov, tekst: w });

    // isti ISBN sa različitim naslovom u fajlu: samo se prijavljuje (prvi red se uvozi, ostali su duplikati ispod)
    if (k.isbn) {
      const m = isbnNaslovi.get(k.isbn) ?? new Map();
      if (!m.has(kNaslov(k))) m.set(kNaslov(k), k.linija);
      isbnNaslovi.set(k.isbn, m);
    }

    // ista knjiga u istom fajlu (više COBISS zapisa, npr. više primeraka): jedna; isti ISBN je ista knjiga bez obzira na naslov
    // (red bez ISBN-a je duplikat i kad ranije stoji red sa ISBN-om istog naslova, autora i godine)
    const kljucFajla = k.isbn ? `isbn|${k.isbn}` : kBezIsbn(k);
    const prva = videno.get(kljucFajla) ?? (k.isbn ? undefined : videnoBezIsbn.get(kBezIsbn(k)));
    if (prva !== undefined) {
      plan.duplikatiUFajlu.push({ linija: k.linija, naslov: k.naslov, prvaLinija: prva });
      continue;
    }
    videno.set(kljucFajla, k.linija);
    if (!videnoBezIsbn.has(kBezIsbn(k))) videnoBezIsbn.set(kBezIsbn(k), k.linija);

    // poklapanje sa bazom
    let nadjene;
    let vrsta = "dopune";
    if (k.isbn) {
      nadjene = baza.poIsbn.get(k.isbn) ?? [];
      if (nadjene.length && kNaslov(nadjene[0]) !== kNaslov(k)) plan.isbnDrugiNaslovUBazi.push({ linija: k.linija, naslov: k.naslov, naslovUBazi: nadjene[0].naslov, id: nadjene[0].id });
      if (!nadjene.length) {
        // knjiga istog naslova, autora i godine koja u bazi nema ISBN: ista knjiga, samo bez ISBN-a
        nadjene = baza.bezIsbn.get(kBezIsbn(k)) ?? [];
        vrsta = "dopuneBezIsbna";
      }
    } else {
      nadjene = baza.sveNaslovAutorGodina.get(kBezIsbn(k)) ?? [];
    }

    if (!nadjene.length) {
      plan.nove.push(k);
      continue;
    }
    if (nadjene.length > 1) plan.viseSlucajeva.push({ linija: k.linija, naslov: k.naslov, broj: nadjene.length });
    const post = nadjene[0];
    const p = dopunaPostojece(post, k);
    if (!Object.keys(p).length) {
      plan.vecUFondu.push({ linija: k.linija, naslov: k.naslov, id: post.id });
      continue;
    }
    if (p.u_fondu && post.odluka_nabavke && post.odluka_nabavke !== "imamo") plan.saOdlukom.push({ linija: k.linija, naslov: k.naslov, odluka: post.odluka_nabavke });
    plan[vrsta].push({ linija: k.linija, naslov: k.naslov, id: post.id, izmena: p });
  }

  for (const [isbn, m] of isbnNaslovi) if (m.size > 1) plan.isbnRazlicitNaslov.push({ isbn, naslovi: [...m.entries()].map(([n, l]) => ({ linija: l, kljuc: n })) });
  return plan;
}

// Plan primenjen na listu (za test idempotentnosti; skripta isto radi u bazi): vraća novu listu knjiga.
export function primeniPlanNaListu(postojece, plan) {
  const kopija = postojece.map((k) => ({ ...k }));
  let sledeci = kopija.length + 1;
  for (const d of [...plan.dopune, ...plan.dopuneBezIsbna]) Object.assign(kopija.find((k) => k.id === d.id), d.izmena);
  for (const n of plan.nove) kopija.push({ id: `nov-${sledeci++}`, spojena_sa_id: null, odluka_nabavke: null, ...redZaUpis(n) });
  return kopija;
}

export function sazetak(plan, ukupnoRedova) {
  return {
    ukupnoRedova,
    nove: plan.nove.length,
    dopune: plan.dopune.length,
    dopuneBezIsbna: plan.dopuneBezIsbna.length,
    vecUFondu: plan.vecUFondu.length,
    duplikatiUFajlu: plan.duplikatiUFajlu.length,
    odbijeni: plan.odbijeni.length,
    upozorenja: plan.upozorenja.length,
    viseSlucajeva: plan.viseSlucajeva.length,
    saOdlukom: plan.saOdlukom.length,
    isbnRazlicitNaslov: plan.isbnRazlicitNaslov.length,
    isbnDrugiNaslovUBazi: plan.isbnDrugiNaslovUBazi.length,
  };
}
