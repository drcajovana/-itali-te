-- 0002 — везе позивницом и блокаде.
--
-- Ово је најосетљивији део (план, тачка 5, корак 6). Правило: веза постоји тек
-- кад је друга страна прихвати, нема јавног списка чланова и нема претраге по
-- имену. Једини начин да се дође до неког јесте да ти он лично да своју шифру.

-- ─────────────────────────────────────────────────────────────────────────────
-- Блокаде
--
-- Блокирани не сме ни да сазна да је блокиран (план, тачка 3), па нема
-- ниједне политике која му даје увид у ову табелу.
-- ─────────────────────────────────────────────────────────────────────────────

create table public.blokade (
  id           uuid primary key default gen_random_uuid(),
  blokirao_id  uuid not null references public.clanovi(id) on delete cascade,
  blokirani_id uuid not null references public.clanovi(id) on delete cascade,
  kreirana     timestamptz not null default now(),

  unique (blokirao_id, blokirani_id),
  constraint blokade_ne_blokira_sebe check (blokirao_id <> blokirani_id)
);

create index blokade_blokirani_idx on public.blokade (blokirani_id);

alter table public.blokade enable row level security;

create policy blokade_svoje on public.blokade
  for all to authenticated
  using (blokirao_id = auth.uid())
  with check (blokirao_id = auth.uid() and public.aktivan_clan());

create policy blokade_bibliotekar_select on public.blokade
  for select to authenticated
  using (public.je_bibliotekar());

-- ─────────────────────────────────────────────────────────────────────────────
-- Везе
-- ─────────────────────────────────────────────────────────────────────────────

create table public.veze (
  id           uuid primary key default gen_random_uuid(),
  pozivalac_id uuid not null references public.clanovi(id) on delete cascade,
  pozvani_id   uuid not null references public.clanovi(id) on delete cascade,
  status       text not null default 'na_cekanju'
                 check (status in ('na_cekanju', 'prihvacena')),
  kreirana     timestamptz not null default now(),
  potvrdjena   timestamptz,

  constraint veze_ne_zove_sebe check (pozivalac_id <> pozvani_id)
);

-- Веза је неусмерена: не сме да постоји и A→B и B→A.
create unique index veze_par_idx on public.veze (
  least(pozivalac_id, pozvani_id),
  greatest(pozivalac_id, pozvani_id)
);

create index veze_pozvani_idx on public.veze (pozvani_id) where status = 'na_cekanju';

-- ─────────────────────────────────────────────────────────────────────────────
-- su_povezani — једно место на које се ослањају све остале политике
--
-- Блокада поништава везу и пре него што је ред у `veze` обрисан, зато је
-- провера блокаде овде а не у позивима.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.su_povezani(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select
    a is not null
    and b is not null
    and a <> b
    and exists (
      select 1 from public.veze v
       where v.status = 'prihvacena'
         and ((v.pozivalac_id = a and v.pozvani_id = b)
           or (v.pozivalac_id = b and v.pozvani_id = a))
    )
    and not exists (
      select 1 from public.blokade bl
       where (bl.blokirao_id = a and bl.blokirani_id = b)
          or (bl.blokirao_id = b and bl.blokirani_id = a)
    );
$fn$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Слање и прихватање позива
--
-- Иду кроз функције, а не кроз INSERT из апликације, јер члан нема право да
-- чита туђи ред у `clanovi` — значи не може ни да сазна pozvani_id. Тако се
-- успут онемогућава и пробање шифара уназад: једини одговор који клијент
-- добије јесте „шифра не постоји“.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.posalji_poziv(sifra text)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  ja      uuid := auth.uid();
  meta    uuid;
  veza_id uuid;
begin
  if ja is null or not exists (select 1 from public.clanovi where id = ja and aktivan) then
    raise exception 'Налог није активан';
  end if;

  select id into meta
    from public.clanovi
   where public.norm_sifra(sifra_poziva) = public.norm_sifra(sifra)
     and aktivan;

  if meta is null or meta = ja then
    raise exception 'Шифра позива не постоји';
  end if;

  -- Блокада се не открива: исти текст као и за непостојећу шифру.
  if exists (
    select 1 from public.blokade
     where (blokirao_id = meta and blokirani_id = ja)
        or (blokirao_id = ja   and blokirani_id = meta)
  ) then
    raise exception 'Шифра позива не постоји';
  end if;

  insert into public.veze (pozivalac_id, pozvani_id)
  values (ja, meta)
  on conflict do nothing
  returning id into veza_id;

  if veza_id is null then
    select id into veza_id
      from public.veze
     where least(pozivalac_id, pozvani_id)    = least(ja, meta)
       and greatest(pozivalac_id, pozvani_id) = greatest(ja, meta);
  end if;

  return veza_id;
end;
$fn$;

create or replace function public.prihvati_poziv(veza uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  ja uuid := auth.uid();
begin
  update public.veze
     set status = 'prihvacena',
         potvrdjena = now()
   where id = veza
     and pozvani_id = ja           -- прихвата само позвана страна
     and status = 'na_cekanju';

  if not found then
    raise exception 'Позив не постоји или је већ решен';
  end if;
end;
$fn$;

-- Раскидање везе у сваком тренутку, без обавештења другој страни
-- (план, тачка 3). Библиотекар сме да раскине везу малолетног члана.
create or replace function public.raskini_vezu(veza uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
declare
  ja uuid := auth.uid();
begin
  delete from public.veze
   where id = veza
     and (pozivalac_id = ja or pozvani_id = ja or public.je_bibliotekar());

  if not found then
    raise exception 'Веза не постоји';
  end if;
end;
$fn$;

alter table public.veze enable row level security;

-- Своје везе (позване и примљене) види свака страна.
create policy veze_svoje_select on public.veze
  for select to authenticated
  using (pozivalac_id = auth.uid() or pozvani_id = auth.uid());

-- Библиотекар има увид у везе ради заштите малолетних чланова (план, тачка 3).
create policy veze_bibliotekar_select on public.veze
  for select to authenticated
  using (public.je_bibliotekar());

-- Нема INSERT/UPDATE политике: везе се мењају искључиво кроз функције изнад.
create policy veze_svoje_delete on public.veze
  for delete to authenticated
  using (pozivalac_id = auth.uid() or pozvani_id = auth.uid() or public.je_bibliotekar());

-- ─────────────────────────────────────────────────────────────────────────────
-- Права приступа
-- ─────────────────────────────────────────────────────────────────────────────

revoke all on public.veze    from anon;
revoke all on public.blokade from anon;

grant select, delete on public.veze to authenticated;
grant select, insert, delete on public.blokade to authenticated;

revoke all on function public.su_povezani(uuid, uuid) from public, anon;
revoke all on function public.posalji_poziv(text)     from public, anon;
revoke all on function public.prihvati_poziv(uuid)    from public, anon;
revoke all on function public.raskini_vezu(uuid)      from public, anon;

grant execute on function public.su_povezani(uuid, uuid) to authenticated;
grant execute on function public.posalji_poziv(text)     to authenticated;
grant execute on function public.prihvati_poziv(uuid)    to authenticated;
grant execute on function public.raskini_vezu(uuid)      to authenticated;
