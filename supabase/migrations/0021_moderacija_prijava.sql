-- 0021 — moderacija prijava: ekran „Пријаве" za bibliotekare i zaštita same tabele prijava.
--
-- Do sada je tabela prijave (0004) imala samo politike: član podnosi, bibliotekar čita i menja. Ekran
-- za bibliotekare traži još tri stvari koje politika ne može da kaže (politika zna „smeš li ovaj red",
-- ne i „smeš li ovu vrednost"), pa sve ide kroz okidače, kao u 0020:
--
--   1. Šta bibliotekar sme da menja. Politika prijave_bibliotekar_update dozvoljava izmenu CELOG reda,
--      pa bi bibliotekar mogao da prepravi ko je prijavio, šta je prijavljeno, razlog i datum. Okidač
--      prijave_zastita_bu to vraća na staro: menjaju se samo resena i beleska. Ko je rešio i kada
--      postavlja baza (auth.uid() i sat baze), ne klijent. Prijava može i da se vrati među nerešene
--      (tada se skidaju resio_id i datum; beleška ostaje).
--
--   2. Šta sme da se prijavi. Do sada je član mogao da upiše bilo koji id kao „stavku" prijave, a
--      bibliotekar po politici preporuke_prijavljene_select (0005) vidi baš prijavljene preporuke, pa
--      je prijava bila put do tuđe prepiske. Okidač prijave_provera_bi (BEFORE INSERT) zato proverava,
--      pod pravima onoga ko prijavljuje (RLS važi, nije SECURITY DEFINER):
--        - 'utisak':    utisak koji prijavilac sme da vidi i koji nije njegov;
--        - 'preporuka': preporuka koju je prijavilac PRIMIO;
--        - 'clan':      član sa kojim je prijavilac povezan (ekran prijave člana je samo na profilu
--                       povezanog čitaoca), različit od prijavioca.
--      Nova prijava je uvek nerešena (resena, resio_id, beleska i datum se ne mogu podneti unapred).
--      Ako prijavio_id nije auth.uid(), okidač ne odlučuje: odbija je postojeća politika (prijave_insert),
--      kao i do sada. Servisna uloga je izuzeta.
--
--   3. Dužine: razlog do 300 znakova (isto kao ekran), beleska bibliotekara do 500. Ograničenja su
--      NOT VALID: ne diraju redove koji već postoje, važe za nove i izmenjene.
--
-- Nova kolona resena_datum. Nema novih tabela ni politika: nijedna politika se ne dodaje, ne briše ni
-- ne menja. Prijavljeni član i dalje ne vidi prijave (nema politike za njega).
--
-- Idempotentna: može da se pusti proizvoljno puta. Ovo je NOVA migracija: 0001 do 0020 se ne menjaju.
--
-- Posle puštanja: notify pgrst, 'reload schema';  (da PostgREST vidi novu kolonu)

alter table public.prijave add column if not exists resena_datum timestamptz;

comment on column public.prijave.resena_datum is
  'Kad je prijava označena kao rešena (postavlja okidač; prazno dok je nerešena).';

alter table public.prijave drop constraint if exists prijave_razlog_duzina;
alter table public.prijave
  add constraint prijave_razlog_duzina
  check (razlog is null or char_length(razlog) <= 300) not valid;

alter table public.prijave drop constraint if exists prijave_beleska_duzina;
alter table public.prijave
  add constraint prijave_beleska_duzina
  check (beleska is null or char_length(beleska) <= 500) not valid;

create index if not exists prijave_resene_idx on public.prijave (resena_datum desc) where resena;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Izmena: samo resena i beleska
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function privatno.prijave_zastita()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
begin
  if privatno.servisna_uloga() then
    return new;
  end if;

  -- šta je prijavljeno, ko je prijavio, razlog i vreme prijave se ne menjaju
  new.prijavio_id := old.prijavio_id;
  new.tip         := old.tip;
  new.stavka_id   := old.stavka_id;
  new.razlog      := old.razlog;
  new.kreirana    := old.kreirana;
  new.beleska     := nullif(btrim(new.beleska), '');

  if new.resena then
    if old.resena then
      -- već rešena: ostaje ko ju je rešio i kada (može samo da se dopuni beleška)
      new.resio_id     := old.resio_id;
      new.resena_datum := old.resena_datum;
    else
      new.resio_id     := auth.uid();
      new.resena_datum := now();
    end if;
  else
    new.resio_id     := null;
    new.resena_datum := null;
  end if;
  return new;
end;
$fn$;

drop trigger if exists prijave_zastita_bu on public.prijave;
create trigger prijave_zastita_bu
  before update on public.prijave
  for each row execute function privatno.prijave_zastita();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Upis: prijavljuje se samo ono što prijavilac sme da vidi
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function privatno.prijave_provera_bi()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
begin
  if privatno.servisna_uloga() then
    return new;
  end if;

  -- prijava u tuđe ime: to odbija politika prijave_insert, ne ovaj okidač
  if new.prijavio_id is distinct from auth.uid() then
    return new;
  end if;

  new.resena       := false;
  new.resio_id     := null;
  new.resena_datum := null;
  new.beleska      := null;

  -- Upiti ispod rade sa pravima prijavioca (okidač nije SECURITY DEFINER): RLS važi, pa se
  -- „vidi" znači baš ono što taj član vidi.
  if new.tip = 'utisak' then
    if not exists (select 1 from public.utisci u where u.id = new.stavka_id and u.clan_id <> new.prijavio_id) then
      raise exception 'Ova stavka ne može da se prijavi' using errcode = '22023';
    end if;
  elsif new.tip = 'preporuka' then
    if not exists (select 1 from public.preporuke p where p.id = new.stavka_id and p.primalac_id = new.prijavio_id) then
      raise exception 'Ova stavka ne može da se prijavi' using errcode = '22023';
    end if;
  elsif new.tip = 'clan' then
    if not privatno.su_povezani(new.prijavio_id, new.stavka_id) then
      raise exception 'Ova stavka ne može da se prijavi' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$fn$;

drop trigger if exists prijave_provera_bi on public.prijave;
create trigger prijave_provera_bi
  before insert on public.prijave
  for each row execute function privatno.prijave_provera_bi();

-- Prava: nove funkcije u privatno (ponavlja se kao u svakoj migraciji)
revoke all on all functions in schema privatno from public, anon;
grant execute on all functions in schema privatno to authenticated, service_role;

notify pgrst, 'reload schema';
