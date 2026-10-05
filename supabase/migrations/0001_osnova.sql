-- 0001 — osnova: pomoćne funkcije, članovi, knjige.
-- RLS ide u istoj migraciji kao i tabela (plan, tačka 4).

create extension if not exists pg_trgm;

-- ─────────────────────────────────────────────────────────────────────────────
-- Normalizacija teksta
-- ─────────────────────────────────────────────────────────────────────────────

-- Ćirilica i latinica se u biblioteci mešaju u istom polju: zapis iz COBISS-a je
-- ćirilički, čitalac kuca latinicom i bez kvačica. Pretraga zato poredi
-- normalizovan oblik, pa „Андрић", „Andrić" i „andric" daju isti rezultat.
create or replace function public.norm_tekst(t text)
returns text
language sql
immutable
strict
parallel safe
as $fn$
  select translate(
    replace(replace(replace(replace(replace(
      lower(t),
      'ђ', 'dj'), 'љ', 'lj'), 'њ', 'nj'), 'џ', 'dz'), 'đ', 'dj'),
    'абвгдежзијклмнопрстћуфхцчшčćšž',
    'abvgdezzijklmnoprstcufhccsccsz'
  );
$fn$;

-- Šifra poziva se daje usmeno i prepisuje rukom, pa se poređenje radi bez
-- razdelnika i bez obzira na veličinu slova: „NEG·4471·KJ" = „neg 4471 kj".
create or replace function public.norm_sifra(s text)
returns text
language sql
immutable
strict
parallel safe
as $fn$
  select upper(regexp_replace(s, '[^A-Za-z0-9]', '', 'g'));
$fn$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Članovi
-- ─────────────────────────────────────────────────────────────────────────────

create table public.clanovi (
  id                     uuid primary key references auth.users(id) on delete cascade,
  broj_kartice           text not null unique,
  ime                    text not null,
  nadimak                text,
  avatar_url             text,
  uloga                  text not null default 'citalac'
                           check (uloga in ('citalac', 'bibliotekar', 'administrator')),
  aktivan                boolean not null default true,
  telefon                text,
  sifra_poziva           text not null unique,
  omiljeni_zanrovi       text[] not null default '{}',
  datum_rodjenja         date,
  roditeljska_saglasnost boolean not null default false,
  kreiran                timestamptz not null default now()
);

create unique index clanovi_sifra_norm_idx
  on public.clanovi (public.norm_sifra(sifra_poziva));

comment on column public.clanovi.sifra_poziva is
  'Šifra koju član lično daje drugome. Jedini način da se dođe do nekog člana — nema javnog spiska ni pretrage po imenu.';
comment on column public.clanovi.datum_rodjenja is
  'Samo zbog maloletnih članova: roditeljska saglasnost i uvid bibliotekara u veze.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Pomoćne funkcije za RLS
--
-- Sve su SECURITY DEFINER jer politike na drugim tabelama moraju da pročitaju
-- „ko sam ja" iz clanovi, a clanovi i sama ima RLS. Bez DEFINER-a politika
-- zove samu sebe i Postgres prijavi beskonačnu rekurziju.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.moja_uloga()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select uloga from public.clanovi where id = auth.uid() and aktivan;
$fn$;

create or replace function public.je_bibliotekar()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select coalesce(public.moja_uloga() in ('bibliotekar', 'administrator'), false);
$fn$;

create or replace function public.je_administrator()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select coalesce(public.moja_uloga() = 'administrator', false);
$fn$;

create or replace function public.aktivan_clan()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select exists (select 1 from public.clanovi where id = auth.uid() and aktivan);
$fn$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Šifra poziva
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.nova_sifra_poziva()
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  -- Bez I, L i O — mešaju se sa 1 i 0 kad se šifra prepisuje sa papira.
  slova constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ';
  kod   text;
begin
  for i in 1..50 loop
    kod := 'NEG·'
        || (floor(random() * 9000) + 1000)::int::text
        || '·'
        || substr(slova, floor(random() * length(slova))::int + 1, 1)
        || substr(slova, floor(random() * length(slova))::int + 1, 1);

    if not exists (
      select 1 from public.clanovi c
       where public.norm_sifra(c.sifra_poziva) = public.norm_sifra(kod)
    ) then
      return kod;
    end if;
  end loop;

  raise exception 'Ne mogu da napravim jedinstvenu šifru poziva';
end;
$fn$;

-- Šifra se dodeljuje sama, da ne zavisi od toga da li ju je neko upisao pri
-- otvaranju naloga. Član bez šifre ne bi mogao nikom da da pozivnicu.
alter table public.clanovi
  alter column sifra_poziva set default public.nova_sifra_poziva();

-- ─────────────────────────────────────────────────────────────────────────────
-- Zaštita polja koja član ne sme sam da menja
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.clanovi_zastita()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if public.je_administrator() then
    return new;
  end if;

  if public.je_bibliotekar() then
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

create trigger clanovi_zastita_bu
  before update on public.clanovi
  for each row execute function public.clanovi_zastita();

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS: članovi
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.clanovi enable row level security;

