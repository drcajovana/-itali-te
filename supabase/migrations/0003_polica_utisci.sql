-- 0003 — полица и утисци.

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
-- Полица
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

-- Своју полицу читалац види увек (план, тачка 4).
create policy polica_svoja on public.polica
  for all to authenticated
  using (clan_id = auth.uid())
  with check (clan_id = auth.uid() and public.aktivan_clan());

-- Туђу полицу види само ако у `veze` постоји прихваћен ред са оба члана.
create policy polica_povezani_select on public.polica
  for select to authenticated
  using (public.su_povezani(auth.uid(), clan_id));

-- Библиотекару треба увид ради извештаја за набавку (план, тачка 3, 5а).
create policy polica_bibliotekar_select on public.polica
  for select to authenticated
  using (public.je_bibliotekar());

-- ─────────────────────────────────────────────────────────────────────────────
-- Утисци
-- ─────────────────────────────────────────────────────────────────────────────

create table public.utisci (
  id                  uuid primary key default gen_random_uuid(),
  clan_id             uuid not null references public.clanovi(id) on delete cascade,
  knjiga_id           uuid not null references public.knjige(id) on delete cascade,
  -- Оцена 1–10, не звездице: разлика између 7 и 8 је битна (план, тачка 3).
  ocena               smallint check (ocena between 1 and 10),
  tekst               text,
  vidljivost          text not null default 'javno'
                        check (vidljivost in ('javno', 'prijatelji', 'samo_ja')),
  spojler             boolean not null default false,
  skriven             boolean not null default false,
  -- „Записано на пулту": библиотекар уноси утисак у име члана који није
  -- дигитално вешт (план, тачка 2). Утисак и даље припада члану.
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

-- Скривање је потез модерације: аутор не сме сам да откључа свој сакривени
-- утисак, нити да га сакрије па открије да би избегао преглед.
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

-- Свој утисак пише члан; библиотекар сме и у име члана — уз потпис у
-- uneo_bibliotekar_id, да се увек зна ко је куцао.
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
-- Просечна оцена по књизи
--
-- security_invoker: поглед се извршава са правима онога ко га чита, па га
-- политике изнад и даље штите. Без тога поглед заобилази RLS.
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
-- Права приступа
-- ─────────────────────────────────────────────────────────────────────────────

revoke all on public.polica       from anon;
revoke all on public.utisci       from anon;
revoke all on public.ocene_knjiga from anon;

grant select, insert, update, delete on public.polica to authenticated;
grant select, insert, update, delete on public.utisci to authenticated;
grant select on public.ocene_knjiga to authenticated;
