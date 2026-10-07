-- 0009 — knjige.korice_url: samo https, ograničena dužina, samo dozvoljeni domeni.
--
-- Zašto: korice se prikazuju svim članovima kao <img src="...">, pa bi član koji
-- upiše adresu sa tuđeg servera mogao da prati ko gleda koju knjigu (slika se
-- učitava sa njegovog servera). Dozvoljeni su samo domeni kojima verujemo:
-- Open Library, naš Supabase Storage (fotografije korica koje okači bibliotekar) i
-- izdavači sa liste (api/_lib/bela-lista.js).
--
-- GOOGLE BOOKS NAMERNO NIJE NA LISTI. Njegovi uslovi (Google APIs ToS, odeljak 5e)
-- ne dozvoljavaju trajne kopije sadržaja iz API-ja, pa se Google korica samo
-- prikazuje u rezultatima pretrage uživo i nikad ne čuva. Ako bi neko ipak upisao
-- Google adresu, baza je postavlja na NULL.
--
-- ŠTA SE RADI SA NEDOZVOLJENOM ADRESOM: postavlja se na NULL (zajedno sa
-- korice_izvor), knjiga se ipak upisuje; ne odbija se čitav upis.
-- Razlozi:
--  1. Korica je dopuna. Član koji dodaje knjigu radi nešto drugo (dodaje je na
--     policu); greška zbog slike bi mu uništila taj posao, a on ne može da je
--     ispravi (adresu je dao sajt, ne on). U planu pretraga nikad ne sme da
--     bude ćorsokak.
--  2. Lanac korica (Open Library → pločica) postoji upravo za knjige bez korice,
--     pa NULL je potpuno ispravno stanje, ne greška.
--  3. Odbijanje bi svaku promenu na sajtu izdavača (nov CDN domen) pretvorilo u
--     pokvareno dugme „Dodaj na policu".
-- Cena: ispravka je tiha. Zato api/ funkcije same ne vraćaju korice sa domena van
-- liste (član ne vidi sliku koju ne bi mogao da sačuva), a test:db proverava ovo
-- ponašanje i da lista u bazi odgovara listi u JS-u.
--
-- Servisna uloga (service_role, postgres) je izuzeta: uvoz fonda i administrator
-- mogu da upišu šta treba.
--
-- Ovo je NOVA migracija: 0001 do 0008 su već u bazi i ne menjaju se.

-- ─────────────────────────────────────────────────────────────────────────────
-- Lista dozvoljenih domena
--
-- Tabela, a ne niz u funkciji, da se domen dodaje običnim INSERT-om (nova
-- migracija) bez prepisivanja funkcije. Mora da odgovara listi
-- DOZVOLJENI_DOMENI_KORICA u api/_lib/bela-lista.js; test:db to proverava.
-- Nalazi se u šemi privatno (ne izlaže se kroz API), samo za service_role.
-- ─────────────────────────────────────────────────────────────────────────────

create table privatno.domeni_korica (
  domen text primary key
    check (domen = lower(domen) and domen ~ '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$' and domen like '%.%')
);

comment on table privatno.domeni_korica is
  'Domeni sa kojih sme adresa korice (knjige.korice_url). Mora da odgovara DOZVOLJENI_DOMENI_KORICA u api/_lib/bela-lista.js.';

alter table privatno.domeni_korica enable row level security;

create policy domeni_korica_servis on privatno.domeni_korica
  for all to service_role
  using (true)
  with check (true);

revoke all on privatno.domeni_korica from public, anon, authenticated;
grant select, insert, update, delete on privatno.domeni_korica to service_role;

insert into privatno.domeni_korica (domen) values
  ('laguna.rs'),
  ('delfi.rs'),
  ('vulkani.rs'),
  ('dereta.rs'),
  ('booka.rs'),
  ('geopoetika.rs'),
  ('arhipelag.rs'),
  ('carobnaknjiga.rs'),
  ('kreativnicentar.rs'),
  ('pcelica.rs'),
  ('publikpraktikum.rs'),
  ('stelaknjige.rs'),
  ('clio.rs'),
  ('klett.rs'),
  ('geopoetika.com'),
  ('covers.openlibrary.org'),
  -- Naš Supabase Storage: https://<host>/storage/v1/object/public/<bucket>/<fajl>.
  -- Host je isti kao u VITE_SUPABASE_URL (već je u javnom klijentskom kodu, nije tajna).
  ('jrmzgulxvxtpghwbhmrc.supabase.co');

-- ─────────────────────────────────────────────────────────────────────────────
-- Provera adrese (isto pravilo kao koricaJeDozvoljena u api/_lib/bela-lista.js)
--
-- SECURITY DEFINER samo zato da bi pročitala tabelu iznad (koju korisnik ne sme
-- da čita); search_path je postavljen.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function privatno.korice_dozvoljena(url text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  host text;
begin
  -- https, najviše 500 znakova, bez razmaka i kontrolnih znakova
  if url is null or length(url) > 500 or url ~ '[[:space:][:cntrl:]]' then
    return false;
  end if;

  -- Domen je sve između „https://" i prvog „/", „?" ili „#" ili kraja. Dvotačka
  -- i „@" nisu dozvoljeni u domenu, pa port, korisnik i IPv6 adresa otpadaju.
  host := lower((regexp_match(url, '^https://([A-Za-z0-9.-]+)([/?#]|$)'))[1]);
  if host is null or host like '.%' or host like '%.' or host like '%..%' then
    return false;
  end if;

  -- Tačno domen sa liste ili njegov poddomen (ne „evil-laguna.rs", ne „laguna.rs.evil.com").
  return exists (
    select 1
      from privatno.domeni_korica d
     where host = d.domen
        or right(host, length(d.domen) + 1) = '.' || d.domen
  );
end;
$fn$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Okidač: nedozvoljena adresa → NULL (i korice_izvor), osim za servisne uloge.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function privatno.knjige_korice()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
begin
  if privatno.servisna_uloga() then
    return new;
  end if;

  if new.korice_url is not null and not privatno.korice_dozvoljena(new.korice_url) then
    new.korice_url := null;
  end if;

  -- Izvor korice bez korice nema smisla.
  if new.korice_url is null then
    new.korice_izvor := null;
  end if;

  return new;
end;
$fn$;

create trigger knjige_korice_biu
  before insert or update of korice_url, korice_izvor on public.knjige
  for each row execute function privatno.knjige_korice();

-- Postojeći redovi koji ne ispunjavaju pravilo (npr. probni upisi) dobijaju NULL.
update public.knjige
   set korice_url = null,
       korice_izvor = null
 where korice_url is not null
   and not privatno.korice_dozvoljena(korice_url);

-- ─────────────────────────────────────────────────────────────────────────────
-- Prava pristupa
-- ─────────────────────────────────────────────────────────────────────────────

revoke all on all functions in schema privatno from public, anon;
grant execute on all functions in schema privatno to authenticated, service_role;
