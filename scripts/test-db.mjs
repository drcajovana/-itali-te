// Test migracija na pravom Postgresu u procesu (PGlite, WASM): bez Docker-a,
// bez mreže i bez ikakvih ključeva.
//
//   npm run test:db
//
// Pušta SVE migracije iz supabase/migrations redom i proverava ponašanje baze.
//
// VAŽNO: ovo NIJE Supabase. Uloge (anon, authenticated, service_role), auth.users,
// auth.uid() i podrazumevane privilegije su zamene koje oponašaju Supabase; prolaz
// ovde znači da SQL radi i da pravila važe, ne da je tvoj projekat u tom stanju.
// Ne proverava ni istovremene zahteve (PGlite ima jednu vezu).

import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DOZVOLJENI_DOMENI_KORICA, koricaJeDozvoljena } from "../api/_lib/bela-lista.js";
import { uIsbn13 } from "../src/lib/isbn.js";
import { putanjaIzAdrese, putanjaKorice } from "../src/lib/korica-slika.js";
import { normTekst, redZaUpis } from "../src/lib/uvoz-fonda.js";

const MIGRACIJE = fileURLToPath(new URL("../supabase/migrations/", import.meta.url));
const db = new PGlite({ extensions: { pg_trgm } });

let pass = 0;
let fail = 0;
const ok = (uslov, opis, detalj) => {
  if (uslov) {
    pass++;
    console.log("PASS ", opis);
  } else {
    fail++;
    console.log("FAIL ", opis, detalj !== undefined ? `\n        -> ${typeof detalj === "string" ? detalj : JSON.stringify(detalj)}` : "");
  }
};
const faza = (n) => console.log(`\n── ${n}`);

// Kao PostgREST: uloga + sub iz tokena, u jednoj transakciji.
async function kao(uloga, sub, sql, params = []) {
  try {
    await db.exec("begin");
    await db.exec(`set local role ${uloga}`);
    if (sub) await db.query("select set_config('request.jwt.claim.sub', $1, true)", [sub]);
    const r = await db.query(sql, params);
    await db.exec("commit");
    return { redovi: r.rows };
  } catch (e) {
    await db.exec("rollback").catch(() => {});
    return { greska: e };
  }
}
const nemaPrava = (r) => Boolean(r.greska?.message?.includes("permission denied"));

const fajlovi = fs.readdirSync(MIGRACIJE).filter((x) => x.endsWith(".sql")).sort();
async function pusti(ime) {
  try {
    await db.exec(fs.readFileSync(path.join(MIGRACIJE, ime), "utf8"));
    ok(true, `${ime} prolazi`);
  } catch (e) {
    ok(false, `${ime} prolazi`, `${e.message}${e.position ? ` (pozicija ${e.position})` : ""}`);
    throw new Error("migracija nije prošla, dalje nema smisla", { cause: e });
  }
}

