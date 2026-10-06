// Test RLS-a: proverava STVARNO ponašanje baze, pod stvarnim prijavama.
//
// Pokretanje (ključeve učitava Node iz .env, skripta ih nikad ne ispisuje):
//   npm run test:rls
//
// Piše u bazu na koju pokazuje .env: pravi naloge rls-test-*@citaliste.test i
// knjige čiji naslov počinje sa "RLS-TEST", pa sve briše u finally bloku. Može
// da se pokreće više puta; ostatke prekinutog pokretanja čisti na početku.
//
// Svaka "negativna" provera (nešto ne sme da se vidi / uradi) ima pozitivnu
// kontrolu (nešto drugo MORA da se vidi), da PASS ne bude prazan: bez toga bi
// pokvarena prijava ili prazna tabela dala PASS na svaku proveru.
//
// Napomena: ovo je skripta, ne aplikacija, pa pravi više Supabase klijenata
// (jedan po nalogu). Pravilo "singleton u src/lib/supabase.js" važi za
// aplikaciju, gde bi duplirani klijent dupliran Auth sesiju.

import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { kartaUEmail, normalizujKarticu } from "../src/lib/kartica.js";

// ───────────────────────── okruženje ─────────────────────────

const URL_ = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
const ANON = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

const nedostaje = [
  !URL_ && "VITE_SUPABASE_URL",
  !ANON && "VITE_SUPABASE_ANON_KEY",
  !SERVICE && "SUPABASE_SERVICE_ROLE_KEY",
].filter(Boolean);
if (nedostaje.length) {
  console.error(`Nedostaju promenljive u .env: ${nedostaje.join(", ")}`);
  process.exit(2);
}

// Ništa što liči na ključ ne sme da dospe u izlaz, ni kroz poruku o grešci.
const TAJNE = [ANON, SERVICE].filter(Boolean);
const bezTajni = (t) => TAJNE.reduce((s, k) => s.split(k).join("***"), String(t ?? ""));

const OPCIJE = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const noviKlijent = (kljuc) => createClient(URL_, kljuc, OPCIJE);

const S = noviKlijent(SERVICE); // service_role — samo priprema, provera stanja i čišćenje
const anon = noviKlijent(ANON);

const RUN = randomUUID().slice(0, 8);
const N = (s) => `RLS-TEST ${RUN} ${s}`;
// rls-test-*@citaliste.test: nalozi pripreme; rlstest-*@citaliste.local: nalog za
// proveru prijave, čija je adresa izvedena iz broja karte kao u aplikaciji.
const OBRAZAC_EMAIL = /^(rls-test-.+@citaliste\.test|rlstest-.+@citaliste\.local)$/;
const NEPOSTOJECA_SIFRA = "NEG·0000·AA"; // generator ne pravi 0000 (od 1000 do 9999)

// ───────────────────────── ispis i brojanje ─────────────────────────

let pass = 0;
let fail = 0;

function izvesti(ok, naziv, detalj) {
  if (ok) {
    pass++;
    console.log(`PASS  ${bezTajni(naziv)}`);
  } else {
    fail++;
    console.log(`FAIL  ${bezTajni(naziv)}`);
    if (detalj) console.log(`        -> ${bezTajni(detalj).slice(0, 400)}`);
  }
}

// fn vraća true kad je sve kako treba, a tekst (zašto nije) kad nije.
async function provera(naziv, fn) {
  try {
    const r = await fn();
    izvesti(r === true, naziv, r === true ? undefined : typeof r === "string" ? r : JSON.stringify(r));
  } catch (e) {
    izvesti(false, naziv, `izuzetak u testu: ${e?.message ?? e}`);
  }
}

const faza = (naslov) => console.log(`\n── ${naslov}`);

// ───────────────────────── pomoćne ─────────────────────────

const opis = (r) => (r.error ? `greška ${r.error.code}: ${r.error.message}` : `${r.data?.length ?? 0} redova`);
const vidi = (db, tabela, f) => {
  const q = db.from(tabela).select("*");
  return f ? f(q) : q;
};
const tacno = (r, n, sta) => (!r.error && r.data.length === n ? true : `${sta}: očekivano ${n}, dobijeno ${opis(r)}`);
const nistaNeVidi = (r, sta) => tacno(r, 0, sta);

function mora(r, sta) {
  if (r.error) throw new Error(`${sta}: ${r.error.message}`);
  return r.data;
}

// Funkcija "nije dostupna": nije izvršena (nema prava ili je nema u API-ju).
// Greška koju baca sama funkcija (P0001) znači da je IZVRŠENA — to je FAIL.
const nedostupna = (r) =>
  !!r.error &&
  (r.error.code === "42501" ||
    r.error.code === "PGRST202" ||
    /permission denied|could not find the function/i.test(r.error.message ?? ""));

const potpisGreske = (r) =>
  JSON.stringify([r.error?.code, r.error?.message, r.error?.details, r.error?.hint, r.status]);

async function stanje(tabela, id) {
  const r = await S.from(tabela).select("*").eq("id", id).maybeSingle();
  if (r.error) throw new Error(`stanje ${tabela}: ${r.error.message}`);
  return r.data;
}

// Pokušaj izmene/brisanja tuđeg reda. Prolazi ako ništa nije pogođeno.
// Greška (npr. nema prava) je prihvatljiva, ali stanje se uvek proverava posebno.
async function pokusaj(zahtev) {
  const r = await zahtev;
  return { greska: r.error, pogodjeno: r.data?.length ?? 0 };
}

// ───────────────────────── čišćenje ─────────────────────────

// Nalozi čija adresa ne liči na test (broj karte sa vodećom nulom, npr.
// 0101228@citaliste.local) ne mogu da se čiste po obrascu adrese: obrazac bi
// mogao da pogodi pravog člana. Zato se pamte po id-ju, a ostaci prekinutog
// pokretanja se nalaze po imenu u clanovi ("RLS Test…").
const NAPRAVLJENI = [];

