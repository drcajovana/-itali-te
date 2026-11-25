-- 0030 — „Све књиге": filter po žanru, žanrovi u listi i spisak žanrova sa brojem knjiga.
--
-- Proširuje funkcije iz 0024, 0025 i 0027 (one se ne menjaju; već su primenjene u bazi). Kolona knjige.zanrovi (text[]) postoji od 0001;
-- uvoz fonda je popunjava iz UDK-a (docs/uvoz-fonda.md). Menjaju se potpisi funkcija, pa se stare verzije prvo brišu (inače bi poziv sa
-- starim brojem parametara bio dvosmislen), a nove dobijaju ista prava:
--
--   1. privatno.pregled_knjige_filter(p_upit, p_izvor, p_odluka, p_korica, p_zanr)   zajednički filter; p_zanr je novi poslednji
--      parametar (tačan naziv žanra, '__bez__' = knjige bez žanra, prazno = bez filtera). Jedino mesto gde se filteri pretvaraju u skup
--      knjiga, pa lista, spisak izdavača i spisak žanrova ne mogu da se razilaze.
--   2. public.pregled_knjiga(..., p_izdavac, p_korica, p_zanr)                       lista; novi poslednji parametar p_zanr i nova
--      izlazna kolona zanrovi (text[]).
--   3. public.pregled_knjiga_izdavaci(p_upit, p_izvor, p_odluka, p_korica, p_zanr)   spisak izdavača prati i filter žanra.
--   4. public.pregled_knjiga_zanrovi(p_upit, p_izvor, p_odluka, p_korica, p_izdavac) NOVO: spisak žanrova (kljuc, naziv, broj) po ostalim
--      aktivnim filterima (i po izabranom izdavaču, ne po izabranom žanru); '__bez__' je knjige bez žanra, uvek poslednje.
--
-- Žanr se poredi tačno (kako je upisan; uvoz i ručni unos čuvaju isti naziv). Knjiga sa više žanrova se broji u svakom svom žanru, pa zbir
-- brojeva u spisku može biti veći od broja knjiga.
--
-- PRIVATNOST. Režim je isti kao u 0024, 0025 i 0027: SECURITY DEFINER sa search_path, provera privatno.je_bibliotekar() u telu (ostali
-- dobijaju prazan odgovor, bez greške), anon nema pravo. Nijedna kolona ne vodi do člana (nema uneo_id, id-eva, imena, broja karte).
--
-- Nema novih tabela, kolona ni politika. Idempotentna. Ovo je NOVA migracija: 0001 do 0029 se ne menjaju.
--
-- Posle puštanja: notify pgrst, 'reload schema';  (da PostgREST vidi nove potpise)

-- 1. zajednički filter (pretraga, izvor, odluka, korica, žanr)
drop function if exists privatno.pregled_knjige_filter(text, text, text, text);

create or replace function privatno.pregled_knjige_filter(p_upit text, p_izvor text, p_odluka text, p_korica text default null, p_zanr text default null)
returns table (id uuid)
language plpgsql
stable
set search_path = pg_catalog, public
as $fn$
#variable_conflict use_column
declare
  v_tekst  text;
  v_cifre  text;
  v_izvor  text := nullif(btrim(p_izvor), '');
  v_odluka text := nullif(btrim(p_odluka), '');
  v_korica text := nullif(btrim(p_korica), '');
  v_zanr   text := nullif(btrim(p_zanr), '');
