-- 0025 — „Све књиге": filter po izdavaču.
--
-- Proširuje funkcije iz 0024 (0024 se ne menja; ona je već primenjena u bazi):
--
--   1. public.pregled_knjiga dobija novi parametar p_izdavac (poslednji, default null). Menja se potpis funkcije, pa se stara
--      verzija (šest parametara) prvo briše, a nova se pravi i dobija ista prava. Vrednost p_izdavac je normalizovan KLJUČ izdavača
--      (ono što vraća pregled_knjiga_izdavaci), a posebna vrednost '__bez__' znači knjige bez izdavača.
--
--   2. public.pregled_knjiga_izdavaci(p_upit, p_izvor, p_odluka) vraća spisak izdavača sa brojem knjiga: kljuc, naziv, broj.
--
--   3. privatno.pregled_knjige_filter(p_upit, p_izvor, p_odluka) je JEDNO mesto gde se pretraga, izvor i odluka pretvaraju u skup
--      knjiga (ista pravila kao u 0024). Obe javne funkcije ga zovu, pa spisak izdavača i lista ne mogu da se razilaze.
--
-- SPAJANJE ISTIH IZDAVAČA. Ključ je privatno.norm_tekst(btrim(izdavac)): neosetljiv na veličinu slova, pismo (ćirilica i latinica)
-- i razmake na krajevima, pa su „Laguna", „LAGUNA", „laguna " i „Лагуна" jedna stavka. (norm_tekst ne briše znake interpunkcije,
-- pa „Laguna d.o.o." ostaje posebna stavka; to je namerno, aplikacija ne pogađa šta je ista firma.) Za prikaz se uzima NAJČEŠĆI
-- zapis u grupi (pri jednakom broju onaj koji je prvi po abecedi), računat nad svim matičnim knjigama, da naziv ne menja oblik
-- kad se menjaju filteri. Filter po ključu vraća sve knjige iz grupe. Prazan izdavač (null, razmaci, ili ključ koji ostane prazan)
-- je „bez izdavača".
--
-- BROJEVI U SPISKU IZDAVAČA zavise od ostalih aktivnih filtera (pretraga, izvor, odluka), ali NE od izabranog izdavača, pa se
-- izdavač može zameniti drugim bez gubitka spiska (uobičajeno ponašanje filtera sa brojevima). Zbir brojeva je broj knjiga koje
-- odgovaraju ostalim filterima; lista sa izabranim izdavačem vraća tačno broj iz spiska.
--
-- PRIVATNOST. Izdavač je podatak o knjizi. Nijedna kolona ne vodi do člana (nema uneo_id, id-eva, imena, brojeva karte ni
-- polica). Režim je isti kao u 0024: SECURITY DEFINER sa search_path, provera je_bibliotekar() (ostali dobijaju prazan odgovor, bez
-- greške), anon nema pravo, nepoznat izvor, odluka ili redosled je greška 22023.
--
-- Nema novih tabela, kolona ni politika. Idempotentna. Ovo je NOVA migracija: 0001 do 0024 se ne menjaju.
--
-- Posle puštanja: notify pgrst, 'reload schema';  (da PostgREST vidi novi potpis i novu funkciju)

-- 1. zajednički filter (pretraga, izvor, odluka)
create or replace function privatno.pregled_knjige_filter(p_upit text, p_izvor text, p_odluka text)
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
begin
  if v_izvor is not null and v_izvor not in ('fond', 'link', 'google_books', 'clan') then
    raise exception 'Nepoznat izvor' using errcode = '22023';
  end if;
  if v_odluka is not null and v_odluka not in ('imamo', 'nabavljamo', 'ne_nabavljamo', 'bez') then
    raise exception 'Nepoznata odluka' using errcode = '22023';
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

-- 2. lista knjiga (novi potpis: stara verzija sa šest parametara se briše)
drop function if exists public.pregled_knjiga(text, text, text, text, integer, integer);

create or replace function public.pregled_knjiga(
  p_upit     text    default null,
  p_izvor    text    default null,
  p_odluka   text    default null,
  p_redosled text    default 'najnovije',
  p_najvise  integer default 50,
  p_pomeraj  integer default 0,
  p_izdavac  text    default null
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
           count(*) over ()
      from privatno.pregled_knjige_filter(p_upit, p_izvor, p_odluka) f
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

-- 3. spisak izdavača sa brojem knjiga
create or replace function public.pregled_knjiga_izdavaci(
  p_upit   text default null,
  p_izvor  text default null,
  p_odluka text default null
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
        from privatno.pregled_knjige_filter(p_upit, p_izvor, p_odluka) f
        join public.knjige k on k.id = f.id
       group by 1
    )
    select coalesce(b.kljuc, '__bez__'), n.zapis, b.broj
      from brojevi b
      left join nazivi n on n.kljuc = b.kljuc
     order by (b.kljuc is null), b.broj desc, n.zapis;
end;
$fn$;

-- prava (posle brisanja stare funkcije nova nema nikakva; ponavlja se i za novu)
revoke all on function public.pregled_knjiga(text, text, text, text, integer, integer, text) from public, anon, authenticated;
grant execute on function public.pregled_knjiga(text, text, text, text, integer, integer, text) to authenticated, service_role;

revoke all on function public.pregled_knjiga_izdavaci(text, text, text) from public, anon, authenticated;
grant execute on function public.pregled_knjiga_izdavaci(text, text, text) to authenticated, service_role;

revoke all on all functions in schema privatno from public, anon;
grant execute on all functions in schema privatno to authenticated, service_role;

notify pgrst, 'reload schema';