async function ocisti() {
  // Knjige i objave nemaju vlasnika koji bi ih pokupio kaskadom.
  const o = await S.from("objave").delete().like("naslov", "RLS-TEST%");
  if (o.error) throw new Error(`čišćenje objava: ${o.error.message}`);
  const k = await S.from("knjige").delete().like("naslov", "RLS-TEST%");
  if (k.error) throw new Error(`čišćenje knjiga: ${k.error.message}`);

  // Brisanje auth naloga kaskadno briše clanovi, a ona polica, utisci, veze,
  // blokade, preporuke, prijave i rezervacije. Prvo sakupi, pa briši (strane
  // se pomeraju dok se briše).
  const ids = new Set(NAPRAVLJENI);
  for (let strana = 1; ; strana++) {
    const { data, error } = await S.auth.admin.listUsers({ page: strana, perPage: 200 });
    if (error) throw new Error(`čišćenje naloga (lista): ${error.message}`);
    for (const u of data.users) if (OBRAZAC_EMAIL.test(u.email ?? "")) ids.add(u.id);
    if (data.users.length < 200) break;
  }
  const poImenu = await S.from("clanovi").select("id").like("ime", "RLS Test%");
  if (poImenu.error) throw new Error(`čišćenje naloga (po imenu): ${poImenu.error.message}`);
  for (const c of poImenu.data) ids.add(c.id);
  for (const id of ids) {
    const { error } = await S.auth.admin.deleteUser(id);
    if (error) throw new Error(`čišćenje naloga: ${error.message}`);
  }
  return ids.size;
}

let cistiSe = false;
async function ocistiIIzadji(kod) {
  if (cistiSe) return;
  cistiSe = true;
  try {
    await ocisti();
  } catch (e) {
    console.error(`Čišćenje nije uspelo: ${bezTajni(e.message)}`);
  }
  process.exit(kod);
}
process.on("SIGINT", () => ocistiIIzadji(130));

// ───────────────────────── priprema ─────────────────────────

async function napraviClana(oznaka, uloga) {
  const email = `rls-test-${RUN}-${oznaka}@citaliste.test`;
  const lozinka = `${randomUUID()}aA1!`; // jednokratna, ne ispisuje se
  const k = await S.auth.admin.createUser({ email, password: lozinka, email_confirm: true });
  if (k.error) throw new Error(`createUser ${oznaka}: ${k.error.message}`);
  const id = k.data.user.id;

  // Nema trigger-a na auth.users: red u clanovi se upisuje ručno.
  const c = await S.from("clanovi")
    .insert({ id, broj_kartice: `RLSTEST-${RUN}-${oznaka.toUpperCase()}`, ime: `RLS Test ${oznaka}`, uloga })
    .select("id, sifra_poziva, uloga")
    .single();
  const red = mora(c, `upis clanovi ${oznaka}`);

  const db = noviKlijent(ANON);
  const p = await db.auth.signInWithPassword({ email, password: lozinka });
  if (p.error) throw new Error(`prijava ${oznaka}: ${p.error.message}`);
  return { id, db, sifra: red.sifra_poziva, uloga: red.uloga };
}

async function napraviKnjigu(oznaka, dodatno = {}) {
  const r = await S.from("knjige")
    .insert({ naslov: N(oznaka), autor: "RLS Test", u_fondu: true, broj_primeraka: 1, broj_slobodnih: 1, izvor: "fond", ...dodatno })
    .select()
    .single();
  return mora(r, `knjiga ${oznaka}`);
}

async function ubaci(tabela, red) {
  return mora(await S.from(tabela).insert(red).select().single(), `upis ${tabela}`);
}

// ───────────────────────── glavni tok ─────────────────────────