begin
  if v_izvor is not null and v_izvor not in ('fond', 'link', 'google_books', 'clan') then
    raise exception 'Nepoznat izvor' using errcode = '22023';
  end if;
  if v_odluka is not null and v_odluka not in ('imamo', 'nabavljamo', 'ne_nabavljamo', 'bez') then
    raise exception 'Nepoznata odluka' using errcode = '22023';
  end if;
  if v_korica is not null and v_korica not in ('bez', 'sa') then
    raise exception 'Nepoznat filter korice' using errcode = '22023';
  end if;

  -- džokeri iz upita postaju razmaci (kao u trazi_knjige), pa upit od samih džokera ne vraća sve
  v_tekst := btrim(translate(privatno.norm_tekst(btrim(coalesce(p_upit, ''))), '%_', '  '));
  v_cifre := regexp_replace(coalesce(p_upit, ''), '[^0-9Xx]', '', 'g');

  return query
    select k.id
      from public.knjige k
     where k.spojena_sa_id is null
       and (v_izvor is null or k.izvor = v_izvor)
       and (v_odluka is null
            or (v_odluka = 'bez' and coalesce(k.odluka_nabavke, case when k.u_fondu then 'imamo' end) is null)
            or coalesce(k.odluka_nabavke, case when k.u_fondu then 'imamo' end) = v_odluka)
       and (v_korica is null
            or (v_korica = 'bez' and coalesce(btrim(k.korice_url), '') = '')
            or (v_korica = 'sa' and coalesce(btrim(k.korice_url), '') <> ''))
       and (v_zanr is null
            or (v_zanr = '__bez__' and not exists (select 1 from unnest(k.zanrovi) as z where btrim(z) <> ''))
            or (v_zanr <> '__bez__' and exists (select 1 from unnest(k.zanrovi) as z where btrim(z) = v_zanr)))
       and (v_tekst = ''
            -- svaka reč iz upita mora da stoji u naslovu ili autoru
            or not exists (
                 select 1 from string_to_table(v_tekst, ' ') as r(rec)
                  where r.rec <> ''
                    and privatno.norm_tekst(coalesce(k.naslov, '') || ' ' || coalesce(k.autor, '')) not like '%' || r.rec || '%'
               )
            -- ili ISBN (cifre iz upita, bez crtica), delimično ili ceo
            or (length(v_cifre) >= 4 and k.isbn like '%' || upper(v_cifre) || '%'));
end;
$fn$;

-- 2. lista knjiga (novi potpis: stara verzija sa osam parametara se briše; nova izlazna kolona zanrovi)
drop function if exists public.pregled_knjiga(text, text, text, text, integer, integer, text, text);

