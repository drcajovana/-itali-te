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
  for (const f of fajlovi.filter((x) => !KASNE.includes(x) && !POSLEDNJA.includes(x) && !NAKON.includes(x) && !STORAGE.includes(x) && !ISPRAVKA.includes(x) && !PUTANJA.includes(x))) await pusti(f);

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
  const ocekivana = [...new Set(DOZVOLJENI_DOMENI_KORICA)].sort();
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
  const uJs = [...DOZVOLJENI_DOMENI_KORICA].sort();
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

  // ───────── opšte ─────────
  faza("Opšta pravila");
  const javne = await db.query(`select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon, has_function_privilege('authenticated', p.oid, 'execute') as auth
                                from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind = 'f' order by 1`);
  console.log("   javne funkcije u šemi public (anon / authenticated može da izvrši):");
  for (const f of javne.rows) console.log(`     ${f.proname.padEnd(18)} ${f.anon ? "anon" : "----"}  ${f.auth ? "authenticated" : "-------------"}`);
  ok(javne.rows.every((f) => !f.anon), "nijedna javna funkcija nije dostupna anon-u", javne.rows.filter((f) => f.anon));
  ok(JSON.stringify(javne.rows.map((f) => f.proname)) === JSON.stringify(["posalji_poziv", "prihvati_poziv", "spoji_knjige", "trazi_knjige", "uzmi_zahtev"]),
    "javne funkcije su tačno: posalji_poziv, prihvati_poziv, spoji_knjige, trazi_knjige, uzmi_zahtev", javne.rows.map((f) => f.proname));
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
