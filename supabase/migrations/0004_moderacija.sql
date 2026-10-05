-- 0004 — пријаве, објаве библиотекара, резервације.

-- ─────────────────────────────────────────────────────────────────────────────
-- Пријаве
--
-- Дугме „Пријави" стоји на свакој поруци и сваком утиску (план, тачка 3).
-- `stavka_id` намерно нема страни кључ: показује час на препоруку, час на
-- утисак, а пријава мора да преживи брисање пријављене ставке — иначе се
-- траг о инциденту губи баш кад је најпотребнији.
-- ─────────────────────────────────────────────────────────────────────────────

create table public.prijave (
  id          uuid primary key default gen_random_uuid(),
  prijavio_id uuid not null references public.clanovi(id) on delete cascade,
  tip         text not null check (tip in ('preporuka', 'utisak')),
  stavka_id   uuid not null,
  razlog      text,
  resena      boolean not null default false,
  resio_id    uuid references public.clanovi(id) on delete set null,
  beleska     text,
  kreirana    timestamptz not null default now(),

  unique (prijavio_id, tip, stavka_id)
);

create index prijave_neresene_idx on public.prijave (kreirana) where not resena;

alter table public.prijave enable row level security;

create policy prijave_svoje_select on public.prijave
  for select to authenticated
  using (prijavio_id = auth.uid());

create policy prijave_insert on public.prijave
  for insert to authenticated
  with check (prijavio_id = auth.uid() and public.aktivan_clan());

create policy prijave_bibliotekar_select on public.prijave
  for select to authenticated
  using (public.je_bibliotekar());

create policy prijave_bibliotekar_update on public.prijave
  for update to authenticated
  using (public.je_bibliotekar())
  with check (public.je_bibliotekar());

-- ─────────────────────────────────────────────────────────────────────────────
-- Објаве и препорука библиотекара
-- ─────────────────────────────────────────────────────────────────────────────

create table public.objave (
  id         uuid primary key default gen_random_uuid(),
  autor_id   uuid references public.clanovi(id) on delete set null,
  vrsta      text not null default 'vest'
               check (vrsta in ('vest', 'preporuka_bibliotekara')),
  naslov     text not null check (btrim(naslov) <> ''),
  tekst      text,
  slika_url  text,
  knjiga_id  uuid references public.knjige(id) on delete set null,
  objavljena timestamptz,
  kreirana   timestamptz not null default now(),

  -- Препорука библиотекара је истакнута књига са образложењем — без књиге
  -- нема шта да се истакне.
  constraint objave_preporuka_ima_knjigu
    check (vrsta <> 'preporuka_bibliotekara' or knjiga_id is not null)
);

create index objave_objavljene_idx on public.objave (objavljena desc)
  where objavljena is not null;

alter table public.objave enable row level security;

-- Необјављен нацрт види само библиотекар.
create policy objave_select on public.objave
  for select to authenticated
  using (
    (objavljena is not null and objavljena <= now() and public.aktivan_clan())
    or public.je_bibliotekar()
  );

create policy objave_bibliotekar_write on public.objave
  for all to authenticated
  using (public.je_bibliotekar())
  with check (public.je_bibliotekar());

-- ─────────────────────────────────────────────────────────────────────────────
-- Резервације
--
-- „Резервиши" је обавештење библиотекару, не упис у COBISS — COBISS остаје
-- извор истине за задужења (план, тачка 4).
-- ─────────────────────────────────────────────────────────────────────────────

create table public.rezervacije (
  id        uuid primary key default gen_random_uuid(),
  clan_id   uuid not null references public.clanovi(id) on delete cascade,
  knjiga_id uuid not null references public.knjige(id) on delete cascade,
  status    text not null default 'nova'
              check (status in ('nova', 'obradjena', 'otkazana')),
  napomena  text,
  kreirana  timestamptz not null default now()
);

-- Иста књига не може двапут да се резервише док прва резервација стоји.
create unique index rezervacije_otvorena_idx
  on public.rezervacije (clan_id, knjiga_id)
  where status = 'nova';

create index rezervacije_nove_idx on public.rezervacije (kreirana) where status = 'nova';

alter table public.rezervacije enable row level security;

create policy rezervacije_svoje_select on public.rezervacije
  for select to authenticated
  using (clan_id = auth.uid());

create policy rezervacije_insert on public.rezervacije
  for insert to authenticated
  with check (clan_id = auth.uid() and public.aktivan_clan() and status = 'nova');

-- Члан сме само да откаже своју; обраду уписује библиотекар.
create policy rezervacije_svoje_update on public.rezervacije
  for update to authenticated
  using (clan_id = auth.uid() and status = 'nova')
  with check (clan_id = auth.uid() and status = 'otkazana');

create policy rezervacije_bibliotekar_all on public.rezervacije
  for all to authenticated
  using (public.je_bibliotekar())
  with check (public.je_bibliotekar());

-- ─────────────────────────────────────────────────────────────────────────────
-- Права приступа
-- ─────────────────────────────────────────────────────────────────────────────

revoke all on public.prijave     from anon;
revoke all on public.objave      from anon;
revoke all on public.rezervacije from anon;

grant select, insert, update on public.prijave to authenticated;
grant select, insert, update, delete on public.objave to authenticated;
grant select, insert, update, delete on public.rezervacije to authenticated;
