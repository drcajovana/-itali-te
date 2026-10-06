-- 0004 — prijave, objave bibliotekara, rezervacije.

-- ─────────────────────────────────────────────────────────────────────────────
-- Prijave
--
-- Dugme „Prijavi" stoji na svakoj poruci i svakom utisku (plan, tačka 3).
-- `stavka_id` namerno nema strani ključ: pokazuje čas na preporuku, čas na
-- utisak, a prijava mora da preživi brisanje prijavljene stavke — inače se
-- trag o incidentu gubi baš kad je najpotrebniji.
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
  with check (prijavio_id = auth.uid() and privatno.aktivan_clan());

create policy prijave_bibliotekar_select on public.prijave
  for select to authenticated
  using (privatno.je_bibliotekar());

create policy prijave_bibliotekar_update on public.prijave
  for update to authenticated
  using (privatno.je_bibliotekar())
  with check (privatno.je_bibliotekar());

-- ─────────────────────────────────────────────────────────────────────────────
-- Objave i preporuka bibliotekara
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

  -- Preporuka bibliotekara je istaknuta knjiga sa obrazloženjem — bez knjige
  -- nema šta da se istakne.
  constraint objave_preporuka_ima_knjigu
    check (vrsta <> 'preporuka_bibliotekara' or knjiga_id is not null)
);

create index objave_objavljene_idx on public.objave (objavljena desc)
  where objavljena is not null;

alter table public.objave enable row level security;

-- Neobjavljen nacrt vidi samo bibliotekar.
create policy objave_select on public.objave
  for select to authenticated
  using (
    (objavljena is not null and objavljena <= now() and privatno.aktivan_clan())
    or privatno.je_bibliotekar()
  );

create policy objave_bibliotekar_write on public.objave
  for all to authenticated
  using (privatno.je_bibliotekar())
  with check (privatno.je_bibliotekar());

-- ─────────────────────────────────────────────────────────────────────────────
-- Rezervacije
--
-- „Rezerviši" je obaveštenje bibliotekaru, ne upis u COBISS — COBISS ostaje
-- izvor istine za zaduženja (plan, tačka 4).
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

-- Ista knjiga ne može dvaput da se rezerviše dok prva rezervacija stoji.
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
  with check (clan_id = auth.uid() and privatno.aktivan_clan() and status = 'nova');

-- Član sme samo da otkaže svoju; obradu upisuje bibliotekar.
create policy rezervacije_svoje_update on public.rezervacije
  for update to authenticated
  using (clan_id = auth.uid() and status = 'nova')
  with check (clan_id = auth.uid() and status = 'otkazana');

create policy rezervacije_bibliotekar_all on public.rezervacije
  for all to authenticated
  using (privatno.je_bibliotekar())
  with check (privatno.je_bibliotekar());

-- ─────────────────────────────────────────────────────────────────────────────
-- Prava pristupa
-- ─────────────────────────────────────────────────────────────────────────────

revoke all on public.prijave, public.objave, public.rezervacije from anon, authenticated;

grant select, insert, update on public.prijave to authenticated;
grant select, insert, update, delete on public.objave to authenticated;
grant select, insert, update, delete on public.rezervacije to authenticated;
