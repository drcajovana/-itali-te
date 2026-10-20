-- 0017 — napredak čitanja, autor utiska (nadimak) i rezervacija samo za knjige u fondu.
--
-- Korak 5 iz PLAN.md (polica, stranica knjige, utisci) traži tri stvari koje šema nema:
--
--  1. polica.napredak: napredak čitanja u procentima (0 do 100) za knjige u toku. Postojeći redovi
--     dobijaju 0; „Pročitano" u aplikaciji uvek znači 100, bez obzira na ovu kolonu.
--
--  2. Ime autora uz tuđi utisak. clanovi vide samo sam član i bibliotekari (nema spiska članova),
--     pa se ime autora javnog utiska ne može dobiti spajanjem tabela. Pogled utisci_sa_autorom
--     (security_invoker, kao ocene_knjiga) vraća utiske ISTIM redovima koje utisci_* politike
--     pokazuju onome ko čita (svoje, javne, „samo prijatelji" za povezane, skrivene samo
--     bibliotekaru), a uz svaki samo NADIMAK autora preko privatno.javno_ime(). Pravo ime, broj
--     karte i ostalo se ne vide. Pogled ništa ne filtrira: vidljivost je i dalje u RLS-u.
--
--  3. Rezervacija je poruka bibliotekaru za knjigu iz fonda (zaduženja vodi COBISS). Politika
--     rezervacije_insert sada u bazi traži da knjiga bude u fondu i da nije spojeni duplikat;
--     do sada je to proveravao samo interfejs.
--
-- Nema novih tabela. Pogled i funkcija imaju eksplicitna prava; RLS postojećih tabela se ne
-- menja, osim zamene jedne politike (rezervacije_insert) u istoj migraciji.
--
-- Idempotentno: može da se pusti proizvoljno puta.
-- Ovo je NOVA migracija: 0001 do 0016 se ne menjaju.

-- 1. napredak čitanja
alter table public.polica
  add column if not exists napredak smallint not null default 0
    check (napredak between 0 and 100);

comment on column public.polica.napredak is
  'Napredak čitanja u procentima (0–100) za knjige u toku; „procitano" je u aplikaciji uvek 100.';

-- 2. nadimak autora (SECURITY DEFINER samo da bi pročitala clanovi; vraća samo nadimak)
create or replace function privatno.javno_ime(p_clan uuid)
returns text
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  select nullif(btrim(nadimak), '') from public.clanovi where id = p_clan;
$fn$;

create or replace view public.utisci_sa_autorom
with (security_invoker = true)
as
select
  u.id,
  u.clan_id,
  u.knjiga_id,
  u.ocena,
  u.tekst,
  u.vidljivost,
  u.spojler,
  u.skriven,
  u.kreiran,
  u.izmenjeno,
  privatno.javno_ime(u.clan_id) as autor
from public.utisci u;

comment on view public.utisci_sa_autorom is
  'Utisci sa nadimkom autora. security_invoker: vidljivost određuju politike na utisci; pogled ne filtrira.';

-- 3. rezervacija samo za knjigu u fondu
drop policy if exists rezervacije_insert on public.rezervacije;

create policy rezervacije_insert on public.rezervacije
  for insert to authenticated
  with check (
    clan_id = auth.uid()
    and privatno.aktivan_clan()
    and status = 'nova'
    and exists (
      select 1 from public.knjige k
       where k.id = knjiga_id and k.u_fondu and k.spojena_sa_id is null
    )
  );

-- Prava pristupa
revoke all on public.utisci_sa_autorom from public, anon, authenticated;
grant select on public.utisci_sa_autorom to authenticated;

revoke all on function privatno.javno_ime(uuid) from public, anon;
grant execute on function privatno.javno_ime(uuid) to authenticated, service_role;
