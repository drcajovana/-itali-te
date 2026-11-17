-- 0020 — izveštaj za nabavku (samo za bibliotekare) i zaštita administratora u bazi.
--
-- DEO A: izveštaj za nabavku
--
--   Aplikacija nije povezana sa COBISS-om, pa ovo je JEDINO mesto gde bibliotekar kaže da li
--   biblioteka ima knjigu: odluka „Имамо", „Набављамо", „Не набављамо" ili bez odluke.
--
--   1. knjige.odluka_nabavke ('imamo' | 'nabavljamo' | 'ne_nabavljamo' | null) i knjige.odluka_datum.
--      Datum postavlja okidač (ne klijent): vreme poslednje promene odluke, a prazan kad se odluka
--      skine. Odluku sme da menja samo bibliotekar (postojeća politika knjige_update_bibliotekar);
--      član koji sam upiše naslov ne može da je postavi (okidač knjige_unos_clana je poništava).
--      „Имамо" postavlja u_fondu = true, a „Набављамо" i „Не набављамо" u_fondu = false, da postoji
--      jedna istina; skidanje odluke ne dira u_fondu.
--
--   2. Pregled po knjizi: privatno.izvestaj_nabavke() (SECURITY DEFINER, search_path) vraća samo
--      AGREGAT: koliko različitih čitalaca želi knjigu (stanje „zelim") i koliko je čita ili je
--      pročitalo. Vraća redove samo bibliotekaru i administratoru (provera je u samoj funkciji);
--      svima ostalima prazno, bez greške. Nema imena, id-a članova, ni vremena kad je neko stavio
--      knjigu na policu (ni to ne sme da bude trag ka članu). Broje se samo aktivni članovi i matični
--      zapisi (spojeni duplikati su već preneti na matični). Javni pogled public.izvestaj_za_nabavku
--      (security_invoker) samo čita tu funkciju. RLS na polici se NE menja; pogled ne daje pristup
--      tuđoj polici, samo brojeve.
--
--   Stari pogledi izvestaj_nabavka i izvestaj_dodatni_primerak (0006) ostaju kakvi jesu; ekran ih ne koristi.
--
-- DEO B: bibliotekar ne dira administratora
--
--   Do sada je trigger clanovi_zastita vraćao bibliotekaru samo promenu uloge, pa je mogao da
--   deaktivira administratora ili da mu menja ime, a ekran je to samo krio. Sada:
--     - bibliotekar ne može da menja (pa ni da deaktivira) člana čija je uloga administrator: greška 42501;
--     - bibliotekar ne menja ulogu nikome (promena uloge se poništava, kao i do sada);
--     - bibliotekar ne može da upiše novi red u clanovi sa ulogom različitom od 'citalac'
--       (novi okidač clanovi_insert_zastita_bi; do sada je to dozvoljavala politika insert);
--     - brisanje je i do sada samo administratoru (clanovi_admin_delete).
--   Administrator sme sve; servisna uloga (npr. api/napravi-clana, skripta za prvog administratora)
--   je izuzeta. Politike na clanovi se NE menjaju: sve ide kroz okidače (funkcije), jer politika
--   zna samo „smeš li da menjaš ovaj red", ne i „smeš li ovu vrednost".
--
-- Nema novih tabela, pa nema ni novih politika. Pogled i funkcije imaju eksplicitna prava.
-- Idempotentna: može da se pusti proizvoljno puta. Ovo je NOVA migracija: 0001 do 0019 se ne menjaju.
--
-- Posle puštanja: notify pgrst, 'reload schema';  (da PostgREST vidi novi pogled i kolone)

-- ─────────────────────────────────────────────────────────────────────────────
-- DEO A
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.knjige add column if not exists odluka_nabavke text;
alter table public.knjige add column if not exists odluka_datum timestamptz;

alter table public.knjige drop constraint if exists knjige_odluka_nabavke_check;
alter table public.knjige
  add constraint knjige_odluka_nabavke_check
  check (odluka_nabavke is null or odluka_nabavke in ('imamo', 'nabavljamo', 'ne_nabavljamo'));

comment on column public.knjige.odluka_nabavke is
  'Odluka bibliotekara: imamo, nabavljamo, ne_nabavljamo (null = bez odluke). Jedino mesto gde se kaže da li biblioteka ima knjigu (nema COBISS-a).';
comment on column public.knjige.odluka_datum is
  'Kad je odluka poslednji put promenjena (postavlja okidač).';

-- Okidač: datum odluke i u_fondu; ostali ne mogu da menjaju odluku.
create or replace function privatno.knjige_odluka_zastita()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
begin
  if new.odluka_nabavke is not distinct from old.odluka_nabavke then
    new.odluka_datum := old.odluka_datum;
    return new;
  end if;

  if not (privatno.servisna_uloga() or privatno.je_bibliotekar()) then
    new.odluka_nabavke := old.odluka_nabavke;
    new.odluka_datum := old.odluka_datum;
    return new;
  end if;

  new.odluka_datum := case when new.odluka_nabavke is null then null else now() end;
  if new.odluka_nabavke = 'imamo' then
    new.u_fondu := true;
  elsif new.odluka_nabavke in ('nabavljamo', 'ne_nabavljamo') then
    new.u_fondu := false;
  end if;
  return new;
end;
$fn$;

drop trigger if exists knjige_odluka_zastita_bu on public.knjige;
create trigger knjige_odluka_zastita_bu
  before update on public.knjige
  for each row execute function privatno.knjige_odluka_zastita();

-- Član koji upiše naslov ne može da postavi odluku (ostalo je isto kao u 0001).
create or replace function privatno.knjige_unos_clana()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
begin
  if privatno.servisna_uloga() or privatno.je_bibliotekar() then
    return new;
  end if;

  new.izvor          := 'clan';
  new.uneo_id        := auth.uid();
  new.u_fondu        := false;
  new.broj_primeraka := 0;
  new.broj_slobodnih := 0;
  new.signatura      := null;
  new.cobiss_id      := null;
  new.spojena_sa_id  := null;
  new.odluka_nabavke := null;
  new.odluka_datum   := null;
  return new;
end;
$fn$;

-- Agregat po knjizi: samo brojevi, samo za bibliotekare.
create or replace function privatno.izvestaj_nabavke()
returns table (
  id                 uuid,
  naslov             text,
  autor              text,
  izdavac            text,
  isbn               text,
  korice_url         text,
  korice_izvor       text,
  u_fondu            boolean,
  odluka             text,
  odluka_postavljena boolean,
  odluka_datum       timestamptz,
  zele               integer,
  citaju_ili_procitali integer
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  select
    k.id,
    k.naslov,
    k.autor,
    k.izdavac,
    k.isbn,
    k.korice_url,
    k.korice_izvor,
    k.u_fondu,
    coalesce(k.odluka_nabavke, case when k.u_fondu then 'imamo' end),
    k.odluka_nabavke is not null,
    k.odluka_datum,
    (count(*) filter (where p.status = 'zelim'))::integer,
    (count(*) filter (where p.status in ('citam', 'procitano')))::integer
  from public.knjige k
  join public.polica p on p.knjiga_id = k.id
  join public.clanovi c on c.id = p.clan_id and c.aktivan
  where privatno.je_bibliotekar()
    and k.spojena_sa_id is null
  group by k.id
  having count(*) filter (where p.status = 'zelim') > 0
  order by count(*) filter (where p.status = 'zelim') desc, k.naslov;
$fn$;

create or replace view public.izvestaj_za_nabavku
with (security_invoker = true)
as
select * from privatno.izvestaj_nabavke();

comment on view public.izvestaj_za_nabavku is
  'Knjige koje čitaoci žele, sa brojevima (bez imena); redove vidi samo bibliotekar/administrator.';

revoke all on public.izvestaj_za_nabavku from public, anon, authenticated;
grant select on public.izvestaj_za_nabavku to authenticated;

revoke all on function privatno.izvestaj_nabavke() from public, anon;
grant execute on function privatno.izvestaj_nabavke() to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- DEO B
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function privatno.clanovi_zastita()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
begin
  if privatno.servisna_uloga() then
    return new;
  end if;

  if privatno.je_administrator() then
    return new;
  end if;

  if privatno.je_bibliotekar() then
    -- administratora bibliotekar ne dira (ni deaktivacija, ni ime, ni bilo šta drugo)
    if old.uloga = 'administrator' then
      raise exception 'Bibliotekar ne može da menja administratora' using errcode = '42501';
    end if;
    new.uloga := old.uloga;          -- uloge dodeljuje samo administrator
    return new;
  end if;

  -- Čitalac menja samo ono što je njegovo: ime, nadimak, avatar, žanrove, telefon.
  new.broj_kartice           := old.broj_kartice;
  new.uloga                  := old.uloga;
  new.aktivan                := old.aktivan;
  new.sifra_poziva           := old.sifra_poziva;
  new.datum_rodjenja         := old.datum_rodjenja;
  new.roditeljska_saglasnost := old.roditeljska_saglasnost;
  return new;
end;
$fn$;

-- Novi red u clanovi: bibliotekar sme samo čitaoca (uloge dodeljuje administrator).
create or replace function privatno.clanovi_insert_zastita()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
begin
  if privatno.servisna_uloga() or privatno.je_administrator() then
    return new;
  end if;
  if new.uloga is distinct from 'citalac' then
    raise exception 'Samo administrator dodeljuje ulogu bibliotekara ili administratora' using errcode = '42501';
  end if;
  return new;
end;
$fn$;

drop trigger if exists clanovi_insert_zastita_bi on public.clanovi;
create trigger clanovi_insert_zastita_bi
  before insert on public.clanovi
  for each row execute function privatno.clanovi_insert_zastita();

-- Prava: nove funkcije u privatno (ponavlja se kao u svakoj migraciji)
revoke all on all functions in schema privatno from public, anon;
grant execute on all functions in schema privatno to authenticated, service_role;

notify pgrst, 'reload schema';
