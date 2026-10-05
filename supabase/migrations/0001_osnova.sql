-- 0001 — основа: помоћне функције, чланови, књиге.
-- RLS иде у истој миграцији као и табела (план, тачка 4).

create extension if not exists pg_trgm;

-- ─────────────────────────────────────────────────────────────────────────────
-- Нормализација текста
-- ─────────────────────────────────────────────────────────────────────────────

-- Ћирилица и латиница се у библиотеци мешају у истом пољу: запис из COBISS-а је
-- ћирилички, читалац куца латиницом и без квачица. Претрага зато пореди
-- нормализован облик, па „Андрић", „Andrić" и „andric" дају исти резултат.
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

-- Шифра позива се даје усмено и преписује руком, па се поређење ради без
-- разделника и без обзира на величину слова: „NEG·4471·KJ" = „neg 4471 kj".
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
-- Чланови
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
  'Шифра коју члан лично даје другоме. Једини начин да се дође до неког члана — нема јавног списка ни претраге по имену.';
comment on column public.clanovi.datum_rodjenja is
  'Само због малолетних чланова: родитељска сагласност и увид библиотекара у везе.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Помоћне функције за RLS
--
-- Све су SECURITY DEFINER јер политике на другим табелама морају да прочитају
-- „ко сам ја" из clanovi, а clanovi и сама има RLS. Без DEFINER-а политика
-- зове саму себе и Postgres пријави бесконачну рекурзију.
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
-- Шифра позива
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.nova_sifra_poziva()
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  -- Без I, L и O — мешају се са 1 и 0 кад се шифра преписује са папира.
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

  raise exception 'Не могу да направим јединствену шифру позива';
end;
$fn$;

-- Шифра се додељује сама, да не зависи од тога да ли ју је неко уписао при
-- отварању налога. Члан без шифре не би могао ником да да позивницу.
alter table public.clanovi
  alter column sifra_poziva set default public.nova_sifra_poziva();

-- ─────────────────────────────────────────────────────────────────────────────
-- Заштита поља која члан не сме сам да мења
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
    new.uloga := old.uloga;          -- улоге додељује само администратор
    return new;
  end if;

  -- Читалац мења само оно што је његово: име, надимак, аватар, жанрове, телефон.
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
-- RLS: чланови
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.clanovi enable row level security;

-- Свој налог, увек.
create policy clanovi_svoj_select on public.clanovi
  for select to authenticated
  using (id = auth.uid());

create policy clanovi_svoj_update on public.clanovi
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Библиотекар и администратор виде све чланове.
create policy clanovi_bibliotekar_select on public.clanovi
  for select to authenticated
  using (public.je_bibliotekar());

-- Нема самосталне регистрације — налог отвара библиотекар (план, тачка 3).
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
-- Књиге
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
  'Дупликат показује на матични запис. Библиотекар спаја ручно (план, тачка 3, извештај за набавку).';
comment on column public.knjige.korice_url is
  'Чува се URL, не фајл — услови Google Books-а траже приказ уз линк ка њиховом запису.';

create index knjige_pretraga_idx on public.knjige using gin (
  public.norm_tekst(coalesce(naslov, '') || ' ' || coalesce(autor, '')) gin_trgm_ops
);
create index knjige_isbn_idx    on public.knjige (isbn) where isbn is not null;
create index knjige_u_fondu_idx on public.knjige (u_fondu);
create index knjige_spojena_idx on public.knjige (spojena_sa_id) where spojena_sa_id is not null;

-- Члан сме да упише наслов који немамо, али не сме да га прогласи делом фонда.
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

-- Каталог виде сви пријављени активни чланови.
create policy knjige_select on public.knjige
  for select to authenticated
  using (public.aktivan_clan());

-- „Наслов који немамо" — кључна функционалност (план, тачка 3).
-- Претрага никад не сме да буде ћорсокак, па сваки активан члан сме да упише.
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
-- Права приступа
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
