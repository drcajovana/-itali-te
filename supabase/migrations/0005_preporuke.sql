-- 0004 — директне препоруке између повезаних читалаца.
--
-- Нема слободног дописивања (план, тачка 3): порука увек виси о конкретној
-- књизи. Или је препорука, или одговор на препоруку.

create table public.preporuke (
  id            uuid primary key default gen_random_uuid(),
  posiljalac_id uuid not null references public.clanovi(id) on delete cascade,
  primalac_id   uuid not null references public.clanovi(id) on delete cascade,
  knjiga_id     uuid not null references public.knjige(id) on delete cascade,
  poruka        text,
  procitana     boolean not null default false,
  odgovor       text,
  skrivena      boolean not null default false,
  kreirana      timestamptz not null default now(),

  constraint preporuke_ne_salje_sebi check (posiljalac_id <> primalac_id)
);

create index preporuke_primalac_idx  on public.preporuke (primalac_id, kreirana desc);
create index preporuke_posiljalac_idx on public.preporuke (posiljalac_id, kreirana desc);

-- Пошиљалац не мења препоруку пошто је послата, нити прима одговор у своје име.
create or replace function public.preporuke_zastita()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  if public.je_bibliotekar() then
    return new;
  end if;

  new.posiljalac_id := old.posiljalac_id;
  new.primalac_id   := old.primalac_id;
  new.knjiga_id     := old.knjiga_id;
  new.poruka        := old.poruka;
  new.skrivena      := old.skrivena;
  return new;
end;
$fn$;

create trigger preporuke_zastita_bu
  before update on public.preporuke
  for each row execute function public.preporuke_zastita();

alter table public.preporuke enable row level security;

-- Препоруке види само пошиљалац и прималац (план, тачка 4).
create policy preporuke_ucesnici_select on public.preporuke
  for select to authenticated
  using (posiljalac_id = auth.uid() or primalac_id = auth.uid());

-- Изузетак: библиотекар види само ону препоруку која је пријављена. Модерација
-- не сме да значи увид у сву преписку.
create policy preporuke_prijavljene_select on public.preporuke
  for select to authenticated
  using (
    public.je_bibliotekar()
    and exists (
      select 1 from public.prijave p
       where p.tip = 'preporuka' and p.stavka_id = preporuke.id
    )
  );

-- Кључно правило: препорука се може уписати само ако веза постоји.
-- Провера стоји у политици, не у апликацији (план, тачка 4).
create policy preporuke_insert on public.preporuke
  for insert to authenticated
  with check (
    posiljalac_id = auth.uid()
    and public.aktivan_clan()
    and public.su_povezani(auth.uid(), primalac_id)
  );

-- Прималац означава прочитано и уписује одговор; триггер изнад чува остало.
create policy preporuke_primalac_update on public.preporuke
  for update to authenticated
  using (primalac_id = auth.uid())
  with check (primalac_id = auth.uid());

create policy preporuke_bibliotekar_update on public.preporuke
  for update to authenticated
  using (public.je_bibliotekar())
  with check (public.je_bibliotekar());

create policy preporuke_delete on public.preporuke
  for delete to authenticated
  using (posiljalac_id = auth.uid() or public.je_bibliotekar());

revoke all on public.preporuke from anon;
grant select, insert, update, delete on public.preporuke to authenticated;