try {
  faza("Zamene za Supabase");
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create schema extensions;
    grant usage on schema public, extensions, auth to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

    -- Zamena za Supabase Storage: samo ono što 0013 dira (buckets, objects, RLS na objects).
    -- Veličinu i tip fajla proverava Storage API, ne baza, pa se to ovde ne može probati.
    create schema storage;
    create table storage.buckets (id text primary key, name text not null, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text, owner uuid, created_at timestamptz default now());
    alter table storage.objects enable row level security;
    grant usage on schema storage to anon, authenticated, service_role;
    grant all on storage.buckets, storage.objects to anon, authenticated, service_role;
  `);
  const ko = await db.query("select current_user as k");
  ok(ko.rows[0].k === "postgres", "sesija radi kao 'postgres' (kao SQL Editor i migracije)", ko.rows[0]);

  // ───────── migracije 0001..0008, pa „stari" podaci, pa 0009 i 0010 ─────────
  faza("Migracije 0001 do 0008");
  const KASNE = fajlovi.filter((f) => /^00(09|10)_/.test(f));
  const POSLEDNJA = fajlovi.filter((f) => /^0011_/.test(f));
  const NAKON = fajlovi.filter((f) => /^0012_/.test(f));
  const STORAGE = fajlovi.filter((f) => /^001[34]_/.test(f));
  const ISPRAVKA = fajlovi.filter((f) => /^0015_/.test(f));
  const PUTANJA = fajlovi.filter((f) => /^0016_/.test(f));
  const POLICA = fajlovi.filter((f) => /^0017_/.test(f));
  const REZERVACIJE = fajlovi.filter((f) => /^0018_/.test(f));
  const CITAOCI = fajlovi.filter((f) => /^0019_/.test(f));
  const NABAVKA = fajlovi.filter((f) => /^0020_/.test(f));
  const MODERACIJA = fajlovi.filter((f) => /^0021_/.test(f));
  const POTPIS = fajlovi.filter((f) => /^0022_/.test(f));
  const BLOKADE = fajlovi.filter((f) => /^0023_/.test(f));
  const PREGLED = fajlovi.filter((f) => /^0024_/.test(f));
  const IZDAVAC = fajlovi.filter((f) => /^0025_/.test(f));
  const JEDINSTVEN = fajlovi.filter((f) => /^0026_/.test(f));
  const KORICA27 = fajlovi.filter((f) => /^0027_/.test(f));
  const DOMENI28 = fajlovi.filter((f) => /^0028_/.test(f));
  // domeni koje dodaje tek 0028: do tada se lista u bazi poredi sa listom bez njih
  const NOVI_DOMENI_28 = ["prometej.rs", "datastatus.rs"];
  const DOMENI29 = fajlovi.filter((f) => /^0029_/.test(f));
  const NOVI_DOMENI_29 = ["pravoslavnarec.com", "portalibris.rs"];
  const NOVI_DOMENI = [...NOVI_DOMENI_28, ...NOVI_DOMENI_29];
  for (const f of fajlovi.filter((x) => !KASNE.includes(x) && !POSLEDNJA.includes(x) && !NAKON.includes(x) && !STORAGE.includes(x) && !ISPRAVKA.includes(x) && !PUTANJA.includes(x) && !POLICA.includes(x) && !REZERVACIJE.includes(x) && !CITAOCI.includes(x) && !NABAVKA.includes(x) && !MODERACIJA.includes(x) && !POTPIS.includes(x) && !BLOKADE.includes(x) && !PREGLED.includes(x) && !IZDAVAC.includes(x) && !JEDINSTVEN.includes(x) && !KORICA27.includes(x) && !DOMENI28.includes(x) && !DOMENI29.includes(x))) await pusti(f);

  // Redovi koji su mogli da nastanu pre 0009 i 0010: nenormalizovan ISBN, nesigurna korica.
  await db.query(
    `insert into knjige (naslov, autor, isbn, korice_url, korice_izvor) values
       ('Stari ISBN-10', 'A', '0-306-40615-2', 'http://books.google.com/x.jpg', 'google_books'),
       ('Stara dobra korica', 'A', '978-86-521-2603-3', 'https://cdn.laguna.rs/k.jpg', 'og_slika'),
       ('Stara tuđa korica', 'A', null, 'https://evil.com/pratilac.gif', 'og_slika'),
       ('Stari neispravan ISBN', 'A', '123-456', null, null)`
  );

  faza("Migracije 0009 i 0010 (nad bazom koja već ima podatke)");
  for (const f of KASNE) await pusti(f);

  const stari = Object.fromEntries((await db.query("select naslov, isbn, korice_url, korice_izvor from knjige where naslov like 'Star%'")).rows.map((r) => [r.naslov, r]));
  ok(stari["Stari ISBN-10"].isbn === "9780306406157", "0010 normalizuje postojeći ISBN-10 sa crticama u ISBN-13", stari["Stari ISBN-10"]);
  ok(stari["Stara dobra korica"].isbn === "9788652126033", "0010 normalizuje i postojeći ISBN-13 sa crticama", stari["Stara dobra korica"]);
  ok(stari["Stari neispravan ISBN"].isbn === "123-456", "0010 ne dira postojeći neispravan ISBN (ne gubi se zapis)", stari["Stari neispravan ISBN"]);
  ok(stari["Stari ISBN-10"].korice_url === null && stari["Stari ISBN-10"].korice_izvor === null, "0009 postojeću http koricu postavlja na NULL (i izvor)", stari["Stari ISBN-10"]);
  ok(stari["Stara tuđa korica"].korice_url === null && stari["Stara tuđa korica"].korice_izvor === null, "0009 postojeću koricu sa tuđeg servera postavlja na NULL", stari["Stara tuđa korica"]);
  ok(stari["Stara dobra korica"].korice_url === "https://cdn.laguna.rs/k.jpg" && stari["Stara dobra korica"].korice_izvor === "og_slika", "0009 ne dira postojeću ispravnu koricu", stari["Stara dobra korica"]);

  // ───────── 0011: Google sadržaj koji je već u bazi ─────────
  faza("Migracija 0011: uklanja Google opis i Google koricu koji su već u bazi");
  // Upis kao postgres (servisna uloga je izuzeta od okidača), kao što bi nastao pre odluke o Google-u.
  await db.query(
    `insert into knjige (naslov, autor, izdavac, godina, isbn, izvor, opis, korice_url, korice_izvor) values
       ('G1 Google izvor', 'Autor G1', 'Izdavač G1', 2001, '9781234567897', 'google_books', 'Opis iz Google-a', 'https://books.google.com/books/content?id=1', 'google_books'),
       ('G2 Google korica kod člana', 'Autor G2', null, null, null, 'clan', 'Opis 2', 'https://books.google.com/books/content?id=2', 'google_books'),
       ('G3 Google bez korice', 'Autor G3', null, null, null, 'google_books', 'Opis 3', null, null),
       ('L1 Opis sa linka', 'Autor L1', null, null, null, 'clan', 'Opis sa linka', 'https://cdn.laguna.rs/z.jpg', 'og_slika'),
       ('F1 Opis iz fonda', 'Autor F1', null, null, null, 'fond', 'Opis iz COBISS-a', 'https://laguna.rs/f.jpg', 'fond'),
       ('P1 Fotografija', 'Autor P1', null, null, null, 'fond', null, 'https://jrmzgulxvxtpghwbhmrc.supabase.co/storage/v1/object/public/korice/p.jpg', 'fotografija')`
  );
  const SNIMAK = "select naslov, autor, izdavac, godina, isbn, izvor, opis, korice_url, korice_izvor from knjige where naslov ~ '^[GLFP][0-9] ' order by naslov";
  const pre0011 = Object.fromEntries((await db.query(SNIMAK)).rows.map((x) => [x.naslov.slice(0, 2), x]));
  ok(pre0011.G1.korice_url !== null && pre0011.G1.opis !== null, "pre 0011: Google redovi imaju opis i koricu (stanje koje se čisti)", pre0011.G1);
  for (const f of POSLEDNJA) await pusti(f);
  const posle0011 = (await db.query(SNIMAK)).rows;
  const p = Object.fromEntries(posle0011.map((x) => [x.naslov.slice(0, 2), x]));
  ok(p.G1.opis === null && p.G1.korice_url === null && p.G1.korice_izvor === null, "G1 (izvor google_books + Google korica): opis, korica i izvor korice su NULL", p.G1);
  ok(p.G1.naslov && p.G1.autor === "Autor G1" && p.G1.izdavac === "Izdavač G1" && p.G1.godina === 2001 && p.G1.isbn === "9781234567897",
    "G1: naslov, autor, izdavač, godina i ISBN ostaju (to je ono što član potvrđuje)", p.G1);
  ok(p.G1.izvor === "google_books", "G1: izvor knjige se ne menja (migracija ga ne dira)", p.G1.izvor);
  ok(p.G2.opis === null && p.G2.korice_url === null && p.G2.korice_izvor === null && p.G2.izvor === "clan", "G2 (korice_izvor google, izvor 'clan'): opis i korica su NULL", p.G2);
  ok(p.G3.opis === null && p.G3.izvor === "google_books", "G3 (izvor google_books, bez korice): opis je NULL", p.G3);
  ok(JSON.stringify(p.L1) === JSON.stringify(pre0011.L1), "L1 (opis i korica sa sajta izdavača) se ne dira", p.L1);
  ok(JSON.stringify(p.F1) === JSON.stringify(pre0011.F1) && p.F1.opis === "Opis iz COBISS-a", "F1 (opis iz fonda) se ne dira", p.F1);
  ok(JSON.stringify(p.P1) === JSON.stringify(pre0011.P1), "P1 (fotografija bibliotekara u našem Storage-u) se ne dira", p.P1);
  await db.exec(fs.readFileSync(path.join(MIGRACIJE, POSLEDNJA[0]), "utf8"));
  ok(JSON.stringify((await db.query(SNIMAK)).rows) === JSON.stringify(posle0011), "0011 je idempotentna: drugo puštanje ne menja ništa");

  faza("Migracija 0012 (nad bazom koja već ima zahteve u tabeli)");
  for (const f of NAKON) await pusti(f);

  faza("Migracije 0013 i 0014 (Storage: bucket i politike; korica preuzeta sa linka)");
  for (const f of STORAGE) await pusti(f);

  faza("Migracija 0015: ispravka liste domena za korice (baza sa starom i sa ispravnom listom)");
  const listaDomena = async () => (await db.query("select domen from privatno.domeni_korica order by 1")).rows.map((x) => x.domen);
  const ocekivana = [...new Set(DOZVOLJENI_DOMENI_KORICA)].filter((d) => !NOVI_DOMENI.includes(d)).sort();
  const pre0015 = await listaDomena();
  ok(JSON.stringify(pre0015) === JSON.stringify(ocekivana), "baza napravljena iz 0001–0014 već ima ispravnu listu (kao 0009 i bela-lista.js)", pre0015);
  for (const f of ISPRAVKA) await pusti(f);
  ok(JSON.stringify(await listaDomena()) === JSON.stringify(pre0015), "0015 na već ispravnoj bazi ne menja ništa", await listaDomena());

  // stara baza: Google domeni, bez našeg Supabase domena (stanje pre ručne ispravke)
  await db.query("delete from privatno.domeni_korica where domen = 'jrmzgulxvxtpghwbhmrc.supabase.co'");
  await db.query("insert into privatno.domeni_korica (domen) values ('books.google.com'), ('books.googleusercontent.com')");
  const STORAGE_ADRESA = "https://jrmzgulxvxtpghwbhmrc.supabase.co/storage/v1/object/public/korice/x/1.jpg";
  const staro = await db.query("select privatno.korice_dozvoljena('https://books.google.com/books/content?id=1') as g, privatno.korice_dozvoljena($1) as s", [STORAGE_ADRESA]);
  ok(staro.rows[0].g === true && staro.rows[0].s === false, "pre 0015 (stara lista): Google adresa je dozvoljena, a naš Storage nije", staro.rows[0]);
  for (const f of ISPRAVKA) await pusti(f);
  ok(JSON.stringify(await listaDomena()) === JSON.stringify(ocekivana), "0015 na staroj bazi: lista je tačno kao u bela-lista.js (Google domeni obrisani, Supabase domen dodat)", await listaDomena());
  const novo = await db.query("select privatno.korice_dozvoljena('https://books.google.com/books/content?id=1') as g, privatno.korice_dozvoljena('https://books.googleusercontent.com/x.jpg') as g2, privatno.korice_dozvoljena($1) as s, privatno.korice_dozvoljena('https://covers.openlibrary.org/b/isbn/1-M.jpg') as ol", [STORAGE_ADRESA]);
  ok(novo.rows[0].g === false && novo.rows[0].g2 === false && novo.rows[0].s === true && novo.rows[0].ol === true, "posle 0015: Google adrese su odbijene, naš Storage i Open Library su dozvoljeni", novo.rows[0]);
  await db.exec(fs.readFileSync(path.join(MIGRACIJE, ISPRAVKA[0]), "utf8"));
  ok(JSON.stringify(await listaDomena()) === JSON.stringify(ocekivana), "0015 je idempotentna: drugo puštanje ne menja listu", await listaDomena());
  await db.exec(fs.readFileSync(path.join(MIGRACIJE, ISPRAVKA[0]), "utf8"));

  faza("Migracija 0016: search_path = pg_catalog za norm_tekst, norm_sifra, dodirni_izmenjeno i isbn13");
  const POMOCNE = ["norm_tekst", "norm_sifra", "dodirni_izmenjeno", "isbn13"];
  const putanje = async () => Object.fromEntries((await db.query(
    `select p.proname, p.proconfig, p.provolatile, pg_get_function_identity_arguments(p.oid) as args from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'privatno' and p.proname = any($1) order by 1`, [POMOCNE])).rows.map((r) => [r.proname, r]));
  const pre16 = await putanje();
  ok(POMOCNE.every((n) => !(pre16[n]?.proconfig ?? []).some((c) => c.startsWith("search_path="))), "pre 0016: ove četiri funkcije nemaju postavljen search_path (stanje iz 0001, 0003 i 0010)", pre16);
  const UZORCI = ["Андрић Иво", "Đorđe Čolić", "ŠĆŽ ljubav Његош Џ", "", "A1 b2"];
  const SIFRE = ["NEG·4471·KJ", "neg 4471 kj", "  x-y_z 9 "];
  const izlazFunkcija = async () => ({
    tekst: (await db.query("select privatno.norm_tekst(t) as r from unnest($1::text[]) as t", [UZORCI])).rows.map((r) => r.r),
    sifre: (await db.query("select privatno.norm_sifra(t) as r from unnest($1::text[]) as t", [SIFRE])).rows.map((r) => r.r),
  });
  // isbn13 na ~2000 ulaza: ispravni i neispravni ISBN-10 i ISBN-13, sa X, sa crticama, smeće
  const ISBN_ULAZI = `select x from (
      select lpad(g::text, 10, '0') as x from generate_series(0, 9999999, 4999) g
      union all select '978' || lpad(g::text, 10, '0') from generate_series(0, 9999999, 4999) g
      union all select lpad((g % 1000000000)::text, 9, '0') || 'X' from generate_series(0, 9999999, 4999) g
      union all select unnest(array['978-86-521-2603-3', '0-306-40615-2', '0-8044-2957-X', '080442957x', 'ISBN 0-306-40615-2', '978-86-521-2603-4', '123', '', 'abc'])
    ) t`;
  const isbnOtisak = async () => (await db.query(`select count(*)::int as n, count(privatno.isbn13(x))::int as ispravnih, md5(string_agg(x || '=' || coalesce(privatno.isbn13(x), '-'), ',' order by x)) as otisak from (${ISBN_ULAZI}) q`)).rows[0];
  const isbnPre = await isbnOtisak();
  ok(isbnPre.n > 1500 && isbnPre.ispravnih > 100 && isbnPre.ispravnih < isbnPre.n - 100, "uzorak za isbn13 ima i ispravnih i neispravnih ulaza (provera nije prazna)", isbnPre);
  const izlazPre = await izlazFunkcija();
  for (const f of PUTANJA) await pusti(f);
  const posle16 = await putanje();
  ok(POMOCNE.every((n) => JSON.stringify(posle16[n]?.proconfig) === JSON.stringify(["search_path=pg_catalog"])), "posle 0016: sve četiri imaju search_path=pg_catalog", POMOCNE.map((n) => [n, posle16[n]?.proconfig]));
  ok(POMOCNE.every((n) => posle16[n].provolatile === pre16[n].provolatile && posle16[n].args === pre16[n].args), "volatilnost i potpis ostaju isti (norm_* su i dalje immutable, pa mogu u indeksima)", POMOCNE.map((n) => [n, posle16[n].provolatile, posle16[n].args]));
  const isbnPosle = await isbnOtisak();
  ok(JSON.stringify(isbnPosle) === JSON.stringify(isbnPre), "isbn13 daje iste rezultate kao pre 0016 na istim ulazima (broj, broj ispravnih i otisak svih rezultata)", { pre: isbnPre, posle: isbnPosle });
  ok(JSON.stringify(await izlazFunkcija()) === JSON.stringify(izlazPre), "norm_tekst i norm_sifra daju iste rezultate kao pre (ćirilica, latinica, kvačice, razdelnici)", await izlazFunkcija());
  const izvor16 = fs.readFileSync(path.join(MIGRACIJE, PUTANJA[0]), "utf8").replace(/^--.*$/gm, "");
  ok(!/create\s+(or\s+replace\s+)?function|drop\s/i.test(izvor16) && (izvor16.match(/alter function/g) ?? []).length === 4, "0016 samo menja postojeće funkcije (alter function), ne piše ih iznova", izvor16);
  await db.exec(fs.readFileSync(path.join(MIGRACIJE, PUTANJA[0]), "utf8"));
  ok(JSON.stringify(await putanje()) === JSON.stringify(posle16), "0016 je idempotentna: drugo puštanje ništa ne menja", await putanje());

  faza("Migracija 0017: napredak čitanja, autor utiska (nadimak), rezervacija samo za fond");
  for (const f of POLICA) await pusti(f);

  // ───────── podaci za dalje provere ─────────
  const A = "11111111-1111-4111-8111-111111111111";
  const NEAKTIVAN = "22222222-2222-4222-8222-222222222222";
  const BIB = "33333333-3333-4333-8333-333333333333";
  const ADM = "88888888-8888-4888-8888-888888888888";
  await db.query("insert into auth.users (id) values ($1), ($2), ($3), ($4)", [A, NEAKTIVAN, BIB, ADM]);
  await db.query(
    `insert into clanovi (id, broj_kartice, ime, uloga, aktivan) values
       ($1, '0101228', 'Čitalac A', 'citalac', true),
       ($2, 'STARA', 'Neaktivna', 'citalac', false),
       ($3, 'BIB1', 'Bibliotekar', 'bibliotekar', true),
       ($4, 'ADM1', 'Administrator', 'administrator', true)`,
    [A, NEAKTIVAN, BIB, ADM]
  );
  await db.query(
    `insert into knjige (naslov, autor, izdavac, godina, isbn, u_fondu, broj_primeraka, broj_slobodnih, izvor) values
       ('На Дрини ћуприја', 'Иво Андрић', 'Просвета', 1945, '978-86-521-2603-3', true, 2, 1, 'fond'),
       ('Prokleta avlija', 'Ivo Andrić', 'Laguna', 2010, '9788652126033', false, 0, 0, 'clan'),
       ('Zlatni znak', 'Ivo Andrić', 'Dereta', 2015, null, true, 1, 0, 'fond'),
       ('Gospođica', 'Ivo Andrić', null, null, null, true, 1, 1, 'fond'),
       ('Seobe', 'Miloš Crnjanski', 'Laguna', 2008, '9788652117857', true, 3, 3, 'fond'),
       ('Seobe (duplikat)', 'Crnjanski', null, null, null, false, 0, 0, 'clan'),
       ('Stogodišnjak % koji je pobegao', 'Jonas Jonasson', null, null, null, false, 0, 0, 'clan'),
       ('1984', 'Džordž Orvel', null, null, null, true, 1, 1, 'fond')`
  );
  await db.query("update knjige set spojena_sa_id = (select id from knjige where naslov = 'Seobe') where naslov = 'Seobe (duplikat)'");
  const naslovi = (r) => (r.redovi ?? []).map((x) => x.naslov);

  // ───────── trazi_knjige ─────────
  faza("trazi_knjige: ćirilica i latinica, ISBN, džokeri");
  let r = await kao("authenticated", A, "select * from public.trazi_knjige($1)", ["andric"]);
  ok(!r.greska && naslovi(r).length === 4, "'andric' (latinica, bez kvačica) nalazi sva 4 dela Ive Andrića, i ćirilična i latinična", r.greska?.message ?? naslovi(r));
  r = await kao("authenticated", A, "select * from public.trazi_knjige($1)", ["Андрић"]);
  ok(!r.greska && naslovi(r).length === 4, "'Андрић' (ćirilica) daje isti skup", r.greska?.message ?? naslovi(r));
  r = await kao("authenticated", A, "select * from public.trazi_knjige($1)", ["na drini cuprija"]);
  ok(!r.greska && naslovi(r).join() === "На Дрини ћуприја", "'na drini cuprija' nalazi ćirilični naslov", r.greska?.message ?? naslovi(r));
  r = await kao("authenticated", A, "select * from public.trazi_knjige($1)", ["ИВО андрић ПРОКЛЕТА"]);
  ok(!r.greska && naslovi(r).join() === "Prokleta avlija", "reči mogu da budu iz naslova i autora, u mešovitom pismu", r.greska?.message ?? naslovi(r));
  r = await kao("authenticated", A, "select * from public.trazi_knjige($1)", ["andric"]);
  ok(r.redovi?.[0]?.u_fondu === true && r.redovi.at(-1)?.u_fondu === false, "knjige iz fonda idu prve", r.redovi?.map((x) => `${x.naslov}:${x.u_fondu}`));
  r = await kao("authenticated", A, "select * from public.trazi_knjige($1)", ["seobe"]);
  ok(!r.greska && naslovi(r).join() === "Seobe", "spojeni duplikat se ne prikazuje", r.greska?.message ?? naslovi(r));
  for (const upit of ["a", "", "  ", "%", "%%", "_", "% _"]) {
    r = await kao("authenticated", A, "select * from public.trazi_knjige($1)", [upit]);
    ok(!r.greska && r.redovi.length === 0, `upit ${JSON.stringify(upit)} (prekratak ili samo džokeri) ne vraća ništa`, r.greska?.message ?? naslovi(r));
  }
  r = await kao("authenticated", A, "select * from public.trazi_knjige($1)", ["100% pobegao"]);
  ok(!r.greska && r.redovi.length === 0, "'%' u upitu nije džoker", r.greska?.message ?? naslovi(r));
  r = await kao("authenticated", A, "select * from public.trazi_knjige($1, 1)", ["andric"]);
  ok(!r.greska && r.redovi.length === 1, "drugi argument ograničava broj rezultata", r.greska?.message ?? r.redovi?.length);
  r = await kao("authenticated", NEAKTIVAN, "select * from public.trazi_knjige($1)", ["andric"]);
  ok(!r.greska && r.redovi.length === 0, "neaktivan član ne dobija ništa (RLS važi i kroz funkciju)", r.greska?.message ?? naslovi(r));
  r = await kao("anon", null, "select * from public.trazi_knjige($1)", ["andric"]);
  ok(nemaPrava(r), "anon ne sme da zove trazi_knjige", r.greska?.message ?? naslovi(r));
  r = await kao("authenticated", A, "select * from public.trazi_knjige($1)", ["1984"]);
  ok(!r.greska && naslovi(r).join() === "1984", "naslov od samih cifara ('1984') se traži kao tekst, ne kao ISBN", r.greska?.message ?? naslovi(r));

  faza("trazi_knjige: ISBN u svim oblicima nalazi isti zapis (0010)");
  // Isti ISBN imaju tri zapisa: „На Дрини ћуприја" i „Prokleta avlija" (upisani posle 0010, jedan
  // sa crticama, jedan bez) i „Stara dobra korica" (upisan pre 0010 sa crticama, normalizovan migracijom).
  for (const upit of ["978-86-521-2603-3", "9788652126033", "978 86 521 2603 3"]) {
    r = await kao("authenticated", A, "select * from public.trazi_knjige($1)", [upit]);
    ok(!r.greska && r.redovi.length === 3, `upit ${JSON.stringify(upit)} nalazi sva 3 zapisa istog ISBN-a (i onaj normalizovan migracijom)`, r.greska?.message ?? naslovi(r));
  }
  r = await kao("authenticated", A, "select * from public.trazi_knjige($1)", ["86-521-2603-3"]);
  ok(!r.greska && r.redovi.length === 0, "10 cifara sa pogrešnim kontrolnim brojem nije ISBN-10 i ne pogađa ništa", r.greska?.message ?? naslovi(r));
  r = await kao("authenticated", A, "select * from public.trazi_knjige($1)", ["0-306-40615-2"]);
  ok(!r.greska && naslovi(r).join() === "Stari ISBN-10", "upit ISBN-10 nalazi zapis koji je sačuvan kao ISBN-13", r.greska?.message ?? naslovi(r));
  r = await kao("authenticated", A, "select * from public.trazi_knjige($1)", ["9780306406157"]);
  ok(!r.greska && naslovi(r).join() === "Stari ISBN-10", "upit ISBN-13 nalazi isti zapis", r.greska?.message ?? naslovi(r));
  r = await kao("authenticated", A, "select * from public.trazi_knjige($1)", ["0306406153"]);
  ok(!r.greska && r.redovi.length === 0, "ISBN-10 sa pogrešnim kontrolnim brojem ne pogađa ništa", r.greska?.message ?? naslovi(r));

  // ───────── ISBN: JS i SQL daju isti rezultat ─────────
  faza("ISBN: JS (src/lib/isbn.js) i SQL (privatno.isbn13) su isto pravilo");
  let seme = 20260101;
  const slucajno = (n) => {
    seme = (seme * 1664525 + 1013904223) % 4294967296;
    return Math.floor((seme / 4294967296) * n);
  };
  const cifre = (n) => Array.from({ length: n }, () => slucajno(10));
  const isbn10 = () => {
    const d = cifre(9);
    const c = (11 - (d.reduce((z, x, i) => z + x * (10 - i), 0) % 11)) % 11;
    return d.join("") + (c === 10 ? "X" : String(c));
  };
  const isbn13 = () => {
    const d = [9, 7, slucajno(2) ? 9 : 8, ...cifre(9)];
    const c = (10 - (d.reduce((z, x, i) => z + x * (i % 2 ? 3 : 1), 0) % 10)) % 10;
    return d.join("") + c;
  };
  const pokvari = (s) => {
    const i = slucajno(s.length - 1);
    const zamena = String((Number(s[i]) + 1 + slucajno(8)) % 10);
    return s.slice(0, i) + zamena + s.slice(i + 1);
  };
  const crtice = (s) => s.slice(0, 3) + "-" + s.slice(3, 5) + "-" + s.slice(5, 8) + " " + s.slice(8);
  const uzorci = [
    "978-86-521-2603-3", "9788652126033", "0-306-40615-2", "0306406152", "0-8044-2957-X", "080442957x", "ISBN 0-306-40615-2",
    "978-86-521-2603-4", "97886521260", "123", "", " ", "abc", "0306406153", "03064061520", "0-306-4061X-2", "xxxxxxxxxx", "9780306406157 ",
    "९७८०३०६४०६१५७" /* devanagari cifre */, "978-0-306-40615-7",
  ];
  for (let i = 0; i < 150; i++) {
    const a = isbn10();
    const b = isbn13();
    uzorci.push(a, b, crtice(b), a.toLowerCase(), pokvari(a), pokvari(b), cifre(slucajno(15)).join("") + (slucajno(2) ? "X" : ""));
  }
  const sqlRezultat = await db.query("select ord::int as ord, privatno.isbn13(x) as r from unnest($1::text[]) with ordinality as t(x, ord) order by ord", [uzorci]);
  const razlike = [];
  uzorci.forEach((u, i) => {
    const sql = sqlRezultat.rows[i].r;
    const js = uIsbn13(u);
    if ((sql ?? null) !== (js ?? null)) razlike.push({ ulaz: u, js, sql });
  });
  ok(razlike.length === 0, `JS i SQL se slažu na svih ${uzorci.length} primera (fiksnih i slučajnih; ispravni, pokvareni, smeće)`, razlike.slice(0, 5));
  const ispravnih = uzorci.filter((u) => uIsbn13(u) !== null).length;
  ok(ispravnih > 400 && ispravnih < uzorci.length - 100, "uzorak ima i ispravnih i neispravnih (provera nije prazna)", { ispravnih, ukupno: uzorci.length });

  // ───────── ISBN: okidač pri upisu ─────────
  faza("ISBN: normalizacija pri upisu (okidač)");
  const upisiKnjigu = (uloga, sub, naslov, isbn) =>
    kao(uloga, sub, "insert into public.knjige (naslov, isbn) values ($1, $2) returning isbn", [naslov, isbn]);
  r = await upisiKnjigu("authenticated", A, "ISBN test 1", "0-306-40615-2");
  ok(r.redovi?.[0]?.isbn === "9780306406157", "član: ISBN-10 sa crticama se čuva kao ISBN-13", r.greska?.message ?? r.redovi);
  r = await upisiKnjigu("authenticated", A, "ISBN test 2", "0-8044-2957-x");
  ok(r.redovi?.[0]?.isbn === "9780804429573", "član: ISBN-10 sa malim 'x' se čuva kao ISBN-13", r.greska?.message ?? r.redovi);
  r = await upisiKnjigu("authenticated", A, "ISBN test 3", "978 86 521 2603 3");
  ok(r.redovi?.[0]?.isbn === "9788652126033", "član: ISBN-13 sa razmacima se čuva bez razmaka", r.greska?.message ?? r.redovi);
  r = await upisiKnjigu("authenticated", A, "ISBN test 4", "");
  ok(r.redovi?.[0]?.isbn === null, "član: prazan ISBN postaje NULL", r.greska?.message ?? r.redovi);
  r = await upisiKnjigu("authenticated", A, "ISBN test 5", "978-86-521-2603-4");
  ok(r.greska && (r.greska.code === "22023" || r.greska.message.includes("ISBN nije ispravan")), "član: ISBN sa pogrešnim kontrolnim brojem se odbija sa jasnom greškom", r.greska?.message ?? r.redovi);
  r = await upisiKnjigu("authenticated", BIB, "ISBN test 6", "nije isbn");
  ok(r.greska?.message?.includes("ISBN nije ispravan"), "bibliotekar: neispravan ISBN se odbija (da zna da je pogrešio)", r.greska?.message ?? r.redovi);
  r = await upisiKnjigu("service_role", null, "ISBN test 7", " 123-456 ");
  ok(r.redovi?.[0]?.isbn === "123-456", "servis: neispravan ISBN se čuva (bez razmaka sa krajeva), uvoz ne gubi zapis", r.greska?.message ?? r.redovi);
  r = await upisiKnjigu("service_role", null, "ISBN test 8", "0306406152");
  ok(r.redovi?.[0]?.isbn === "9780306406157", "servis: ispravan ISBN-10 se i tu normalizuje", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", BIB, "update public.knjige set isbn = '080442957X' where naslov = 'ISBN test 1' returning isbn");
  ok(r.redovi?.[0]?.isbn === "9780804429573", "izmena ISBN-a se takođe normalizuje (UPDATE)", r.greska?.message ?? r.redovi);

  // ───────── korice: pravilo i okidač ─────────
  faza("Korice: samo https, do 500 znakova, samo dozvoljeni domeni (0009)");
  const upisiKoricu = (uloga, sub, naslov, url, izvor = "og_slika") =>
    kao(uloga, sub, "insert into public.knjige (naslov, korice_url, korice_izvor) values ($1, $2, $3) returning korice_url, korice_izvor", [naslov, url, izvor]);
  const SLUCAJEVI = [
    ["https://covers.openlibrary.org/b/isbn/9788652126033-M.jpg", true, "Open Library"],
    ["https://jrmzgulxvxtpghwbhmrc.supabase.co/storage/v1/object/public/korice/1.jpg", true, "naš Supabase Storage"],
    ["https://books.google.com/books/content?id=a&zoom=1", false, "Google Books (ne čuva se)"],
    ["https://books.googleusercontent.com/x", false, "Google (googleusercontent, ne čuva se)"],
    ["https://tudji-projekat.supabase.co/storage/v1/object/public/korice/1.jpg", false, "tuđi Supabase projekat"],
    ["https://supabase.co/x.jpg", false, "supabase.co bez našeg projekta"],
    ["https://laguna.rs/k.jpg", true, "izdavač sa liste"],
    ["https://cdn.laguna.rs/k.jpg", true, "poddomen izdavača"],
    ["https://LAGUNA.RS/k.jpg", true, "veliko slovo u domenu"],
    ["http://books.google.com/x", false, "http"],
    ["https://evil.com/pratilac.gif", false, "tuđ server"],
    ["https://laguna.rs.evil.com/k", false, "domen sa liste kao prefiks tuđeg"],
    ["https://evil-laguna.rs/k", false, "domen koji samo liči na listu"],
    ["https://books.google.com@evil.com/k", false, "userinfo trik"],
    ["https://user:lozinka@laguna.rs/k", false, "korisnik i lozinka u adresi"],
    ["https://laguna.rs:8443/k", false, "port"],
    ["https://127.0.0.1/k", false, "IP adresa"],
    ["https://[::1]/k", false, "IPv6 adresa"],
    ["https://laguna.rs./k", false, "domen sa tačkom na kraju"],
    ["https://laguna.rs/a b.jpg", false, "razmak u adresi"],
    ["https://laguna.rs/a\tb.jpg", false, "tabulator u adresi"],
    ["HTTPS://laguna.rs/k", false, "veliko slovo u šemi (strogo pravilo)"],
    ["ftp://laguna.rs/k", false, "druga šema"],
    ["//laguna.rs/k", false, "bez šeme"],
    ["javascript:alert(1)", false, "javascript:"],
    ["https://laguna.rs/" + "a".repeat(482), true, "tačno 500 znakova"],
    ["https://laguna.rs/" + "a".repeat(483), false, "501 znak"],
  ];
  for (const [adresa, dozvoljena, opis] of SLUCAJEVI) {
    r = await upisiKoricu("authenticated", A, `Korica ${opis}`, adresa);
    const red = r.redovi?.[0];
    const dobro = dozvoljena
      ? red?.korice_url === adresa && red.korice_izvor === "og_slika"
      : red && red.korice_url === null && red.korice_izvor === null;
    ok(Boolean(dobro), `član: ${dozvoljena ? "zadržava se" : "postaje NULL (i izvor), knjiga se upisuje"} — ${opis}`, r.greska?.message ?? red);
  }
  // Isto pravilo u JS-u i u SQL funkciji.
  const sqlPravilo = await db.query("select privatno.korice_dozvoljena(x) as r from unnest($1::text[]) with ordinality as t(x, o) order by o", [SLUCAJEVI.map((s) => s[0])]);
  const razlikeKorica = SLUCAJEVI.filter((s, i) => sqlPravilo.rows[i].r !== koricaJeDozvoljena(s[0]) || sqlPravilo.rows[i].r !== s[1]).map((s) => s[0].slice(0, 70));
  ok(razlikeKorica.length === 0, `SQL funkcija i JS (koricaJeDozvoljena) daju isti odgovor na svih ${SLUCAJEVI.length} primera`, razlikeKorica);

  r = await upisiKoricu("authenticated", A, "Korica bez izvora", "https://evil.com/x.gif", null);
  ok(r.redovi?.[0]?.korice_url === null && r.redovi[0].korice_izvor === null, "nedozvoljena korica bez izvora: oboje NULL", r.greska?.message ?? r.redovi);
  r = await upisiKoricu("authenticated", A, "Izvor bez korice", null, "google_books");
  ok(r.redovi?.[0]?.korice_url === null && r.redovi[0].korice_izvor === null, "izvor korice bez korice se briše (nema smisla)", r.greska?.message ?? r.redovi);
  r = await upisiKoricu("authenticated", A, "Korica Google izvor", "https://books.google.com/books/content?id=z", "google_books");
  ok(r.redovi?.[0]?.korice_url === null && r.redovi[0].korice_izvor === null, "član: Google korica (i izvor 'google_books') se NIKAD ne čuva: oboje NULL", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", BIB, "update public.knjige set korice_url = 'https://evil.com/x.gif', korice_izvor = 'fotografija' where naslov = 'Korica Open Library' returning korice_url, korice_izvor");
  ok(r.redovi?.[0]?.korice_url === null && r.redovi[0].korice_izvor === null, "UPDATE: ni bibliotekar ne može da postavi koricu sa tuđeg servera (postaje NULL)", r.greska?.message ?? r.redovi);
  const FOTO = "https://jrmzgulxvxtpghwbhmrc.supabase.co/storage/v1/object/public/korice/foto.jpg";
  r = await kao("authenticated", BIB, "update public.knjige set korice_url = $1, korice_izvor = 'fotografija' where naslov = 'Korica naš Supabase Storage' returning korice_url, korice_izvor", [FOTO]);
  ok(r.redovi?.[0]?.korice_url === FOTO && r.redovi[0].korice_izvor === "fotografija", "bibliotekar okači fotografiju korice u našem Storage-u: ostaje (ne postaje NULL)", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", BIB, "update public.knjige set naslov = 'Korica naš Supabase Storage (izmenjena)' where naslov = 'Korica naš Supabase Storage' returning korice_url");
  ok(r.redovi?.[0]?.korice_url === FOTO, "UPDATE drugog polja ne dira koricu", r.greska?.message ?? r.redovi);

  r = await upisiKoricu("service_role", null, "Servis: tuđa korica", "https://evil.com/x.gif", "fotografija");
  ok(r.redovi?.[0]?.korice_url === "https://evil.com/x.gif" && r.redovi[0].korice_izvor === "fotografija", "servisna uloga je izuzeta: INSERT sa bilo kojom adresom prolazi", r.greska?.message ?? r.redovi);
  r = await kao("service_role", null, "update public.knjige set korice_url = 'http://nesigurno.example/x.gif' where naslov = 'Servis: tuđa korica' returning korice_url");
  ok(r.redovi?.[0]?.korice_url === "http://nesigurno.example/x.gif", "servisna uloga je izuzeta i za UPDATE", r.greska?.message ?? r.redovi);

  faza("Korice: lista domena (privatno.domeni_korica) i prava");
  const uBazi = (await db.query("select domen from privatno.domeni_korica order by domen")).rows.map((x) => x.domen);
  const uJs = [...DOZVOLJENI_DOMENI_KORICA].filter((d) => !NOVI_DOMENI.includes(d)).sort();
  ok(JSON.stringify(uBazi) === JSON.stringify(uJs), "lista domena u bazi = DOZVOLJENI_DOMENI_KORICA u api/_lib/bela-lista.js (nema razilaženja)", {
    samoUBazi: uBazi.filter((d) => !uJs.includes(d)),
    samoUJs: uJs.filter((d) => !uBazi.includes(d)),
  });
  for (const uloga of ["anon", "authenticated"]) {
    r = await kao(uloga, A, "select * from privatno.domeni_korica");
    ok(nemaPrava(r), `${uloga} ne vidi listu domena`, r.greska?.message ?? r.redovi?.length);
    r = await kao(uloga, A, "insert into privatno.domeni_korica (domen) values ('evil.com')");
    ok(nemaPrava(r), `${uloga} ne može da doda domen`, r.greska?.message ?? r.redovi);
  }
  r = await kao("service_role", null, "select count(*)::int as n from privatno.domeni_korica");
  ok(r.redovi?.[0]?.n === uJs.length, "service_role vidi listu domena", r.greska?.message ?? r.redovi);
  const rlsDomeni = await db.query(`select c.relrowsecurity, (select count(*)::int from pg_policy p where p.polrelid = c.oid) as politika
                                    from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'privatno' and c.relname = 'domeni_korica'`);
  ok(rlsDomeni.rows[0]?.relrowsecurity && rlsDomeni.rows[0].politika >= 1, "domeni_korica ima RLS i bar jednu politiku", rlsDomeni.rows);
  r = await kao("authenticated", A, "insert into public.knjige (naslov, korice_url) values ('Korica posle brisanja domena', 'https://laguna.rs/x.jpg') returning korice_url");
  ok(r.redovi?.[0]?.korice_url === "https://laguna.rs/x.jpg", "član ne mora da ima pristup tabeli domena da bi okidač radio (definer funkcija)", r.greska?.message ?? r.redovi);
  await db.query("insert into privatno.domeni_korica (domen) values ('novi-izdavac.rs')");
  r = await upisiKoricu("authenticated", A, "Korica novi domen", "https://slike.novi-izdavac.rs/k.jpg");
  ok(r.redovi?.[0]?.korice_url === "https://slike.novi-izdavac.rs/k.jpg", "domen dodat INSERT-om u tabelu važi odmah (bez prepisivanja funkcije)", r.greska?.message ?? r.redovi);
  await db.query("delete from privatno.domeni_korica where domen = 'novi-izdavac.rs'");

  // ───────── uzmi_zahtev i keš (0007) ─────────
  faza("uzmi_zahtev i tabele samo za service_role (0007)");
  const KLJUC = "select public.uzmi_zahtev($1, 'test', 30, 3600) as o";
  let dozvoljeno = 0;
  let odbijeno = null;
  for (let i = 0; i < 31; i++) {
    r = await kao("service_role", null, KLJUC, [A]);
    if (r.greska) {
      ok(false, "uzmi_zahtev kao service_role", r.greska.message);
      break;
    }
    if (r.redovi[0].o.dozvoljeno) dozvoljeno++;
    else odbijeno = r.redovi[0].o;
  }
  ok(dozvoljeno === 30, "prvih 30 zahteva prolazi", dozvoljeno);
  ok(odbijeno && odbijeno.dozvoljeno === false && odbijeno.ponovo_za_sekundi > 3500 && odbijeno.ponovo_za_sekundi <= 3600, "31. je odbijen i javlja kad da se pokuša ponovo", odbijeno);
  r = await kao("service_role", null, KLJUC, [BIB]);
  ok(r.redovi?.[0]?.o.dozvoljeno === true && r.redovi[0].o.preostalo === 29, "ograničenje je po članu: drugi član počinje od 30", r.redovi?.[0]?.o);
  const STARI = "44444444-4444-4444-8444-444444444444";
  await db.query("insert into auth.users (id) values ($1)", [STARI]);
  await db.query("insert into clanovi (id, broj_kartice, ime) values ($1, 'STARI', 'Stari')", [STARI]);
  await db.query("insert into zahtevi_api (clan_id, akcija, vreme) select $1, 'x', now() - interval '2 hours' from generate_series(1, 30)", [STARI]);
  r = await kao("service_role", null, KLJUC, [STARI]);
  ok(r.redovi?.[0]?.o.dozvoljeno === true, "zahtevi stariji od sat vremena se ne broje", r.greska?.message ?? r.redovi?.[0]?.o);
  for (const uloga of ["anon", "authenticated"]) {
    r = await kao(uloga, A, KLJUC, [A]);
    ok(nemaPrava(r), `${uloga} ne sme da zove uzmi_zahtev`, r.greska?.message ?? r.redovi);
    for (const t of ["kes_linkova", "zahtevi_api"]) {
      r = await kao(uloga, A, `select * from public.${t}`);
      ok(nemaPrava(r), `${uloga} ne vidi ${t}`, r.greska?.message ?? r.redovi);
      r = await kao(uloga, A, t === "kes_linkova" ? "insert into public.kes_linkova (url, odgovor, istice) values ('x','{}', now())" : "insert into public.zahtevi_api (clan_id, akcija) values ($1, 'x')", t === "kes_linkova" ? [] : [A]);
      ok(nemaPrava(r), `${uloga} ne sme da piše u ${t}`, r.greska?.message ?? r.redovi);
    }
  }
  r = await kao("service_role", null, "insert into public.kes_linkova (url, odgovor, istice) values ('https://laguna.rs/x', '{\"naslov\":\"T\"}', now() + interval '7 days') returning url");
  ok(!r.greska && r.redovi.length === 1, "service_role sme da upiše u keš", r.greska?.message);
  const rls = await db.query(`select c.relname, c.relrowsecurity, (select count(*)::int from pg_policy p where p.polrelid = c.oid) as politika
                              from pg_class c where c.relname in ('kes_linkova','zahtevi_api') order by 1`);
  ok(rls.rows.length === 2 && rls.rows.every((x) => x.relrowsecurity && x.politika >= 1), "obe tabele imaju RLS i bar jednu politiku", rls.rows);

  // ───────── 0012: ograničenje po kanti ─────────
  faza("0012: ograničenje zahteva se broji po kanti (opšta 30, bibliotekarska 200)");
  const ID_KANTE = "55555555-5555-4555-8555-555555555555";
  await db.query("insert into auth.users (id) values ($1)", [ID_KANTE]);
  await db.query("insert into clanovi (id, broj_kartice, ime) values ($1, 'KANTE', 'Kante')", [ID_KANTE]);
  const uzmi = (kanta, najvise) => kao("service_role", null, "select public.uzmi_zahtev($1, $2, $3, 3600) as o", [ID_KANTE, kanta, najvise]);
  for (let i = 0; i < 30; i++) await uzmi("api", 30);
  r = await uzmi("api", 30);
  ok(r.redovi?.[0]?.o.dozvoljeno === false, "kanta 'api': 31. zahtev je odbijen", r.greska?.message ?? r.redovi?.[0]?.o);
  r = await uzmi("iz-linka:bibliotekar", 200);
  ok(r.redovi?.[0]?.o.dozvoljeno === true && r.redovi[0].o.preostalo === 199, "potrošena kanta 'api' ne dira bibliotekarsku (ima svoje brojanje: preostalo 199)", r.greska?.message ?? r.redovi?.[0]?.o);
  let proslo = 1;
  for (let i = 1; i < 200; i++) if ((await uzmi("iz-linka:bibliotekar", 200)).redovi?.[0]?.o.dozvoljeno) proslo++;
  r = await uzmi("iz-linka:bibliotekar", 200);
  ok(proslo === 200 && r.redovi?.[0]?.o.dozvoljeno === false, "bibliotekarska kanta: 200 zahteva prolazi, 201. je odbijen", { proslo, sledeci: r.redovi?.[0]?.o });
  r = await uzmi("pretraga-test", 30);
  ok(r.redovi?.[0]?.o.dozvoljeno === true, "treća kanta nije dotaknuta ni posle potrošene opšte i bibliotekarske", r.greska?.message ?? r.redovi?.[0]?.o);
  const poKanti = Object.fromEntries((await db.query("select akcija, count(*)::int as n from zahtevi_api where clan_id = $1 group by 1", [ID_KANTE])).rows.map((x) => [x.akcija, x.n]));
  ok(poKanti.api === 30 && poKanti["iz-linka:bibliotekar"] === 200 && poKanti["pretraga-test"] === 1, "u tabeli je tačno po kanti: 30 + 200 + 1", poKanti);
  for (const uloga of ["anon", "authenticated"]) {
    r = await kao(uloga, A, "select public.uzmi_zahtev($1, 'iz-linka:bibliotekar', 200000, 3600) as o", [A]);
    ok(nemaPrava(r), `${uloga} ne može da pozove uzmi_zahtev (ni sa izmišljenim većim limitom)`, r.greska?.message ?? r.redovi);
  }

  // ───────── bibliotekar: unos knjige, stanje, primerci ─────────
  faza("Bibliotekar: upis knjige i broj primeraka (ekran za unos linkovima)");
  const ISBN_BIB = "9780306406164";
  ok(uIsbn13("0-306-40616-0") === ISBN_BIB, "pripremni ISBN-10 i ISBN-13 su ista knjiga", uIsbn13("0-306-40616-0"));
  const UNOS = `insert into public.knjige (naslov, autor, izdavac, godina, isbn, zanrovi, opis, signatura, u_fondu, broj_primeraka, broj_slobodnih, izvor, uneo_id, korice_url, korice_izvor)
                values ($1, 'Autor', 'Izdavač', 2019, $2, $3, $4, $5, $6, $7, $7, $8, $9, $10, $11) returning *`;
  const bibUnos = (uloga, sub, naslov, o) =>
    kao(uloga, sub, UNOS, [naslov, o.isbn ?? null, o.zanrovi ?? ["roman"], o.opis ?? null, o.signatura ?? null, o.uFondu, o.primerci, o.izvor, o.uneo ?? sub, o.korica ?? null, o.korica ? "og_slika" : null]);

  r = await bibUnos("authenticated", BIB, "Bib: fond", { isbn: "0-306-40616-0", uFondu: true, primerci: 3, izvor: "fond", signatura: "821.163", opis: "Opis bibliotekara", zanrovi: ["roman", "istorijski roman"], korica: "https://cdn.laguna.rs/x.jpg" });
  const fond = r.redovi?.[0];
  ok(fond && fond.u_fondu === true && fond.broj_primeraka === 3 && fond.broj_slobodnih === 3 && fond.izvor === "fond" && fond.signatura === "821.163",
    "bibliotekar „U fondu”: u_fondu, 3 primerka (3 slobodna), izvor 'fond' i signatura ostaju kako su uneti (okidač ih ne dira)", r.greska?.message ?? fond);
  ok(fond?.isbn === ISBN_BIB && fond.zanrovi.join() === "roman,istorijski roman" && fond.opis === "Opis bibliotekara" && fond.uneo_id === BIB && fond.korice_url === "https://cdn.laguna.rs/x.jpg" && fond.korice_izvor === "og_slika",
    "ISBN-10 je normalizovan u ISBN-13, žanrovi, opis bibliotekara, uneo_id i korica sa liste domena ostaju", fond);

  r = await bibUnos("authenticated", BIB, "Bib: nabavka", { uFondu: false, primerci: 0, izvor: "link", signatura: null });
  const nabavka = r.redovi?.[0];
  ok(nabavka && nabavka.u_fondu === false && nabavka.broj_primeraka === 0 && nabavka.broj_slobodnih === 0 && nabavka.izvor === "link",
    "bibliotekar „Za nabavku”: u_fondu=false, bez primeraka, izvor 'link' ostaje (okidač ga ne vraća na 'clan')", r.greska?.message ?? nabavka);

  r = await bibUnos("authenticated", BIB, "Bib: korica van liste", { uFondu: false, primerci: 0, izvor: "link", korica: "https://evil.com/pratilac.gif" });
  ok(r.redovi?.[0]?.korice_url === null && r.redovi[0].korice_izvor === null, "korica van liste dozvoljenih: i bibliotekaru postaje NULL (pločica), knjiga se ipak upisuje", r.greska?.message ?? r.redovi);

  r = await bibUnos("authenticated", A, "Čitalac: pokušaj fonda", { uFondu: true, primerci: 9, izvor: "fond", signatura: "S-1", uneo: BIB });
  const citalac = r.redovi?.[0];
  ok(citalac && citalac.izvor === "clan" && citalac.u_fondu === false && citalac.broj_primeraka === 0 && citalac.broj_slobodnih === 0 && citalac.signatura === null && citalac.uneo_id === A,
    "čitalac koji pošalje isto: okidač vraća izvor 'clan', u_fondu=false, 0 primeraka, bez signature, uneo_id = on sam", r.greska?.message ?? citalac);

  r = await kao("authenticated", A, "update public.knjige set broj_primeraka = 99, broj_slobodnih = 99, u_fondu = true where id = $1 returning id", [nabavka.id]);
  const posleCitaoca = (await db.query("select u_fondu, broj_primeraka from knjige where id = $1", [nabavka.id])).rows[0];
  ok(!r.greska && r.redovi.length === 0 && posleCitaoca.u_fondu === false && posleCitaoca.broj_primeraka === 0,
    "čitalac ne može da poveća broj primeraka ni da prebaci knjigu u fond (0 izmenjenih redova, stanje isto)", { greska: r.greska?.message, redova: r.redovi?.length, posleCitaoca });

  const POVECAJ = "update public.knjige set u_fondu = true, broj_primeraka = $2, broj_slobodnih = $3 where id = $1 and broj_primeraka = $4 and broj_slobodnih = $5 returning id, broj_primeraka";
  r = await kao("authenticated", BIB, POVECAJ, [fond.id, 5, 5, 3, 3]);
  ok(!r.greska && r.redovi.length === 1 && r.redovi[0].broj_primeraka === 5, "bibliotekar povećava broj primeraka sa 3 na 5", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", BIB, POVECAJ, [fond.id, 5, 5, 3, 3]);
  ok(!r.greska && r.redovi.length === 0, "ista izmena sa zastarelom vrednošću (uslov na staro stanje) ne menja ništa: hvata istovremenu izmenu", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", BIB, POVECAJ, [nabavka.id, 2, 2, 0, 0]);
  ok(!r.greska && r.redovi.length === 1, "zapis „nije u fondu” postaje deo fonda sa 2 primerka (bibliotekar)", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", BIB, "update public.knjige set broj_slobodnih = 99 where id = $1", [fond.id]);
  ok(Boolean(r.greska), "slobodnih ne može biti više od primeraka (ograničenje u bazi)", r.greska?.message ?? r.redovi);

  // Provera duplikata kakvu radi nadjiDuplikate: trazi_knjige po ISBN-u i po naslovu + autoru
  r = await kao("authenticated", BIB, "select id from public.trazi_knjige($1)", ["0-306-40616-0"]);
  ok(!r.greska && r.redovi.some((x) => x.id === fond.id), "duplikat po ISBN-u: upit ISBN-10 nalazi zapis sačuvan kao ISBN-13", r.greska?.message ?? r.redovi);
  await db.query("insert into knjige (naslov, autor, izvor) values ('Проклета авлија', 'Иво Андрић', 'fond')");
  r = await kao("authenticated", BIB, "select naslov from public.trazi_knjige($1)", ["Prokleta avlija Ivo Andric"]);
  ok(!r.greska && r.redovi.some((x) => x.naslov === "Проклета авлија"), "duplikat po naslovu i autoru: latinički unos nalazi ćirilični zapis", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", BIB, "select naslov from public.trazi_knjige($1)", ["Potpuno nepostojeci naslov Nepoznat Autor"]);
  ok(!r.greska && r.redovi.length === 0, "nova knjiga: nema duplikata", r.greska?.message ?? r.redovi);

  // ───────── 0013: Storage ─────────
  faza("0013: bucket „korice” i politike na storage.objects (zamena za Storage)");
  const bucket = (await db.query("select * from storage.buckets where id = 'korice'")).rows[0];
  ok(bucket?.public === true && Number(bucket.file_size_limit) === 1572864 && JSON.stringify(bucket.allowed_mime_types) === JSON.stringify(["image/jpeg", "image/png", "image/webp"]),
    "bucket „korice” posle 0013 i 0014: javan, najviše 1.5 MB (0013 je postavila 1 MB, 0014 ga podiže), samo jpeg, png i webp", bucket);
  const politike = (await db.query(`select p.polname as ime, p.polcmd as komanda, array(select rolname from pg_roles r where r.oid = any(p.polroles) order by 1) as uloge
                                    from pg_policy p where p.polrelid = 'storage.objects'::regclass order by 1`)).rows;
  ok(JSON.stringify(politike) === JSON.stringify([
    { ime: "korice_brisanje_bibliotekar", komanda: "d", uloge: ["authenticated"] },
    { ime: "korice_citanje_svi", komanda: "r", uloge: ["anon", "authenticated"] },
    { ime: "korice_upis_bibliotekar", komanda: "a", uloge: ["authenticated"] },
  ]), "politike: čitanje za sve, upis i brisanje samo za prijavljene (bibliotekar), nijedna za izmenu", politike);

  const KID = fond.id;
  const imeUbaceno = (n) => `${KID}/${n}.webp`;
  await db.query("insert into storage.buckets (id, name, public) values ('drugi', 'drugi', false)");
  await db.query("insert into storage.objects (bucket_id, name) values ('korice', $1), ('korice', $2), ('drugi', $3)", [imeUbaceno("1700000000001"), imeUbaceno("1700000000002"), "tajna/dokument.webp"]);
  const OBJ = "insert into storage.objects (bucket_id, name, owner) values ($1, $2, auth.uid()) returning name";
  const spisak = (b) => kao(b.uloga, b.sub, "select name from storage.objects where bucket_id = $1 order by name", [b.bucket]);

  r = await spisak({ uloga: "anon", sub: null, bucket: "korice" });
  ok(!r.greska && r.redovi.length === 2, "anon vidi objekte u bucket-u „korice” (javno čitanje)", r.greska?.message ?? r.redovi);
  r = await spisak({ uloga: "anon", sub: null, bucket: "drugi" });
  ok(!r.greska && r.redovi.length === 0, "anon ne vidi objekte iz drugog bucket-a", r.greska?.message ?? r.redovi);
  r = await spisak({ uloga: "authenticated", sub: A, bucket: "korice" });
  ok(!r.greska && r.redovi.length === 2, "čitalac vidi objekte u bucket-u „korice”", r.greska?.message ?? r.redovi);

  r = await kao("authenticated", A, OBJ, ["korice", imeUbaceno("1700000000010")]);
  ok(r.greska?.message?.includes("row-level security"), "ČITALAC ne može da upiše u bucket „korice”", r.greska?.message ?? r.redovi);
  r = await kao("anon", null, OBJ, ["korice", imeUbaceno("1700000000011")]);
  ok(Boolean(r.greska), "anon ne može da upiše u bucket „korice”", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", NEAKTIVAN, OBJ, ["korice", imeUbaceno("1700000000012")]);
  ok(r.greska?.message?.includes("row-level security"), "neaktivan član ne može da upiše u bucket „korice”", r.greska?.message ?? r.redovi);

  for (const tip of ["image/webp", "image/jpeg", "image/png"]) {
    const ime = putanjaKorice(KID, 1700000000100, tip);
    r = await kao("authenticated", BIB, OBJ, ["korice", ime]);
    ok(!r.greska && r.redovi.length === 1, `BIBLIOTEKAR može da upiše ${ime.split("/")[1]} (ime iz putanjaKorice, ${tip})`, r.greska?.message ?? r.redovi);
  }
  r = await kao("authenticated", ADM, OBJ, ["korice", imeUbaceno("1700000000200")]);
  ok(!r.greska && r.redovi.length === 1, "administrator može da upiše u bucket „korice”", r.greska?.message ?? r.redovi);

  for (const [naziv, ime] of [
    ["bez fascikle knjige", "slika.webp"],
    ["fascikla nije uuid", "nije-uuid/1700000000300.webp"],
    ["dublje fascikle", `${KID}/a/1700000000300.webp`],
    ["izlaz iz fascikle (..)", `${KID}/../1700000000300.webp`],
    ["ekstenzija .svg", `${KID}/1700000000300.svg`],
    ["ekstenzija .html", `${KID}/1700000000300.html`],
    ["dvostruka ekstenzija", `${KID}/1700000000300.webp.exe`],
    ["bez imena fajla", `${KID}/.webp`],
    ["predugačko ime (65 znakova)", `${KID}/${"a".repeat(65)}.webp`],
    ["UUID velikim slovima", `${KID.toUpperCase()}/1700000000300.webp`],
    ["razmak u imenu", `${KID}/1700 000300.webp`],
  ]) {
    r = await kao("authenticated", BIB, OBJ, ["korice", ime]);
    ok(r.greska?.message?.includes("row-level security"), `bibliotekar: ime se odbija — ${naziv}`, r.greska?.message ?? r.redovi);
  }
  r = await kao("authenticated", BIB, OBJ, ["drugi", imeUbaceno("1700000000400")]);
  ok(r.greska?.message?.includes("row-level security"), "bibliotekar ne upisuje u tuđ bucket preko ovih politika", r.greska?.message ?? r.redovi);

  r = await kao("authenticated", BIB, "update storage.objects set name = name || 'x' where bucket_id = 'korice' returning id");
  ok(!r.greska && r.redovi.length === 0, "niko ne može da izmeni objekat (nema UPDATE politike): zamena je novi fajl", r.greska?.message ?? r.redovi);

  const BRISI = "delete from storage.objects where bucket_id = 'korice' and name = $1 returning name";
  r = await kao("authenticated", A, BRISI, [imeUbaceno("1700000000001")]);
  ok(!r.greska && r.redovi.length === 0, "čitalac ne može da obriše objekat", r.greska?.message ?? r.redovi);
  r = await kao("anon", null, BRISI, [imeUbaceno("1700000000001")]);
  ok(!r.greska && r.redovi.length === 0, "anon ne može da obriše objekat", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", BIB, BRISI, [imeUbaceno("1700000000001")]);
  ok(!r.greska && r.redovi.length === 1, "bibliotekar može da obriše objekat (stara korica pri zameni)", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", BIB, "delete from storage.objects where bucket_id = 'drugi' returning name");
  ok(!r.greska && r.redovi.length === 0, "bibliotekar ne briše iz tuđeg bucket-a", r.greska?.message ?? r.redovi);

  // Isto pravilo u JS-u: adresa fotografije se vraća u ime fajla koje politika prihvata
  const javna = `https://jrmzgulxvxtpghwbhmrc.supabase.co/storage/v1/object/public/korice/${putanjaKorice(KID, 1700000000500, "image/webp")}`;
  ok(putanjaIzAdrese(javna) === putanjaKorice(KID, 1700000000500, "image/webp"), "javna adresa → putanja u bucket-u (za brisanje stare korice)", putanjaIzAdrese(javna));
  r = await kao("authenticated", BIB, "insert into public.knjige (naslov, korice_url, korice_izvor, izvor) values ('Fotografija bibliotekara', $1, 'fotografija', 'fond') returning korice_url, korice_izvor", [javna]);
  ok(!r.greska && r.redovi[0]?.korice_url === javna && r.redovi[0]?.korice_izvor === "fotografija", "adresa fotografije iz našeg Storage-a prolazi okidač za domene (0009)", r.greska?.message ?? r.redovi);

  await db.exec(fs.readFileSync(path.join(MIGRACIJE, STORAGE[0]), "utf8"));
  const posle = (await db.query("select count(*)::int as n from pg_policy where polrelid = 'storage.objects'::regclass")).rows[0].n;
  const brojBucketa = (await db.query("select count(*)::int as n from storage.buckets where id = 'korice'")).rows[0].n;
  ok(posle === 3 && brojBucketa === 1, "0013 je idempotentna: drugo puštanje ne duplira politike ni bucket", { politike: posle, bucketi: brojBucketa });
  const posle13Ponovo = Number((await db.query("select file_size_limit from storage.buckets where id = 'korice'")).rows[0].file_size_limit);
  ok(posle13Ponovo === 1048576, "napomena: ponovno puštanje 0013 posle 0014 vraća granicu na 1 MB, pa se posle njega ponovo pušta 0014", posle13Ponovo);
  await db.exec(fs.readFileSync(path.join(MIGRACIJE, STORAGE[1]), "utf8"));

  // ───────── 0014: korica preuzeta sa linka ─────────
  faza("0014: korice_izvor 'preuzeto' i korice_poreklo (korica preuzeta sa linka)");
  const kolona = (await db.query("select data_type from information_schema.columns where table_schema = 'public' and table_name = 'knjige' and column_name = 'korice_poreklo'")).rows;
  ok(kolona[0]?.data_type === "text", "kolona knjige.korice_poreklo postoji (text)", kolona);
  const ogranicenjaIzvora = (await db.query("select conname from pg_constraint where conrelid = 'public.knjige'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%korice_izvor%'")).rows;
  ok(ogranicenjaIzvora.length === 1 && ogranicenjaIzvora[0].conname === "knjige_korice_izvor_check", "tačno jedno ograničenje na korice_izvor, pod stalnim imenom", ogranicenjaIzvora);
  const bucket14 = (await db.query("select * from storage.buckets where id = 'korice'")).rows[0];
  ok(bucket14?.public === true && Number(bucket14.file_size_limit) === 1572864 && JSON.stringify(bucket14.allowed_mime_types) === JSON.stringify(["image/jpeg", "image/png", "image/webp"]),
    "bucket „korice”: javan, najviše 1.5 MB, i dalje samo jpeg, png i webp", bucket14);
  const okidac = (await db.query("select pg_get_triggerdef(oid) as d from pg_trigger where tgrelid = 'public.knjige'::regclass and tgname = 'knjige_korice_biu'")).rows;
  ok(okidac.length === 1 && okidac[0].d.includes("korice_poreklo"), "okidač knjige_korice_biu prati i korice_poreklo", okidac);

  const NASA = `https://jrmzgulxvxtpghwbhmrc.supabase.co/storage/v1/object/public/korice/${fond.id}/1700000000600.jpg`;
  const POREKLO = "https://cdn.nigde-na-listi.example/slike/k.jpg";
  const UPIS14 = "insert into public.knjige (naslov, korice_url, korice_izvor, korice_poreklo, izvor) values ($1, $2, $3, $4, 'fond') returning id, korice_url, korice_izvor, korice_poreklo";
  const dugo = `https://cdn.example/${"a".repeat(600)}.jpg`;

  r = await kao("authenticated", BIB, UPIS14, ["P1 preuzeta", NASA, "preuzeto", POREKLO]);
  const p1 = r.redovi?.[0];
  ok(!r.greska && p1.korice_url === NASA && p1.korice_izvor === "preuzeto" && p1.korice_poreklo === POREKLO,
    "bibliotekar: korica 'preuzeto' sa našom adresom i porekom (adresa sa tuđeg sajta) ostaje kako je upisana", r.greska?.message ?? p1);
  for (const [naziv, poreklo] of [["poreklo nije https", "http://cdn.example/k.jpg"], ["poreklo ima razmak", "https://cdn.example/a b.jpg"], ["poreklo duže od 500 znakova", dugo], ["poreklo je prazan tekst", ""], ["poreklo nije adresa", "nije adresa"]]) {
    r = await kao("authenticated", BIB, UPIS14, [`P2 ${naziv}`, NASA, "preuzeto", poreklo]);
    const red = r.redovi?.[0];
    ok(!r.greska && red.korice_poreklo === null && red.korice_url === NASA && red.korice_izvor === "preuzeto", `bibliotekar: ${naziv} → poreklo postaje NULL, korica ostaje (upis se ne odbija)`, r.greska?.message ?? red);
  }
  r = await kao("authenticated", BIB, UPIS14, ["P3 fotografija sa porekom", NASA, "fotografija", POREKLO]);
  ok(!r.greska && r.redovi[0].korice_izvor === "fotografija" && r.redovi[0].korice_poreklo === null, "poreklo ima smisla samo uz izvor 'preuzeto': uz 'fotografija' postaje NULL", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", BIB, UPIS14, ["P4 bez korice", null, "preuzeto", POREKLO]);
  ok(!r.greska && r.redovi[0].korice_url === null && r.redovi[0].korice_izvor === null && r.redovi[0].korice_poreklo === null, "bez korice nema ni izvora ni porekla", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", BIB, UPIS14, ["P5 tuđa adresa korice", "https://evil.example/k.jpg", "preuzeto", POREKLO]);
  ok(!r.greska && r.redovi[0].korice_url === null && r.redovi[0].korice_izvor === null && r.redovi[0].korice_poreklo === null, "adresa korice van liste domena: sve tri vrednosti postaju NULL (0009 i dalje važi)", r.greska?.message ?? r.redovi);

  // član ne može da lažira 'preuzeto'
  r = await kao("authenticated", A, UPIS14, ["P6 član lažira", NASA, "preuzeto", POREKLO]);
  ok(!r.greska && r.redovi[0].korice_url === null && r.redovi[0].korice_izvor === null && r.redovi[0].korice_poreklo === null, "ČLAN ne može da postavi izvor 'preuzeto' (korica, izvor i poreklo postaju NULL)", r.greska?.message ?? r.redovi);

  // izmena
  r = await kao("authenticated", BIB, "update public.knjige set korice_izvor = 'fotografija' where id = $1 returning korice_izvor, korice_poreklo, korice_url", [p1.id]);
  ok(!r.greska && r.redovi[0]?.korice_izvor === "fotografija" && r.redovi[0].korice_poreklo === null && r.redovi[0].korice_url === NASA, "izmena izvora sa 'preuzeto' na 'fotografija' briše poreklo", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", BIB, "update public.knjige set korice_izvor = 'preuzeto', korice_poreklo = $2 where id = $1 returning korice_izvor, korice_poreklo", [p1.id, POREKLO]);
  ok(!r.greska && r.redovi[0]?.korice_izvor === "preuzeto" && r.redovi[0].korice_poreklo === POREKLO, "bibliotekar može ponovo da postavi 'preuzeto' sa porekom", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", BIB, "update public.knjige set korice_url = null where id = $1 returning korice_izvor, korice_poreklo, korice_url", [p1.id]);
  ok(!r.greska && r.redovi[0]?.korice_url === null && r.redovi[0].korice_izvor === null && r.redovi[0].korice_poreklo === null, "uklanjanje korice briše i izvor i poreklo", r.greska?.message ?? r.redovi);

  // servisna uloga (api/korica-iz-linka.js) je izuzeta od okidača, ali ne od ograničenja u tabeli
  r = await db.query(UPIS14, ["P7 servis", NASA, "preuzeto", POREKLO]).then((x) => ({ redovi: x.rows }), (e) => ({ greska: e }));
  ok(!r.greska && r.redovi[0].korice_url === NASA && r.redovi[0].korice_izvor === "preuzeto" && r.redovi[0].korice_poreklo === POREKLO, "servisna uloga (postgres) upisuje sve tri vrednosti kako jesu", r.greska?.message ?? r.redovi);
  r = await db.query(UPIS14, ["P8 loš izvor", NASA, "nesto", null]).then((x) => ({ redovi: x.rows }), (e) => ({ greska: e }));
  ok(Boolean(r.greska), "ograničenje u tabeli odbija nepoznat izvor korice čak i servisnoj ulozi", r.greska?.message ?? r.redovi);
  r = await db.query(UPIS14, ["P9 loše poreklo", NASA, "preuzeto", "http://cdn.example/k.jpg"]).then((x) => ({ redovi: x.rows }), (e) => ({ greska: e }));
  ok(Boolean(r.greska), "ograničenje u tabeli odbija poreklo koje nije https čak i servisnoj ulozi", r.greska?.message ?? r.redovi);

  // stari izvori i dalje važe
  for (const izvor of ["fond", "google_books", "open_library", "og_slika", "fotografija", "preuzeto"]) {
    r = await db.query(UPIS14, [`P10 ${izvor}`, NASA, izvor, null]).then((x) => ({ redovi: x.rows }), (e) => ({ greska: e }));
    ok(!r.greska && r.redovi[0].korice_izvor === izvor, `izvor korice '${izvor}' je dozvoljen`, r.greska?.message ?? r.redovi);
  }

  await db.exec(fs.readFileSync(path.join(MIGRACIJE, STORAGE[1]), "utf8"));
  const posle14 = (await db.query("select (select count(*)::int from pg_constraint where conrelid = 'public.knjige'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%korice_izvor%') as ogr, (select count(*)::int from pg_trigger where tgrelid = 'public.knjige'::regclass and tgname = 'knjige_korice_biu') as okidaci, (select count(*)::int from storage.buckets where id = 'korice') as bucketi")).rows[0];
  ok(posle14.ogr === 1 && posle14.okidaci === 1 && posle14.bucketi === 1, "0014 je idempotentna: drugo puštanje ne duplira ograničenje, okidač ni bucket", posle14);

  // ───────── 0017: polica, utisci sa autorom, rezervacije ─────────
  faza("0017: utisci_sa_autorom (RLS važi, samo nadimak), napredak čitanja, rezervacija samo za knjigu u fondu");
  const UA = A; // povezan sa UB
  const UB = "66666666-6666-4666-8666-666666666666";
  const UC = "77777777-7777-4777-8777-777777777777";
  await db.query("insert into auth.users (id) values ($1), ($2)", [UB, UC]);
  await db.query(
    `insert into clanovi (id, broj_kartice, ime, nadimak, uloga, aktivan) values
       ($1, 'UB1', 'Pravo Ime B', 'Nadimak B', 'citalac', true),
       ($2, 'UC1', 'Pravo Ime C', null, 'citalac', true)`,
    [UB, UC]
  );
  await db.query("insert into veze (pozivalac_id, pozvani_id, status) values ($1, $2, 'prihvacena')", [UA, UB]);
  const nova = async (naslov, uFondu = true, spojena = null) =>
    (await db.query("insert into knjige (naslov, izvor, u_fondu, broj_primeraka, broj_slobodnih, spojena_sa_id) values ($1, 'fond', $2, $3, $3, $4) returning id", [naslov, uFondu, uFondu ? 1 : 0, spojena])).rows[0].id;
  const K1 = await nova("U1 javni");
  const K2 = await nova("U2 prijatelji");
  const K3 = await nova("U3 samo ja");
  const K4 = await nova("U4 skriven");
  const KN = await nova("U5 nije u fondu", false);
  const KD = await nova("U6 spojeni duplikat", true, K1);
  await db.query(
    `insert into utisci (clan_id, knjiga_id, ocena, tekst, vidljivost, skriven) values
       ($1, $2, 8, 'B javno', 'javno', false), ($1, $3, 7, 'B prijatelji', 'prijatelji', false), ($1, $4, 6, 'B samo ja', 'samo_ja', false), ($1, $5, 5, 'B skriven', 'javno', true),
       ($6, $2, 3, 'C javno', 'javno', false), ($6, $3, 4, 'C prijatelji', 'prijatelji', false), ($7, $2, 9, 'A javno', 'javno', false)`,
    [UB, K1, K2, K3, K4, UC, UA]
  );
  const vidiUtiske = (uloga, sub, knjiga, pogled = "utisci_sa_autorom") => kao(uloga, sub, `select * from public.${pogled} where knjiga_id = $1 order by tekst`, [knjiga]);
  const tekstovi = (r) => (r.redovi ?? []).map((x) => x.tekst).join("|");

  r = await vidiUtiske("authenticated", UA, K1);
  ok(!r.greska && tekstovi(r) === "A javno|B javno|C javno", "pogled: povezani čitalac A vidi svoj i javne utiske (B, C)", r.greska?.message ?? tekstovi(r));
  ok(r.redovi.find((x) => x.tekst === "B javno")?.autor === "Nadimak B" && r.redovi.find((x) => x.tekst === "C javno")?.autor === null, "pogled: uz utisak ide NADIMAK autora (null kad ga nema), ne pravo ime", r.redovi.map((x) => [x.tekst, x.autor]));
  r = await vidiUtiske("authenticated", UA, K2);
  ok(tekstovi(r) === "B prijatelji", "pogled: A vidi „prijatelji” utisak povezanog B, ne i stranca C", r.greska?.message ?? tekstovi(r));
  r = await vidiUtiske("authenticated", UC, K2);
  ok(tekstovi(r) === "C prijatelji", "pogled: stranac C ne vidi „prijatelji” utisak B (samo svoj)", r.greska?.message ?? tekstovi(r));
  r = await vidiUtiske("authenticated", UA, K3);
  ok(r.redovi?.length === 0, "pogled: „samo ja” utisak niko ne vidi (ni povezani)", r.greska?.message ?? tekstovi(r));
  r = await vidiUtiske("authenticated", UA, K4);
  ok(r.redovi?.length === 0, "pogled: skriven utisak (moderacija) obični čitalac ne vidi", r.greska?.message ?? tekstovi(r));
  r = await vidiUtiske("authenticated", UB, K4);
  ok(tekstovi(r) === "B skriven" && r.redovi[0].skriven === true, "pogled: autor vidi svoj skriven utisak (označen kao skriven)", r.greska?.message ?? tekstovi(r));
  r = await vidiUtiske("authenticated", BIB, K3);
  ok(tekstovi(r) === "B samo ja", "pogled: bibliotekar vidi i „samo ja” (isto kao tabela utisci)", r.greska?.message ?? tekstovi(r));
  r = await vidiUtiske("authenticated", BIB, K4);
  ok(tekstovi(r) === "B skriven", "pogled: bibliotekar vidi i skrivene utiske", r.greska?.message ?? tekstovi(r));

  // pogled ne širi i ne sužava ono što RLS pokazuje na tabeli
  for (const [naziv, uloga, sub] of [["A", "authenticated", UA], ["B", "authenticated", UB], ["C", "authenticated", UC], ["bibliotekar", "authenticated", BIB]]) {
    const t = await kao(uloga, sub, "select id from public.utisci order by id");
    const p = await kao(uloga, sub, "select id from public.utisci_sa_autorom order by id");
    ok(!t.greska && !p.greska && JSON.stringify(t.redovi) === JSON.stringify(p.redovi), `pogled i tabela utisci pokazuju ISTE redove (${naziv})`, t.greska?.message ?? p.greska?.message ?? { tabela: t.redovi?.length, pogled: p.redovi?.length });
  }
  const kolonePogleda = (await db.query("select column_name from information_schema.columns where table_schema = 'public' and table_name = 'utisci_sa_autorom' order by 1")).rows.map((x) => x.column_name);
  ok(JSON.stringify(kolonePogleda) === JSON.stringify(["autor", "clan_id", "izmenjeno", "knjiga_id", "kreiran", "id", "ocena", "skriven", "spojler", "tekst", "vidljivost"].sort()), "pogled nema ni pravo ime, ni broj karte, ni uneo_bibliotekar_id (samo autor = nadimak)", kolonePogleda);
  r = await kao("anon", null, "select * from public.utisci_sa_autorom");
  ok(nemaPrava(r), "anon ne sme da čita utisci_sa_autorom", r.greska?.message ?? r.redovi);
  r = await kao("anon", null, "select privatno.javno_ime($1)", [UB]);
  ok(nemaPrava(r), "anon ne sme da zove privatno.javno_ime", r.greska?.message ?? r.redovi);
  const defView = (await db.query("select c.reloptions from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'utisci_sa_autorom'")).rows[0];
  ok(JSON.stringify(defView?.reloptions) === JSON.stringify(["security_invoker=true"]), "pogled je security_invoker (RLS tabele utisci važi za onoga ko čita)", defView);

  // napredak čitanja
  const polici = await kao("authenticated", UA, "insert into public.polica (clan_id, knjiga_id, status) values ($1, $2, 'citam') returning id, napredak", [UA, K1]);
  ok(!polici.greska && polici.redovi[0].napredak === 0, "polica.napredak ima podrazumevanu vrednost 0", polici.greska?.message ?? polici.redovi);
  const pid = polici.redovi?.[0]?.id;
  for (const [naziv, vrednost, dobro] of [["0", 0, true], ["45", 45, true], ["100", 100, true], ["-1", -1, false], ["101", 101, false]]) {
    r = await kao("authenticated", UA, "update public.polica set napredak = $2 where id = $1 returning napredak", [pid, vrednost]);
    ok(dobro ? !r.greska && r.redovi[0]?.napredak === vrednost : Boolean(r.greska), `polica.napredak ${naziv}: ${dobro ? "prolazi" : "odbija baza (0 do 100)"}`, r.greska?.message ?? r.redovi);
  }
  r = await kao("authenticated", UB, "update public.polica set napredak = 10 where id = $1 returning id", [pid]);
  ok(!r.greska && r.redovi.length === 0, "tuđu policu (napredak) ne može da menja ni povezani B", r.greska?.message ?? r.redovi);

  // rezervacija samo za knjigu u fondu
  const REZ = "insert into public.rezervacije (clan_id, knjiga_id) values ($1, $2) returning id";
  r = await kao("authenticated", UA, REZ, [UA, K2]);
  ok(!r.greska && r.redovi.length === 1, "rezervacija knjige u fondu prolazi", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", UA, REZ, [UA, K2]);
  ok(Boolean(r.greska), "ista knjiga se ne rezerviše dvaput dok prva stoji (postojeće ograničenje)", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", UA, REZ, [UA, KN]);
  ok(r.greska?.message?.includes("row-level security"), "REZERVACIJA knjige koja nije u fondu se odbija u bazi", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", UA, REZ, [UA, KD]);
  ok(r.greska?.message?.includes("row-level security"), "rezervacija spojenog duplikata se odbija u bazi", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", UA, REZ, [UB, K3]);
  ok(r.greska?.message?.includes("row-level security"), "rezervaciju u tuđe ime ne može da upiše ni povezani član", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", UA, "update public.rezervacije set status = 'otkazana' where clan_id = $1 and knjiga_id = $2 returning status", [UA, K2]);
  ok(!r.greska && r.redovi[0]?.status === "otkazana", "član otkazuje svoju rezervaciju (postojeće pravo i dalje radi)", r.greska?.message ?? r.redovi);

  await db.exec(fs.readFileSync(path.join(MIGRACIJE, POLICA[0]), "utf8"));
  const politikeRez = (await db.query("select count(*)::int as n from pg_policy where polrelid = 'public.rezervacije'::regclass and polname = 'rezervacije_insert'")).rows[0].n;
  r = await kao("authenticated", UC, "select count(*)::int as n from public.utisci_sa_autorom where knjiga_id = $1", [K1]);
  ok(politikeRez === 1 && r.redovi?.[0]?.n === 3, "0017 je idempotentna: drugo puštanje ne duplira politiku i pogled i dalje radi", { politike: politikeRez, pogled: r.redovi });

  // ───────── 0018: statusi rezervacije ─────────
  faza("0018: statusi rezervacije (nova, spremna, preuzeta, otkazana), jedna otvorena rezervacija, RLS nepromenjen");
  const otisakPolitika = async () =>
    JSON.stringify((await db.query(`select polname, polcmd::text as cmd, pg_get_expr(polqual, polrelid) as q, pg_get_expr(polwithcheck, polrelid) as w
                                      from pg_policy where polrelid = 'public.rezervacije'::regclass order by polname`)).rows);
  const definicije = async () =>
    JSON.stringify([
      (await db.query("select pg_get_constraintdef(oid) as d from pg_constraint where conrelid = 'public.rezervacije'::regclass and conname = 'rezervacije_status_check'")).rows,
      (await db.query("select indexname, indexdef from pg_indexes where schemaname = 'public' and tablename = 'rezervacije' order by indexname")).rows,
    ]);
  // stanje „pre": stari status 'obradjena' i jedna otvorena rezervacija
  await db.query("insert into public.rezervacije (clan_id, knjiga_id, status) values ($1, $2, 'obradjena'), ($3, $2, 'nova')", [UC, K1, UB]);
  const politikePre = await otisakPolitika();
  const redovaPre = (await db.query("select count(*)::int as n from public.rezervacije")).rows[0].n;
  ok((await definicije()).includes("obradjena") && !(await definicije()).includes("spremna"), "pre 0018: ograničenje poznaje 'obradjena', a ne 'spremna'");
  for (const f of REZERVACIJE) await pusti(f);

  const redovaPosle = (await db.query("select count(*)::int as n from public.rezervacije")).rows[0].n;
  const preuzeta = (await db.query("select status from public.rezervacije where clan_id = $1 and knjiga_id = $2", [UC, K1])).rows[0]?.status;
  ok(preuzeta === "preuzeta" && redovaPosle === redovaPre, "0018: postojeća 'obradjena' postaje 'preuzeta', nijedan red se ne gubi", { preuzeta, redovaPre, redovaPosle });
  ok((await db.query("select count(*)::int as n from public.rezervacije where status = 'obradjena'")).rows[0].n === 0, "0018: nijedna rezervacija nema stari status 'obradjena'");
  const posle18 = await definicije();
  ok(posle18.includes("spremna") && posle18.includes("preuzeta") && !posle18.includes("obradjena"), "0018: ograničenje statusa je nova, spremna, preuzeta, otkazana", posle18);
  ok((await otisakPolitika()) === politikePre, "0018: politike (RLS) na rezervacije su iste kao pre migracije (nijedna dodata, izbrisana ni izmenjena)");
  ok(JSON.parse(politikePre).length === 4, "rezervacije imaju četiri politike (svoje_select, insert, svoje_update, bibliotekar_all)", JSON.parse(politikePre).map((p) => p.polname));

  const PROMENI = "update public.rezervacije set status = $3 where clan_id = $1 and knjiga_id = $2 returning status";
  for (const sledeci of ["spremna", "preuzeta", "nova", "otkazana", "spremna"]) {
    r = await kao("authenticated", BIB, PROMENI, [UB, K1, sledeci]);
    ok(!r.greska && r.redovi[0]?.status === sledeci, `bibliotekar menja status rezervacije u '${sledeci}'`, r.greska?.message ?? r.redovi);
  }
  for (const losa of ["obradjena", "gotova", ""]) {
    r = await kao("authenticated", BIB, PROMENI, [UB, K1, losa]);
    ok(r.greska?.message?.includes("rezervacije_status_check"), `baza odbija nepoznat status '${losa}' čak i bibliotekaru`, r.greska?.message ?? r.redovi);
  }
  r = await kao("authenticated", ADM, PROMENI, [UB, K1, "preuzeta"]);
  ok(!r.greska && r.redovi[0]?.status === "preuzeta", "administrator takođe menja status (bibliotekar_all važi i za njega)", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", BIB, PROMENI, [UB, K1, "spremna"]);
  ok(!r.greska && r.redovi[0]?.status === "spremna", "rezervacija je opet 'spremna' (nastavak provera)", r.greska?.message ?? r.redovi);

  // član: ne postavlja sebi statuse bibliotekara, ne otkazuje spremnu, ne rezerviše dvaput
  r = await kao("authenticated", UB, PROMENI, [UB, K1, "preuzeta"]);
  ok(r.redovi?.length === 0 || Boolean(r.greska), "član ne može sam da označi svoju rezervaciju kao 'preuzeta'", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", UB, PROMENI, [UB, K1, "otkazana"]);
  ok(!r.greska && r.redovi.length === 0, "član ne može da otkaže rezervaciju koja je već 'spremna' (menja je samo bibliotekar)", r.greska?.message ?? r.redovi);
  ok((await db.query("select status from public.rezervacije where clan_id = $1 and knjiga_id = $2", [UB, K1])).rows[0].status === "spremna", "rezervacija je i dalje 'spremna' posle pokušaja člana");
  r = await kao("authenticated", UB, "insert into public.rezervacije (clan_id, knjiga_id, status) values ($1, $2, 'spremna') returning id", [UB, K2]);
  ok(r.greska?.message?.includes("row-level security"), "član ne može da upiše rezervaciju sa statusom 'spremna' (insert samo 'nova')", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", UB, REZ, [UB, K1]);
  ok(r.greska?.code === "23505", "dok je rezervacija 'spremna', ista knjiga se ne rezerviše ponovo (indeks važi za nova i spremna)", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", UA, PROMENI, [UB, K1, "otkazana"]);
  ok(!r.greska && r.redovi.length === 0, "tuđu rezervaciju ne menja ni povezani član", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", UC, "select count(*)::int as n from public.rezervacije where clan_id = $1", [UB]);
  ok(r.redovi?.[0]?.n === 0, "tuđe rezervacije čitalac i dalje ne vidi", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", BIB, "select count(*)::int as n from public.rezervacije");
  ok(r.redovi?.[0]?.n >= 3, "bibliotekar vidi sve rezervacije", r.greska?.message ?? r.redovi);

  // posle 'preuzeta' član može ponovo da rezerviše istu knjigu
  r = await kao("authenticated", BIB, PROMENI, [UB, K1, "preuzeta"]);
  ok(!r.greska, "bibliotekar zatvara rezervaciju ('preuzeta')", r.greska?.message);
  r = await kao("authenticated", UB, REZ, [UB, K1]);
  ok(!r.greska && r.redovi.length === 1, "posle 'preuzeta' ista knjiga može ponovo da se rezerviše", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", UB, "update public.rezervacije set status = 'otkazana' where clan_id = $1 and knjiga_id = $2 and status = 'nova' returning status", [UB, K1]);
  ok(!r.greska && r.redovi[0]?.status === "otkazana", "član i dalje otkazuje svoju 'novu' rezervaciju (postojeće pravo)", r.greska?.message ?? r.redovi);
  // izveštaj o nabavci broji samo 'nova' (0006): spremna ne traži dodatni primerak
  ok(/status = 'nova'/.test(fs.readFileSync(path.join(MIGRACIJE, "0006_izvestaj_nabavka.sql"), "utf8")), "izveštaj o dodatnim primercima (0006) i dalje broji samo 'nova' rezervacije");

  // idempotentnost
  const definicijePre = await definicije();
  await db.exec(fs.readFileSync(path.join(MIGRACIJE, REZERVACIJE[0]), "utf8"));
  ok((await definicije()) === definicijePre, "0018 je idempotentna: drugo puštanje ne menja ograničenje ni indekse", await definicije());
  ok((await otisakPolitika()) === politikePre, "0018: posle drugog puštanja politike su iste");
  ok((await db.query("select count(*)::int as n from public.rezervacije where status = 'preuzeta'")).rows[0].n >= 1, "0018: drugo puštanje ne dira podatke");

  // ───────── 0019: nadimci povezanih, preporuke, prijava člana ─────────
  faza("0019: pogledi moje_veze i moje_preporuke (samo nadimak, samo moje), blokada, prijava člana, preporuka do 280 znakova");
  const otisakTabela = async () =>
    JSON.stringify(
      (await db.query(`select c.relname, p.polname, p.polcmd::text as cmd, pg_get_expr(p.polqual, p.polrelid) as q, pg_get_expr(p.polwithcheck, p.polrelid) as w
                         from pg_policy p join pg_class c on c.oid = p.polrelid
                        where c.relname in ('clanovi', 'veze', 'blokade', 'preporuke', 'prijave', 'polica', 'utisci') order by 1, 2`)).rows
    );
  const politikePre19 = await otisakTabela();
  const tipPre = (await db.query("select pg_get_constraintdef(oid) as d from pg_constraint where conrelid = 'public.prijave'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%tip%'")).rows[0]?.d ?? "";
  ok(tipPre.includes("preporuka") && tipPre.includes("utisak") && !tipPre.includes("clan'"), "pre 0019: prijava postoji samo za preporuku i utisak", tipPre);
  await db.query("update public.clanovi set nadimak = 'Nadimak C' where id = $1", [UC]);
  const dugacka = "x".repeat(300);
  const K19 = await nova("R1 knjiga za preporuku");
  await db.query("insert into public.preporuke (posiljalac_id, primalac_id, knjiga_id, poruka) values ($1, $2, $3, $4)", [UB, UA, K19, dugacka]);
  ok((await db.query("select count(*)::int as n from public.preporuke where char_length(poruka) = 300")).rows[0].n === 1, "pre 0019: napomena od 300 znakova se još može upisati (nije ograničena)");
  await db.query("delete from public.preporuke where char_length(poruka) = 300");

  for (const f of CITAOCI) await pusti(f);

  ok((await otisakTabela()) === politikePre19, "0019: politike (RLS) na clanovi, veze, blokade, preporuke, prijave, polica i utisci su iste kao pre (nijedna dodata, izbrisana ni izmenjena)");
  const opcije = (await db.query("select c.relname, c.reloptions, c.relkind from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname in ('moje_veze', 'moje_preporuke') order by 1")).rows;
  ok(opcije.length === 2 && opcije.every((x) => x.relkind === "v" && (x.reloptions ?? []).includes("security_invoker=true")), "pogledi moje_veze i moje_preporuke su security_invoker", opcije);
  const kolone = async (pogled) => (await db.query("select column_name from information_schema.columns where table_schema = 'public' and table_name = $1 order by ordinal_position", [pogled])).rows.map((x) => x.column_name);
  const kv = await kolone("moje_veze");
  const kp = await kolone("moje_preporuke");
  ok(JSON.stringify(kv) === JSON.stringify(["id", "clan_id", "smer", "status", "kreirana", "potvrdjena", "nadimak"]), "moje_veze vraća samo: id, clan_id, smer, status, kreirana, potvrdjena, nadimak (nema imena, broja karte ni šifre poziva)", kv);
  ok(JSON.stringify(kp) === JSON.stringify(["id", "knjiga_id", "poruka", "procitana", "kreirana", "posiljalac_nadimak"]), "moje_preporuke vraća samo: id, knjiga_id, poruka, procitana, kreirana, posiljalac_nadimak (bez id-a pošiljaoca, imena i karte)", kp);
  r = await kao("anon", null, "select * from public.moje_veze");
  ok(nemaPrava(r), "anon ne sme da čita moje_veze", r.greska?.message ?? r.redovi);
  r = await kao("anon", null, "select * from public.moje_preporuke");
  ok(nemaPrava(r), "anon ne sme da čita moje_preporuke", r.greska?.message ?? r.redovi);

  // nadimak povezanog: vidi se, i to samo nadimak
  const MV = "select clan_id, smer, status, nadimak from public.moje_veze order by clan_id";
  r = await kao("authenticated", UA, MV);
  ok(!r.greska && r.redovi.length === 1 && r.redovi[0].clan_id === UB && r.redovi[0].smer === "poslat" && r.redovi[0].status === "prihvacena" && r.redovi[0].nadimak === "Nadimak B", "A vidi povezanog B: samo njegov nadimak („Nadimak B”)", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", UB, MV);
  ok(!r.greska && r.redovi.length === 1 && r.redovi[0].clan_id === UA && r.redovi[0].smer === "primljen" && r.redovi[0].nadimak === null, "B vidi povezanog A (smer „primljen”); A nema nadimak, pa je nadimak prazan, a ne ime", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", UC, MV);
  ok(!r.greska && r.redovi.length === 0, "stranac C ne vidi nijednu vezu, ni nadimak A ili B", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", BIB, MV);
  ok(!r.greska && r.redovi.length === 0, "bibliotekar kroz moje_veze vidi samo SVOJE veze (iako veze_bibliotekar_select dozvoljava sve)", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", UA, "select id, ime from public.clanovi where id = $1", [UB]);
  ok(!r.greska && r.redovi.length === 0, "clanovi se i dalje ne otvaraju: A ne vidi tuđi red (ni povezanog B)", r.greska?.message ?? r.redovi);

  // poziv na čekanju: nadimak pošiljaoca se vidi primaocu (i obrnuto)
  const vezaC = (await db.query("insert into public.veze (pozivalac_id, pozvani_id) values ($1, $2) returning id", [UC, UA])).rows[0].id;
  r = await kao("authenticated", UA, MV);
  const pozivC = r.redovi?.find((x) => x.clan_id === UC);
  ok(!r.greska && pozivC?.smer === "primljen" && pozivC?.status === "na_cekanju" && pozivC?.nadimak === "Nadimak C", "primljeni poziv na čekanju: A vidi nadimak pošiljaoca C", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", UC, MV);
  ok(!r.greska && r.redovi.length === 1 && r.redovi[0].clan_id === UA && r.redovi[0].smer === "poslat" && r.redovi[0].status === "na_cekanju", "poslati poziv na čekanju: C ga vidi kao „poslat”", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", UB, MV);
  ok(!r.greska && r.redovi.length === 1, "tuđi poziv (C→A) B ne vidi", r.greska?.message ?? r.redovi);

  // blokada: veza i poziv nestaju sa obe strane, bez ikakvog traga u pogledu
  await db.query("insert into public.blokade (blokirao_id, blokirani_id) values ($1, $2)", [UA, UC]);
  r = await kao("authenticated", UA, MV);
  ok(!r.greska && r.redovi.length === 1 && r.redovi[0].clan_id === UB, "posle blokade C, A više ne vidi poziv od C (ostaje samo B)", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", UC, MV);
  ok(!r.greska && r.redovi.length === 0, "blokirani C ne vidi ni svoj poslati poziv (nestao je kao da je odbijen): ne saznaje za blokadu", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", UC, "select * from public.blokade");
  ok(!r.greska && r.redovi.length === 0, "blokirani ne vidi tabelu blokade (nema politike koja mu to daje)", r.greska?.message ?? r.redovi);
  await db.query("delete from public.blokade where blokirao_id = $1 and blokirani_id = $2", [UA, UC]);
  await db.query("delete from public.veze where id = $1", [vezaC]);

  // posalji_poziv: nepostojeća šifra i blokirani član daju ISTU poruku (postojeće ponašanje, ostaje)
  const sifraC = (await db.query("select sifra_poziva from public.clanovi where id = $1", [UC])).rows[0].sifra_poziva;
  await db.query("insert into public.blokade (blokirao_id, blokirani_id) values ($1, $2)", [UC, UA]);
  const poziv = (sifra) => kao("authenticated", UA, "select public.posalji_poziv($1)", [sifra]);
  const nepostojeca = await poziv("NEG·0000·AA");
  const blokirana = await poziv(sifraC);
  const sopstvena = await poziv((await db.query("select sifra_poziva from public.clanovi where id = $1", [UA])).rows[0].sifra_poziva);
  ok(nepostojeca.greska && blokirana.greska && nepostojeca.greska.message === blokirana.greska.message && nepostojeca.greska.code === blokirana.greska.code && sopstvena.greska?.message === nepostojeca.greska.message, "posalji_poziv: nepostojeća šifra, šifra člana koji me je blokirao i sopstvena šifra daju ISTU grešku (isti kod i poruka)", [nepostojeca.greska?.message, blokirana.greska?.message, sopstvena.greska?.message]);
  ok(nepostojeca.greska?.code === "P0001", "ta greška je P0001 (klijent je prepoznaje i pokazuje jednu poruku)", nepostojeca.greska?.code);
  await db.query("delete from public.blokade where blokirao_id = $1 and blokirani_id = $2", [UC, UA]);

  // preporuke: primljene sa nadimkom pošiljaoca
  const PREP = "insert into public.preporuke (posiljalac_id, primalac_id, knjiga_id, poruka) values ($1, $2, $3, $4) returning id";
  r = await kao("authenticated", UB, PREP, [UB, UA, K19, "Pročitaj ovo."]);
  const prepId = r.redovi?.[0]?.id;
  ok(!r.greska && prepId, "povezani B preporučuje knjigu A-u (RLS: su_povezani)", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", UC, PREP, [UC, UA, K19, "Nepovezan"]);
  ok(r.greska?.message?.includes("row-level security"), "nepovezani C ne može da pošalje preporuku A-u", r.greska?.message ?? r.redovi);
  const MP = "select id, poruka, procitana, posiljalac_nadimak from public.moje_preporuke order by kreirana";
  r = await kao("authenticated", UA, MP);
  ok(!r.greska && r.redovi.length === 1 && r.redovi[0].posiljalac_nadimak === "Nadimak B" && r.redovi[0].poruka === "Pročitaj ovo.", "A vidi primljenu preporuku sa nadimkom pošiljaoca", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", UB, MP);
  ok(!r.greska && r.redovi.length === 0, "pošiljalac B kroz moje_preporuke ne vidi svoje poslate (pogled je samo za primljene)", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", UC, MP);
  ok(!r.greska && r.redovi.length === 0, "stranac C ne vidi tuđe preporuke", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", BIB, MP);
  ok(!r.greska && r.redovi.length === 0, "ni bibliotekar kroz moje_preporuke ne vidi tuđe", r.greska?.message ?? r.redovi);

  // napomena do 280 znakova i jedna neobrađena iste knjige
  r = await kao("authenticated", UB, PREP, [UB, UA, await nova("R2"), "x".repeat(281)]);
  ok(r.greska?.message?.includes("preporuke_poruka_duzina"), "napomena od 281 znak se odbija u bazi", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", UB, PREP, [UB, UA, await nova("R3"), "x".repeat(280)]);
  ok(!r.greska, "napomena od tačno 280 znakova prolazi", r.greska?.message);
  r = await kao("authenticated", UB, PREP, [UB, UA, K19, "Opet"]);
  ok(r.greska?.code === "23505", "ista neobrađena preporuka iste knjige istom primaocu se ne može ponoviti", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", UA, "update public.preporuke set procitana = true, skrivena = true, poruka = 'izmenjeno' where id = $1 returning procitana, skrivena, poruka", [prepId]);
  ok(!r.greska && r.redovi[0]?.procitana === true && r.redovi[0]?.skrivena === false && r.redovi[0]?.poruka === "Pročitaj ovo.", "primalac obrađuje preporuku (procitana = true), a skrivena i poruka ostaju (trigger preporuke_zastita)", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", UB, PREP, [UB, UA, K19, "Ponovo, posle obrade"]);
  ok(!r.greska, "posle obrade ista knjiga može ponovo da se preporuči", r.greska?.message);
  const novaPrep = r.redovi?.[0]?.id;
  await db.query("update public.preporuke set skrivena = true where id = $1", [novaPrep]);
  r = await kao("authenticated", UA, "select count(*)::int as n from public.moje_preporuke where id = $1", [novaPrep]);
  ok(r.redovi?.[0]?.n === 0, "skrivena (moderacija) preporuka se ne pokazuje primaocu", r.greska?.message ?? r.redovi);

  // blokada sakriva preporuke blokiranog; raskid veze skida nadimak pošiljaoca
  await db.query("update public.preporuke set skrivena = false where id = $1", [novaPrep]);
  await db.query("delete from public.veze where pozivalac_id = $1 and pozvani_id = $2", [UA, UB]);
  r = await kao("authenticated", UA, "select posiljalac_nadimak from public.moje_preporuke where id = $1", [novaPrep]);
  ok(!r.greska && r.redovi.length === 1 && r.redovi[0].posiljalac_nadimak === null, "posle raskida veze preporuka ostaje, ali bez nadimka pošiljaoca (ekran piše „Читалац”)", r.greska?.message ?? r.redovi);
  await db.query("insert into public.veze (pozivalac_id, pozvani_id, status) values ($1, $2, 'prihvacena')", [UA, UB]);
  await db.query("insert into public.blokade (blokirao_id, blokirani_id) values ($1, $2)", [UA, UB]);
  r = await kao("authenticated", UA, "select count(*)::int as n from public.moje_preporuke");
  ok(r.redovi?.[0]?.n === 0, "kad A blokira B, njegove preporuke nestaju iz pogleda", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", UA, "select count(*)::int as n from public.polica where clan_id = $1", [UB]);
  ok(r.redovi?.[0]?.n === 0, "kad A blokira B, A ne vidi ni policu B (su_povezani je false)", r.greska?.message ?? r.redovi);
  await db.query("delete from public.blokade where blokirao_id = $1 and blokirani_id = $2", [UA, UB]);

  // prijava člana (tip 'clan')
  const PRIJAVA = "insert into public.prijave (prijavio_id, tip, stavka_id, razlog) values ($1, $2, $3, $4) returning id";
  r = await kao("authenticated", UA, PRIJAVA, [UA, "clan", UB, "Neprimeren nadimak"]);
  ok(!r.greska && r.redovi.length === 1, "A prijavljuje člana B (tip 'clan', stavka_id je id člana)", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", UA, PRIJAVA, [UA, "clan", UB, "Opet"]);
  ok(r.greska?.code === "23505", "ista prijava istog člana se ne podnosi dvaput", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", UA, PRIJAVA, [UA, "nesto", UB, "x"]);
  ok(r.greska?.message?.includes("prijave_tip_check"), "nepoznat tip prijave se odbija", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", UA, PRIJAVA, [UA, "utisak", UB, "stari tipovi i dalje rade"]);
  ok(!r.greska, "prijava utiska i preporuke i dalje radi (stari tipovi)", r.greska?.message);
  r = await kao("authenticated", UB, "select count(*)::int as n from public.prijave");
  ok(r.redovi?.[0]?.n === 0, "prijavljeni B ne vidi prijave (nema znaka da je prijavljen)", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", BIB, "select count(*)::int as n from public.prijave where tip = 'clan'");
  ok(r.redovi?.[0]?.n >= 1, "bibliotekar vidi prijavu člana", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", UA, PRIJAVA, [UB, "clan", UC, "u tuđe ime"]);
  ok(r.greska?.message?.includes("row-level security"), "prijava u tuđe ime se odbija (postojeća politika)", r.greska?.message ?? r.redovi);

  // idempotentnost
  const definicije19 = async () =>
    JSON.stringify([
      (await db.query("select pg_get_viewdef('public.moje_veze'::regclass) as v, pg_get_viewdef('public.moje_preporuke'::regclass) as p")).rows,
      (await db.query("select pg_get_constraintdef(oid) as d from pg_constraint where conrelid in ('public.prijave'::regclass, 'public.preporuke'::regclass) and conname in ('prijave_tip_check', 'preporuke_poruka_duzina') order by conname")).rows,
      (await db.query("select indexdef from pg_indexes where schemaname = 'public' and indexname = 'preporuke_otvorena_idx'")).rows,
    ]);
  const pre19 = await definicije19();
  await db.exec(fs.readFileSync(path.join(MIGRACIJE, CITAOCI[0]), "utf8"));
  ok((await definicije19()) === pre19 && (await otisakTabela()) === politikePre19, "0019 je idempotentna: drugo puštanje ne menja poglede, ograničenja, indeks ni politike", await definicije19());
  r = await kao("authenticated", UA, MV);
  ok(!r.greska && r.redovi.length === 1 && r.redovi[0].nadimak === "Nadimak B", "posle drugog puštanja pogled i dalje radi", r.greska?.message ?? r.redovi);
  const fn = (await db.query("select p.proname, p.prosecdef, p.proconfig, has_function_privilege('anon', p.oid, 'execute') as anon from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'privatno' and p.proname = 'ima_blokade'")).rows[0];
  ok(fn?.prosecdef === true && (fn.proconfig ?? []).some((c) => c.startsWith("search_path=")) && fn.anon === false, "privatno.ima_blokade: SECURITY DEFINER sa search_path, nedostupna anon-u", fn);

  // ───────── 0020: izveštaj za nabavku i zaštita administratora ─────────
  faza("0020: izveštaj za nabavku (samo agregat, samo bibliotekar), odluka nabavke, bibliotekar ne dira administratora");
  const otisakPolitika20 = async () =>
    JSON.stringify((await db.query(`select c.relname, p.polname, p.polcmd::text as cmd, pg_get_expr(p.polqual, p.polrelid) as q, pg_get_expr(p.polwithcheck, p.polrelid) as w
                                      from pg_policy p join pg_class c on c.oid = p.polrelid where c.relname in ('clanovi', 'knjige', 'polica') order by 1, 2`)).rows);
  const politikePre20 = await otisakPolitika20();

  // knjige za izveštaj
  const novaK = async (naslov, uFondu = false, spojena = null) =>
    (await db.query("insert into knjige (naslov, autor, izdavac, isbn, izvor, u_fondu, broj_primeraka, broj_slobodnih, spojena_sa_id) values ($1, 'Autor N', 'Izdavač N', '9788652119875', 'fond', $2, $3, $3, $4) returning id", [naslov, uFondu, uFondu ? 1 : 0, spojena])).rows[0].id;
  const NA = await novaK("N1 tri žele");
  const NB = await novaK("N1 jedan želi, drugi čita");
  const NC = await novaK("N1 niko ne želi");
  const ND = await novaK("N1 u fondu, jedan želi", true);
  const NE = await novaK("N1 samo neaktivan želi");
  const NF = await novaK("N1 matični");
  const NG = await novaK("N1 duplikat matičnog", false, NF);
  const pol = (c, k, s) => db.query("insert into polica (clan_id, knjiga_id, status) values ($1, $2, $3) on conflict (clan_id, knjiga_id) do update set status = excluded.status", [c, k, s]);
  for (const c of [UA, UB, UC]) await pol(c, NA, "zelim");
  await pol(UA, NB, "zelim");
  await pol(UB, NB, "citam");
  await pol(UC, NB, "procitano");
  await pol(UA, NC, "procitano");
  await pol(UA, ND, "zelim");
  await pol(NEAKTIVAN, NE, "zelim");
  await pol(UA, NG, "zelim");
  await pol(UB, NF, "zelim");

  // pre migracije: rupa koju 0020 zatvara
  r = await kao("authenticated", BIB, "update public.clanovi set aktivan = false where id = $1 returning aktivan", [ADM]);
  ok(!r.greska && r.redovi[0]?.aktivan === false, "PRE 0020: bibliotekar može da deaktivira administratora (rupa)", r.greska?.message ?? r.redovi);
  await db.query("update public.clanovi set aktivan = true where id = $1", [ADM]);
  const TUDJI_ADM = "99999999-9999-4999-8999-999999999999";
  await db.query("insert into auth.users (id) values ($1)", [TUDJI_ADM]);
  r = await kao("authenticated", BIB, "insert into public.clanovi (id, broj_kartice, ime, uloga) values ($1, 'PRE-ADM', 'Pre', 'administrator') returning uloga", [TUDJI_ADM]);
  ok(!r.greska && r.redovi[0]?.uloga === "administrator", "PRE 0020: bibliotekar može da upiše red sa ulogom administrator (rupa)", r.greska?.message ?? r.redovi);
  await db.query("delete from public.clanovi where id = $1", [TUDJI_ADM]);

  for (const f of NABAVKA) await pusti(f);

  ok((await otisakPolitika20()) === politikePre20, "0020: politike (RLS) na clanovi, knjige i polica su iste kao pre (nijedna dodata, izbrisana ni izmenjena)");

  // izveštaj: brojevi
  const IZV = "select * from public.izvestaj_za_nabavku where naslov like 'N1 %' order by zele desc, naslov";
  r = await kao("authenticated", BIB, IZV);
  const po = (naslovPocetak) => r.redovi?.find((x) => x.naslov.startsWith(naslovPocetak));
  ok(!r.greska && po("N1 tri žele")?.zele === 3 && po("N1 tri žele")?.citaju_ili_procitali === 0, "izveštaj: tri različita čitaoca žele knjigu → zele = 3", r.greska?.message ?? r.redovi);
  ok(po("N1 jedan želi")?.zele === 1 && po("N1 jedan želi")?.citaju_ili_procitali === 2, "izveštaj: jedan želi, dvoje čita ili je pročitalo → 1 i 2", r.redovi?.map((x) => [x.naslov, x.zele, x.citaju_ili_procitali]));
  ok(!po("N1 niko ne želi") && !po("N1 samo neaktivan"), "izveštaj: knjiga koju niko ne želi i knjiga koju želi samo neaktivan član se ne pojavljuju", r.redovi?.map((x) => x.naslov));
  ok(po("N1 matični")?.zele === 1 && !po("N1 duplikat"), "izveštaj: spojeni duplikat se ne računa zasebno (samo matični zapis; ovde A želi duplikat, a B matični → matični ima 1, duplikat nema red)", r.redovi?.map((x) => [x.naslov, x.zele]));
  ok(r.redovi?.map((x) => x.naslov)[0] === "N1 tri žele", "izveštaj je poređan po broju onih koji žele, opadajuće", r.redovi?.map((x) => x.naslov));
  const kolIzv = (await db.query("select column_name from information_schema.columns where table_schema = 'public' and table_name = 'izvestaj_za_nabavku' order by ordinal_position")).rows.map((x) => x.column_name);
  ok(JSON.stringify(kolIzv) === JSON.stringify(["id", "naslov", "autor", "izdavac", "isbn", "korice_url", "korice_izvor", "u_fondu", "odluka", "odluka_postavljena", "odluka_datum", "zele", "citaju_ili_procitali"]), "izveštaj vraća samo ove kolone: nema id-a članova, imena, brojeva karata ni vremena kad je neko stavio knjigu na policu", kolIzv);
  ok(po("N1 u fondu")?.odluka === "imamo" && po("N1 u fondu")?.odluka_postavljena === false, "knjiga u_fondu bez odluke se vodi kao „imamo”, ali odluka nije postavljena", po("N1 u fondu"));
  ok(po("N1 tri žele")?.odluka === null && po("N1 tri žele")?.odluka_postavljena === false, "knjiga van fonda bez odluke je „nova” (odluka je prazna)", po("N1 tri žele"));
  r = await kao("authenticated", ADM, IZV);
  ok(!r.greska && r.redovi.length === 4, "administrator takođe vidi izveštaj", r.greska?.message ?? r.redovi?.length);
  for (const [naziv, sub] of [["čitalac A (povezan sa B)", UA], ["čitalac B", UB], ["čitalac C", UC]]) {
    r = await kao("authenticated", sub, "select * from public.izvestaj_za_nabavku");
    ok(!r.greska && r.redovi.length === 0, `${naziv} kroz izveštaj ne vidi ništa (ni agregat)`, r.greska?.message ?? r.redovi?.length);
  }
  r = await kao("authenticated", UA, "select * from privatno.izvestaj_nabavke()");
  ok(Boolean(r.greska) || r.redovi.length === 0, "čitalac ni direktnim pozivom funkcije ne dobija redove", r.greska?.message ?? r.redovi?.length);
  r = await kao("anon", null, "select * from public.izvestaj_za_nabavku");
  ok(nemaPrava(r), "anon ne sme da čita izveštaj", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", UC, "select count(*)::int as n from public.polica where clan_id = $1", [UA]);
  ok(r.redovi?.[0]?.n === 0, "RLS na polici je isti: čitalac C i dalje ne vidi tuđu policu (izveštaj nije put do nje)", r.greska?.message ?? r.redovi);

  // odluka nabavke
  const ODL = "update public.knjige set odluka_nabavke = $2 where id = $1 returning odluka_nabavke, odluka_datum, u_fondu";
  r = await kao("authenticated", BIB, ODL, [NA, "nabavljamo"]);
  ok(!r.greska && r.redovi[0]?.odluka_nabavke === "nabavljamo" && r.redovi[0]?.odluka_datum !== null && r.redovi[0]?.u_fondu === false, "bibliotekar postavlja „nabavljamo”: datum postavlja okidač, u_fondu = false", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", BIB, ODL, [NA, "imamo"]);
  ok(!r.greska && r.redovi[0]?.odluka_nabavke === "imamo" && r.redovi[0]?.u_fondu === true, "„imamo” postavlja u_fondu = true", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", BIB, "select odluka, odluka_postavljena, odluka_datum from public.izvestaj_za_nabavku where id = $1", [NA]);
  ok(r.redovi?.[0]?.odluka === "imamo" && r.redovi[0].odluka_postavljena === true && r.redovi[0].odluka_datum !== null, "izveštaj pokazuje postavljenu odluku i datum", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", BIB, ODL, [NA, "ne_nabavljamo"]);
  ok(!r.greska && r.redovi[0]?.u_fondu === false, "„ne_nabavljamo” postavlja u_fondu = false", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", BIB, ODL, [NA, null]);
  ok(!r.greska && r.redovi[0]?.odluka_nabavke === null && r.redovi[0]?.odluka_datum === null, "skidanje odluke prazni i datum", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", BIB, ODL, [NA, "mozda"]);
  ok(r.greska?.message?.includes("knjige_odluka_nabavke_check"), "nepoznata odluka se odbija u bazi", r.greska?.message ?? r.redovi);
  await kao("authenticated", BIB, ODL, [NB, "nabavljamo"]);
  r = await kao("authenticated", BIB, "update public.knjige set odluka_datum = '2000-01-01' where id = $1 returning odluka_datum", [NB]);
  ok(!r.greska && !String(r.redovi[0]?.odluka_datum).startsWith("2000"), "datum odluke ne može da se postavi rukom (okidač ga čuva)", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", UA, ODL, [NC, "imamo"]);
  ok(!r.greska && r.redovi.length === 0, "čitalac ne može da postavi odluku (RLS: izmenu knjige sme samo bibliotekar)", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", UA, "insert into public.knjige (naslov, odluka_nabavke, u_fondu) values ('N1 član upisao sa odlukom', 'imamo', true) returning odluka_nabavke, odluka_datum, u_fondu");
  ok(!r.greska && r.redovi[0]?.odluka_nabavke === null && r.redovi[0]?.odluka_datum === null && r.redovi[0]?.u_fondu === false, "član koji sam upiše naslov ne može da mu postavi odluku (okidač je poništava)", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", BIB, IZV);
  ok(r.redovi?.find((x) => x.naslov.startsWith("N1 jedan želi"))?.odluka === "nabavljamo", "odluka postavljena na jednoj knjizi ne menja druge (NA je bez odluke, NB je „nabavljamo”)", r.redovi?.map((x) => [x.naslov, x.odluka]));

  // DEO B: bibliotekar ne dira administratora
  r = await kao("authenticated", BIB, "update public.clanovi set aktivan = false where id = $1 returning id", [ADM]);
  ok(r.greska?.code === "42501", "POSLE 0020: bibliotekar ne može da deaktivira administratora (greška 42501)", r.greska?.message ?? r.redovi);
  ok((await db.query("select aktivan from public.clanovi where id = $1", [ADM])).rows[0].aktivan === true, "administrator je i dalje aktivan");
  r = await kao("authenticated", BIB, "update public.clanovi set ime = 'Hakovan', nadimak = 'x' where id = $1 returning id", [ADM]);
  ok(r.greska?.code === "42501", "bibliotekar ne menja ni ime ni nadimak administratora", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", BIB, "update public.clanovi set uloga = 'citalac' where id = $1 returning id", [ADM]);
  ok(r.greska?.code === "42501", "bibliotekar ne može da degradira administratora", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", BIB, "update public.clanovi set aktivan = false where id = $1 returning aktivan", [UA]);
  ok(!r.greska && r.redovi[0]?.aktivan === false, "bibliotekar i dalje deaktivira čitaoca (postojeće pravo)", r.greska?.message ?? r.redovi);
  await db.query("update public.clanovi set aktivan = true where id = $1", [UA]);
  r = await kao("authenticated", BIB, "update public.clanovi set uloga = 'administrator' where id = $1 returning uloga", [UA]);
  ok(!r.greska && r.redovi[0]?.uloga === "citalac", "bibliotekar ne može nikome da promeni ulogu (promena se poništava): čitalac ostaje čitalac", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", BIB, "update public.clanovi set uloga = 'administrator' where id = $1 returning uloga", [BIB]);
  ok(!r.greska && r.redovi[0]?.uloga === "bibliotekar", "bibliotekar ne može ni sebe da unapredi", r.greska?.message ?? r.redovi);
  const NOVI = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  await db.query("insert into auth.users (id) values ($1)", [NOVI]);
  for (const uloga of ["administrator", "bibliotekar"]) {
    r = await kao("authenticated", BIB, "insert into public.clanovi (id, broj_kartice, ime, uloga) values ($1, 'POS-' || $2, 'Posle', $2) returning uloga", [NOVI, uloga]);
    ok(r.greska?.code === "42501", `bibliotekar ne može da upiše red sa ulogom '${uloga}'`, r.greska?.message ?? r.redovi);
  }
  r = await kao("authenticated", BIB, "insert into public.clanovi (id, broj_kartice, ime, uloga) values ($1, 'POS-CIT', 'Posle', 'citalac') returning uloga", [NOVI]);
  ok(!r.greska && r.redovi[0]?.uloga === "citalac", "bibliotekar i dalje upisuje čitaoca", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", BIB, "delete from public.clanovi where id = $1 returning id", [NOVI]);
  ok(!r.greska && r.redovi.length === 0, "bibliotekar ne briše članove (brisanje je samo administratoru)", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", BIB, "delete from public.clanovi where id = $1 returning id", [ADM]);
  ok(!r.greska && r.redovi.length === 0, "bibliotekar ne briše administratora", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", ADM, "update public.clanovi set aktivan = false where id = $1 returning aktivan", [BIB]);
  ok(!r.greska && r.redovi[0]?.aktivan === false, "administrator sme da deaktivira bibliotekara", r.greska?.message ?? r.redovi);
  await db.query("update public.clanovi set aktivan = true where id = $1", [BIB]);
  r = await kao("authenticated", ADM, "update public.clanovi set uloga = 'bibliotekar' where id = $1 returning uloga", [NOVI]);
  ok(!r.greska && r.redovi[0]?.uloga === "bibliotekar", "administrator menja ulogu", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", ADM, "update public.clanovi set ime = 'Admin Novo Ime' where id = $1 returning ime", [ADM]);
  ok(!r.greska && r.redovi[0]?.ime === "Admin Novo Ime", "administrator sme da menja i sebe", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", ADM, "insert into public.clanovi (id, broj_kartice, ime, uloga) values ($1, 'POS-ADM', 'Posle', 'administrator') on conflict (id) do update set uloga = 'administrator' returning uloga", [NOVI]);
  ok(!r.greska && r.redovi[0]?.uloga === "administrator", "administrator sme da dodeli ulogu administratora", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", ADM, "delete from public.clanovi where id = $1 returning id", [NOVI]);
  ok(!r.greska && r.redovi.length === 1, "administrator sme da briše članove", r.greska?.message ?? r.redovi);
  r = await kao("service_role", null, "update public.clanovi set ime = 'Administrator' where id = $1 returning ime", [ADM]);
  ok(!r.greska && r.redovi[0]?.ime === "Administrator", "servisna uloga je izuzeta (menja administratora)", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", UA, "update public.clanovi set nadimak = 'Moje ime', uloga = 'administrator', aktivan = false where id = $1 returning nadimak, uloga, aktivan", [UA]);
  ok(!r.greska && r.redovi[0]?.nadimak === "Moje ime" && r.redovi[0]?.uloga === "citalac" && r.redovi[0]?.aktivan === true, "čitalac i dalje menja samo svoj nadimak (uloga i aktivnost ostaju)", r.greska?.message ?? r.redovi);
  ok((await otisakPolitika20()) === politikePre20, "politike su iste i posle svih izmena");

  // idempotentnost i funkcije
  const fn20 = async () =>
    JSON.stringify([
      (await db.query("select pg_get_viewdef('public.izvestaj_za_nabavku'::regclass) as v")).rows,
      (await db.query("select pg_get_constraintdef(oid) as d from pg_constraint where conname = 'knjige_odluka_nabavke_check'")).rows,
      (await db.query("select tgname from pg_trigger where tgname in ('knjige_odluka_zastita_bu', 'clanovi_insert_zastita_bi', 'clanovi_zastita_bu') order by 1")).rows,
    ]);
  const pre20 = await fn20();
  await db.exec(fs.readFileSync(path.join(MIGRACIJE, NABAVKA[0]), "utf8"));
  ok((await fn20()) === pre20 && (await otisakPolitika20()) === politikePre20, "0020 je idempotentna: drugo puštanje ne duplira okidače, ograničenje ni pogled i ne menja politike", await fn20());
  r = await kao("authenticated", BIB, IZV);
  ok(!r.greska && r.redovi.length >= 4, "posle drugog puštanja izveštaj radi", r.greska?.message ?? r.redovi?.length);
  const f20 = (await db.query("select p.prosecdef, p.proconfig, has_function_privilege('anon', p.oid, 'execute') as anon from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'privatno' and p.proname = 'izvestaj_nabavke'")).rows[0];
  ok(f20?.prosecdef === true && (f20.proconfig ?? []).some((c) => c.startsWith("search_path=")) && f20.anon === false, "privatno.izvestaj_nabavke: SECURITY DEFINER sa search_path, nedostupna anon-u", f20);
  const opc20 = (await db.query("select reloptions from pg_class where relname = 'izvestaj_za_nabavku'")).rows[0];
  ok((opc20?.reloptions ?? []).includes("security_invoker=true"), "pogled izvestaj_za_nabavku je security_invoker", opc20);

  // ───────── upis knjige sa odlukom (ekran za unos) ─────────
  faza("Unos knjige: odluka nabavke se upisuje uz knjigu, pa knjiga nije među „Нове” u izveštaju");
  const okidacOdluke = (await db.query("select tgtype from pg_trigger where tgname = 'knjige_odluka_zastita_bu'")).rows[0];
  ok(okidacOdluke && (okidacOdluke.tgtype & 4) === 0 && (okidacOdluke.tgtype & 16) !== 0, "okidač knjige_odluka_zastita_bu važi samo pri izmeni (UPDATE), ne pri upisu (INSERT): zato klijent upisuje odluku i datum sam", okidacOdluke);
  const UNOS_ODLUKA = `insert into public.knjige (naslov, autor, izdavac, isbn, zanrovi, opis, signatura, u_fondu, broj_primeraka, broj_slobodnih, izvor, uneo_id, odluka_nabavke, odluka_datum)
                values ($1, 'Autor U', 'Izdavač U', null, '{}', null, null, $2, $3, $3, $4, $5, $6, $7) returning id, odluka_nabavke, odluka_datum, u_fondu`;
  r = await kao("authenticated", BIB, UNOS_ODLUKA, ["U1 sačuvano kao nabavljamo", false, 0, "link", BIB, "nabavljamo", "2026-11-17T10:30:00Z"]);
  const UKO1 = r.redovi?.[0]?.id;
  ok(!r.greska && r.redovi[0]?.odluka_nabavke === "nabavljamo" && r.redovi[0]?.u_fondu === false && new Date(r.redovi[0]?.odluka_datum).toISOString() === "2026-11-17T10:30:00.000Z", "bibliotekar upisuje knjigu kao „Nabavljamo”: odluka i datum su u redu, u_fondu = false", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", BIB, UNOS_ODLUKA, ["U1 sačuvano kao imamo", true, 2, "fond", BIB, "imamo", "2026-11-17T10:31:00Z"]);
  const UKO2 = r.redovi?.[0]?.id;
  ok(!r.greska && r.redovi[0]?.odluka_nabavke === "imamo" && r.redovi[0]?.u_fondu === true, "bibliotekar upisuje knjigu kao „Imamo”: odluka 'imamo', u_fondu = true", r.greska?.message ?? r.redovi);
  for (const k of [UKO1, UKO2]) await db.query("insert into polica (clan_id, knjiga_id, status) values ($1, $2, 'zelim')", [UA, k]);
  r = await kao("authenticated", BIB, "select naslov, odluka, odluka_postavljena, odluka_datum from public.izvestaj_za_nabavku where naslov like 'U1 %' order by naslov");
  ok(!r.greska && r.redovi.length === 2 && r.redovi.every((x) => x.odluka !== null && x.odluka_postavljena === true && x.odluka_datum !== null) && r.redovi.map((x) => x.odluka).join() === "imamo,nabavljamo", "u izveštaju obe knjige imaju postavljenu odluku i datum: nijedna nije među „Нове” (odluka nije prazna)", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", BIB, "select count(*)::int as n from public.izvestaj_za_nabavku where naslov like 'U1 %' and odluka is null");
  ok(r.redovi?.[0]?.n === 0, "filter „Нове” (bez odluke) ih ne pokazuje", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", BIB, "update public.knjige set odluka_nabavke = 'imamo' where id = $1 returning odluka_nabavke, odluka_datum, u_fondu", [UKO1]);
  ok(!r.greska && r.redovi[0]?.odluka_nabavke === "imamo" && r.redovi[0]?.u_fondu === true && new Date(r.redovi[0]?.odluka_datum) > new Date("2026-11-17T10:30:00Z"), "kasnija izmena odluke radi okidač: novi datum (sat baze) i u_fondu = true", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", UA, UNOS_ODLUKA, ["U1 čitalac upisuje sa odlukom", true, 5, "fond", UA, "imamo", "2026-11-17T10:00:00Z"]);
  ok(r.greska?.message?.includes("row-level security") || (!r.greska && r.redovi[0]?.odluka_nabavke === null), "čitalac ne može da upiše knjigu sa odlukom (RLS ili poništeno okidačem iz 0020)", r.greska?.message ?? r.redovi);

  // ───────── 0021: moderacija prijava ─────────
  faza("0021: moderacija prijava (samo resena i beleska se menjaju, prijavljuje se samo ono što prijavilac vidi, dužine)");
  const otisakPolitika21 = async () =>
    JSON.stringify((await db.query(`select c.relname, p.polname, p.polcmd::text as cmd, pg_get_expr(p.polqual, p.polrelid) as q, pg_get_expr(p.polwithcheck, p.polrelid) as w
                                      from pg_policy p join pg_class c on c.oid = p.polrelid where c.relname in ('prijave', 'preporuke', 'utisci', 'clanovi') order by 1, 2`)).rows);
  const politikePre21 = await otisakPolitika21();

  const UD = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"; // nije povezan ni sa kim
  await db.query("insert into auth.users (id) values ($1)", [UD]);
  await db.query("insert into clanovi (id, broj_kartice, ime, nadimak, uloga, aktivan) values ($1, 'UD1', 'Pravo Ime D', null, 'citalac', true)", [UD]);
  const utisakId = async (clan, knjiga) => (await db.query("select id from public.utisci where clan_id = $1 and knjiga_id = $2", [clan, knjiga])).rows[0].id;
  const U_B_JAVNI = await utisakId(UB, K1);
  const U_B_SAMO_JA = await utisakId(UB, K3);
  const U_B_SKRIVEN = await utisakId(UB, K4);
  const U_A_SVOJ = await utisakId(UA, K1);
  const U_B_PRIJATELJI = await utisakId(UB, K2);
  const PREP_BA = (await db.query("insert into public.preporuke (posiljalac_id, primalac_id, knjiga_id, poruka) values ($1, $2, $3, 'B šalje A') returning id", [UB, UA, K1])).rows[0].id;
  const PREP_BD = (await db.query("insert into public.preporuke (posiljalac_id, primalac_id, knjiga_id, poruka) values ($1, $2, $3, 'B šalje D, tajno') returning id", [UB, UD, K1])).rows[0].id;
  await db.query("insert into public.utisci (clan_id, knjiga_id, ocena, tekst, vidljivost) values ($1, $2, 6, 'D javno', 'javno'), ($1, $3, 5, 'D prijatelji', 'prijatelji')", [UD, K1, K2]);
  const U_D_JAVNI = await utisakId(UD, K1);
  const U_D_PRIJATELJI = await utisakId(UD, K2);
  const NEPOSTOJI = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const P21 = "insert into public.prijave (prijavio_id, tip, stavka_id, razlog) values ($1, $2, $3, $4) returning id, resena, resio_id, beleska, resena_datum";
  const P21_PRE = "insert into public.prijave (prijavio_id, tip, stavka_id, razlog) values ($1, $2, $3, $4) returning id";

  // pre migracije: rupe koje 0021 zatvara
  r = await kao("authenticated", UA, P21_PRE, [UA, "utisak", NEPOSTOJI, "izmišljena stavka"]);
  ok(!r.greska, "PRE 0021: član može da prijavi id koji ne postoji (rupa)", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", UA, P21_PRE, [UA, "preporuka", PREP_BD, "tuđa prepiska"]);
  const PRE_TUDJA = r.redovi?.[0]?.id;
  ok(!r.greska, "PRE 0021: član može da prijavi preporuku koja nije njegova (rupa)", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", BIB, "select poruka from public.preporuke where id = $1", [PREP_BD]);
  ok(r.redovi?.[0]?.poruka === "B šalje D, tajno", "PRE 0021: zbog toga bibliotekar čita tuđu prepisku (put do privatne preporuke)", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", BIB, "update public.prijave set prijavio_id = $2, tip = 'clan', razlog = 'prepravljeno', kreirana = '2000-01-01' where id = $1 returning prijavio_id, tip, razlog", [PRE_TUDJA, UC]);
  ok(!r.greska && r.redovi[0]?.prijavio_id === UC && r.redovi[0]?.razlog === "prepravljeno", "PRE 0021: bibliotekar može da prepravi ko je prijavio, šta i zašto (rupa)", r.greska?.message ?? r.redovi);
  await db.query("delete from public.prijave where razlog in ('izmišljena stavka', 'prepravljeno')");

  for (const f of MODERACIJA) await pusti(f);

  ok((await otisakPolitika21()) === politikePre21, "0021: politike (RLS) na prijave, preporuke, utisci i clanovi su iste kao pre (nijedna dodata, izbrisana ni izmenjena)");
  const k21 = fs.readFileSync(path.join(MIGRACIJE, MODERACIJA[0]), "utf8").replace(/^--.*$/gm, "");
  ok(!/\b(create|drop|alter)\s+policy\b/i.test(k21) && !/create\s+table/i.test(k21), "0021 ne piše nijednu politiku i ne pravi tabele");
  const kolPrijave = (await db.query("select column_name from information_schema.columns where table_schema = 'public' and table_name = 'prijave' order by ordinal_position")).rows.map((x) => x.column_name);
  ok(kolPrijave.includes("resena_datum"), "prijave imaju kolonu resena_datum", kolPrijave);

  // upis: samo ono što prijavilac vidi
  r = await kao("authenticated", UA, P21, [UA, "utisak", U_B_JAVNI, "Uvredljiv tekst"]);
  const PRIJAVA_U = r.redovi?.[0]?.id;
  ok(!r.greska && r.redovi.length === 1, "A prijavljuje javni utisak člana B", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", UA, P21, [UA, "utisak", U_B_JAVNI, "Opet"]);
  ok(r.greska?.code === "23505", "ista prijava istog utiska se ne podnosi dvaput", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", UA, P21, [UA, "utisak", U_B_PRIJATELJI, "Povezani vide utisak 'prijatelji'"]);
  ok(!r.greska, "A prijavljuje utisak „samo povezani” člana B (povezani su, pa ga vidi)", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", UD, P21, [UD, "utisak", U_B_PRIJATELJI, "Ne vidim ga"]);
  ok(r.greska?.code === "22023", "D (nije povezan) ne može da prijavi utisak „samo povezani” (ne vidi ga)", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", UA, P21, [UA, "utisak", U_B_SAMO_JA, "Ne vidim ga"]);
  ok(r.greska?.code === "22023", "utisak „samo ja” se ne može prijaviti (prijavilac ga ne vidi)", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", UA, P21, [UA, "utisak", U_B_SKRIVEN, "Već sakriven"]);
  ok(r.greska?.code === "22023", "sakriven utisak se ne može prijaviti (prijavilac ga ne vidi)", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", UA, P21, [UA, "utisak", U_A_SVOJ, "Sopstveni"]);
  ok(r.greska?.code === "22023", "sopstveni utisak se ne prijavljuje", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", UA, P21, [UA, "utisak", NEPOSTOJI, "Izmišljen"]);
  ok(r.greska?.code === "22023", "id koji ne postoji se ne može prijaviti", r.greska?.message ?? r.redovi);

  r = await kao("authenticated", UA, P21, [UA, "preporuka", PREP_BA, "Neprimerena preporuka"]);
  const PRIJAVA_P = r.redovi?.[0]?.id;
  ok(!r.greska && r.redovi.length === 1, "A prijavljuje preporuku koju je primio", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", UA, P21, [UA, "preporuka", PREP_BD, "Tuđa"]);
  ok(r.greska?.code === "22023", "A ne može da prijavi preporuku koja je upućena drugom (nije njegova)", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", UB, P21, [UB, "preporuka", PREP_BA, "Sopstvena poslata"]);
  ok(r.greska?.code === "22023", "pošiljalac ne prijavljuje sopstvenu poruku (prijavljuje je samo primalac)", r.greska?.message ?? r.redovi);

  r = await kao("authenticated", UB, P21, [UB, "clan", UA, "Prijava povezanog člana"]);
  ok(!r.greska && r.redovi.length === 1, "B prijavljuje člana A sa kojim je povezan", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", UD, P21, [UD, "clan", UA, "Nepovezan"]);
  ok(r.greska?.code === "22023", "D ne može da prijavi člana sa kojim nije povezan", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", UA, P21, [UA, "clan", UA, "Sebe"]);
  ok(r.greska?.code === "22023", "član ne prijavljuje sebe", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", UA, P21, [UA, "clan", NEPOSTOJI, "Nema ga"]);
  ok(r.greska?.code === "22023", "član koji ne postoji se ne može prijaviti", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", UA, P21, [UD, "clan", UB, "u tuđe ime"]);
  ok(r.greska?.message?.includes("row-level security"), "prijava u tuđe ime i dalje odbija politika (okidač joj ne smeta)", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", UA, "insert into public.prijave (prijavio_id, tip, stavka_id, razlog, resena, resio_id, beleska, resena_datum) values ($1, 'utisak', $2, 'Unapred rešeno', true, $3, 'beleška', now()) returning resena, resio_id, beleska, resena_datum", [UA, await utisakId(UC, K1), BIB]);
  ok(!r.greska && r.redovi[0]?.resena === false && r.redovi[0]?.resio_id === null && r.redovi[0]?.beleska === null && r.redovi[0]?.resena_datum === null, "nova prijava je uvek nerešena (resena, resio_id, beleska i datum se ne mogu podneti unapred)", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", UA, P21, [UA, "utisak", U_D_PRIJATELJI, "Utisak D prijatelji"]);
  ok(r.greska?.code === "22023", "utisak „samo povezani” člana D, koji nije povezan sa A, se ne može prijaviti", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", UA, P21, [UA, "utisak", U_D_JAVNI, "x".repeat(301)]);
  ok(r.greska?.message?.includes("prijave_razlog_duzina"), "razlog duži od 300 znakova se odbija u bazi", r.greska?.message ?? r.redovi);
  r = await kao("service_role", null, P21, [UA, "utisak", NEPOSTOJI, "Servisna uloga je izuzeta"]);
  ok(!r.greska, "servisna uloga je izuzeta od provere stavke", r.greska?.message ?? r.redovi);
  await db.query("delete from public.prijave where razlog = 'Servisna uloga je izuzeta'");

  // ko šta vidi
  r = await kao("authenticated", UB, "select count(*)::int as n from public.prijave where prijavio_id <> $1", [UB]);
  ok(r.redovi?.[0]?.n === 0, "prijavljeni član B ne vidi tuđe prijave (nema znaka da je prijavljen)", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", UA, "select count(*)::int as n from public.prijave where prijavio_id <> $1", [UA]);
  ok(r.redovi?.[0]?.n === 0, "član vidi samo sopstvene prijave", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", BIB, "select poruka from public.preporuke where id in ($1, $2) order by poruka", [PREP_BA, PREP_BD]);
  ok(!r.greska && r.redovi.length === 1 && r.redovi[0].poruka === "B šalje A", "bibliotekar vidi prijavljenu preporuku, ali ne i neprijavljenu iz iste prepiske", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", UA, "update public.prijave set resena = true where id = $1 returning id", [PRIJAVA_U]);
  ok(!r.greska && r.redovi.length === 0, "prijavilac ne može da reši sopstvenu prijavu (nema politike za izmenu)", r.greska?.message ?? r.redovi);

  // rešavanje
  r = await kao("authenticated", BIB, `update public.prijave set resena = true, beleska = '  Upozoren član.  ', prijavio_id = $2, tip = 'clan', stavka_id = $2, razlog = 'prepravljeno', kreirana = '2000-01-01', resio_id = $3, resena_datum = '2000-01-01'
                                        where id = $1 returning resena, beleska, resio_id, resena_datum, prijavio_id, tip, stavka_id, razlog, kreirana`, [PRIJAVA_U, UC, ADM]);
  const rs = r.redovi?.[0];
  ok(!r.greska && rs?.resena === true && rs.beleska === "Upozoren član." && rs.resio_id === BIB && new Date(rs.resena_datum).getFullYear() >= 2026, "bibliotekar rešava: beleška je očišćena, rešio je on (auth.uid()), vreme je sat baze", r.greska?.message ?? rs);
  ok(rs?.prijavio_id === UA && rs.tip === "utisak" && rs.stavka_id === U_B_JAVNI && rs.razlog === "Uvredljiv tekst" && new Date(rs.kreirana).getFullYear() >= 2026, "u istoj izmeni ko je prijavio, šta, razlog i vreme prijave ostaju isti (okidač ih vraća)", rs);
  const datum1 = rs?.resena_datum;
  r = await kao("authenticated", ADM, "update public.prijave set beleska = 'Dopuna.', resio_id = $2, resena_datum = '2001-01-01' where id = $1 returning resena, beleska, resio_id, resena_datum", [PRIJAVA_U, ADM]);
  ok(!r.greska && r.redovi[0]?.resena === true && r.redovi[0]?.beleska === "Dopuna." && r.redovi[0]?.resio_id === BIB && new Date(r.redovi[0]?.resena_datum).getTime() === new Date(datum1).getTime(), "već rešena prijava: beleška može da se dopuni, ali ko je rešio i kada se ne menja", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", BIB, "update public.prijave set resena = false where id = $1 returning resena, resio_id, resena_datum, beleska", [PRIJAVA_U]);
  ok(!r.greska && r.redovi[0]?.resena === false && r.redovi[0]?.resio_id === null && r.redovi[0]?.resena_datum === null && r.redovi[0]?.beleska === "Dopuna.", "vraćanje među nerešene skida ko je rešio i datum; beleška ostaje", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", ADM, "update public.prijave set resena = true, beleska = '   ' where id = $1 returning resio_id, beleska", [PRIJAVA_U]);
  ok(!r.greska && r.redovi[0]?.resio_id === ADM && r.redovi[0]?.beleska === null, "administrator rešava kao on sam; beleška od samih razmaka postaje prazna", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", BIB, "update public.prijave set beleska = $2 where id = $1 returning id", [PRIJAVA_U, "x".repeat(501)]);
  ok(r.greska?.message?.includes("prijave_beleska_duzina"), "beleška duža od 500 znakova se odbija u bazi", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", BIB, "update public.prijave set beleska = $2 where id = $1 returning length(beleska)::int as n", [PRIJAVA_U, "x".repeat(500)]);
  ok(!r.greska && r.redovi[0]?.n === 500, "beleška od tačno 500 znakova prolazi", r.greska?.message ?? r.redovi);
  r = await kao("service_role", null, "update public.prijave set razlog = 'servisno', resio_id = $2 where id = $1 returning razlog, resio_id", [PRIJAVA_U, UA]);
  ok(!r.greska && r.redovi[0]?.razlog === "servisno", "servisna uloga je izuzeta od zaštite izmene", r.greska?.message ?? r.redovi);

  // radnje nad prijavljenim: sakrivanje utiska i preporuke
  r = await kao("authenticated", BIB, "update public.utisci set skriven = true where id = $1 returning skriven", [U_B_JAVNI]);
  ok(!r.greska && r.redovi[0]?.skriven === true, "bibliotekar sakriva prijavljeni utisak", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", UA, "select count(*)::int as n from public.utisci where id = $1", [U_B_JAVNI]);
  ok(r.redovi?.[0]?.n === 0, "sakriven utisak više ne vidi drugi čitalac", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", BIB, "update public.utisci set skriven = false where id = $1 returning skriven", [U_B_JAVNI]);
  ok(!r.greska && r.redovi[0]?.skriven === false, "bibliotekar vraća utisak", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", UB, "update public.utisci set skriven = true where id = $1 returning skriven", [U_B_JAVNI]);
  ok(!r.greska && r.redovi[0]?.skriven === false, "autor sam ne može da sakrije ni otkrije svoj utisak (postojeći okidač)", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", BIB, "update public.preporuke set skrivena = true where id = $1 returning skrivena", [PREP_BA]);
  ok(!r.greska && r.redovi[0]?.skrivena === true, "bibliotekar sakriva prijavljenu preporuku", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", UA, "select count(*)::int as n from public.moje_preporuke where id = $1", [PREP_BA]);
  ok(r.redovi?.[0]?.n === 0, "sakrivena preporuka nestaje primaocu iz pogleda moje_preporuke", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", BIB, "select skrivena from public.preporuke where id = $1", [PREP_BA]);
  ok(r.redovi?.[0]?.skrivena === true, "bibliotekar je i dalje vidi (prijava postoji), pa može da je vrati", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", BIB, "update public.preporuke set skrivena = false where id = $1 returning skrivena", [PREP_BA]);
  ok(!r.greska && r.redovi[0]?.skrivena === false, "bibliotekar vraća preporuku", r.greska?.message ?? r.redovi);

  // prijava preživi brisanje stavke (0004), pa ekran piše „više ne postoji”
  await db.query("delete from public.preporuke where id = $1", [PREP_BA]);
  r = await kao("authenticated", BIB, "select id from public.prijave where id = $1", [PRIJAVA_P]);
  ok(r.redovi?.length === 1, "prijava ostaje i posle brisanja prijavljene preporuke", r.greska?.message ?? r.redovi);

  // funkcije i idempotentnost
  const f21 = (await db.query("select p.proname, p.prosecdef, has_function_privilege('anon', p.oid, 'execute') as anon from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'privatno' and p.proname in ('prijave_zastita', 'prijave_provera_bi') order by 1")).rows;
  ok(f21.length === 2 && f21.every((f) => f.prosecdef === false && f.anon === false), "obe funkcije okidača su u šemi privatno, nisu SECURITY DEFINER (provera stavke radi sa pravima prijavioca, RLS važi) i nisu dostupne anon-u", f21);
  const fn21 = async () =>
    JSON.stringify([
      (await db.query("select pg_get_constraintdef(oid) as d, convalidated from pg_constraint where conname in ('prijave_razlog_duzina', 'prijave_beleska_duzina') order by conname")).rows,
      (await db.query("select tgname from pg_trigger where tgrelid = 'public.prijave'::regclass and not tgisinternal order by 1")).rows,
      (await db.query("select indexdef from pg_indexes where schemaname = 'public' and indexname = 'prijave_resene_idx'")).rows,
    ]);
  const pre21 = await fn21();
  await db.exec(fs.readFileSync(path.join(MIGRACIJE, MODERACIJA[0]), "utf8"));
  ok((await fn21()) === pre21 && (await otisakPolitika21()) === politikePre21, "0021 je idempotentna: drugo puštanje ne duplira okidače, ograničenja ni indeks i ne menja politike", await fn21());
  ok(JSON.parse(pre21)[1].map((t) => t.tgname).join() === "prijave_provera_bi,prijave_zastita_bu", "na prijavama su tačno dva okidača: prijave_provera_bi i prijave_zastita_bu", JSON.parse(pre21)[1]);
  r = await kao("authenticated", UA, P21, [UA, "utisak", U_B_SAMO_JA, "posle drugog puštanja"]);
  ok(r.greska?.code === "22023", "posle drugog puštanja provera stavke i dalje radi", r.greska?.message ?? r.redovi);

  // ───────── 0022: utisak sa pulta ─────────
  faza("0022: utisak sa pulta (potpis bibliotekara se ne može lažirati, neaktivnom članu se ne upisuje, autor koji menja reči preuzima utisak)");
  const otisakPolitika22 = async () =>
    JSON.stringify((await db.query("select c.relname, p.polname, p.polcmd::text as cmd, pg_get_expr(p.polqual, p.polrelid) as q, pg_get_expr(p.polwithcheck, p.polrelid) as w from pg_policy p join pg_class c on c.oid = p.polrelid where c.relname in ('utisci', 'clanovi') order by 1, 2")).rows);
  const politikePre22 = await otisakPolitika22();
  const KP1 = await nova("P22 jedan");
  const KP2 = await nova("P22 dva");
  const KP3 = await nova("P22 tri");
  const KP4 = await nova("P22 četiri");
  const UT22 = "insert into public.utisci (clan_id, knjiga_id, ocena, tekst, vidljivost, uneo_bibliotekar_id) values ($1, $2, 7, $3, $4, $5) returning id, uneo_bibliotekar_id, clan_id";

  // pre migracije: rupe
  r = await kao("authenticated", UA, UT22, [UA, KP1, "A lažira potpis", "javno", ADM]);
  ok(!r.greska && r.redovi[0]?.uneo_bibliotekar_id === ADM, "PRE 0022: član može da upiše svoj utisak sa tuđim potpisom bibliotekara (rupa)", r.greska?.message ?? r.redovi);
  await db.query("delete from public.utisci where tekst = 'A lažira potpis'");
  r = await kao("authenticated", BIB, UT22, [NEAKTIVAN, KP1, "Za neaktivnog", "javno", BIB]);
  ok(!r.greska, "PRE 0022: bibliotekar može da upiše utisak u ime neaktivnog člana (rupa)", r.greska?.message ?? r.redovi);
  await db.query("delete from public.utisci where tekst = 'Za neaktivnog'");

  for (const f of POTPIS) await pusti(f);

  ok((await otisakPolitika22()) === politikePre22, "0022: politike (RLS) na utisci i clanovi su iste kao pre (nijedna dodata, izbrisana ni izmenjena)");
  r = await kao("authenticated", UA, UT22, [UA, KP1, "A lažira potpis", "javno", ADM]);
  ok(!r.greska && r.redovi[0]?.uneo_bibliotekar_id === null, "POSLE 0022: potpis koji član upiše uz svoj utisak se poništava", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", BIB, UT22, [UB, KP1, "Sa pulta za B", "samo_ja", BIB]);
  const PULT_B = r.redovi?.[0]?.id;
  ok(!r.greska && r.redovi[0]?.clan_id === UB && r.redovi[0]?.uneo_bibliotekar_id === BIB, "bibliotekar upisuje utisak u ime člana B: utisak pripada B-u, potpis je bibliotekar", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", BIB, UT22, [UB, KP1, "Opet za B", "javno", BIB]);
  ok(r.greska?.code === "23505", "postojeći utisak člana se ne prepisuje (jedinstvenost član + knjiga)", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", BIB, UT22, [NEAKTIVAN, KP2, "Za neaktivnog", "javno", BIB]);
  ok(r.greska?.code === "22023", "neaktivnom članu se ne upisuje utisak (22023)", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", BIB, UT22, [UB, KP2, "Tuđi potpis", "javno", ADM]);
  ok(r.greska?.message?.includes("row-level security"), "bibliotekar ne može da potpiše tuđim imenom (politika zahteva potpis = on sam)", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", BIB, UT22, [BIB, KP2, "Svoj utisak bibliotekara", "javno", BIB]);
  ok(!r.greska && r.redovi[0]?.uneo_bibliotekar_id === null, "bibliotekar piše i svoj utisak: bez potpisa (nije ničiji „u ime”)", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", UC, UT22, [UB, KP3, "C piše za B", "javno", UC]);
  ok(Boolean(r.greska), "običan član ne može da upiše utisak u tuđe ime", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", ADM, UT22, [UC, KP3, "Administrator za C", "javno", ADM]);
  const PULT_C = r.redovi?.[0]?.id;
  ok(!r.greska && r.redovi[0]?.uneo_bibliotekar_id === ADM, "administrator takođe upisuje u ime člana", r.greska?.message ?? r.redovi);
  r = await kao("service_role", null, UT22, [UD, KP4, "Servisno", "javno", ADM]);
  ok(!r.greska && r.redovi[0]?.uneo_bibliotekar_id === ADM, "servisna uloga je izuzeta", r.greska?.message ?? r.redovi);

  // izmene
  r = await kao("authenticated", UB, "update public.utisci set vidljivost = 'javno', spojler = false, uneo_bibliotekar_id = null where id = $1 returning vidljivost, uneo_bibliotekar_id", [PULT_B]);
  ok(!r.greska && r.redovi[0]?.vidljivost === "javno" && r.redovi[0]?.uneo_bibliotekar_id === BIB, "član menja samo vidljivost: potpis ostaje (i ne može da ga skine rukom)", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", BIB, "update public.utisci set skriven = true, uneo_bibliotekar_id = $2 where id = $1 returning skriven, uneo_bibliotekar_id", [PULT_B, ADM]);
  ok(!r.greska && r.redovi[0]?.skriven === true && r.redovi[0]?.uneo_bibliotekar_id === BIB, "moderacija (sakrivanje) ne dira potpis, ni kad ga bibliotekar pokuša da prepravi", r.greska?.message ?? r.redovi);
  await db.query("update public.utisci set skriven = false where id = $1", [PULT_B]);
  r = await kao("authenticated", UB, "update public.utisci set uneo_bibliotekar_id = $2 where id = $1 returning uneo_bibliotekar_id", [PULT_B, ADM]);
  ok(!r.greska && r.redovi[0]?.uneo_bibliotekar_id === BIB, "član ne može da promeni potpis na svom utisku", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", UB, "update public.utisci set tekst = 'Sad pišem ja' where id = $1 returning tekst, uneo_bibliotekar_id", [PULT_B]);
  ok(!r.greska && r.redovi[0]?.tekst === "Sad pišem ja" && r.redovi[0]?.uneo_bibliotekar_id === null, "član koji promeni tekst preuzima utisak: potpis se poništava", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", BIB, "update public.utisci set uneo_bibliotekar_id = $2 where id = $1 returning uneo_bibliotekar_id", [PULT_B, BIB]);
  ok(!r.greska && r.redovi[0]?.uneo_bibliotekar_id === null, "bibliotekar ne može naknadno da potpiše tuđ utisak (potpis se postavlja samo pri upisu)", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", UC, "update public.utisci set ocena = 2 where id = $1 returning ocena, uneo_bibliotekar_id", [PULT_C]);
  ok(!r.greska && r.redovi[0]?.ocena === 2 && r.redovi[0]?.uneo_bibliotekar_id === null, "član koji promeni ocenu takođe preuzima utisak", r.greska?.message ?? r.redovi);

  // funkcije i idempotentnost
  const fn22 = async () => JSON.stringify((await db.query("select tgname from pg_trigger where tgrelid = 'public.utisci'::regclass and not tgisinternal order by 1")).rows);
  const pre22 = await fn22();
  await db.exec(fs.readFileSync(path.join(MIGRACIJE, POTPIS[0]), "utf8"));
  ok((await fn22()) === pre22 && (await otisakPolitika22()) === politikePre22, "0022 je idempotentna: drugo puštanje ne duplira okidače i ne menja politike", await fn22());
  ok(JSON.parse(pre22).map((x) => x.tgname).filter((n) => n.startsWith("utisci_potpis")).join() === "utisci_potpis_bi,utisci_potpis_bu", "na utiscima su okidači utisci_potpis_bi i utisci_potpis_bu (uz postojeće)", JSON.parse(pre22));
  const f22 = (await db.query("select p.prosecdef, has_function_privilege('anon', p.oid, 'execute') as anon from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'privatno' and p.proname = 'utisci_potpis'")).rows[0];
  ok(f22?.prosecdef === false && f22.anon === false, "privatno.utisci_potpis nije SECURITY DEFINER i nije dostupna anon-u", f22);

  // ───────── 0023: moje_blokade i odblokiranje ─────────
  faza("0023: pogled moje_blokade (samo moje, samo nadimak), odblokiranje je brisanje svoje blokade");
  const otisakPolitika23 = async () =>
    JSON.stringify((await db.query("select c.relname, p.polname, p.polcmd::text as cmd, pg_get_expr(p.polqual, p.polrelid) as q, pg_get_expr(p.polwithcheck, p.polrelid) as w from pg_policy p join pg_class c on c.oid = p.polrelid where c.relname in ('blokade', 'veze', 'clanovi') order by 1, 2")).rows);
  const politikePre23 = await otisakPolitika23();
  const UE = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  await db.query("insert into auth.users (id) values ($1)", [UE]);
  await db.query("insert into clanovi (id, broj_kartice, ime, nadimak, uloga, aktivan) values ($1, 'UE1', 'Pravo Ime E', 'Nadimak E', 'citalac', true)", [UE]);
  await db.query("update clanovi set nadimak = 'Nadimak D' where id = $1", [UD]);
  const sifraE = (await db.query("select sifra_poziva from clanovi where id = $1", [UE])).rows[0].sifra_poziva;
  await db.query("insert into public.blokade (blokirao_id, blokirani_id) values ($1, $2)", [UD, UE]);

  r = await kao("authenticated", UD, "select * from public.moje_blokade");
  ok(r.greska && /moje_blokade|does not exist/.test(r.greska.message), "PRE 0023: pogleda moje_blokade nema", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", UD, "select posalji_poziv($1)", [sifraE]);
  ok(r.greska?.code === "P0001", "PRE odblokiranja: D ne može da pozove E-a koga je blokirao (ista opšta greška)", r.greska?.message ?? r.redovi);

  for (const f of BLOKADE) await pusti(f);

  ok((await otisakPolitika23()) === politikePre23, "0023: politike (RLS) na blokade, veze i clanovi su iste kao pre (nijedna dodata, izbrisana ni izmenjena)");
  r = await kao("authenticated", UD, "select id, clan_id, nadimak, kreirana from public.moje_blokade");
  const BLOKADA_DE = r.redovi?.[0]?.id;
  ok(!r.greska && r.redovi.length === 1 && r.redovi[0].clan_id === UE && r.redovi[0].nadimak === "Nadimak E", "D vidi koga je blokirao: samo E, sa nadimkom", r.greska?.message ?? r.redovi);
  const kol23 = (await db.query("select column_name from information_schema.columns where table_schema = 'public' and table_name = 'moje_blokade' order by ordinal_position")).rows.map((x) => x.column_name);
  ok(JSON.stringify(kol23) === JSON.stringify(["id", "clan_id", "kreirana", "nadimak"]), "pogled nema ime, broj karte ni šifru poziva", kol23);
  r = await kao("authenticated", UE, "select count(*)::int as n from public.moje_blokade");
  ok(r.redovi?.[0]?.n === 0, "blokirani E ne vidi ništa (ne saznaje za blokadu)", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", BIB, "select count(*)::int as n from public.moje_blokade");
  ok(r.redovi?.[0]?.n === 0, "bibliotekar kroz pogled vidi samo svoje blokade (ne tuđe)", r.greska?.message ?? r.redovi);
  r = await kao("anon", null, "select * from public.moje_blokade");
  ok(nemaPrava(r), "anon ne sme da čita pogled", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", UE, "delete from public.blokade where id = $1 returning id", [BLOKADA_DE]);
  ok(!r.greska && r.redovi.length === 0, "E ne može da obriše blokadu koju je D napravio", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", UC, "delete from public.blokade where id = $1 returning id", [BLOKADA_DE]);
  ok(!r.greska && r.redovi.length === 0, "treći član ne može da obriše tuđu blokadu", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", UD, "delete from public.blokade where id = $1 returning id", [BLOKADA_DE]);
  ok(!r.greska && r.redovi.length === 1, "D odblokira E-a: brisanje svoje blokade", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", UD, "select count(*)::int as n from public.moje_blokade");
  ok(r.redovi?.[0]?.n === 0, "posle odblokiranja spisak je prazan", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", UD, "select posalji_poziv($1)", [sifraE]);
  ok(!r.greska, "posle odblokiranja D može ponovo da pozove E-a (veza se ne vraća sama, pravi se novim pozivom)", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", UD, "select count(*)::int as n from public.moje_veze where status = 'prihvacena' and clan_id = $1", [UE]);
  ok(r.redovi?.[0]?.n === 0, "odblokiranje samo po sebi ne pravi vezu (poziv čeka prihvatanje)", r.greska?.message ?? r.redovi);
  await db.query("delete from public.veze where pozivalac_id = $1 and pozvani_id = $2", [UD, UE]);

  const pre23 = JSON.stringify([(await db.query("select pg_get_viewdef('public.moje_blokade'::regclass) as v")).rows, (await db.query("select reloptions from pg_class where relname = 'moje_blokade'")).rows]);
  await db.exec(fs.readFileSync(path.join(MIGRACIJE, BLOKADE[0]), "utf8"));
  const posle23 = JSON.stringify([(await db.query("select pg_get_viewdef('public.moje_blokade'::regclass) as v")).rows, (await db.query("select reloptions from pg_class where relname = 'moje_blokade'")).rows]);
  ok(pre23 === posle23 && (await otisakPolitika23()) === politikePre23 && pre23.includes("security_invoker=true"), "0023 je idempotentna i pogled je security_invoker", pre23);

  // ───────── 0024: pregled svih knjiga (zbir i lista, samo bibliotekar, bez ikakvog traga do člana) ─────────
  faza("0024: pregled svih knjiga: zbirni brojevi i lista sa brojem čitalaca (samo bibliotekar, bez člana u odgovoru)");
  const otisakPolitika24 = async () =>
    JSON.stringify((await db.query("select c.relname, p.polname, p.polcmd::text as cmd, pg_get_expr(p.polqual, p.polrelid) as q, pg_get_expr(p.polwithcheck, p.polrelid) as w from pg_policy p join pg_class c on c.oid = p.polrelid where c.relname in ('knjige', 'polica', 'clanovi') order by 1, 2")).rows);
  const politikePre24 = await otisakPolitika24();

  r = await kao("authenticated", BIB, "select * from public.pregled_knjiga_zbir()");
  ok(r.greska && /pregled_knjiga_zbir/.test(r.greska.message), "PRE 0024: funkcije nema", r.greska?.message ?? r.redovi);

  for (const f of PREGLED) await pusti(f);

  ok((await otisakPolitika24()) === politikePre24, "0024: politike (RLS) na knjige, polica i clanovi su iste kao pre (nijedna dodata, izbrisana ni izmenjena)");
  const k24 = fs.readFileSync(path.join(MIGRACIJE, PREGLED[0]), "utf8").replace(/^\s*--.*$/gm, "");
  ok(!/\b(create|drop|alter)\s+policy\b/i.test(k24) && !/create\s+table|add column/i.test(k24), "0024 ne piše politike, tabele ni kolone");

  // zbir: poklapa se sa direktnim brojanjem
  const direktno = (await db.query(`select
      (count(*) filter (where spojena_sa_id is null))::int as ukupno,
      (count(*) filter (where spojena_sa_id is null and izvor = 'fond'))::int as fond,
      (count(*) filter (where spojena_sa_id is null and izvor = 'link'))::int as link,
      (count(*) filter (where spojena_sa_id is null and izvor = 'google_books'))::int as google_books,
      (count(*) filter (where spojena_sa_id is null and izvor = 'clan'))::int as clan,
      (count(*) filter (where spojena_sa_id is null and coalesce(odluka_nabavke, case when u_fondu then 'imamo' end) = 'imamo'))::int as imamo,
      (count(*) filter (where spojena_sa_id is null and coalesce(odluka_nabavke, case when u_fondu then 'imamo' end) = 'nabavljamo'))::int as nabavljamo,
      (count(*) filter (where spojena_sa_id is null and coalesce(odluka_nabavke, case when u_fondu then 'imamo' end) = 'ne_nabavljamo'))::int as ne_nabavljamo,
      (count(*) filter (where spojena_sa_id is null and coalesce(odluka_nabavke, case when u_fondu then 'imamo' end) is null))::int as bez_odluke,
      (count(*) filter (where spojena_sa_id is not null))::int as spojenih
    from public.knjige`)).rows[0];
  r = await kao("authenticated", BIB, "select * from public.pregled_knjiga_zbir()");
  ok(!r.greska && r.redovi.length === 1 && JSON.stringify(r.redovi[0]) === JSON.stringify(direktno), "zbir bibliotekaru: svih deset brojeva se poklapa sa direktnim brojanjem tabele knjige", r.greska?.message ?? [r.redovi?.[0], direktno]);
  const z = r.redovi?.[0] ?? {};
  ok(z.fond + z.link + z.google_books + z.clan === z.ukupno && z.imamo + z.nabavljamo + z.ne_nabavljamo + z.bez_odluke === z.ukupno && z.ukupno > 0 && z.spojenih >= 1, "zbir: izvori i odluke se sabiraju u ukupno; spojeni duplikati su izdvojeni (ne računaju se u ukupno)", z);
  r = await kao("authenticated", ADM, "select ukupno from public.pregled_knjiga_zbir()");
  ok(!r.greska && r.redovi[0]?.ukupno === direktno.ukupno, "administrator vidi isti zbir", r.greska?.message ?? r.redovi);

  // ko ne sme
  for (const [naziv, sub] of [["čitalac A", UA], ["čitalac B", UB], ["neaktivan član", NEAKTIVAN]]) {
    r = await kao("authenticated", sub, "select * from public.pregled_knjiga_zbir()");
    const l = await kao("authenticated", sub, "select * from public.pregled_knjiga()");
    ok(!r.greska && r.redovi.length === 0 && !l.greska && l.redovi.length === 0, naziv + ": zbir i lista su prazni (bez greške, kao izveštaj za nabavku)", r.greska?.message ?? l.greska?.message ?? [r.redovi, l.redovi]);
  }
  r = await kao("anon", null, "select * from public.pregled_knjiga_zbir()");
  const ra = await kao("anon", null, "select * from public.pregled_knjiga()");
  ok(nemaPrava(r) && nemaPrava(ra), "anon ne sme da pozove nijednu od dve funkcije", [r.greska?.message, ra.greska?.message]);

  // lista: poklapanje sa direktnim brojanjem, red po red
  const SVE = "select * from public.pregled_knjiga(null, null, null, 'najnovije', 100, 0)";
  r = await kao("authenticated", BIB, SVE);
  const strana = r.redovi ?? [];
  const ukupnoK = direktno.ukupno;
  ok(!r.greska && strana.length === Math.min(100, ukupnoK) && strana.every((x) => Number(x.ukupno) === ukupnoK), "lista: stranica ima najviše 100 redova, a svaki red nosi ukupan broj (isti kao u zbiru)", r.greska?.message ?? [strana.length, ukupnoK]);
  const kolonePregleda = Object.keys(strana[0] ?? {}).sort().join();
  ok(kolonePregleda === "autor,citaoca,godina,id,isbn,izdavac,izvor,korice_izvor,korice_url,kreirana,naslov,odluka,ukupno", "lista vraća samo ove kolone: nema uneo_id, id-a članova, imena, brojeva karte ni vremena na polici", kolonePregleda);
  const brojciDirektno = new Map((await db.query("select p.knjiga_id, count(*)::int as n from public.polica p join public.clanovi c on c.id = p.clan_id and c.aktivan group by p.knjiga_id")).rows.map((x) => [x.knjiga_id, x.n]));
  ok(strana.length > 0 && strana.every((x) => x.citaoca === (brojciDirektno.get(x.id) ?? 0)), "lista: broj čitalaca svake knjige se poklapa sa direktnim brojanjem police (samo aktivni članovi)", strana.filter((x) => x.citaoca !== (brojciDirektno.get(x.id) ?? 0)).slice(0, 3));
  ok(strana.find((x) => x.id === NA)?.citaoca === 3 && strana.find((x) => x.id === NC)?.citaoca === 1 && strana.find((x) => x.id === NE)?.citaoca === 0, "poznate knjige: tri čitaoca, jedan (stavio je i „pročitano”, broje se sva stanja), nijedan (želi samo neaktivan član)", [NA, NC, NE].map((i) => strana.find((x) => x.id === i)?.citaoca));
  ok(!strana.some((x) => x.id === NG), "spojeni duplikat se ne prikazuje na listi", NG);
  const tekstOdgovora = JSON.stringify(strana);
  ok(![UA, UB, UC, BIB, ADM, NEAKTIVAN].some((id) => tekstOdgovora.includes(id)) && !/Pravo Ime|UB1|UC1/.test(tekstOdgovora), "ni u jednom polju odgovora nema člana (ni id-a, ni pravog imena, ni broja karte)");

  // filteri, pretraga, redosled, straničenje
  r = await kao("authenticated", BIB, "select * from public.pregled_knjiga(null, 'fond', null, 'najnovije', 100, 0)");
  ok(!r.greska && r.redovi.length > 0 && r.redovi.every((x) => x.izvor === "fond") && Number(r.redovi[0].ukupno) === direktno.fond, "filter izvora „fond”: samo fond, i ukupno je broj iz zbira", r.greska?.message ?? r.redovi?.length);
  r = await kao("authenticated", BIB, "select * from public.pregled_knjiga(null, null, 'bez', 'najnovije', 100, 0)");
  ok(!r.greska && r.redovi.every((x) => x.odluka === null) && Number(r.redovi[0]?.ukupno ?? 0) === direktno.bez_odluke, "filter odluke „bez”: samo knjige bez odluke (u_fondu bez odluke se vodi kao „imamo”, pa nije među njima)", r.greska?.message ?? r.redovi?.length);
  r = await kao("authenticated", BIB, "select * from public.pregled_knjiga(null, null, 'imamo', 'najnovije', 100, 0)");
  ok(!r.greska && r.redovi.length > 0 && r.redovi.every((x) => x.odluka === "imamo") && Number(r.redovi[0].ukupno) === direktno.imamo, "filter odluke „imamo”: broj iz zbira", r.greska?.message ?? r.redovi?.length);
  for (const [naziv, sql] of [["izvor", "select * from public.pregled_knjiga(null, 'drugo')"], ["odluka", "select * from public.pregled_knjiga(null, null, 'mozda')"], ["redosled", "select * from public.pregled_knjiga(null, null, null, 'slucajno')"]]) {
    r = await kao("authenticated", BIB, sql);
    ok(r.greska?.code === "22023", "nepoznata vrednost (" + naziv + ") je greška 22023, ne tiho ignorisanje", r.greska?.message ?? r.redovi?.length);
  }
  r = await kao("authenticated", BIB, "select naslov from public.pregled_knjiga('n1 tri zele', null, null, 'najnovije', 50, 0)");
  ok(!r.greska && r.redovi.length === 1 && r.redovi[0].naslov === "N1 tri žele", "pretraga ne zavisi od kvačica (n1 tri zele → N1 tri žele)", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", BIB, "select naslov from public.pregled_knjiga('H1 ТРИ жеље', null, null, 'najnovije', 50, 0)");
  ok(!r.greska && r.redovi.length === 0, "pretraga koja ništa ne pogađa vraća prazno", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", BIB, "select naslov from public.pregled_knjiga('N1 ТРИ', null, null, 'najnovije', 50, 0)");
  ok(!r.greska && r.redovi.some((x) => x.naslov === "N1 tri žele"), "pretraga ćirilicom nalazi latinični naslov (N1 ТРИ → N1 tri žele)", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", BIB, "select id from public.pregled_knjiga('978-86-521-1987', null, null, 'najnovije', 50, 0)");
  ok(!r.greska && r.redovi.length > 0 && r.redovi.some((x) => x.id === NA), "pretraga po delu ISBN-a (sa crticama) nalazi knjige", r.greska?.message ?? r.redovi?.length);
  r = await kao("authenticated", BIB, "select id from public.pregled_knjiga('%%', null, null, 'najnovije', 50, 0)");
  ok(!r.greska && r.redovi.length === Math.min(50, ukupnoK), "upit od samih džokera ne ruši pretragu i ne pravi nikakav izuzetak (kao prazan upit)", r.greska?.message ?? r.redovi?.length);
  r = await kao("authenticated", BIB, "select citaoca from public.pregled_knjiga(null, null, null, 'citaoca', 100, 0)");
  ok(!r.greska && r.redovi.every((x, i, a) => i === 0 || a[i - 1].citaoca >= x.citaoca) && r.redovi[0]?.citaoca === Math.max(...brojciDirektno.values()), "redosled „najviše čitalaca”: opadajuće, prvi je najčitanija knjiga", r.greska?.message ?? r.redovi?.slice(0, 3));
  r = await kao("authenticated", BIB, "select kreirana from public.pregled_knjiga(null, null, null, 'najnovije', 100, 0)");
  ok(!r.greska && r.redovi.every((x, i, a) => i === 0 || new Date(a[i - 1].kreirana) >= new Date(x.kreirana)), "redosled „najnovije prvo”: opadajuće po datumu unosa", r.greska?.message);
  r = await kao("authenticated", BIB, "select naslov from public.pregled_knjiga(null, null, null, 'naslov', 100, 0)");
  ok(!r.greska && r.redovi.length > 1, "redosled po naslovu radi", r.greska?.message);
  const s1 = await kao("authenticated", BIB, "select id from public.pregled_knjiga(null, null, null, 'najnovije', 3, 0)");
  const s2 = await kao("authenticated", BIB, "select id from public.pregled_knjiga(null, null, null, 'najnovije', 3, 3)");
  const sv = await kao("authenticated", BIB, "select id from public.pregled_knjiga(null, null, null, 'najnovije', 6, 0)");
  ok(!s1.greska && !s2.greska && s1.redovi.length === 3 && s2.redovi.length === 3 && JSON.stringify([...s1.redovi, ...s2.redovi].map((x) => x.id)) === JSON.stringify(sv.redovi.map((x) => x.id)), "straničenje: dve stranice od po 3 redom daju isto što i jedna od 6 (bez ponavljanja i rupa)", [s1.greska?.message, s2.greska?.message]);
  r = await kao("authenticated", BIB, "select id from public.pregled_knjiga(null, null, null, 'najnovije', 100000, -5)");
  ok(!r.greska && r.redovi.length <= 100, "granica stranice je 100, a negativan pomeraj se tretira kao nula", r.greska?.message ?? r.redovi?.length);

  // funkcije i idempotentnost
  const f24 = (await db.query("select p.proname, p.prosecdef, p.proconfig, has_function_privilege('anon', p.oid, 'execute') as anon from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('pregled_knjiga', 'pregled_knjiga_zbir') order by 1")).rows;
  ok(f24.length === 2 && f24.every((f) => f.prosecdef === true && (f.proconfig ?? []).some((c) => c.startsWith("search_path=")) && f.anon === false), "obe funkcije su SECURITY DEFINER sa search_path i nedostupne anon-u", f24);
  const pre24 = JSON.stringify((await db.query("select proname, pg_get_functiondef(oid) as d from pg_proc where proname in ('pregled_knjiga', 'pregled_knjiga_zbir') order by 1")).rows);
  await db.exec(fs.readFileSync(path.join(MIGRACIJE, PREGLED[0]), "utf8"));
  const posle24 = JSON.stringify((await db.query("select proname, pg_get_functiondef(oid) as d from pg_proc where proname in ('pregled_knjiga', 'pregled_knjiga_zbir') order by 1")).rows);
  ok(pre24 === posle24 && (await otisakPolitika24()) === politikePre24, "0024 je idempotentna: drugo puštanje ne duplira funkcije i ne menja politike");
  r = await kao("authenticated", BIB, "select ukupno from public.pregled_knjiga_zbir()");
  ok(!r.greska && r.redovi[0]?.ukupno === direktno.ukupno, "posle drugog puštanja zbir i dalje radi", r.greska?.message ?? r.redovi);

  // ───────── 0025: filter po izdavaču ─────────
  faza("0025: filter po izdavaču u pregledu knjiga (spajanje varijanti pisanja, „bez izdavača”, brojevi prate ostale filtere)");
  const otisakPolitika25 = async () =>
    JSON.stringify((await db.query("select c.relname, p.polname, p.polcmd::text as cmd, pg_get_expr(p.polqual, p.polrelid) as q, pg_get_expr(p.polwithcheck, p.polrelid) as w from pg_policy p join pg_class c on c.oid = p.polrelid where c.relname in ('knjige', 'polica', 'clanovi') order by 1, 2")).rows);
  const politikePre25 = await otisakPolitika25();
  const pk = async (naslov, izd, izvor = "clan", uFondu = false, spojena = null) =>
    (await db.query("insert into knjige (naslov, izdavac, izvor, u_fondu, broj_primeraka, broj_slobodnih, spojena_sa_id) values ($1, $2, $3, $4, $5, $5, $6) returning id", [naslov, izd, izvor, uFondu, uFondu ? 1 : 0, spojena])).rows[0].id;
  const L1 = await pk("P25 laguna 1", "Laguna", "fond", true);
  const L2 = await pk("P25 laguna 2", "Laguna", "clan");
  const L3 = await pk("P25 laguna 3", "LAGUNA", "link");
  const L4 = await pk("P25 laguna 4", "laguna ", "clan");
  const L5 = await pk("P25 laguna 5", "Лагуна", "google_books");
  await pk("P25 vulkan 1", "Vulkan", "clan");
  await pk("P25 vulkan 2", "VULKAN", "clan");
  await pk("P25 delfi", "Delfi", "link");
  await pk("P25 bez 1", null, "clan");
  await pk("P25 bez 2", "", "clan");
  await pk("P25 bez 3", "   ", "clan");
  await pk("P25 spojena laguna", "Laguna", "clan", false, L1);

  r = await kao("authenticated", BIB, "select * from public.pregled_knjiga('P25', null, null, 'najnovije', 50, 0, 'laguna')");
  ok(r.greska && /pregled_knjiga/.test(r.greska.message), "PRE 0025: funkcija nema parametar za izdavača, a spiska izdavača nema", r.greska?.message ?? r.redovi?.length);
  r = await kao("authenticated", BIB, "select * from public.pregled_knjiga_izdavaci()");
  ok(Boolean(r.greska), "PRE 0025: pregled_knjiga_izdavaci ne postoji", r.greska?.message ?? r.redovi?.length);

  for (const f of IZDAVAC) await pusti(f);

  ok((await otisakPolitika25()) === politikePre25, "0025: politike (RLS) na knjige, polica i clanovi su iste kao pre (nijedna dodata, izbrisana ni izmenjena)");
  const k25 = fs.readFileSync(path.join(MIGRACIJE, IZDAVAC[0]), "utf8").replace(/^\s*--.*$/gm, "");
  ok(!/\b(create|drop|alter)\s+policy\b/i.test(k25) && !/create\s+table|add column/i.test(k25), "0025 ne piše politike, tabele ni kolone");
  const preklopi = (await db.query("select count(*)::int as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'pregled_knjiga'")).rows[0].n;
  ok(preklopi === 1, "posle 0025 postoji tačno jedna verzija public.pregled_knjiga (stara sa šest parametara je obrisana, nema dvosmislenog poziva)", preklopi);

  const IZD = (upit = "P25", izvor = null, odluka = null) => kao("authenticated", BIB, "select kljuc, naziv, broj from public.pregled_knjiga_izdavaci($1, $2, $3)", [upit, izvor, odluka]);
  const LISTA = (izd, upit = "P25", izvor = null, odluka = null) => kao("authenticated", BIB, "select id, izdavac, ukupno from public.pregled_knjiga($1, $2, $3, 'najnovije', 100, 0, $4)", [upit, izvor, odluka, izd]);

  r = await IZD();
  const spisakIzd = r.redovi ?? [];
  ok(!r.greska && spisakIzd.map((x) => x.kljuc).join() === "laguna,vulkan,delfi,__bez__" && spisakIzd.map((x) => x.broj).join() === "5,2,1,3", "spisakIzd izdavača: Laguna/LAGUNA/laguna /Лагуна su jedna stavka (5), Vulkan/VULKAN (2), Delfi (1), a prazni (null, '', razmaci) su „bez” (3); sortirano po broju opadajuće, „bez” poslednje", r.greska?.message ?? spisakIzd);
  ok(spisakIzd[0]?.naziv === "Laguna" && ["Vulkan", "VULKAN"].includes(spisakIzd[1]?.naziv) && spisakIzd[2]?.naziv === "Delfi" && spisakIzd[3]?.naziv === null, "naziv grupe je najčešći zapis (Laguna, 2 puta, ispred LAGUNA, laguna i Лагуна); „bez” nema naziv (to piše ekran)", spisakIzd.map((x) => x.naziv));
  const zbirP25 = (await db.query("select count(*)::int as n from knjige where naslov like 'P25 %' and spojena_sa_id is null")).rows[0].n;
  ok(spisakIzd.reduce((s, x) => s + x.broj, 0) === zbirP25 && zbirP25 === 11, "zbir brojeva iz spiska je broj matičnih knjiga koje odgovaraju (spojeni duplikat se ne računa)", [spisakIzd.reduce((s, x) => s + x.broj, 0), zbirP25]);
  const kolIzd = Object.keys(spisakIzd[0] ?? {}).sort().join();
  ok(kolIzd === "broj,kljuc,naziv", "spisakIzd izdavača ima samo kljuc, naziv i broj (nikakav trag do člana)", kolIzd);
  ok(![UA, UB, UC, BIB, ADM, NEAKTIVAN].some((id) => JSON.stringify(spisakIzd).includes(id)), "u spisku izdavača nema nijednog id-a člana");

  // lista po izdavaču
  r = await LISTA("laguna");
  ok(!r.greska && r.redovi.length === 5 && r.redovi.every((x) => Number(x.ukupno) === 5) && [L1, L2, L3, L4, L5].every((i) => r.redovi.some((x) => x.id === i)), "filter po izdavaču „laguna” vraća svih pet knjiga iz grupe, bez obzira na pisanje (veličina slova, razmak, ćirilica), a ne spojeni duplikat", r.greska?.message ?? r.redovi?.map((x) => x.izdavac));
  ok(r.redovi?.some((x) => x.izdavac === "Лагуна") && r.redovi?.some((x) => x.izdavac === "laguna ") && r.redovi?.some((x) => x.izdavac === "LAGUNA"), "red zadržava izvorni zapis izdavača (grupisanje ne menja podatak)", r.redovi?.map((x) => x.izdavac));
  r = await LISTA("__bez__");
  ok(!r.greska && r.redovi.length === 3 && r.redovi.every((x) => !x.izdavac || x.izdavac.trim() === ""), "„__bez__”: sve knjige bez izdavača (null, prazan tekst i razmaci)", r.greska?.message ?? r.redovi?.map((x) => x.izdavac));
  r = await LISTA("nepostojeci");
  ok(!r.greska && r.redovi.length === 0, "nepoznat ključ ne vraća ništa", r.greska?.message ?? r.redovi?.length);
  r = await LISTA("");
  ok(!r.greska && r.redovi.length === 11, "prazna vrednost izdavača znači bez filtera (svih 11)", r.greska?.message ?? r.redovi?.length);
  r = await LISTA("  Laguna ");
  ok(!r.greska && r.redovi.length === 0, "vrednost je KLJUČ (ne zapis): „  Laguna ” sa velikim slovom nije ključ, pa ne pogađa ništa (klijent šalje ključ iz spiska)", r.greska?.message ?? r.redovi?.length);

  // spisakIzd prati ostale filtere, a lista vraća tačno toliko koliko spisakIzd kaže
  const kombinacije = [["P25", null, null], ["P25", "link", null], ["P25", "fond", null], ["P25", null, "imamo"], ["P25", null, "bez"], ["p25 delfi", null, null], ["P25 laguna", "clan", "bez"], ["P25", "google_books", "nabavljamo"]];
  let svePoklapanje = true;
  const kvar = [];
  for (const [u, iz, od] of kombinacije) {
    const s = (await IZD(u, iz, od)).redovi ?? [];
    const ukupnoKombinacije = (await kao("authenticated", BIB, "select ukupno from public.pregled_knjiga($1, $2, $3, 'najnovije', 1, 0)", [u, iz, od])).redovi?.[0]?.ukupno ?? 0;
    if (s.reduce((a, x) => a + x.broj, 0) !== Number(ukupnoKombinacije)) {
      svePoklapanje = false;
      kvar.push(["zbir", u, iz, od]);
    }
    for (const x of s) {
      const l = (await LISTA(x.kljuc, u, iz, od)).redovi ?? [];
      if (l.length !== x.broj) {
        svePoklapanje = false;
        kvar.push([x.kljuc, x.broj, l.length, u, iz, od]);
      }
    }
  }
  ok(svePoklapanje, "za osam kombinacija filtera: broj uz svakog izdavača i zbir se poklapaju sa listom koju bi korisnik dobio", kvar);
  r = await IZD("P25", "link");
  ok(!r.greska && r.redovi.map((x) => x.kljuc + ":" + x.broj).join() === "delfi:1,laguna:1", "izvor „link”: u spisku ostaju samo izdavači knjiga sa tog izvora (Delfi 1, Laguna 1)", r.greska?.message ?? r.redovi);
  r = await IZD("P25", null, "imamo");
  ok(!r.greska && r.redovi.map((x) => x.kljuc + ":" + x.broj).join() === "laguna:1", "odluka „imamo” (knjiga u fondu bez odluke): samo Laguna 1", r.greska?.message ?? r.redovi);
  r = await IZD("p25 delfi");
  ok(!r.greska && r.redovi.map((x) => x.kljuc + ":" + x.broj).join() === "delfi:1", "pretraga po naslovu sužava spisakIzd izdavača (neosetljiva na veličinu slova)", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", BIB, "select naziv from public.pregled_knjiga_izdavaci('P25', 'link')");
  ok(r.redovi?.some((x) => x.naziv === "Laguna"), "naziv grupe ne zavisi od filtera: uz izvor „link” Laguna ostaje „Laguna” (a ne „LAGUNA” koja je jedina sa linka)", r.redovi);

  // izdavač + pretraga + redosled zajedno
  r = await kao("authenticated", BIB, "select naslov from public.pregled_knjiga('laguna 3', null, null, 'naslov', 50, 0, 'laguna')");
  ok(!r.greska && r.redovi.length === 1 && r.redovi[0].naslov === "P25 laguna 3", "izdavač se kombinuje sa pretragom i redosledom", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", BIB, "select id from public.pregled_knjiga('P25', null, null, 'najnovije', 2, 2, 'laguna')");
  const strLag = await kao("authenticated", BIB, "select id from public.pregled_knjiga('P25', null, null, 'najnovije', 10, 0, 'laguna')");
  ok(!r.greska && r.redovi.length === 2 && JSON.stringify(r.redovi.map((x) => x.id)) === JSON.stringify(strLag.redovi.slice(2, 4).map((x) => x.id)), "straničenje radi i uz filter izdavača", r.greska?.message ?? r.redovi?.length);

  // pravila: neznano je 22023, ko ne sme dobija prazno
  for (const [naziv, sql] of [["izvor", "select * from public.pregled_knjiga_izdavaci(null, 'drugo')"], ["odluka", "select * from public.pregled_knjiga_izdavaci(null, null, 'mozda')"], ["izvor u listi", "select * from public.pregled_knjiga(null, 'drugo', null, 'najnovije', 5, 0, 'laguna')"], ["redosled", "select * from public.pregled_knjiga(null, null, null, 'slucajno', 5, 0, 'laguna')"]]) {
    r = await kao("authenticated", BIB, sql);
    ok(r.greska?.code === "22023", "nepoznata vrednost (" + naziv + ") je greška 22023", r.greska?.message ?? r.redovi?.length);
  }
  for (const [naziv, sub] of [["čitalac A", UA], ["čitalac B", UB], ["neaktivan član", NEAKTIVAN]]) {
    const a = await kao("authenticated", sub, "select * from public.pregled_knjiga_izdavaci('P25')");
    const b = await kao("authenticated", sub, "select * from public.pregled_knjiga('P25', null, null, 'najnovije', 50, 0, 'laguna')");
    ok(!a.greska && a.redovi.length === 0 && !b.greska && b.redovi.length === 0, naziv + ": spisakIzd izdavača i lista su prazni (bez greške)", a.greska?.message ?? b.greska?.message ?? [a.redovi, b.redovi]);
  }
  r = await kao("anon", null, "select * from public.pregled_knjiga_izdavaci()");
  const ra25 = await kao("anon", null, "select * from public.pregled_knjiga()");
  ok(nemaPrava(r) && nemaPrava(ra25), "anon ne sme da pozove nijednu od funkcija", [r.greska?.message, ra25.greska?.message]);
  r = await kao("authenticated", UA, "select * from privatno.pregled_knjige_filter('P25', null, null)");
  ok(!r.greska || /permission denied/.test(r.greska.message), "pomoćni filter je u šemi privatno (PostgREST je ne izlaže), a vraća samo id-eve knjiga", r.greska?.message ?? r.redovi?.length);

  // funkcije i idempotentnost
  const f25 = (await db.query("select p.proname, p.prosecdef, p.proconfig, has_function_privilege('anon', p.oid, 'execute') as anon from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('pregled_knjiga', 'pregled_knjiga_izdavaci') order by 1")).rows;
  ok(f25.length === 2 && f25.every((f) => f.prosecdef === true && (f.proconfig ?? []).some((c) => c.startsWith("search_path=")) && f.anon === false), "obe funkcije su SECURITY DEFINER sa search_path i nedostupne anon-u", f25);
  const pre25 = JSON.stringify((await db.query("select proname, pg_get_functiondef(oid) as d from pg_proc where proname in ('pregled_knjiga', 'pregled_knjiga_izdavaci', 'pregled_knjige_filter') order by 1")).rows);
  await db.exec(fs.readFileSync(path.join(MIGRACIJE, IZDAVAC[0]), "utf8"));
  const posle25 = JSON.stringify((await db.query("select proname, pg_get_functiondef(oid) as d from pg_proc where proname in ('pregled_knjiga', 'pregled_knjiga_izdavaci', 'pregled_knjige_filter') order by 1")).rows);
  ok(pre25 === posle25 && (await otisakPolitika25()) === politikePre25, "0025 je idempotentna: drugo puštanje ne duplira funkcije (i dalje jedna verzija pregled_knjiga) i ne menja politike");
  r = await LISTA("laguna");
  ok(!r.greska && r.redovi.length === 5, "posle drugog puštanja filter i dalje radi", r.greska?.message ?? r.redovi?.length);
  r = await kao("authenticated", BIB, "select ukupno from public.pregled_knjiga_zbir()");
  ok(!r.greska && r.redovi.length === 1, "zbir iz 0024 ostaje netaknut i radi", r.greska?.message ?? r.redovi);

  // ───────── uvoz fonda: kako se okidači ponašaju prema servisnoj ulozi (pre prvog pokretanja skripte) ─────────
  faza("Uvoz fonda (scripts/uvezi-fond.mjs): okidači ne diraju servisni upis, odluka ostaje prazna, JS i SQL normalizacija su isti");
  const uzorciNorm = ["Ђорђе и змај", "Љубица Његош", "Šaponja Čačak, ćevap", "ĐURĐEVDAN", "Џон џеп", "Трагични дани Србије 1915—1918. : белешке", "10.000 milja da te pronađem", "(С)тиховање : одабране песме", "Народна библиотека \"Доситеј\"", "Žabalj Šabac Ćuprija"];
  const sqlNorm = (await db.query("select privatno.norm_tekst(t) as n from unnest($1::text[]) as t", [uzorciNorm])).rows.map((x) => x.n);
  ok(uzorciNorm.every((u, i) => normTekst(u) === sqlNorm[i]), "normTekst u skripti je isti kao privatno.norm_tekst u bazi (deset uzoraka na ćirilici i latinici)", uzorciNorm.map((u, i) => [u, normTekst(u), sqlNorm[i]]).filter(([, a, b]) => a !== b));

  const UVEZENA = { naslov: "UVOZ Probna knjiga", autor: "Probni Autor", izdavac: "Laguna", godina: 2025, isbn: "978-86-521-2603-3", izvor: "fond", u_fondu: true };
  r = await kao("service_role", null, "insert into public.knjige (naslov, autor, izdavac, godina, isbn, izvor, u_fondu) values ($1, $2, $3, $4, $5, $6, $7) returning izvor, u_fondu, uneo_id, odluka_nabavke, odluka_datum, isbn, broj_primeraka, cobiss_id, opis, korice_url, spojena_sa_id", [UVEZENA.naslov, UVEZENA.autor, UVEZENA.izdavac, UVEZENA.godina, UVEZENA.isbn, UVEZENA.izvor, UVEZENA.u_fondu]);
  ok(!r.greska && r.redovi[0]?.izvor === "fond" && r.redovi[0]?.u_fondu === true && r.redovi[0]?.uneo_id === null && r.redovi[0]?.odluka_nabavke === null && r.redovi[0]?.odluka_datum === null, "servisni upis: izvor ostaje 'fond' i u_fondu true (okidač knjige_unos_clana izuzima servisnu ulogu), uneo_id i odluka su prazni", r.greska?.message ?? r.redovi);
  ok(r.redovi?.[0]?.isbn === "9788652126033" && r.redovi[0].broj_primeraka === 0 && r.redovi[0].cobiss_id === null && r.redovi[0].opis === null && r.redovi[0].korice_url === null && r.redovi[0].spojena_sa_id === null, "ISBN sa crticama okidač knjige_isbn pretvara u 13 cifara; primerci, COBISS ID, opis i korica ostaju prazni", r.redovi?.[0]);
  const idUvoz = (await db.query("select id from public.knjige where naslov = 'UVOZ Probna knjiga'")).rows[0].id;
  r = await kao("authenticated", BIB, "select odluka, citaoca from public.pregled_knjiga('UVOZ Probna', null, null, 'najnovije', 5, 0, null)");
  ok(!r.greska && r.redovi.length === 1 && r.redovi[0].odluka === "imamo", "uvezena knjiga je u pregledu bibliotekara efektivno „imamo” (u_fondu bez odluke)", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", BIB, "select odluka from public.izvestaj_za_nabavku where id = $1", [idUvoz]);
  ok(!r.greska && r.redovi.length === 0, "uvezena knjiga nije među „Нове” u izveštaju za nabavku (niko je ne želi, a i u fondu je)", r.greska?.message ?? r.redovi);

  // dopuna postojeće knjige koju je uneo član i za koju je bibliotekar odlučio „nabavljamo"
  const idClan = (await db.query("insert into public.knjige (naslov, izvor, u_fondu, odluka_nabavke, odluka_datum) values ('UVOZ Dopuna', 'clan', false, 'nabavljamo', '2026-01-01T00:00:00Z') returning id")).rows[0].id;
  r = await kao("service_role", null, "update public.knjige set u_fondu = true, izvor = 'fond', autor = 'Dopunjen Autor', isbn = '9780306406157' where id = $1 returning u_fondu, izvor, autor, isbn, odluka_nabavke, odluka_datum", [idClan]);
  ok(!r.greska && r.redovi[0]?.u_fondu === true && r.redovi[0]?.izvor === "fond" && r.redovi[0]?.autor === "Dopunjen Autor" && r.redovi[0]?.isbn === "9780306406157" && r.redovi[0]?.odluka_nabavke === "nabavljamo" && new Date(r.redovi[0]?.odluka_datum).toISOString().startsWith("2026-01-01"), "dopuna servisnom ulogom: u_fondu, izvor i prazna polja se postavljaju, a odluka nabavke i njen datum ostaju netaknuti (okidač knjige_odluka_zastita)", r.greska?.message ?? r.redovi);
  ok(Object.keys(redZaUpis({ naslov: "x", autor: null, izdavac: null, godina: null, isbn: null })).sort().join() === "autor,godina,isbn,izdavac,izvor,naslov,u_fondu", "redZaUpis iz skripte ima samo kolone koje test iznad proverava (nikakvo uneo_id, odluka_nabavke, cobiss_id, broj_primeraka)");
  const serija = Array.from({ length: 200 }, (_, i) => ["UVOZ serija " + i, "fond", true]);
  r = await kao("service_role", null, "insert into public.knjige (naslov, izvor, u_fondu) select * from unnest($1::text[], $2::text[], $3::boolean[]) returning id", [serija.map((x) => x[0]), serija.map((x) => x[1]), serija.map((x) => x[2])]);
  ok(!r.greska && r.redovi.length === 200, "serija od 200 knjiga se upisuje u jednom upitu", r.greska?.message ?? r.redovi?.length);
  await db.query("delete from public.knjige where naslov like 'UVOZ %'");

  // ───────── izmena i brisanje knjige iz panela: RLS i posledice brisanja ─────────
  faza("Panel: bibliotekar menja knjigu, samo administrator je briše, a brisanje odnosi i police, utiske i preporuke");
  const KI = await nova("PANEL Izmena i brisanje");
  await db.query("insert into polica (clan_id, knjiga_id, status) values ($1, $3, 'zelim'), ($2, $3, 'citam')", [UA, UB, KI]);
  await db.query("insert into utisci (clan_id, knjiga_id, ocena, tekst, vidljivost) values ($1, $2, 7, 'PANEL utisak', 'javno')", [UA, KI]);
  await db.query("insert into preporuke (posiljalac_id, primalac_id, knjiga_id, poruka) values ($1, $2, $3, 'PANEL preporuka')", [UB, UA, KI]);
  const brojVeza = async () => (await db.query("select (select count(*) from polica where knjiga_id = $1)::int as p, (select count(*) from utisci where knjiga_id = $1)::int as u, (select count(*) from preporuke where knjiga_id = $1)::int as r", [KI])).rows[0];
  r = await kao("authenticated", BIB, "update public.knjige set naslov = 'PANEL Novi naslov', autor = 'Novi Autor', izdavac = 'Novi Izdavač', godina = 2021, isbn = '978-86-521-2603-3' where id = $1 returning naslov, autor, izdavac, godina, isbn", [KI]);
  ok(!r.greska && r.redovi[0]?.naslov === "PANEL Novi naslov" && r.redovi[0]?.autor === "Novi Autor" && r.redovi[0]?.godina === 2021 && r.redovi[0]?.isbn === "9788652126033", "bibliotekar menja naslov, autora, izdavača, godinu i ISBN (ISBN okidač pretvara u 13 cifara)", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", BIB, "update public.knjige set isbn = '123-456' where id = $1 returning id", [KI]);
  ok(r.greska?.code === "22023", "neispravan ISBN bibliotekar ne može da upiše (greška 22023); ekran ga ionako proverava pre slanja", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", UA, "update public.knjige set naslov = 'Hakovano' where id = $1 returning id", [KI]);
  ok(!r.greska && r.redovi.length === 0, "čitalac ne može da menja knjigu (RLS: 0 izmenjenih redova)", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", BIB, "delete from public.knjige where id = $1 returning id", [KI]);
  ok(!r.greska && r.redovi.length === 0 && (await db.query("select count(*)::int as n from knjige where id = $1", [KI])).rows[0].n === 1, "bibliotekar ne može da briše knjigu (samo administrator): 0 obrisanih redova, knjiga ostaje", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", UA, "delete from public.knjige where id = $1 returning id", [KI]);
  ok(!r.greska && r.redovi.length === 0, "čitalac ne može da briše knjigu", r.greska?.message ?? r.redovi);
  const preBrisanja = await brojVeza();
  ok(preBrisanja.p === 2 && preBrisanja.u === 1 && preBrisanja.r === 1, "pre brisanja: dve stavke na policama, jedan utisak i jedna preporuka za knjigu", preBrisanja);
  r = await kao("authenticated", ADM, "delete from public.knjige where id = $1 returning id", [KI]);
  ok(!r.greska && r.redovi.length === 1, "administrator briše knjigu", r.greska?.message ?? r.redovi);
  const posleBrisanja = await brojVeza();
  ok(posleBrisanja.p === 0 && posleBrisanja.u === 0 && posleBrisanja.r === 0, "brisanje knjige odnosi i stavke sa polica, utiske i preporuke (zato ekran traži potvrdu sa brojem čitalaca)", posleBrisanja);

  // ───────── 0026: svaki ISBN samo jednom ─────────
  faza("0026: jedinstven ISBN među matičnim knjigama (postojeći duplikati se spajaju, ništa se ne briše; novi duplikat daje 23505)");
  const otisakPolitika26 = async () =>
    JSON.stringify((await db.query("select c.relname, p.polname, p.polcmd::text as cmd, pg_get_expr(p.polqual, p.polrelid) as q, pg_get_expr(p.polwithcheck, p.polrelid) as w from pg_policy p join pg_class c on c.oid = p.polrelid order by 1, 2")).rows);
  const politikePre26 = await otisakPolitika26();
  const ISB = "9780140449136"; // ispravan ISBN-13 koji ranije testovi ne koriste; pre 0026 može triput, jer jedinstvenosti još nema
  const dk = async (naslov, uFondu, primeraka, izvor) =>
    (await db.query("insert into knjige (naslov, isbn, izvor, u_fondu, broj_primeraka, broj_slobodnih) values ($1, $2, $3, $4, $5, $5) returning id", [naslov, ISB, izvor, uFondu, primeraka])).rows[0].id;
  const DUP1 = await dk("D26 clan prvi", false, 0, "clan");
  const DUP2 = await dk("D26 fond", true, 2, "fond");
  const DUP3 = await dk("D26 clan treci", false, 0, "clan");
  const BEZ1 = (await db.query("insert into knjige (naslov) values ('D26 bez isbn 1') returning id")).rows[0].id;
  await db.query("insert into knjige (naslov) values ('D26 bez isbn 2')");
  await db.query("insert into polica (clan_id, knjiga_id, status) values ($1, $2, 'zelim'), ($1, $3, 'citam'), ($4, $5, 'procitano')", [UA, DUP1, DUP2, UB, DUP3]);
  await db.query("insert into utisci (clan_id, knjiga_id, ocena, tekst, vidljivost) values ($1, $2, 8, 'D26 utisak', 'javno')", [UA, DUP1]);
  const brojKnjiga = async () => (await db.query("select count(*)::int as n from knjige")).rows[0].n;
  const knjigaPre26 = await brojKnjiga();
  ok((await db.query("select count(*)::int as n from knjige where isbn = $1", [ISB])).rows[0].n === 3, "PRE 0026: isti ISBN je u bazi triput (nije bilo zaštite)", null);

  for (const f of JEDINSTVEN) await pusti(f);

  const m26 = (await db.query("select id, spojena_sa_id from knjige where isbn = $1 order by naslov", [ISB])).rows;
  const sp = Object.fromEntries(m26.map((x) => [x.id, x.spojena_sa_id]));
  ok(sp[DUP2] === null && sp[DUP1] === DUP2 && sp[DUP3] === DUP2, "posle 0026 je matična knjiga ona koja je u fondu (D26 fond), a ostale dve su spojene u nju (spojena_sa_id)", sp);
  ok((await brojKnjiga()) === knjigaPre26, "spajanje ništa ne briše: broj redova u knjige je isti kao pre", [knjigaPre26, await brojKnjiga()]);
  const pol26 = (await db.query("select clan_id, knjiga_id from polica where knjiga_id in ($1, $2, $3) order by 1", [DUP1, DUP2, DUP3])).rows;
  ok(pol26.length === 2 && pol26.every((x) => x.knjiga_id === DUP2) && pol26.some((x) => x.clan_id === UA) && pol26.some((x) => x.clan_id === UB), "police prelaze na matični zapis; član koji je imao oba zapisa ima jednu stavku (nema dvostruke)", pol26);
  ok((await db.query("select count(*)::int as n from utisci where knjiga_id = $1 and tekst = 'D26 utisak'", [DUP2])).rows[0].n === 1, "utisak sa duplikata prelazi na matični zapis", null);
  ok((await db.query("select count(*)::int as n from knjige where isbn = $1 and spojena_sa_id is null", [ISB])).rows[0].n === 1, "među matičnim knjigama ISBN postoji tačno jednom", null);
  ok((await db.query("select count(*)::int as n from (select isbn from knjige where isbn is not null and spojena_sa_id is null group by isbn having count(*) > 1) x")).rows[0].n === 0, "u celoj bazi nema nijednog ISBN-a koji se ponavlja među matičnim knjigama", null);

  r = await kao("authenticated", BIB, "insert into public.knjige (naslov, isbn) values ('D26 novi', $1) returning id", [ISB]);
  ok(r.greska?.code === "23505", "bibliotekar ne može da upiše novu knjigu sa postojećim ISBN-om (23505)", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", UA, "insert into public.knjige (naslov, isbn) values ('D26 clan novi', $1) returning id", [ISB]);
  ok(r.greska?.code === "23505", "ni član ne može da upiše knjigu sa postojećim ISBN-om (23505); aplikacija tada uzima postojeću", r.greska?.message ?? r.redovi);
  r = await kao("service_role", null, "insert into public.knjige (naslov, isbn) values ('D26 servis novi', $1) returning id", [ISB]);
  ok(r.greska?.code === "23505", "ni servisni upis (uvoz fonda) ne može da napravi duplikat ISBN-a", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", BIB, "insert into public.knjige (naslov, isbn) values ('D26 isti isbn crtice', '978-0-7475-3269-9') returning isbn");
  const prvi13 = r.redovi?.[0]?.isbn;
  r = await kao("authenticated", BIB, "insert into public.knjige (naslov, isbn) values ('D26 isti isbn isbn10', '0-7475-3269-9') returning isbn");
  ok(prvi13 === "9780747532699" && r.greska?.code === "23505", "ISBN-10 i ISBN-13 iste knjige su isti ISBN: drugi unos je odbijen (okidač ih pretvara u 13 cifara pre provere jedinstvenosti)", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", BIB, "update public.knjige set isbn = $2 where id = $1 returning id", [BEZ1, ISB]);
  ok(r.greska?.code === "23505", "izmena ISBN-a druge knjige u postojeći je odbijena (23505); ekran to pretvara u poruku", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", BIB, "insert into public.knjige (naslov, isbn) values ('D26 bez isbn 3', null), ('D26 bez isbn 4', null) returning id");
  ok(!r.greska && r.redovi.length === 2, "knjige bez ISBN-a (null) se ne ograničavaju: sme ih biti koliko god", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", BIB, "insert into public.knjige (naslov, isbn) values ('D26 novi isbn', '9780306406157x') returning id");
  ok(r.greska?.code === "22023", "neispravan ISBN i dalje daje grešku 22023 iz 0010 (nova provera je ne zamenjuje)", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", BIB, "select id, naslov from public.trazi_knjige('D26', 50)");
  ok(!r.greska, "pretraga i dalje radi posle 0026", r.greska?.message);
  r = await kao("authenticated", BIB, "select ukupno, spojenih from public.pregled_knjiga_zbir()");
  ok(!r.greska && r.redovi[0]?.spojenih >= 2, "pregled „Све књиге” broji spojene duplikate posebno, a ukupno su samo matične knjige", r.greska?.message ?? r.redovi);

  ok((await otisakPolitika26()) === politikePre26, "0026: nijedna politika (RLS) nije dodata, izbrisana ni izmenjena");
  const k26 = fs.readFileSync(path.join(MIGRACIJE, JEDINSTVEN[0]), "utf8").replace(/^\s*--.*$/gm, "");
  ok(!/\b(create|drop|alter)\s+policy\b/i.test(k26) && !/create\s+table|add column/i.test(k26), "0026 ne piše politike, tabele ni kolone");
  const stanje26 = JSON.stringify((await db.query("select id, spojena_sa_id from knjige order by id")).rows) + JSON.stringify((await db.query("select clan_id, knjiga_id from polica order by 1, 2")).rows);
  await db.exec(fs.readFileSync(path.join(MIGRACIJE, JEDINSTVEN[0]), "utf8"));
  const stanje26b = JSON.stringify((await db.query("select id, spojena_sa_id from knjige order by id")).rows) + JSON.stringify((await db.query("select clan_id, knjiga_id from polica order by 1, 2")).rows);
  ok(stanje26 === stanje26b && (await otisakPolitika26()) === politikePre26, "0026 je idempotentna: drugo puštanje ne menja knjige, spajanja ni police, i ne dira politike");
  ok((await db.query("select count(*)::int as n from pg_indexes where indexname = 'knjige_isbn_jedinstven_idx'")).rows[0].n === 1, "postoji tačno jedan jedinstven indeks knjige_isbn_jedinstven_idx", null);

  // ───────── 0027: filter po koricama u pregledu knjiga ─────────
  faza("0027: filter korica u pregledu knjiga (Без корице / Са корицом), kolona bez_korice u zbiru, samo bibliotekar");
  const otisakPolitika27 = async () =>
    JSON.stringify((await db.query("select c.relname, p.polname, p.polcmd::text as cmd, pg_get_expr(p.polqual, p.polrelid) as q, pg_get_expr(p.polwithcheck, p.polrelid) as w from pg_policy p join pg_class c on c.oid = p.polrelid order by 1, 2")).rows);
  const politikePre27 = await otisakPolitika27();
  const KORICA_URL = "https://covers.openlibrary.org/b/isbn/9780140449136-M.jpg";
  const k27 = async (naslov, izd, korica, spojena = null) =>
    (await db.query("insert into knjige (naslov, izdavac, korice_url, korice_izvor, spojena_sa_id) values ($1, $2, $3, $4, $5) returning id", [naslov, izd, korica, korica ? "open_library" : null, spojena])).rows[0].id;
  const KA = await k27("K27 sa koricom 1", "Laguna", KORICA_URL);
  await k27("K27 sa koricom 2", "Vulkan", KORICA_URL);
  await k27("K27 bez korice 1", "Laguna", null);
  await k27("K27 bez korice 2", "Laguna", null);
  await k27("K27 bez korice 3", null, null);
  await db.query("insert into knjige (naslov, izdavac, korice_url) values ('K27 prazna adresa', 'Delfi', '')");
  await k27("K27 spojena bez korice", "Laguna", null, KA);
  const direktnoBez = (await db.query("select count(*)::int as n from knjige where spojena_sa_id is null and coalesce(btrim(korice_url), '') = ''")).rows[0].n;

  r = await kao("authenticated", BIB, "select * from public.pregled_knjiga('K27', null, null, 'najnovije', 50, 0, null, 'bez')");
  ok(Boolean(r.greska), "PRE 0027: lista nema parametar za koricu", r.greska?.message ?? r.redovi?.length);
  r = await kao("authenticated", BIB, "select bez_korice from public.pregled_knjiga_zbir()");
  ok(Boolean(r.greska), "PRE 0027: zbir nema kolonu bez_korice", r.greska?.message ?? r.redovi?.length);

  for (const f of KORICA27) await pusti(f);

  ok((await otisakPolitika27()) === politikePre27, "0027: nijedna politika (RLS) nije dodata, izbrisana ni izmenjena");
  const m27 = fs.readFileSync(path.join(MIGRACIJE, KORICA27[0]), "utf8").replace(/^\s*--.*$/gm, "");
  ok(!/\b(create|drop|alter)\s+policy\b/i.test(m27) && !/create\s+table|add column/i.test(m27), "0027 ne piše politike, tabele ni kolone");
  const verzije27 = (await db.query("select p.proname, count(*)::int as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where (n.nspname = 'public' and p.proname in ('pregled_knjiga', 'pregled_knjiga_izdavaci', 'pregled_knjiga_zbir')) or (n.nspname = 'privatno' and p.proname = 'pregled_knjige_filter') group by 1 order by 1")).rows;
  ok(verzije27.length === 4 && verzije27.every((v) => v.n === 1), "posle 0027 svaka od četiri funkcije postoji u tačno jednoj verziji (stari potpisi su obrisani, nema dvosmislenih poziva)", verzije27);

  const lista27 = (korica) => kao("authenticated", BIB, "select naslov, korice_url from public.pregled_knjiga('K27', null, null, 'naslov', 50, 0, null, $1)", [korica]);
  r = await lista27("bez");
  ok(!r.greska && r.redovi.length === 4 && r.redovi.every((x) => !x.korice_url) && r.redovi.every((x) => !/spojena/.test(x.naslov)), "„bez” vraća samo knjige bez korice (null i prazna adresa), a spojeni duplikat se ne računa", r.greska?.message ?? r.redovi);
  r = await lista27("sa");
  ok(!r.greska && r.redovi.length === 2 && r.redovi.every((x) => x.korice_url), "„sa” vraća samo knjige sa koricom", r.greska?.message ?? r.redovi);
  r = await lista27(null);
  ok(!r.greska && r.redovi.length === 6, "bez filtera korice vraćene su sve matične knjige (6, bez spojene)", r.greska?.message ?? r.redovi?.length);
  r = await lista27("xx");
  ok(r.greska?.code === "22023", "nepoznata vrednost filtera korice je greška 22023", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", BIB, "select ukupno from public.pregled_knjiga('K27', null, null, 'najnovije', 2, 0, null, 'bez') limit 1");
  ok(!r.greska && Number(r.redovi[0]?.ukupno) === 4, "ukupan broj u redu prati filter korice (4) i kad je stranica kraća", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", BIB, "select naslov from public.pregled_knjiga('K27', null, null, 'naslov', 50, 0, 'laguna', 'bez')");
  ok(!r.greska && r.redovi.length === 2, "filter korice radi zajedno sa izdavačem (Laguna bez korice: 2)", r.greska?.message ?? r.redovi);

  r = await kao("authenticated", BIB, "select kljuc, broj from public.pregled_knjiga_izdavaci('K27', null, null, 'bez')");
  const mi27 = Object.fromEntries((r.redovi ?? []).map((x) => [x.kljuc, x.broj]));
  ok(!r.greska && mi27.laguna === 2 && mi27.delfi === 1 && mi27.__bez__ === 1 && !("vulkan" in mi27), "spisak izdavača prati filter korice (bez korice: Laguna 2, Delfi 1, bez izdavača 1, Vulkan nema)", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", BIB, "select kljuc, broj from public.pregled_knjiga_izdavaci('K27')");
  ok(!r.greska && r.redovi.length > 0, "spisak izdavača radi i sa starim brojem parametara (korica je poslednji, podrazumevano prazna)", r.greska?.message ?? r.redovi?.length);

  r = await kao("authenticated", BIB, "select bez_korice, ukupno from public.pregled_knjiga_zbir()");
  ok(!r.greska && r.redovi[0]?.bez_korice === direktnoBez && direktnoBez >= 4, "zbir: bez_korice se poklapa sa direktnim brojanjem matičnih knjiga bez korice", r.greska?.message ?? [r.redovi, direktnoBez]);

  r = await kao("authenticated", UA, "select * from public.pregled_knjiga('K27', null, null, 'najnovije', 50, 0, null, 'bez')");
  const rz = await kao("authenticated", UA, "select * from public.pregled_knjiga_zbir()");
  const ri = await kao("authenticated", UA, "select * from public.pregled_knjiga_izdavaci('K27', null, null, 'bez')");
  ok(!r.greska && r.redovi.length === 0 && !rz.greska && rz.redovi.length === 0 && !ri.greska && ri.redovi.length === 0, "običan član dobija prazno (bez greške) iz liste, zbira i spiska izdavača", [r.greska?.message, rz.greska?.message, ri.greska?.message]);
  r = await kao("anon", null, "select * from public.pregled_knjiga(null, null, null, 'najnovije', 5, 0, null, 'bez')");
  ok(nemaPrava(r), "anon ne sme da pozove listu", r.greska?.message ?? r.redovi);
  r = await kao("anon", null, "select * from public.pregled_knjiga_zbir()");
  ok(nemaPrava(r), "anon ne sme da pozove zbir", r.greska?.message ?? r.redovi);
  const f27 = (await db.query("select p.proname, p.prosecdef, p.proconfig, has_function_privilege('anon', p.oid, 'execute') as anon from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('pregled_knjiga', 'pregled_knjiga_izdavaci', 'pregled_knjiga_zbir') order by 1")).rows;
  ok(f27.length === 3 && f27.every((f) => f.prosecdef === true && (f.proconfig ?? []).some((c) => c.startsWith("search_path=")) && f.anon === false), "sve tri javne funkcije su SECURITY DEFINER sa search_path i nedostupne anon-u", f27);
  const kolone27 = (await db.query("select pg_get_function_result(p.oid) as t from pg_proc p where p.proname = 'pregled_knjiga' and p.pronamespace = 'public'::regnamespace")).rows[0].t;
  ok(!/uneo_id|clan_id|nadimak|broj_kartice|sifra_poziva/.test(kolone27), "nijedna izlazna kolona liste ne vodi do člana", kolone27);

  const pre27 = JSON.stringify((await db.query("select proname, pg_get_functiondef(oid) as d from pg_proc where proname in ('pregled_knjiga', 'pregled_knjiga_izdavaci', 'pregled_knjiga_zbir', 'pregled_knjige_filter') order by 1")).rows);
  await db.exec(fs.readFileSync(path.join(MIGRACIJE, KORICA27[0]), "utf8"));
  const posle27 = JSON.stringify((await db.query("select proname, pg_get_functiondef(oid) as d from pg_proc where proname in ('pregled_knjiga', 'pregled_knjiga_izdavaci', 'pregled_knjiga_zbir', 'pregled_knjige_filter') order by 1")).rows);
  ok(pre27 === posle27 && (await otisakPolitika27()) === politikePre27, "0027 je idempotentna: drugo puštanje ne duplira funkcije i ne menja politike");
  r = await lista27("bez");
  ok(!r.greska && r.redovi.length === 4, "posle drugog puštanja filter i dalje radi", r.greska?.message ?? r.redovi?.length);

  // ───────── 0028: Prometej i Data Status na listi domena za korice ─────────
  faza("0028: domeni prometej.rs i datastatus.rs na listi za korice (samo dva reda; RLS i prava netaknuti; idempotentno)");
  const pre28 = await listaDomena();
  ok(NOVI_DOMENI_28.every((d) => !pre28.includes(d)), "PRE 0028: novih domena nema u bazi", pre28);
  const nedozv28 = await db.query("select privatno.korice_dozvoljena('https://www.prometej.rs/wp-content/uploads/x.jpg') as p, privatno.korice_dozvoljena('https://datastatus.rs/wp-content/uploads/x.png') as d");
  ok(nedozv28.rows[0].p === false && nedozv28.rows[0].d === false, "PRE 0028: adrese sa oba domena nisu dozvoljene za korice", nedozv28.rows[0]);
  const politike28 = JSON.stringify((await db.query("select schemaname, tablename, policyname, cmd, roles::text, qual, with_check from pg_policies where schemaname = 'privatno' and tablename = 'domeni_korica' order by 1, 2, 3")).rows);
  for (const f of DOMENI28) await pusti(f);
  const posle28 = await listaDomena();
  ok(JSON.stringify(posle28.filter((d) => !pre28.includes(d))) === JSON.stringify([...NOVI_DOMENI_28].sort()) && posle28.length === pre28.length + 2, "0028 dodaje tačno dva reda (prometej.rs, datastatus.rs), ništa ne briše", posle28.filter((d) => !pre28.includes(d)));
  const jsDo28 = DOZVOLJENI_DOMENI_KORICA.filter((d) => !NOVI_DOMENI_29.includes(d));
  ok(JSON.stringify(posle28) === JSON.stringify([...new Set(jsDo28)].sort()), "posle 0028 lista u bazi = DOZVOLJENI_DOMENI_KORICA bez domena koje dodaje tek 0029 (nema razilaženja)", {
    samoUBazi: posle28.filter((d) => !jsDo28.includes(d)),
    samoUJs: jsDo28.filter((d) => !posle28.includes(d)),
  });
  const dozv28 = await db.query(`select privatno.korice_dozvoljena('https://www.prometej.rs/wp-content/uploads/x.jpg') as p,
                                        privatno.korice_dozvoljena('https://datastatus.rs/wp-content/uploads/x.png') as d,
                                        privatno.korice_dozvoljena('https://evil-prometej.rs/x.jpg') as lp,
                                        privatno.korice_dozvoljena('https://datastatus.rs.evil.com/x.jpg') as ld`);
  ok(dozv28.rows[0].p === true && dozv28.rows[0].d === true && dozv28.rows[0].lp === false && dozv28.rows[0].ld === false, "posle 0028: oba domena (i www. poddomen) su dozvoljena, lažni domeni sa istim imenom nisu", dozv28.rows[0]);
  ok(JSON.stringify((await db.query("select schemaname, tablename, policyname, cmd, roles::text, qual, with_check from pg_policies where schemaname = 'privatno' and tablename = 'domeni_korica' order by 1, 2, 3")).rows) === politike28, "0028: politike (RLS) tabele domeni_korica nisu menjane");
  const m28 = fs.readFileSync(path.join(MIGRACIJE, DOMENI28[0]), "utf8").replace(/^\s*--.*$/gm, "");
  ok(!/\b(create|drop|alter)\s+(policy|table|function)\b/i.test(m28) && !/\bdelete\b|\btruncate\b|\bgrant\b|\brevoke\b/i.test(m28) && /on conflict \(domen\) do nothing/i.test(m28) && /notify pgrst/i.test(m28), "0028 samo dodaje redove (on conflict do nothing), ne piše politike, funkcije ni prava, ništa ne briše", null);
  for (const f of DOMENI28) await pusti(f);
  ok(JSON.stringify(await listaDomena()) === JSON.stringify(posle28), "0028 je idempotentna: drugo puštanje ne duplira i ne menja listu", await listaDomena());
  r = await kao("authenticated", BIB, "select * from privatno.domeni_korica");
  ok(nemaPrava(r), "bibliotekar (authenticated) i posle 0028 ne vidi privatno.domeni_korica", r.greska?.message ?? r.redovi?.length);

  // ───────── 0029: Pravoslavna reč i PortaLibris na listi domena za korice ─────────
  faza("0029: domeni pravoslavnarec.com i portalibris.rs na listi za korice (samo dva reda; RLS i prava netaknuti; idempotentno)");
  const pre29 = await listaDomena();
  ok(NOVI_DOMENI_29.every((d) => !pre29.includes(d)), "PRE 0029: novih domena nema u bazi", pre29);
  const politike29 = JSON.stringify((await db.query("select schemaname, tablename, policyname, cmd, roles::text, qual, with_check from pg_policies where schemaname = 'privatno' and tablename = 'domeni_korica' order by 1, 2, 3")).rows);
  for (const f of DOMENI29) await pusti(f);
  const posle29 = await listaDomena();
  ok(JSON.stringify(posle29.filter((d) => !pre29.includes(d))) === JSON.stringify([...NOVI_DOMENI_29].sort()) && posle29.length === pre29.length + 2, "0029 dodaje tačno dva reda (pravoslavnarec.com, portalibris.rs), ništa ne briše", posle29.filter((d) => !pre29.includes(d)));
  ok(JSON.stringify(posle29) === JSON.stringify([...new Set(DOZVOLJENI_DOMENI_KORICA)].sort()), "posle 0029 lista u bazi = DOZVOLJENI_DOMENI_KORICA u api/_lib/bela-lista.js (nema razilaženja)", {
    samoUBazi: posle29.filter((d) => !DOZVOLJENI_DOMENI_KORICA.includes(d)),
    samoUJs: DOZVOLJENI_DOMENI_KORICA.filter((d) => !posle29.includes(d)),
  });
  const dozv29 = await db.query(`select privatno.korice_dozvoljena('https://pravoslavnarec.com/wp-content/uploads/x.jpg') as p,
                                        privatno.korice_dozvoljena('https://portalibris.rs/wp-content/uploads/x.jpg') as d,
                                        privatno.korice_dozvoljena('https://evil-portalibris.rs/x.jpg') as lp,
                                        privatno.korice_dozvoljena('https://pravoslavnarec.com.evil.com/x.jpg') as ld`);
  ok(dozv29.rows[0].p === true && dozv29.rows[0].d === true && dozv29.rows[0].lp === false && dozv29.rows[0].ld === false, "posle 0029: oba domena su dozvoljena, lažni domeni sa istim imenom nisu", dozv29.rows[0]);
  ok(JSON.stringify((await db.query("select schemaname, tablename, policyname, cmd, roles::text, qual, with_check from pg_policies where schemaname = 'privatno' and tablename = 'domeni_korica' order by 1, 2, 3")).rows) === politike29, "0029: politike (RLS) tabele domeni_korica nisu menjane");
  const m29 = fs.readFileSync(path.join(MIGRACIJE, DOMENI29[0]), "utf8").replace(/^\s*--.*$/gm, "");
  ok(!/\b(create|drop|alter)\s+(policy|table|function)\b/i.test(m29) && !/\bdelete\b|\btruncate\b|\bgrant\b|\brevoke\b/i.test(m29) && /on conflict \(domen\) do nothing/i.test(m29) && /notify pgrst/i.test(m29), "0029 samo dodaje redove (on conflict do nothing), ne piše politike, funkcije ni prava, ništa ne briše", null);
  for (const f of DOMENI29) await pusti(f);
  ok(JSON.stringify(await listaDomena()) === JSON.stringify(posle29), "0029 je idempotentna: drugo puštanje ne duplira i ne menja listu", await listaDomena());

  // ───────── uklanjanje knjige sa police ─────────
  faza("Polica: član uklanja samo svoj red (RLS polica_svoja), tuđi i bibliotekarov pokušaj ne brišu ništa, a utisak ostaje");
  const KUP = await nova("POLICA Uklanjanje");
  await db.query("insert into polica (clan_id, knjiga_id, status) values ($1, $3, 'procitano'), ($2, $3, 'zelim')", [UA, UB, KUP]);
  await db.query("insert into utisci (clan_id, knjiga_id, ocena, tekst, vidljivost) values ($1, $2, 9, 'POLICA utisak ostaje', 'javno')", [UA, KUP]);
  const redUA = (await db.query("select id from polica where clan_id = $1 and knjiga_id = $2", [UA, KUP])).rows[0].id;
  const redUB = (await db.query("select id from polica where clan_id = $1 and knjiga_id = $2", [UB, KUP])).rows[0].id;
  r = await kao("authenticated", UA, "delete from public.polica where id = $1 returning id", [redUB]);
  ok(!r.greska && r.redovi.length === 0 && (await db.query("select count(*)::int as n from polica where id = $1", [redUB])).rows[0].n === 1, "član ne može da ukloni tuđ red police (0 obrisanih redova, red ostaje)", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", BIB, "delete from public.polica where id = $1 returning id", [redUB]);
  ok(!r.greska && r.redovi.length === 0, "ni bibliotekar ne briše tuđu policu (ima samo uvid)", r.greska?.message ?? r.redovi);
  r = await kao("authenticated", UA, "delete from public.polica where id = $1 returning id", [redUA]);
  ok(!r.greska && r.redovi.length === 1, "član uklanja svoj red police", r.greska?.message ?? r.redovi);
  ok((await db.query("select count(*)::int as n from polica where knjiga_id = $1", [KUP])).rows[0].n === 1, "tuđi red police za istu knjigu ostaje", null);
  ok((await db.query("select count(*)::int as n from utisci where knjiga_id = $1 and clan_id = $2", [KUP, UA])).rows[0].n === 1, "utisak člana o knjizi ostaje posle uklanjanja sa police", null);
  ok((await db.query("select count(*)::int as n from knjige where id = $1", [KUP])).rows[0].n === 1, "knjiga ostaje u bazi", null);

  // ───────── opšte ─────────
  faza("Opšta pravila");
  const javne = await db.query(`select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon, has_function_privilege('authenticated', p.oid, 'execute') as auth
                                from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind = 'f' order by 1`);
  console.log("   javne funkcije u šemi public (anon / authenticated može da izvrši):");
  for (const f of javne.rows) console.log(`     ${f.proname.padEnd(18)} ${f.anon ? "anon" : "----"}  ${f.auth ? "authenticated" : "-------------"}`);
  ok(javne.rows.every((f) => !f.anon), "nijedna javna funkcija nije dostupna anon-u", javne.rows.filter((f) => f.anon));
  ok(JSON.stringify(javne.rows.map((f) => f.proname)) === JSON.stringify(["posalji_poziv", "pregled_knjiga", "pregled_knjiga_izdavaci", "pregled_knjiga_zbir", "prihvati_poziv", "spoji_knjige", "trazi_knjige", "uzmi_zahtev"]),
    "javne funkcije su tačno: posalji_poziv, pregled_knjiga, pregled_knjiga_izdavaci, pregled_knjiga_zbir, prihvati_poziv, spoji_knjige, trazi_knjige, uzmi_zahtev", javne.rows.map((f) => f.proname));
  const bezRls = await db.query(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
                                  where n.nspname in ('public', 'privatno') and c.relkind = 'r' and not c.relrowsecurity order by 1`);
  ok(bezRls.rows.length === 0, "svaka tabela u public i privatno ima uključen RLS", bezRls.rows);
  const bezPolitike = await db.query(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
                                      where n.nspname in ('public', 'privatno') and c.relkind = 'r'
                                        and not exists (select 1 from pg_policy p where p.polrelid = c.oid) order by 1`);
  ok(bezPolitike.rows.length === 0, "svaka tabela u public i privatno ima bar jednu politiku", bezPolitike.rows);
  const definerBezPutanje = await db.query(`select n.nspname || '.' || p.proname as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                                            where n.nspname in ('public', 'privatno') and p.prosecdef
                                              and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%') order by 1`);
  ok(definerBezPutanje.rows.length === 0, "svaka SECURITY DEFINER funkcija ima postavljen search_path", definerBezPutanje.rows);
} catch (e) {
  fail++;
  console.log("FAIL  prekinuto:", e.message);
}
console.log(`\nPASS: ${pass}   FAIL: ${fail}`);
process.exit(fail ? 1 : 0);
