-- 0014 — korica preuzeta sa linka: korice_izvor 'preuzeto', korice_poreklo, veća granica bucket-a.
--
-- Kontekst: bibliotekar može da zatraži da se slika korice sa stranice knjige (predlog iz
-- api/iz-linka.js) preuzme i sačuva u NAŠ Storage (api/korica-iz-linka.js, piše kao
-- service_role posle provere uloge). Slika se ne prikazuje sa tuđeg servera: u knjige.korice_url
-- ide naša javna adresa iz bucket-a „korice".
--
-- Šta ova migracija radi:
--  1. nova kolona knjige.korice_poreklo: adresa slike sa koje je korica uzeta (https, do 500
--     znakova). Služi za proveru porekla i ispravku; ne prikazuje se kao slika.
--  2. korice_izvor dobija vrednost 'preuzeto' (uz fond, google_books, open_library,
--     og_slika, fotografija).
--  3. okidač knjige_korice_biu (0009) čuva i korice_poreklo: poreklo ima smisla samo uz izvor
--     'preuzeto', mora biti https do 500 znakova, a izvor 'preuzeto' sme da postavi samo
--     bibliotekar, administrator ili servisna uloga (član ga ne može lažirati). Nevažeće se
--     postavlja na NULL, kao i nedozvoljena adresa u 0009 (upis knjige se ne odbija).
--  4. bucket „korice": najviše 1.5 MB (bilo 1 MB u 0013), jer server preuzima slike do 1.5 MB
--     i ne smanjuje ih. Tipovi ostaju jpeg, png, webp; čitanje javno.
--
-- Politike na storage.objects iz 0013 se NE menjaju: server piše kao service_role (zaobilazi
-- RLS, ali ne i ograničenja bucket-a), a pregledač bibliotekara i dalje piše preko politika.
-- Nova kolona je pokrivena postojećim politikama na tabeli knjige (RLS je već uključen; nema
-- nove tabele). 0013 mora da bude puštena pre ove migracije.
--
-- Može se pokrenuti više puta.
--
-- Ovo je NOVA migracija: 0001 do 0013 se ne menjaju.

-- 1. kolona
alter table public.knjige
  add column if not exists korice_poreklo text
    check (korice_poreklo is null
           or (length(korice_poreklo) <= 500 and korice_poreklo ~ '^https://[^[:space:][:cntrl:]]+$'));

comment on column public.knjige.korice_poreklo is
  'Adresa slike sa koje je korica preuzeta (korice_izvor = ''preuzeto''). Ne prikazuje se; korice_url je naša kopija u Storage-u.';

-- 2. dozvoljene vrednosti izvora korice (ograničenje iz 0001 se zamenjuje pod stalnim imenom)
do $$
declare
  c record;
begin
  for c in
    select conname
      from pg_constraint
     where conrelid = 'public.knjige'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) like '%korice_izvor%'
  loop
    execute format('alter table public.knjige drop constraint %I', c.conname);
  end loop;
end
$$;

alter table public.knjige
  add constraint knjige_korice_izvor_check
  check (korice_izvor in ('fond', 'google_books', 'open_library', 'og_slika', 'fotografija', 'preuzeto'));

-- 3. okidač
create or replace function privatno.knjige_korice()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
begin
  if privatno.servisna_uloga() then
    return new;
  end if;

  if new.korice_url is not null and not privatno.korice_dozvoljena(new.korice_url) then
    new.korice_url := null;
  end if;

  -- 'preuzeto' postavlja samo osoblje biblioteke (ili servis): član ne može da lažira poreklo.
  if new.korice_izvor = 'preuzeto' and not privatno.je_bibliotekar() then
    new.korice_url := null;
  end if;

  -- Izvor korice bez korice nema smisla.
  if new.korice_url is null then
    new.korice_izvor := null;
  end if;

  -- Poreklo ima smisla samo uz izvor 'preuzeto' i samo kao ispravan https.
  if new.korice_izvor is distinct from 'preuzeto'
     or new.korice_poreklo is null
     or length(new.korice_poreklo) > 500
     or new.korice_poreklo !~ '^https://[^[:space:][:cntrl:]]+$' then
    new.korice_poreklo := null;
  end if;

  return new;
end;
$fn$;

drop trigger if exists knjige_korice_biu on public.knjige;
create trigger knjige_korice_biu
  before insert or update of korice_url, korice_izvor, korice_poreklo on public.knjige
  for each row execute function privatno.knjige_korice();

-- 4. bucket
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('korice', 'korice', true, 1572864, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
   set public             = true,
       file_size_limit    = excluded.file_size_limit,
       allowed_mime_types = excluded.allowed_mime_types;