-- Svoj nalog, uvek.
create policy clanovi_svoj_select on public.clanovi
  for select to authenticated
  using (id = auth.uid());

create policy clanovi_svoj_update on public.clanovi
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Bibliotekar i administrator vide sve članove.
create policy clanovi_bibliotekar_select on public.clanovi
  for select to authenticated
  using (public.je_bibliotekar());

-- Nema samostalne registracije — nalog otvara bibliotekar (plan, tačka 3).
create policy clanovi_bibliotekar_insert on public.clanovi
  for insert to authenticated
  with check (public.je_bibliotekar());

create policy clanovi_bibliotekar_update on public.clanovi
  for update to authenticated
  using (public.je_bibliotekar())
  with check (public.je_bibliotekar());

create policy clanovi_admin_delete on public.clanovi
  for delete to authenticated
  using (public.je_administrator());

-- ─────────────────────────────────────────────────────────────────────────────
-- Knjige
-- ─────────────────────────────────────────────────────────────────────────────

create table public.knjige (
  id             uuid primary key default gen_random_uuid(),
  naslov         text not null check (btrim(naslov) <> ''),
  autor          text,
  izdavac        text,
  godina         smallint check (godina between 1400 and 2200),
  isbn           text,
  signatura      text,
  zanrovi        text[] not null default '{}',
  cobiss_id      text,
  opis           text,
  korice_url     text,
  korice_izvor   text check (korice_izvor in
                   ('fond', 'google_books', 'open_library', 'og_slika', 'fotografija')),
  u_fondu        boolean not null default false,
  broj_primeraka integer not null default 0 check (broj_primeraka >= 0),
  broj_slobodnih integer not null default 0 check (broj_slobodnih >= 0),
  izvor          text not null default 'clan'
                   check (izvor in ('fond', 'google_books', 'link', 'clan')),
  uneo_id        uuid references public.clanovi(id) on delete set null,
  spojena_sa_id  uuid references public.knjige(id) on delete set null,
  kreirana       timestamptz not null default now(),

  constraint knjige_slobodnih_ne_vise_od_primeraka
    check (broj_slobodnih <= broj_primeraka),
  constraint knjige_ne_spaja_se_sa_sobom
    check (spojena_sa_id is distinct from id)
);

comment on column public.knjige.spojena_sa_id is
  'Duplikat pokazuje na matični zapis. Bibliotekar spaja ručno (plan, tačka 3, izveštaj za nabavku).';
comment on column public.knjige.korice_url is
  'Čuva se URL, ne fajl — uslovi Google Books-a traže prikaz uz link ka njihovom zapisu.';

create index knjige_pretraga_idx on public.knjige using gin (
  public.norm_tekst(coalesce(naslov, '') || ' ' || coalesce(autor, '')) gin_trgm_ops
);
create index knjige_isbn_idx    on public.knjige (isbn) where isbn is not null;
create index knjige_u_fondu_idx on public.knjige (u_fondu);
create index knjige_spojena_idx on public.knjige (spojena_sa_id) where spojena_sa_id is not null;

-- Član sme da upiše naslov koji nemamo, ali ne sme da ga proglasi delom fonda.
create or replace function public.knjige_unos_clana()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if public.je_bibliotekar() then
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
  return new;
end;
$fn$;

create trigger knjige_unos_clana_bi
  before insert on public.knjige
  for each row execute function public.knjige_unos_clana();

alter table public.knjige enable row level security;

-- Katalog vide svi prijavljeni aktivni članovi.
create policy knjige_select on public.knjige
  for select to authenticated
  using (public.aktivan_clan());

-- „Naslov koji nemamo" — ključna funkcionalnost (plan, tačka 3).
-- Pretraga nikad ne sme da bude ćorsokak, pa svaki aktivan član sme da upiše.
create policy knjige_insert_clan on public.knjige
  for insert to authenticated
  with check (public.aktivan_clan());

create policy knjige_update_bibliotekar on public.knjige
  for update to authenticated
  using (public.je_bibliotekar())
  with check (public.je_bibliotekar());

create policy knjige_delete_admin on public.knjige
  for delete to authenticated
  using (public.je_administrator());

-- ─────────────────────────────────────────────────────────────────────────────
-- Prava pristupa
-- ─────────────────────────────────────────────────────────────────────────────

revoke all on public.clanovi from anon;
revoke all on public.knjige  from anon;
grant select, insert, update on public.clanovi to authenticated;
grant select, insert, update, delete on public.knjige to authenticated;

revoke all on function public.moja_uloga()        from public, anon;
revoke all on function public.je_bibliotekar()    from public, anon;
revoke all on function public.je_administrator()  from public, anon;
revoke all on function public.aktivan_clan()      from public, anon;
revoke all on function public.nova_sifra_poziva() from public, anon;

grant execute on function public.moja_uloga()        to authenticated;
grant execute on function public.je_bibliotekar()    to authenticated;
grant execute on function public.je_administrator()  to authenticated;
grant execute on function public.aktivan_clan()      to authenticated;
grant execute on function public.nova_sifra_poziva() to authenticated;
