-- 0002 — veze pozivnicom i blokade.
--
-- Ovo je najosetljiviji deo (plan, tačka 5, korak 6). Pravilo: veza postoji tek
-- kad je druga strana prihvati, nema javnog spiska članova i nema pretrage po
-- imenu. Jedini način da se dođe do nekog jeste da ti on lično da svoju šifru.

-- ─────────────────────────────────────────────────────────────────────────────
-- Blokade
--
-- Blokirani ne sme ni da sazna da je blokiran (plan, tačka 3), pa nema
-- nijedne politike koja mu daje uvid u ovu tabelu.
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
-- Veze
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

-- Veza je neusmerena: ne sme da postoji i A→B i B→A.
create unique index veze_par_idx on public.veze (
  least(pozivalac_id, pozvani_id),
  greatest(pozivalac_id, pozvani_id)
);

create index veze_pozvani_idx on public.veze (pozvani_id) where status = 'na_cekanju';

-- ─────────────────────────────────────────────────────────────────────────────
-- su_povezani — jedno mesto na koje se oslanjaju sve ostale politike
--
-- Blokada poništava vezu i pre nego što je red u `veze` obrisan, zato je
-- provera blokade ovde a ne u pozivima.
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
-- Slanje i prihvatanje poziva
--
-- Idu kroz funkcije, a ne kroz INSERT iz aplikacije, jer član nema pravo da
-- čita tuđi red u `clanovi` — znači ne može ni da sazna pozvani_id. Tako se
-- usput onemogućava i probanje šifara unazad: jedini odgovor koji klijent
-- dobije jeste „šifra ne postoji“.
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
    raise exception 'Nalog nije aktivan';
  end if;

  select id into meta
    from public.clanovi
   where public.norm_sifra(sifra_poziva) = public.norm_sifra(sifra)
     and aktivan;

  if meta is null or meta = ja then
    raise exception 'Šifra poziva ne postoji';
  end if;

  -- Blokada se ne otkriva: isti tekst kao i za nepostojeću šifru.
  if exists (
    select 1 from public.blokade
     where (blokirao_id = meta and blokirani_id = ja)
        or (blokirao_id = ja   and blokirani_id = meta)
  ) then
    raise exception 'Šifra poziva ne postoji';
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
     and pozvani_id = ja           -- prihvata samo pozvana strana
     and status = 'na_cekanju';

  if not found then
    raise exception 'Poziv ne postoji ili je već rešen';
  end if;
end;
$fn$;

-- Raskidanje veze u svakom trenutku, bez obaveštenja drugoj strani
-- (plan, tačka 3). Bibliotekar sme da raskine vezu maloletnog člana.
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
    raise exception 'Veza ne postoji';
  end if;
end;
$fn$;

alter table public.veze enable row level security;

-- Svoje veze (pozvane i primljene) vidi svaka strana.
create policy veze_svoje_select on public.veze
  for select to authenticated
  using (pozivalac_id = auth.uid() or pozvani_id = auth.uid());

-- Bibliotekar ima uvid u veze radi zaštite maloletnih članova (plan, tačka 3).
create policy veze_bibliotekar_select on public.veze
  for select to authenticated
  using (public.je_bibliotekar());

-- Nema INSERT/UPDATE politike: veze se menjaju isključivo kroz funkcije iznad.
create policy veze_svoje_delete on public.veze
  for delete to authenticated
  using (pozivalac_id = auth.uid() or pozvani_id = auth.uid() or public.je_bibliotekar());

-- ─────────────────────────────────────────────────────────────────────────────
-- Prava pristupa
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