create or replace function public.pregled_knjiga(
  p_upit     text    default null,
  p_izvor    text    default null,
  p_odluka   text    default null,
  p_redosled text    default 'najnovije',
  p_najvise  integer default 50,
  p_pomeraj  integer default 0,
  p_izdavac  text    default null,
  p_korica   text    default null,
  p_zanr     text    default null
)
returns table (
  id           uuid,
  naslov       text,
  autor        text,
  izdavac      text,
  godina       smallint,
  isbn         text,
  korice_url   text,
  korice_izvor text,
  izvor        text,
  kreirana     timestamptz,
  odluka       text,
  citaoca      integer,
  zanrovi      text[],
  ukupno       bigint
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $fn$
#variable_conflict use_column
declare
  v_izd text := nullif(btrim(p_izdavac), '');
  v_red text := coalesce(nullif(btrim(p_redosled), ''), 'najnovije');
begin
  if not privatno.je_bibliotekar() then
    return;
  end if;

  if v_red not in ('najnovije', 'citaoca', 'naslov') then
    raise exception 'Nepoznat redosled' using errcode = '22023';
  end if;

  return query
    select k.id, k.naslov, k.autor, k.izdavac, k.godina, k.isbn, k.korice_url, k.korice_izvor,
           k.izvor, k.kreirana,
           coalesce(k.odluka_nabavke, case when k.u_fondu then 'imamo' end),
           coalesce(b.n, 0),
           k.zanrovi,
           count(*) over ()
      from privatno.pregled_knjige_filter(p_upit, p_izvor, p_odluka, p_korica, p_zanr) f
      join public.knjige k on k.id = f.id
      left join (
        select p.knjiga_id, count(*)::integer as n
          from public.polica p
          join public.clanovi c on c.id = p.clan_id and c.aktivan
         group by p.knjiga_id
      ) b on b.knjiga_id = k.id
     where (v_izd is null
            or (v_izd = '__bez__' and nullif(privatno.norm_tekst(btrim(coalesce(k.izdavac, ''))), '') is null)
            or privatno.norm_tekst(btrim(coalesce(k.izdavac, ''))) = v_izd)
     order by (case when v_red = 'citaoca' then coalesce(b.n, 0) end) desc nulls last,
              (case when v_red = 'naslov' then privatno.norm_tekst(k.naslov) end) asc nulls last,
              k.kreirana desc,
              k.id
     limit least(greatest(coalesce(p_najvise, 50), 1), 100)
    offset greatest(coalesce(p_pomeraj, 0), 0);
end;
$fn$;

-- 3. spisak izdavača sa brojem knjiga (novi potpis: stara verzija sa četiri parametra se briše)
drop function if exists public.pregled_knjiga_izdavaci(text, text, text, text);

create or replace function public.pregled_knjiga_izdavaci(
  p_upit   text default null,
  p_izvor  text default null,
  p_odluka text default null,
  p_korica text default null,
  p_zanr   text default null
)
returns table (
  kljuc text,
  naziv text,
  broj  integer
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $fn$
#variable_conflict use_column
begin
  if not privatno.je_bibliotekar() then
    return;
  end if;

  return query
    with nazivi as (
      -- najčešći zapis u grupi, nad svim matičnim knjigama (naziv ne zavisi od filtera)
      select distinct on (z.kljuc) z.kljuc, z.zapis
        from (
          select nullif(privatno.norm_tekst(btrim(coalesce(k.izdavac, ''))), '') as kljuc,
                 btrim(k.izdavac) as zapis,
                 count(*) as n
            from public.knjige k
           where k.spojena_sa_id is null
           group by 1, 2
        ) z
       where z.kljuc is not null
       order by z.kljuc, z.n desc, z.zapis
    ),
    brojevi as (
      select nullif(privatno.norm_tekst(btrim(coalesce(k.izdavac, ''))), '') as kljuc,
             count(*)::integer as broj
        from privatno.pregled_knjige_filter(p_upit, p_izvor, p_odluka, p_korica, p_zanr) f
        join public.knjige k on k.id = f.id
       group by 1
    )
    select coalesce(b.kljuc, '__bez__'), n.zapis, b.broj
      from brojevi b
      left join nazivi n on n.kljuc = b.kljuc
     order by (b.kljuc is null), b.broj desc, n.zapis;
end;
$fn$;

-- 4. spisak žanrova sa brojem knjiga (nova funkcija); „__bez__" su knjige bez žanra
create or replace function public.pregled_knjiga_zanrovi(
  p_upit    text default null,
  p_izvor   text default null,
  p_odluka  text default null,
  p_korica  text default null,
  p_izdavac text default null
)
returns table (
  kljuc text,
  naziv text,
  broj  integer
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $fn$
#variable_conflict use_column
declare
  v_izd text := nullif(btrim(p_izdavac), '');
begin
  if not privatno.je_bibliotekar() then
    return;
  end if;

  return query
    with osnova as (
      select k.id, k.zanrovi
        from privatno.pregled_knjige_filter(p_upit, p_izvor, p_odluka, p_korica) f
        join public.knjige k on k.id = f.id
       where (v_izd is null
              or (v_izd = '__bez__' and nullif(privatno.norm_tekst(btrim(coalesce(k.izdavac, ''))), '') is null)
              or privatno.norm_tekst(btrim(coalesce(k.izdavac, ''))) = v_izd)
    ),
    po_zanru as (
      -- knjiga se broji jednom u svakom svom žanru
      select t.zanr, count(*)::integer as broj
        from (select distinct o.id, btrim(x) as zanr
                from osnova o, unnest(o.zanrovi) as x
               where btrim(x) <> '') t
       group by t.zanr
    ),
    bez_zanra as (
      select count(*)::integer as broj
        from osnova o
       where not exists (select 1 from unnest(o.zanrovi) as x where btrim(x) <> '')
    )
    select s.kljuc, s.naziv, s.broj
      from (
        select p.zanr as kljuc, p.zanr as naziv, p.broj, false as bez from po_zanru p
        union all
        select '__bez__', null::text, bz.broj, true from bez_zanra bz where bz.broj > 0
      ) s
     order by s.bez, s.broj desc, s.naziv;
end;
$fn$;

-- prava (posle brisanja stare verzije nova nema nikakva; ponavlja se za sve nove potpise)
revoke all on function public.pregled_knjiga(text, text, text, text, integer, integer, text, text, text) from public, anon, authenticated;
grant execute on function public.pregled_knjiga(text, text, text, text, integer, integer, text, text, text) to authenticated, service_role;

revoke all on function public.pregled_knjiga_izdavaci(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.pregled_knjiga_izdavaci(text, text, text, text, text) to authenticated, service_role;

revoke all on function public.pregled_knjiga_zanrovi(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.pregled_knjiga_zanrovi(text, text, text, text, text) to authenticated, service_role;

revoke all on all functions in schema privatno from public, anon;
grant execute on all functions in schema privatno to authenticated, service_role;

notify pgrst, 'reload schema';
