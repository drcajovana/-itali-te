-- 0003 — polica i utisci.

create or replace function public.dodirni_izmenjeno()
returns trigger
language plpgsql
as $fn$
begin
  new.izmenjeno := now();
  return new;
end;
$fn$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Polica
-- ─────────────────────────────────────────────────────────────────────────────

create table public.polica (
  id            uuid primary key default gen_random_uuid(),
  clan_id       uuid not null references public.clanovi(id) on delete cascade,
  knjiga_id     uuid not null references public.knjige(id) on delete cascade,
  status        text not null check (status in ('citam', 'procitano', 'zelim')),
  datum_pocetka date,
  datum_kraja   date,
  izmenjeno     timestamptz not null default now(),

  unique (clan_id, knjiga_id),
  constraint polica_kraj_posle_pocetka
    check (datum_kraja is null or datum_pocetka is null or datum_kraja >= datum_pocetka)
);

create index polica_clan_idx   on public.polica (clan_id, status);
create index polica_knjiga_idx on public.polica (knjiga_id);

create trigger polica_izmenjeno_bu
  before update on public.polica
  for each row execute function public.dodirni_izmenjeno();

alter table public.polica enable row level security;

-- Svoju policu čitalac vidi uvek (plan, tačka 4).
create policy polica_svoja on public.polica
  for all to authenticated
  using (clan_id = auth.uid())
  with check (clan_id = auth.uid() and public.aktivan_clan());

-- Tuđu policu vidi samo ako u `veze` postoji prihvaćen red sa oba člana.
create policy polica_povezani_select on public.polica
  for select to authenticated
  using (public.su_povezani(auth.uid(), clan_id));

-- Bibliotekaru treba uvid radi izveštaja za nabavku (plan, tačka 3, 5a).
create policy polica_bibliotekar_select on public.polica
  for select to authenticated
  using (public.je_bibliotekar());

-- ─────────────────────────────────────────────────────────────────────────────
-- Utisci
-- ─────────────────────────────────────────────────────────────────────────────

create table public.utisci (
  id                  uuid primary key default gen_random_uuid(),
  clan_id             uuid not null references public.clanovi(id) on delete cascade,
  knjiga_id           uuid not null references public.knjige(id) on delete cascade,
  -- Ocena 1–10, ne zvezdice: razlika između 7 i 8 je bitna (plan, tačka 3).
  ocena               smallint check (ocena between 1 and 10),
  tekst               text,
  vidljivost          text not null default 'javno'
                        check (vidljivost in ('javno', 'prijatelji', 'samo_ja')),
  spojler             boolean not null default false,
  skriven             boolean not null default false,
  -- „Zapisano na pultu": bibliotekar unosi utisak u ime člana koji nije
  -- digitalno vešt (plan, tačka 2). Utisak i dalje pripada članu.
  uneo_bibliotekar_id uuid references public.clanovi(id) on delete set null,
  kreiran             timestamptz not null default now(),
  izmenjeno           timestamptz not null default now(),

  unique (clan_id, knjiga_id),
  constraint utisci_bar_nesto
    check (ocena is not null or nullif(btrim(coalesce(tekst, '')), '') is not null)
);

create index utisci_knjiga_idx on public.utisci (knjiga_id) where not skriven;
create index utisci_clan_idx   on public.utisci (clan_id);

create trigger utisci_izmenjeno_bu
  before update on public.utisci
  for each row execute function public.dodirni_izmenjeno();

-- Skrivanje je potez moderacije: autor ne sme sam da otključa svoj sakriveni
-- utisak, niti da ga sakrije pa otkrije da bi izbegao pregled.
create or replace function public.utisci_zastita()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if not public.je_bibliotekar() then
    new.skriven   := old.skriven;
    new.clan_id   := old.clan_id;
    new.knjiga_id := old.knjiga_id;
  end if;
  return new;
end;
$fn$;

create trigger utisci_zastita_bu
  before update on public.utisci
  for each row execute function public.utisci_zastita();

alter table public.utisci enable row level security;

create policy utisci_svoj_select on public.utisci
  for select to authenticated
  using (clan_id = auth.uid());

create policy utisci_javni_select on public.utisci
  for select to authenticated
  using (
    not skriven
    and public.aktivan_clan()
    and (
      vidljivost = 'javno'
      or (vidljivost = 'prijatelji' and public.su_povezani(auth.uid(), clan_id))
    )
  );

create policy utisci_bibliotekar_select on public.utisci
  for select to authenticated
  using (public.je_bibliotekar());

-- Svoj utisak piše član; bibliotekar sme i u ime člana — uz potpis u
-- uneo_bibliotekar_id, da se uvek zna ko je kucao.
create policy utisci_insert on public.utisci
  for insert to authenticated
  with check (
    (clan_id = auth.uid() and public.aktivan_clan())
    or (public.je_bibliotekar() and uneo_bibliotekar_id = auth.uid())
  );

create policy utisci_svoj_update on public.utisci
  for update to authenticated
  using (clan_id = auth.uid())
  with check (clan_id = auth.uid());

create policy utisci_bibliotekar_update on public.utisci
  for update to authenticated
  using (public.je_bibliotekar())
  with check (public.je_bibliotekar());

create policy utisci_delete on public.utisci
  for delete to authenticated
  using (clan_id = auth.uid() or public.je_bibliotekar());

-- ─────────────────────────────────────────────────────────────────────────────
-- Prosečna ocena po knjizi
--
-- security_invoker: pogled se izvršava sa pravima onoga ko ga čita, pa ga
-- politike iznad i dalje štite. Bez toga pogled zaobilazi RLS.
-- ─────────────────────────────────────────────────────────────────────────────

create view public.ocene_knjiga
with (security_invoker = true)
as
select
  knjiga_id,
  round(avg(ocena)::numeric, 1) as prosecna_ocena,
  count(ocena)                  as broj_ocena,
  count(*)                      as broj_utisaka
from public.utisci
where not skriven
group by knjiga_id;

-- ─────────────────────────────────────────────────────────────────────────────
-- Prava pristupa
-- ─────────────────────────────────────────────────────────────────────────────

revoke all on public.polica       from anon;
revoke all on public.utisci       from anon;
revoke all on public.ocene_knjiga from anon;

grant select, insert, update, delete on public.polica to authenticated;
grant select, insert, update, delete on public.utisci to authenticated;
grant select on public.ocene_knjiga to authenticated;
