-- 0019 — ekran „Читаоци": nadimak povezanih čitalaca, preporuke i prijava člana.
--
-- Šta ekran ne može bez baze:
--
--  1. Nadimak drugog člana. `clanovi` vide samo sam član i bibliotekari (nema spiska članova),
--     pa se nadimak povezanog čitaoca, ni nadimak pošiljaoca poziva, ne može dobiti spajanjem.
--     Pogled `moje_veze` (security_invoker) vraća SAMO MOJE veze (pozive koje sam poslao,
--     primio i prihvaćene), a uz svaku samo nadimak druge strane preko privatno.javno_ime().
--     Pravo ime, broj karte i šifra poziva se ne vide. Veza sa blokadom (u bilo kom smeru) se
--     uopšte ne pokazuje, ni jednoj strani: blokirani ne sazna za blokadu, a blokiranom poziv
--     jednostavno nestaje, kao da je odbijen.
--
--  2. Primljene preporuke sa nadimkom pošiljaoca. Pogled `moje_preporuke` (security_invoker)
--     vraća samo preporuke upućene meni, ne skrivene (moderacija), ne od blokiranog člana. Nadimak
--     pošiljaoca se pokazuje samo dok smo još povezani; posle raskida je prazan (ekran piše
--     „Читалац"). Ne vraća id pošiljaoca.
--
--  3. Prijava člana. Prijava je do sada mogla da se podnese samo za preporuku ili utisak
--     (prijave.tip). Dodaje se tip 'clan': stavka_id je tada id prijavljenog člana. Prijavljeni
--     ne vidi prijave (politike se ne menjaju).
--
--  4. Preporuka: napomena najviše 280 znakova (do sada bez ograničenja) i najviše jedna
--     neobrađena preporuka iste knjige od istog pošiljaoca istom primaocu (da se ne sipa isto).
--
-- Šta se NE menja: RLS na clanovi, veze, blokade, preporuke, prijave i polica ostaje isti (nijedna
-- politika se ne dodaje, ne briše ni ne menja). Nema novih tabela. Pogledi i funkcija imaju
-- eksplicitna prava. Na „procitana" kod preporuke ostaje značenje „primalac je odlučio" (želim,
-- već pročitano, nije za mene); skrivena je i dalje samo potez moderacije.
--
-- Idempotentno: može da se pusti proizvoljno puta. Ovo je NOVA migracija: 0001 do 0018 se ne
-- menjaju.
--
-- Posle puštanja: notify pgrst, 'reload schema';  (da PostgREST vidi nove poglede)

-- 1. blokada u bilo kom smeru (SECURITY DEFINER samo da bi pročitala blokade druge strane)
create or replace function privatno.ima_blokade(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  select exists (
    select 1 from public.blokade bl
     where (bl.blokirao_id = a and bl.blokirani_id = b)
        or (bl.blokirao_id = b and bl.blokirani_id = a)
  );
$fn$;

-- 2. moje veze i pozivi
create or replace view public.moje_veze
with (security_invoker = true)
as
select
  v.id,
  case when v.pozivalac_id = auth.uid() then v.pozvani_id else v.pozivalac_id end as clan_id,
  case when v.pozivalac_id = auth.uid() then 'poslat' else 'primljen' end as smer,
  v.status,
  v.kreirana,
  v.potvrdjena,
  privatno.javno_ime(case when v.pozivalac_id = auth.uid() then v.pozvani_id else v.pozivalac_id end) as nadimak
from public.veze v
where (v.pozivalac_id = auth.uid() or v.pozvani_id = auth.uid())
  and not privatno.ima_blokade(v.pozivalac_id, v.pozvani_id);

comment on view public.moje_veze is
  'Samo moje veze i pozivi, sa nadimkom druge strane. Bez blokiranih. security_invoker: veze_svoje_select važi; ovde je i bibliotekar ograničen na svoje.';

-- 3. primljene preporuke
create or replace view public.moje_preporuke
with (security_invoker = true)
as
select
  p.id,
  p.knjiga_id,
  p.poruka,
  p.procitana,
  p.kreirana,
  case when privatno.su_povezani(auth.uid(), p.posiljalac_id) then privatno.javno_ime(p.posiljalac_id) end as posiljalac_nadimak
from public.preporuke p
where p.primalac_id = auth.uid()
  and not p.skrivena
  and not privatno.ima_blokade(p.posiljalac_id, p.primalac_id);

comment on view public.moje_preporuke is
  'Preporuke upućene meni, sa nadimkom pošiljaoca dok smo povezani. Bez skrivenih i bez blokiranih.';

-- 4. prijava člana: tip 'clan' (ograničenje na tip se menja, ma kako se zvalo)
do $do$
declare
  c record;
begin
  for c in
    select conname
      from pg_constraint
     where conrelid = 'public.prijave'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) like '%tip%'
  loop
    execute format('alter table public.prijave drop constraint %I', c.conname);
  end loop;
end
$do$;

alter table public.prijave
  add constraint prijave_tip_check check (tip in ('preporuka', 'utisak', 'clan'));

-- 5. preporuka: napomena do 280 znakova, jedna neobrađena iste knjige po paru
alter table public.preporuke drop constraint if exists preporuke_poruka_duzina;
alter table public.preporuke
  add constraint preporuke_poruka_duzina check (poruka is null or char_length(poruka) <= 280);

create unique index if not exists preporuke_otvorena_idx
  on public.preporuke (posiljalac_id, primalac_id, knjiga_id)
  where not procitana;

-- Prava pristupa
revoke all on public.moje_veze from public, anon, authenticated;
revoke all on public.moje_preporuke from public, anon, authenticated;
grant select on public.moje_veze to authenticated;
grant select on public.moje_preporuke to authenticated;

revoke all on function privatno.ima_blokade(uuid, uuid) from public, anon;
grant execute on function privatno.ima_blokade(uuid, uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
