-- 0007 — keš pročitanih linkova i ograničenje broja zahteva (api/ na Vercel-u).
--
-- Obe tabele su samo za service_role: Vercel funkcije ih koriste sa servisnim
-- ključem, a klijent (anon i authenticated) nema nikakav pristup. RLS je uključen
-- u istoj migraciji, sa jednom politikom koja izričito važi samo za service_role
-- (service_role ionako zaobilazi RLS; politika postoji da namera bude zapisana
-- i da Supabase savetnik ne javlja „RLS uključen bez politike").
--
-- Ovo je NOVA migracija: 0001 do 0006 su već u bazi i ne menjaju se.

-- ─────────────────────────────────────────────────────────────────────────────
-- Keš po adresi
-- ─────────────────────────────────────────────────────────────────────────────

create table public.kes_linkova (
  url       text primary key,
  odgovor   jsonb not null,
  dohvaceno timestamptz not null default now(),
  istice    timestamptz not null
);

comment on table public.kes_linkova is
  'Keš api/iz-linka.js po normalizovanoj adresi. Samo service_role.';

create index kes_linkova_istice_idx on public.kes_linkova (istice);

alter table public.kes_linkova enable row level security;

create policy kes_linkova_servis on public.kes_linkova
  for all to service_role
  using (true)
  with check (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- Ograničenje broja zahteva po članu
--
-- Funkcije na Vercel-u nemaju stanje, pa se zahtevi broje u tabeli. Svaki
-- dozvoljen zahtev je jedan red; broji se koliko ih je u poslednjem prozoru.
-- ─────────────────────────────────────────────────────────────────────────────

create table public.zahtevi_api (
  id      bigint generated always as identity primary key,
  clan_id uuid not null references public.clanovi(id) on delete cascade,
  akcija  text not null,
  vreme   timestamptz not null default now()
);

comment on table public.zahtevi_api is
  'Dozvoljeni zahtevi ka api/ funkcijama, za ograničenje po članu. Samo service_role.';

create index zahtevi_api_clan_vreme_idx on public.zahtevi_api (clan_id, vreme desc);
create index zahtevi_api_vreme_idx on public.zahtevi_api (vreme);

alter table public.zahtevi_api enable row level security;

create policy zahtevi_api_servis on public.zahtevi_api
  for all to service_role
  using (true)
  with check (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- Prava pristupa
--
-- Supabase novim tabelama podrazumevano daje sve privilegije ulogama anon i
-- authenticated; ovde se oduzimaju. Klijent ne sme da vidi ni da menja ništa.
-- ─────────────────────────────────────────────────────────────────────────────

revoke all on public.kes_linkova, public.zahtevi_api from public, anon, authenticated;
grant select, insert, update, delete on public.kes_linkova to service_role;
grant select, insert, update, delete on public.zahtevi_api to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- uzmi_zahtev: proveri i upiši u jednom koraku
--
-- Poziva je SAMO api/ sa servisnim ključem (preko PostgREST-a, pa mora u public),
-- zato se izvršavanje oduzima svima ostalima. Advisory lock po članu serijalizuje
-- istovremene zahteve istog člana: bez njega bi dva zahteva koja stignu zajedno,
-- kad je upotrebljeno 29 od 30, oba izbrojala 29 i oba prošla.
--
-- Vraća: { dozvoljeno, preostalo, ponovo_za_sekundi }
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.uzmi_zahtev(
  p_clan            uuid,
  p_akcija          text,
  p_najvise         integer default 30,
  p_prozor_sekundi  integer default 3600
)
returns jsonb
language plpgsql
volatile
set search_path = public, pg_temp
as $fn$
declare
  prozor       interval := make_interval(secs => p_prozor_sekundi);
  upotrebljeno integer;
  najstariji   timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_clan::text, 0));

  select count(*), min(vreme)
    into upotrebljeno, najstariji
    from public.zahtevi_api
   where clan_id = p_clan
     and vreme > now() - prozor;

  if upotrebljeno >= p_najvise then
    return jsonb_build_object(
      'dozvoljeno', false,
      'preostalo', 0,
      'ponovo_za_sekundi', greatest(1, ceil(extract(epoch from (najstariji + prozor - now())))::integer)
    );
  end if;

  insert into public.zahtevi_api (clan_id, akcija) values (p_clan, p_akcija);

  -- Povremeno čišćenje starih redova (u proseku svaki 50. poziv), da tabela ne raste.
  if random() < 0.02 then
    delete from public.zahtevi_api where vreme < now() - interval '1 day';
  end if;

  return jsonb_build_object(
    'dozvoljeno', true,
    'preostalo', p_najvise - upotrebljeno - 1,
    'ponovo_za_sekundi', 0
  );
end;
$fn$;

revoke all on function public.uzmi_zahtev(uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.uzmi_zahtev(uuid, text, integer, integer) to service_role;