async function main() {
  console.log(`Test RLS — projekat: ${new URL(URL_).host} — pokretanje ${RUN}`);
  const ostaci = await ocisti();
  if (ostaci) console.log(`(očišćeni ostaci prethodnog prekinutog pokretanja: ${ostaci} naloga)`);

  faza("0. Priprema");
  const A = await napraviClana("a", "citalac");
  const B = await napraviClana("b", "citalac");
  const C = await napraviClana("c", "citalac");
  const BIB = await napraviClana("bib", "bibliotekar");
  const sviIdovi = [A.id, B.id, C.id, BIB.id];

  const K1 = await napraviKnjigu("K1");
  const K2 = await napraviKnjigu("K2");
  const K3 = await napraviKnjigu("K3");
  const K4 = await napraviKnjigu("K4");
  const DUP1 = await napraviKnjigu("DUP1", { u_fondu: false, broj_primeraka: 0, broj_slobodnih: 0, izvor: "clan" });
  const DUP2 = await napraviKnjigu("DUP2");

  await provera("servis: upis knjige u fond prolazi kroz trigger nepromenjen (servisna_uloga)", async () => {
    const k = await stanje("knjige", K1.id);
    return k.u_fondu === true && k.izvor === "fond" && k.broj_primeraka === 1
      ? true
      : `u_fondu=${k.u_fondu}, izvor=${k.izvor}, broj_primeraka=${k.broj_primeraka}`;
  });
  await provera("servis: clanovi dobija šifru poziva sam (podrazumevana vrednost)", async () =>
    [A, B, C, BIB].every((c) => /^NEG·\d{4}·[A-Z]{2}$/.test(c.sifra)) ? true : "šifra nije u obliku NEG·####·XX");

  // polica: A (K1 čita, K2 želi), B (K1 pročitano, K2 čita), C (K1 želi), A (DUP1 želi)
  await ubaci("polica", { clan_id: A.id, knjiga_id: K1.id, status: "citam" });
  await ubaci("polica", { clan_id: A.id, knjiga_id: K2.id, status: "zelim" });
  await ubaci("polica", { clan_id: B.id, knjiga_id: K1.id, status: "procitano" });
  await ubaci("polica", { clan_id: B.id, knjiga_id: K2.id, status: "citam" });
  await ubaci("polica", { clan_id: C.id, knjiga_id: K1.id, status: "zelim" });
  await ubaci("polica", { clan_id: A.id, knjiga_id: DUP1.id, status: "zelim" });

  // utisci: A — K1 javno, K2 prijatelji, K3 samo_ja, K4 javno ali sakriven
  const uA1 = await ubaci("utisci", { clan_id: A.id, knjiga_id: K1.id, ocena: 8, vidljivost: "javno" });
  const uA2 = await ubaci("utisci", { clan_id: A.id, knjiga_id: K2.id, ocena: 7, vidljivost: "prijatelji" });
  await ubaci("utisci", { clan_id: A.id, knjiga_id: K3.id, ocena: 6, vidljivost: "samo_ja" });
  const uA4 = await ubaci("utisci", { clan_id: A.id, knjiga_id: K4.id, ocena: 5, vidljivost: "javno", skriven: true });
  const uB1 = await ubaci("utisci", { clan_id: B.id, knjiga_id: K1.id, ocena: 9, vidljivost: "javno" });
  await ubaci("utisci", { clan_id: B.id, knjiga_id: K2.id, ocena: 4, vidljivost: "prijatelji" });
  await ubaci("utisci", { clan_id: C.id, knjiga_id: K1.id, ocena: 3, vidljivost: "javno" });

  // prijave (B i C prijavljuju A-in utisak), rezervacija A, objave bibliotekara
  await ubaci("prijave", { prijavio_id: B.id, tip: "utisak", stavka_id: uA1.id, razlog: "RLS test" });
  await ubaci("prijave", { prijavio_id: C.id, tip: "utisak", stavka_id: uA2.id, razlog: "RLS test" });
  await ubaci("rezervacije", { clan_id: A.id, knjiga_id: K1.id });
  const objavljena = await ubaci("objave", {
    autor_id: BIB.id, naslov: N("objava"), vrsta: "vest", objavljena: new Date(Date.now() - 60_000).toISOString(),
  });
  const nacrt = await ubaci("objave", { autor_id: BIB.id, naslov: N("nacrt"), vrsta: "vest", objavljena: null });

  // ───────────────────────── 1. anon i izloženost API-ja ─────────────────────────
  faza("1. Anonimni korisnik i izloženost API-ja");

  const ruta = (ime, args) => anon.rpc(ime, args);
  await provera("anon ne može da zove posalji_poziv", async () => {
    const r = await ruta("posalji_poziv", { sifra: NEPOSTOJECA_SIFRA });
    return nedostupna(r) ? true : `funkcija je izvršena kao anon: ${opis(r)}`;
  });
  await provera("anon ne može da zove prihvati_poziv", async () => {
    const r = await ruta("prihvati_poziv", { veza: randomUUID() });
    return nedostupna(r) ? true : `funkcija je izvršena kao anon: ${opis(r)}`;
  });
  await provera("anon ne može da zove spoji_knjige", async () => {
    const r = await ruta("spoji_knjige", { dupli: randomUUID(), maticni: randomUUID() });
    return nedostupna(r) ? true : `funkcija je izvršena kao anon: ${opis(r)}`;
  });

  const nijeIzlozena = (r) =>
    !!r.error && (r.error.code === "PGRST106" || /invalid schema|schema.*not.*exposed|not.*exposed/i.test(r.error.message ?? ""));
  await provera("šema privatno nije dostupna kroz API (anon, rpc)", async () => {
    const r = await anon.schema("privatno").rpc("je_bibliotekar");
    return nijeIzlozena(r) ? true : `odgovor: ${opis(r)}`;
  });
  await provera("šema privatno nije dostupna kroz API (prijavljen čitalac, rpc)", async () => {
    const r = await A.db.schema("privatno").rpc("su_povezani", { a: A.id, b: B.id });
    return nijeIzlozena(r) ? true : `odgovor: ${opis(r)}`;
  });
  await provera("šema privatno nije dostupna kroz API (prijavljen čitalac, tabela/pogled)", async () => {
    const r = await A.db.schema("privatno").from("clanovi").select("*");
    return nijeIzlozena(r) ? true : `odgovor: ${opis(r)}`;
  });

  await provera("pomoćne funkcije više ne postoje u šemi public (nema ih kao RPC)", async () => {
    const pokusaji = [
      ["su_povezani", { a: A.id, b: B.id }], ["je_bibliotekar", {}], ["je_administrator", {}],
      ["moja_uloga", {}], ["aktivan_clan", {}], ["nova_sifra_poziva", {}],
      ["norm_tekst", { t: "x" }], ["norm_sifra", { s: "x" }], ["raskini_vezu", { veza: randomUUID() }],
      ["servisna_uloga", {}],
    ];
    const izvrsene = [];
    for (const [ime, args] of pokusaji) {
      const r = await A.db.rpc(ime, args);
      if (!nedostupna(r)) izvrsene.push(`${ime} (${opis(r)})`);
    }
    return izvrsene.length ? `dostupne kao RPC: ${izvrsene.join("; ")}` : true;
  });

  // ───────────────────────── 1b. prijava članskom kartom ─────────────────────────
  faza("1b. Prijava članskom kartom (ista normalizacija kao u aplikaciji)");

  const KARTICA = `RLSTEST-${RUN}-PRIJAVA`.toUpperCase();
  const PIN = "482916";
  const nalogKarte = await S.auth.admin.createUser({ email: kartaUEmail(KARTICA), password: PIN, email_confirm: true });
  const idKarte = mora(nalogKarte, "nalog za proveru prijave").user.id;
  await ubaci("clanovi", { id: idKarte, broj_kartice: KARTICA, ime: "RLS Test prijava", uloga: "citalac" });

  const prijavaKarticom = (kartica, pin) => noviKlijent(ANON).auth.signInWithPassword({ email: kartaUEmail(kartica), password: pin });
  const potpisPrijave = (r) => JSON.stringify([r.error?.name, r.error?.code, r.error?.message, r.error?.status]);

  await provera("normalizacija: razmaci i veličina slova ne menjaju broj karte", async () => {
    const a = normalizujKarticu("  nb 12-34 ");
    const b = kartaUEmail("NB12-34");
    return a === "NB12-34" && b === "nb12-34@citaliste.local" ? true : `normalizujKarticu: ${a}; kartaUEmail: ${b}`;
  });
  await provera("prijava tačnom kartom i PIN-om uspeva, i kad je karta uneta nehajno (razmaci, mala slova)", async () => {
    const nehajno = ` ${KARTICA.toLowerCase().replaceAll("-", " - ")} `;
    const r = await prijavaKarticom(nehajno, PIN);
    return !r.error && r.data.session ? true : `prijava: ${r.error?.code} ${r.error?.message}`;
  });
  await provera("nepostojeći broj karte i pogrešan PIN daju ISTI odgovor", async () => {
    const pogresanPin = await prijavaKarticom(KARTICA, "000000");
    const nepostojecaKarta = await prijavaKarticom(`RLSTEST-${RUN}-NEMA`, PIN);
    if (!pogresanPin.error || !nepostojecaKarta.error) {
      return `prijava je uspela, a nije smela: pogrešan PIN: ${potpisPrijave(pogresanPin)}; nepostojeća karta: ${potpisPrijave(nepostojecaKarta)}`;
    }
    const a = potpisPrijave(pogresanPin);
    const b = potpisPrijave(nepostojecaKarta);
    const otkriva = [a, b].some((p) => p.toLowerCase().includes(KARTICA.toLowerCase()) || p.includes("citaliste.local"));
    if (otkriva) return `odgovor sadrži broj karte ili sintetičku adresu: ${a} / ${b}`;
    return a === b ? true : `odgovori se razlikuju: pogrešan PIN ${a}; nepostojeća karta ${b}`;
  });

  // Broj karte koji počinje nulom (npr. 0101228) mora ostati TEKST na celom putu:
  // Auth adresa, red u clanovi i prijava. Slučajan je, da ne pogodi pravu kartu.
  const KARTICA0 = `0${String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0")}`;
  const PIN0 = "012345"; // i PIN može da počinje nulom
  const nalog0 = await S.auth.admin.createUser({ email: kartaUEmail(KARTICA0), password: PIN0, email_confirm: true });
  const id0 = mora(nalog0, "nalog sa vodećom nulom").user.id;
  NAPRAVLJENI.push(id0);
  await ubaci("clanovi", { id: id0, broj_kartice: KARTICA0, ime: "RLS Test vodeća nula", uloga: "citalac" });

  await provera("vodeća nula: broj karte ostaje tekst u bazi i u Auth adresi (0xxxxxx, ne xxxxxx)", async () => {
    const red = await stanje("clanovi", id0);
    const auth = await S.auth.admin.getUserById(id0);
    if (auth.error) return `getUserById: ${auth.error.message}`;
    return red.broj_kartice === KARTICA0 && typeof red.broj_kartice === "string" && red.broj_kartice.length === 7 &&
      auth.data.user.email === `${KARTICA0}@citaliste.local`
      ? true
      : `u bazi: ${JSON.stringify(red.broj_kartice)}; Auth adresa: ${auth.data.user.email}; očekivano ${KARTICA0}`;
  });
  await provera("vodeća nula: prijava radi i kad se karta unese sa razmacima (0 1 0 1 2 2 8)", async () => {
    const sRazmacima = KARTICA0.split("").join(" ");
    const r = await prijavaKarticom(sRazmacima, PIN0);
    return !r.error && r.data.session ? true : `prijava (${sRazmacima.length} znakova): ${r.error?.code} ${r.error?.message}`;
  });
  await provera("vodeća nula: karta bez nule (kao broj) i PIN bez nule nisu iste kao prave", async () => {
    const kartaKaoBroj = String(Number.parseInt(KARTICA0, 10)); // šta bi ostalo da se karta pretvori u broj
    const pinKaoBroj = String(Number.parseInt(PIN0, 10));
    const a = await prijavaKarticom(kartaKaoBroj, PIN0);
    const b = await prijavaKarticom(KARTICA0, pinKaoBroj);
    return a.error && b.error && !a.data.session && !b.data.session
      ? true
      : `prijava je uspela: karta bez nule ${!!a.data.session}, PIN bez nule ${!!b.data.session}`;
  });

  // ───────────────────────── 2. pre veze ─────────────────────────
  faza("2. Pre veze: A, B, C se međusobno ne vide");

  await provera("kontrola: A vidi svoju policu (2 reda) i svoj utisak za prijatelje", async () => {
    const p = await vidi(A.db, "polica", (q) => q.eq("clan_id", A.id).in("knjiga_id", [K1.id, K2.id]));
    const u = await vidi(A.db, "utisci", (q) => q.eq("id", uA2.id));
    return tacno(p, 2, "polica A") === true && tacno(u, 1, "utisak A (prijatelji)") === true
      ? true
      : `${opis(p)} / ${opis(u)}`;
  });
  await provera("kontrola: B vidi svoju policu (2 reda)", async () =>
    tacno(await vidi(B.db, "polica", (q) => q.eq("clan_id", B.id)), 2, "polica B"));

  await provera("A ne vidi B-ovu policu", async () =>
    nistaNeVidi(await vidi(A.db, "polica", (q) => q.eq("clan_id", B.id)), "polica B kod A"));
  await provera("B ne vidi A-inu policu", async () =>
    nistaNeVidi(await vidi(B.db, "polica", (q) => q.eq("clan_id", A.id)), "polica A kod B"));
  await provera("A ne vidi B-ov utisak vidljivosti 'prijatelji'", async () =>
    nistaNeVidi(await vidi(A.db, "utisci", (q) => q.eq("clan_id", B.id).eq("vidljivost", "prijatelji")), "prijatelji B kod A"));
  await provera("B ne vidi A-in utisak vidljivosti 'prijatelji'", async () =>
    nistaNeVidi(await vidi(B.db, "utisci", (q) => q.eq("clan_id", A.id).eq("vidljivost", "prijatelji")), "prijatelji A kod B"));
  await provera("javni utisci se vide (A vidi B-ov javni, B vidi A-in javni)", async () => {
    const a = await vidi(A.db, "utisci", (q) => q.eq("id", uB1.id));
    const b = await vidi(B.db, "utisci", (q) => q.eq("id", uA1.id));
    return tacno(a, 1, "javni B kod A") === true && tacno(b, 1, "javni A kod B") === true ? true : `${opis(a)} / ${opis(b)}`;
  });
  await provera("utisci 'samo_ja' i sakriveni se ne vide drugima (B i C), a A ih vidi", async () => {
    const ids = [uA4.id];
    const k3 = await S.from("utisci").select("id").eq("clan_id", A.id).eq("knjiga_id", K3.id).single();
    ids.push(mora(k3, "id utiska K3").id);
    const b = await vidi(B.db, "utisci", (q) => q.in("id", ids));
    const c = await vidi(C.db, "utisci", (q) => q.in("id", ids));
    const a = await vidi(A.db, "utisci", (q) => q.in("id", ids));
    return tacno(b, 0, "B") === true && tacno(c, 0, "C") === true && tacno(a, 2, "A (vlasnik)") === true
      ? true
      : `B: ${opis(b)}; C: ${opis(c)}; A: ${opis(a)}`;
  });
  await provera("nema spiska članova: čitalac u clanovi vidi samo sebe", async () => {
    const a = await vidi(A.db, "clanovi");
    const c = await vidi(C.db, "clanovi");
    return a.data?.length === 1 && a.data[0].id === A.id && c.data?.length === 1 && c.data[0].id === C.id
      ? true
      : `A: ${opis(a)}; C: ${opis(c)}`;
  });
  await provera("tuđu rezervaciju ne vidi niko osim vlasnika i bibliotekara", async () => {
    const b = await vidi(B.db, "rezervacije", (q) => q.eq("clan_id", A.id));
    const a = await vidi(A.db, "rezervacije", (q) => q.eq("clan_id", A.id));
    const bib = await vidi(BIB.db, "rezervacije", (q) => q.eq("clan_id", A.id));
    return tacno(b, 0, "B") === true && tacno(a, 1, "A") === true && tacno(bib, 1, "bibliotekar") === true
      ? true
      : `B: ${opis(b)}; A: ${opis(a)}; bib: ${opis(bib)}`;
  });
  await provera("objave: čitalac vidi objavljenu, ne vidi nacrt; bibliotekar vidi oba", async () => {
    const a = await vidi(A.db, "objave", (q) => q.in("id", [objavljena.id, nacrt.id]));
    const bib = await vidi(BIB.db, "objave", (q) => q.in("id", [objavljena.id, nacrt.id]));
    return a.data?.length === 1 && a.data[0].id === objavljena.id && bib.data?.length === 2
      ? true
      : `čitalac: ${opis(a)}; bibliotekar: ${opis(bib)}`;
  });

  const preporuka = (od, ka, knjiga, ostalo = {}) =>
    od.db.from("preporuke")
      .insert({ posiljalac_id: od.id, primalac_id: ka.id, knjiga_id: knjiga.id, poruka: "RLS test", ...ostalo })
      .select()
      .single();
  const odbijeno = (r) => (r.error && r.error.code === "42501" ? true : `očekivano odbijanje (42501), dobijeno: ${opis(r)}`);

  await provera("preporuka A->B se ne može upisati dok veza ne postoji", async () => odbijeno(await preporuka(A, B, K1)));

  // ───────────────────────── 3. veza pozivnicom ─────────────────────────
  faza("3. Veza pozivnicom");

  let vezaId = null;
  await provera("A šalje poziv šifrom koju B diktira (mala slova i razmaci su dozvoljeni)", async () => {
    const kucano = B.sifra.toLowerCase().replace(/·/g, " ");
    const r = await A.db.rpc("posalji_poziv", { sifra: kucano });
    if (r.error || !r.data) return `posalji_poziv: ${opis(r)}`;
    vezaId = r.data;
    const v = await stanje("veze", vezaId);
    return v && v.pozivalac_id === A.id && v.pozvani_id === B.id && v.status === "na_cekanju"
      ? true
      : `red u veze: ${JSON.stringify(v)}`;
  });

  await provera("dok je poziv na čekanju, A još ne vidi B-ovu policu ni utisak za prijatelje", async () => {
    const p = await vidi(A.db, "polica", (q) => q.eq("clan_id", B.id));
    const u = await vidi(A.db, "utisci", (q) => q.eq("clan_id", B.id).eq("vidljivost", "prijatelji"));
    return tacno(p, 0, "polica") === true && tacno(u, 0, "utisci") === true ? true : `${opis(p)} / ${opis(u)}`;
  });
  await provera("preporuka A->B se ne može upisati dok je poziv na čekanju", async () => odbijeno(await preporuka(A, B, K1)));
  await provera("poziv vide samo učesnici: B vidi, C ne vidi", async () => {
    const b = await vidi(B.db, "veze", (q) => q.eq("id", vezaId));
    const c = await vidi(C.db, "veze", (q) => q.eq("id", vezaId));
    return tacno(b, 1, "B") === true && tacno(c, 0, "C") === true ? true : `B: ${opis(b)}; C: ${opis(c)}`;
  });

  await provera("pozivalac ne može sam da prihvati poziv (rpc), ni stranac (C)", async () => {
    const a = await A.db.rpc("prihvati_poziv", { veza: vezaId });
    const c = await C.db.rpc("prihvati_poziv", { veza: vezaId });
    const v = await stanje("veze", vezaId);
    return a.error && c.error && v.status === "na_cekanju"
      ? true
      : `A: ${opis(a)}; C: ${opis(c)}; status u bazi: ${v.status}`;
  });
  await provera("pozivalac ne može da prihvati poziv ni direktnim UPDATE-om na veze", async () => {
    const p = await pokusaj(A.db.from("veze").update({ status: "prihvacena" }).eq("id", vezaId).select());
    const v = await stanje("veze", vezaId);
    return p.pogodjeno === 0 && v.status === "na_cekanju" ? true : `pogođeno: ${p.pogodjeno}, status u bazi: ${v.status}`;
  });
  await provera("niko ne može da napravi vezu direktnim INSERT-om (A->C kao 'prihvacena')", async () => {
    const r = await A.db.from("veze").insert({ pozivalac_id: A.id, pozvani_id: C.id, status: "prihvacena" }).select();
    const u = await S.from("veze").select("id").or(`and(pozivalac_id.eq.${A.id},pozvani_id.eq.${C.id}),and(pozivalac_id.eq.${C.id},pozvani_id.eq.${A.id})`);
    return r.error && u.data?.length === 0 ? true : `INSERT: ${opis(r)}; redova u bazi: ${u.data?.length}`;
  });

  await provera("B prihvata poziv", async () => {
    const r = await B.db.rpc("prihvati_poziv", { veza: vezaId });
    const v = await stanje("veze", vezaId);
    return !r.error && v.status === "prihvacena" && v.potvrdjena ? true : `${opis(r)}; status: ${v.status}`;
  });

  await provera("posle prihvatanja A vidi B-ovu policu (2) i utisak za prijatelje (1)", async () => {
    const p = await vidi(A.db, "polica", (q) => q.eq("clan_id", B.id));
    const u = await vidi(A.db, "utisci", (q) => q.eq("clan_id", B.id).eq("vidljivost", "prijatelji"));
    return tacno(p, 2, "polica") === true && tacno(u, 1, "utisci") === true ? true : `${opis(p)} / ${opis(u)}`;
  });
  await provera("posle prihvatanja B vidi A-inu policu (3) i utisak za prijatelje (1)", async () => {
    const p = await vidi(B.db, "polica", (q) => q.eq("clan_id", A.id));
    const u = await vidi(B.db, "utisci", (q) => q.eq("clan_id", A.id).eq("vidljivost", "prijatelji"));
    return tacno(p, 3, "polica") === true && tacno(u, 1, "utisci") === true ? true : `${opis(p)} / ${opis(u)}`;
  });
  await provera("ni povezan prijatelj ne vidi utiske 'samo_ja' i sakrivene", async () => {
    const r = await vidi(B.db, "utisci", (q) => q.eq("clan_id", A.id).in("vidljivost", ["samo_ja"]));
    const s = await vidi(B.db, "utisci", (q) => q.eq("id", uA4.id));
    return tacno(r, 0, "samo_ja") === true && tacno(s, 0, "sakriven") === true ? true : `${opis(r)} / ${opis(s)}`;
  });

  await provera("C (nepovezan) ni posle toga ne vidi policu A ni B", async () => {
    const a = await vidi(C.db, "polica", (q) => q.eq("clan_id", A.id));
    const b = await vidi(C.db, "polica", (q) => q.eq("clan_id", B.id));
    return tacno(a, 0, "polica A") === true && tacno(b, 0, "polica B") === true ? true : `${opis(a)} / ${opis(b)}`;
  });
  await provera("C ne vidi utiske A i B vidljivosti prijatelji, samo_ja ni sakrivene", async () => {
    const r = await vidi(C.db, "utisci", (q) => q.in("clan_id", [A.id, B.id]).neq("vidljivost", "javno"));
    const s = await vidi(C.db, "utisci", (q) => q.eq("id", uA4.id));
    return tacno(r, 0, "nejavni") === true && tacno(s, 0, "sakriven") === true ? true : `${opis(r)} / ${opis(s)}`;
  });
  await provera("kontrola: C vidi JAVNE utiske A i B (po dizajnu javno vide svi aktivni članovi)", async () => {
    const r = await vidi(C.db, "utisci", (q) => q.in("id", [uA1.id, uB1.id]));
    return tacno(r, 2, "javni utisci kod C");
  });

  // ───────────────────────── 4. preporuke ─────────────────────────
  faza("4. Direktne preporuke");

  let R1 = null;
  await provera("preporuka A->B se upisuje uz prihvaćenu vezu", async () => {
    const r = await preporuka(A, B, K1);
    if (r.error) return opis(r);
    R1 = r.data;
    return true;
  });
  await provera("preporuka A->C (bez veze) se ne može upisati", async () => odbijeno(await preporuka(A, C, K1)));
  await provera("A ne može da lažira pošiljaoca (posiljalac_id = B)", async () => {
    const r = await A.db.from("preporuke")
      .insert({ posiljalac_id: B.id, primalac_id: A.id, knjiga_id: K1.id, poruka: "RLS test" })
      .select();
    return odbijeno(r);
  });
  await provera("preporuku vide samo pošiljalac (A) i primalac (B)", async () => {
    const a = await vidi(A.db, "preporuke", (q) => q.eq("id", R1?.id));
    const b = await vidi(B.db, "preporuke", (q) => q.eq("id", R1?.id));
    const c = await vidi(C.db, "preporuke", (q) => q.eq("id", R1?.id));
    return tacno(a, 1, "A") === true && tacno(b, 1, "B") === true && tacno(c, 0, "C") === true
      ? true
      : `A: ${opis(a)}; B: ${opis(b)}; C: ${opis(c)}`;
  });
  await provera("bibliotekar NE vidi preporuku dok nije prijavljena", async () =>
    nistaNeVidi(await vidi(BIB.db, "preporuke", (q) => q.eq("id", R1?.id)), "preporuka kod bibliotekara"));
  await provera("kad je preporuka prijavljena, bibliotekar je vidi, a C i dalje ne", async () => {
    await ubaci("prijave", { prijavio_id: B.id, tip: "preporuka", stavka_id: R1.id, razlog: "RLS test" });
    const bib = await vidi(BIB.db, "preporuke", (q) => q.eq("id", R1.id));
    const c = await vidi(C.db, "preporuke", (q) => q.eq("id", R1.id));
    return tacno(bib, 1, "bibliotekar") === true && tacno(c, 0, "C") === true ? true : `bib: ${opis(bib)}; C: ${opis(c)}`;
  });

  // ───────────────────────── 5. blokada i isti odgovor ─────────────────────────
  faza("5. Blokada ne sme da se otkrije");

  await provera("A blokira C", async () => {
    const r = await A.db.from("blokade").insert({ blokirao_id: A.id, blokirani_id: C.id }).select();
    return r.error ? opis(r) : true;
  });
  await provera("blokirani (C) ne vidi da je blokiran; A vidi svoju blokadu", async () => {
    const c = await vidi(C.db, "blokade");
    const a = await vidi(A.db, "blokade");
    return tacno(c, 0, "C") === true && tacno(a, 1, "A") === true ? true : `C: ${opis(c)}; A: ${opis(a)}`;
  });
  await provera("posalji_poziv: nepostojeća šifra i šifra blokiranog člana daju ISTI odgovor", async () => {
    const nepostojeca = await A.db.rpc("posalji_poziv", { sifra: NEPOSTOJECA_SIFRA });
    const blokiraoBlokiranom = await A.db.rpc("posalji_poziv", { sifra: C.sifra }); // A je blokirao C
    const blokiranBlokiraoca = await C.db.rpc("posalji_poziv", { sifra: A.sifra }); // C je blokiran
    const nepostojecaC = await C.db.rpc("posalji_poziv", { sifra: NEPOSTOJECA_SIFRA });
    const potpisi = {
      nepostojeca: potpisGreske(nepostojeca),
      "blokirao->blokiran": potpisGreske(blokiraoBlokiranom),
      "blokiran->blokirao": potpisGreske(blokiranBlokiraoca),
      "nepostojeca (C)": potpisGreske(nepostojecaC),
    };
    const razlicitih = new Set(Object.values(potpisi));
    const nemaGreske = [nepostojeca, blokiraoBlokiranom, blokiranBlokiraoca, nepostojecaC].some((r) => !r.error);
    const veza = await S.from("veze").select("id").or(`and(pozivalac_id.eq.${A.id},pozvani_id.eq.${C.id}),and(pozivalac_id.eq.${C.id},pozvani_id.eq.${A.id})`);
    if (nemaGreske) return `neki poziv je uspeo, a nije smeo: ${JSON.stringify(potpisi)}`;
    if (veza.data?.length) return "poziv ka/od blokiranog je ipak napravio vezu";
    return razlicitih.size === 1 ? true : `odgovori se razlikuju: ${JSON.stringify(potpisi)}`;
  });

  // ───────────────────────── 6. anon i tabele ─────────────────────────
  faza("6. Anonimni korisnik ne vidi nijedan red (sve tabele popunjene)");

  const SVE = [
    "clanovi", "knjige", "blokade", "veze", "polica", "utisci", "prijave", "objave", "rezervacije", "preporuke",
    "ocene_knjiga", "izvestaj_nabavka", "izvestaj_dodatni_primerak",
  ];
  for (const t of SVE) {
    await provera(`anon ne vidi nijedan red iz ${t}`, async () => {
      const r = await anon.from(t).select("*");
      return !r.error && r.data.length > 0 ? `anon je video ${r.data.length} redova` : true;
    });
  }

  // ───────────────────────── 7. uloge, prijave, spajanje ─────────────────────────
  faza("7. Uloge, prijave i moderacija");

  await provera("čitalac ne može da promeni sopstvenu ulogu ni status članstva", async () => {
    await A.db.from("clanovi")
      .update({ uloga: "administrator", aktivan: false, broj_kartice: "HAKOVANO", sifra_poziva: "NEG·1111·ZZ", nadimak: "RLS-nadimak" })
      .eq("id", A.id)
      .select();
    const a = await stanje("clanovi", A.id);
    return a.uloga === "citalac" && a.aktivan === true && a.broj_kartice === `RLSTEST-${RUN}-A` && a.sifra_poziva === A.sifra
      ? true
      : `u bazi: uloga=${a.uloga}, aktivan=${a.aktivan}, broj_kartice=${a.broj_kartice}, sifra_poziva=${a.sifra_poziva}`;
  });
  await provera("kontrola: čitalac ipak sme da promeni svoj nadimak (isti UPDATE)", async () => {
    const a = await stanje("clanovi", A.id);
    return a.nadimak === "RLS-nadimak" ? true : `nadimak u bazi: ${a.nadimak} (UPDATE je cela odbijena?)`;
  });
  await provera("bibliotekar ne može da dodeli ulogu administratora (to sme samo administrator)", async () => {
    await BIB.db.from("clanovi").update({ uloga: "administrator" }).eq("id", A.id).select();
    const a = await stanje("clanovi", A.id);
    return a.uloga === "citalac" ? true : `A.uloga u bazi: ${a.uloga}`;
  });
  await provera("čitalac ne može da obriše ni svoj red u clanovi", async () => {
    const p = await pokusaj(A.db.from("clanovi").delete().eq("id", A.id).select());
    const a = await stanje("clanovi", A.id);
    return p.pogodjeno === 0 && a ? true : `pogođeno: ${p.pogodjeno}, red postoji: ${!!a}`;
  });

  await provera("čitalac ne vidi prijave drugih, svoje vidi; bibliotekar vidi sve", async () => {
    const a = await vidi(A.db, "prijave", (q) => q.in("prijavio_id", sviIdovi));
    const b = await vidi(B.db, "prijave", (q) => q.in("prijavio_id", sviIdovi));
    const ukupno = await S.from("prijave").select("id", { count: "exact" }).in("prijavio_id", sviIdovi);
    const bib = await vidi(BIB.db, "prijave", (q) => q.in("prijavio_id", sviIdovi));
    const ocekivanoB = (await S.from("prijave").select("id").eq("prijavio_id", B.id)).data.length;
    return a.data?.length === 0 && b.data?.length === ocekivanoB && bib.data?.length === ukupno.data.length
      ? true
      : `A: ${opis(a)}; B: ${opis(b)} (očekivano ${ocekivanoB}); bibliotekar: ${opis(bib)} (u bazi ${ukupno.data.length})`;
  });

  await provera("čitalac ne može da zove spoji_knjige (i ništa se ne menja)", async () => {
    const r = await A.db.rpc("spoji_knjige", { dupli: DUP1.id, maticni: DUP2.id });
    const d = await stanje("knjige", DUP1.id);
    return r.error && d.spojena_sa_id === null ? true : `${opis(r)}; spojena_sa_id u bazi: ${d.spojena_sa_id}`;
  });
  await provera("bibliotekar može da zove spoji_knjige; polica prelazi na matični zapis", async () => {
    const r = await BIB.db.rpc("spoji_knjige", { dupli: DUP1.id, maticni: DUP2.id });
    if (r.error) return opis(r);
    const d = await stanje("knjige", DUP1.id);
    const p = await S.from("polica").select("knjiga_id").eq("clan_id", A.id).in("knjiga_id", [DUP1.id, DUP2.id]);
    return d.spojena_sa_id === DUP2.id && p.data?.length === 1 && p.data[0].knjiga_id === DUP2.id
      ? true
      : `spojena_sa_id: ${d.spojena_sa_id}; polica A: ${JSON.stringify(p.data)}`;
  });

  await provera("'naslov koji nemamo': čitalac upisuje knjigu, ali ne može da je proglasi delom fonda", async () => {
    const r = await A.db.from("knjige")
      .insert({ naslov: N("A-unos"), autor: "Neko", u_fondu: true, izvor: "fond", broj_primeraka: 5, broj_slobodnih: 5, signatura: "X-1" })
      .select()
      .single();
    if (r.error) return opis(r);
    const k = r.data;
    return k.izvor === "clan" && k.u_fondu === false && k.broj_primeraka === 0 && k.signatura === null && k.uneo_id === A.id
      ? true
      : `u bazi: izvor=${k.izvor}, u_fondu=${k.u_fondu}, primeraka=${k.broj_primeraka}, signatura=${k.signatura}, uneo_id=${k.uneo_id === A.id ? "A" : k.uneo_id}`;
  });
  await provera("bibliotekar upisuje knjigu u fond i polja ostaju kako je uneo", async () => {
    const r = await BIB.db.from("knjige")
      .insert({ naslov: N("BIB-unos"), autor: "Neko", u_fondu: true, izvor: "fond", broj_primeraka: 5, broj_slobodnih: 5, signatura: "X-2" })
      .select()
      .single();
    if (r.error) return opis(r);
    const k = r.data;
    return k.u_fondu === true && k.izvor === "fond" && k.broj_primeraka === 5 && k.signatura === "X-2"
      ? true
      : `u bazi: izvor=${k.izvor}, u_fondu=${k.u_fondu}, primeraka=${k.broj_primeraka}, signatura=${k.signatura}`;
  });
  await provera("autor ne može sam da otkrije svoj sakriveni utisak", async () => {
    await A.db.from("utisci").update({ skriven: false }).eq("id", uA4.id).select();
    const u = await stanje("utisci", uA4.id);
    return u.skriven === true ? true : "skriven je postao false";
  });

  // ───────────────────────── 8. tuđi redovi ─────────────────────────
  faza("8. Tuđi utisak, polica i veza se ne mogu menjati ni brisati");

  const polB1 = (await S.from("polica").select("*").eq("clan_id", B.id).eq("knjiga_id", K1.id).single()).data;
  const polA1 = (await S.from("polica").select("*").eq("clan_id", A.id).eq("knjiga_id", K1.id).single()).data;

  const napadi = [
    ["A (povezan prijatelj)", A, { utisak: uB1, polica: polB1, vlasnik: "B" }],
    ["C (stranac)", C, { utisak: uA1, polica: polA1, vlasnik: "A" }],
  ];
  for (const [ko, napadac, cilj] of napadi) {
    await provera(`${ko} ne može da menja ni briše ${cilj.vlasnik}-in utisak`, async () => {
      const iz = await pokusaj(napadac.db.from("utisci").update({ ocena: 1, tekst: "HAKOVANO" }).eq("id", cilj.utisak.id).select());
      const br = await pokusaj(napadac.db.from("utisci").delete().eq("id", cilj.utisak.id).select());
      const u = await stanje("utisci", cilj.utisak.id);
      return iz.pogodjeno === 0 && br.pogodjeno === 0 && u && u.ocena === cilj.utisak.ocena && u.tekst !== "HAKOVANO"
        ? true
        : `izmenjeno: ${iz.pogodjeno}, obrisano: ${br.pogodjeno}, u bazi: ${JSON.stringify(u)}`;
    });
    await provera(`${ko} ne može da menja ni briše ${cilj.vlasnik}-inu policu`, async () => {
      const iz = await pokusaj(napadac.db.from("polica").update({ status: "zelim" }).eq("id", cilj.polica.id).select());
      const br = await pokusaj(napadac.db.from("polica").delete().eq("id", cilj.polica.id).select());
      const p = await stanje("polica", cilj.polica.id);
      return iz.pogodjeno === 0 && br.pogodjeno === 0 && p && p.status === cilj.polica.status
        ? true
        : `izmenjeno: ${iz.pogodjeno}, obrisano: ${br.pogodjeno}, u bazi: ${JSON.stringify(p)}`;
    });
  }
  await provera("C (stranac) ne može da menja ni briše tuđu vezu (A-B)", async () => {
    const iz = await pokusaj(C.db.from("veze").update({ status: "na_cekanju" }).eq("id", vezaId).select());
    const br = await pokusaj(C.db.from("veze").delete().eq("id", vezaId).select());
    const v = await stanje("veze", vezaId);
    return iz.pogodjeno === 0 && br.pogodjeno === 0 && v && v.status === "prihvacena"
      ? true
      : `izmenjeno: ${iz.pogodjeno}, obrisano: ${br.pogodjeno}, u bazi: ${JSON.stringify(v)}`;
  });

  // ───────────────────────── 9. blokada prekida vidljivost ─────────────────────────
  faza("9. Blokada između povezanih prekida vidljivost");

  let blokadaB = null;
  await provera("kad B blokira A, A više ne vidi B-ovu policu ni utisak za prijatelje, iako red u veze postoji", async () => {
    const b = await B.db.from("blokade").insert({ blokirao_id: B.id, blokirani_id: A.id }).select().single();
    if (b.error) return opis(b);
    blokadaB = b.data;
    const p = await vidi(A.db, "polica", (q) => q.eq("clan_id", B.id));
    const u = await vidi(A.db, "utisci", (q) => q.eq("clan_id", B.id).eq("vidljivost", "prijatelji"));
    const v = await stanje("veze", vezaId);
    return tacno(p, 0, "polica") === true && tacno(u, 0, "utisci") === true && v
      ? true
      : `${opis(p)} / ${opis(u)}; veza postoji: ${!!v}`;
  });
  await provera("blokada važi i u suprotnom smeru: B više ne vidi A-inu policu", async () =>
    nistaNeVidi(await vidi(B.db, "polica", (q) => q.eq("clan_id", A.id)), "polica A kod B"));
  await provera("preporuka A->B se ne može upisati dok traje blokada", async () => odbijeno(await preporuka(A, B, K2)));
  await provera("kad B ukloni blokadu, vidljivost se vraća", async () => {
    const d = await B.db.from("blokade").delete().eq("id", blokadaB?.id).select();
    if (d.error) return opis(d);
    return tacno(await vidi(A.db, "polica", (q) => q.eq("clan_id", B.id)), 2, "polica B kod A");
  });

  // ───────────────────────── 10. raskid veze ─────────────────────────
  faza("10. Raskid veze");

  await provera("B raskida vezu običnim DELETE-om i A odmah gubi uvid", async () => {
    const d = await B.db.from("veze").delete().eq("id", vezaId).select();
    if (d.error || d.data.length !== 1) return `brisanje: ${opis(d)}`;
    const p = await vidi(A.db, "polica", (q) => q.eq("clan_id", B.id));
    const u = await vidi(A.db, "utisci", (q) => q.eq("clan_id", B.id).eq("vidljivost", "prijatelji"));
    return tacno(p, 0, "polica") === true && tacno(u, 0, "utisci") === true ? true : `${opis(p)} / ${opis(u)}`;
  });
}

// ───────────────────────── izvršavanje i čišćenje ─────────────────────────

let kod = 0;
try {
  await main();
} catch (e) {
  fail++;
  console.log(`\nFAIL  test je prekinut: ${bezTajni(e?.message ?? e)}`);
} finally {
  cistiSe = true;
  console.log("\n── Čišćenje");
  try {
    const n = await ocisti();
    const ostalo = await S.from("knjige").select("id", { count: "exact", head: true }).like("naslov", "RLS-TEST%");
    console.log(`obrisano naloga: ${n}; preostalih test knjiga: ${ostalo.count ?? "?"}`);
    if (ostalo.count) kod = 1;
  } catch (e) {
    console.log(`UPOZORENJE: čišćenje nije uspelo (${bezTajni(e.message)}).`);
    console.log("Ručno obriši naloge rls-test-*@citaliste.test i knjige čiji naslov počinje sa RLS-TEST.");
    kod = 1;
  }
}

console.log(`\nPASS: ${pass}   FAIL: ${fail}`);
process.exit(fail > 0 || kod ? 1 : 0);
