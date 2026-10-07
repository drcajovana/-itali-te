-- 0010 — ISBN se uvek čuva i traži kao ISBN-13.
--
-- Jedno mesto za pravilo: JS (src/lib/isbn.js, uIsbn13) i SQL (privatno.isbn13)
-- daju isti rezultat za isti unos; test:db to proverava na fiksnim i na
-- slučajnim primerima. Isti naslov iz različitih izvora (Google daje ISBN-13,
-- stari katalog ISBN-10 sa crticama) tako postaje ista knjiga.
--
-- Primena:
--  - UPIS: okidač pretvara ispravan ISBN-10 ili ISBN-13 (sa crticama, razmacima,
--    malim x) u 13 cifara. Neispravan ISBN: običan korisnik i bibliotekar dobijaju
--    grešku (da znaju da su pogrešili); servisna uloga ga čuva kakav jeste (bez
--    razmaka sa krajeva), jer uvoz fonda ne sme da izgubi zapis zbog starog ISBN-a.
--  - PRETRAGA: trazi_knjige pretvara upit u ISBN-13 i poredi tačno (koristi indeks).
--  - POSTOJEĆI REDOVI se normalizuju.
--
-- Ovo je NOVA migracija: 0001 do 0009 su već u bazi i ne menjaju se.

-- ─────────────────────────────────────────────────────────────────────────────
-- privatno.isbn13: ispravan ISBN-10 ili ISBN-13 → 13 cifara; inače NULL
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function privatno.isbn13(unos text)
returns text
language plpgsql
immutable
strict
parallel safe
as $fn$
declare
  s      text := upper(regexp_replace(unos, '[^0-9Xx]', '', 'g'));
  zbir   integer := 0;
  osnova text;
  i      integer;
begin
  if s ~ '^[0-9]{13}$' then
    for i in 1..12 loop
      zbir := zbir + substr(s, i, 1)::integer * case when i % 2 = 1 then 1 else 3 end;
    end loop;
    if (10 - zbir % 10) % 10 = substr(s, 13, 1)::integer then
      return s;
    end if;
    return null;
  end if;

  if s ~ '^[0-9]{9}[0-9X]$' then
    for i in 1..10 loop
      zbir := zbir + (case when substr(s, i, 1) = 'X' then 10 else substr(s, i, 1)::integer end) * (11 - i);
    end loop;
    if zbir % 11 <> 0 then
      return null;
    end if;
    -- 978 + prvih devet cifara + nov kontrolni broj
    osnova := '978' || substr(s, 1, 9);
    zbir := 0;
    for i in 1..12 loop
      zbir := zbir + substr(osnova, i, 1)::integer * case when i % 2 = 1 then 1 else 3 end;
    end loop;
    return osnova || ((10 - zbir % 10) % 10)::text;
  end if;

  return null;
end;
$fn$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Okidač pri upisu
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function privatno.knjige_isbn()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
declare
  normalizovan text;
begin
  if new.isbn is null or btrim(new.isbn) = '' then
    new.isbn := null;
    return new;
  end if;

  normalizovan := privatno.isbn13(new.isbn);
  if normalizovan is not null then
    new.isbn := normalizovan;
    return new;
  end if;

  if privatno.servisna_uloga() then
    new.isbn := btrim(new.isbn);
    return new;
  end if;

  raise exception 'ISBN nije ispravan' using errcode = '22023';
end;
$fn$;

create trigger knjige_isbn_biu
  before insert or update of isbn on public.knjige
  for each row execute function privatno.knjige_isbn();

-- Postojeći redovi: ispravan ISBN-10 ili ISBN-13 sa crticama postaje ISBN-13.
update public.knjige
   set isbn = privatno.isbn13(isbn)
 where isbn is not null
   and privatno.isbn13(isbn) is not null
   and isbn <> privatno.isbn13(isbn);

-- ─────────────────────────────────────────────────────────────────────────────
-- Pretraga: ISBN iz upita se pretvara u ISBN-13 i poredi tačno.
-- (Isto kao 0008, osim ISBN grane; potpis i prava su nepromenjeni.)
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.trazi_knjige(upit text, najvise integer default 20)
returns table (
  id             uuid,
  naslov         text,
  autor          text,
  izdavac        text,
  godina         smallint,
  isbn           text,
  korice_url     text,
  korice_izvor   text,
  u_fondu        boolean,
  broj_primeraka integer,
  broj_slobodnih integer
)
language sql
stable
set search_path = public, pg_temp
as $fn$
  with ulaz as (
    select
      -- (btrim posle zamene: upit od samih džokera mora da postane prazan, ne da
      -- ostane niz razmaka koji prođe proveru dužine i vrati sve knjige)
      btrim(translate(privatno.norm_tekst(btrim(coalesce(upit, ''))), '%_', '  ')) as tekst,
      -- „978-86-521-2603-3", „9788652126033" i ispravan ISBN-10 su isti ISBN; NULL ako upit nije ISBN
      privatno.isbn13(coalesce(upit, '')) as isbn
  ),
  reci as (
    select r
      from ulaz, string_to_table(ulaz.tekst, ' ') as r
     where r <> ''
  )
  select k.id, k.naslov, k.autor, k.izdavac, k.godina, k.isbn,
         k.korice_url, k.korice_izvor, k.u_fondu, k.broj_primeraka, k.broj_slobodnih
    from public.knjige k, ulaz
   where k.spojena_sa_id is null           -- spojeni duplikati se ne prikazuju
     and length(ulaz.tekst) >= 2
     and (
           (ulaz.isbn is not null and k.isbn = ulaz.isbn)
        or
           -- svaka reč iz upita mora da stoji u naslovu ili autoru
           not exists (
             select 1 from reci
              where privatno.norm_tekst(coalesce(k.naslov, '') || ' ' || coalesce(k.autor, ''))
                    not like '%' || reci.r || '%'
           )
         )
   order by k.u_fondu desc,                                              -- naše knjige prvo
            (privatno.norm_tekst(k.naslov) like ulaz.tekst || '%') desc, -- pa one koje počinju upitom
            k.naslov
   limit least(greatest(coalesce(najvise, 20), 1), 50);
$fn$;

revoke all on function public.trazi_knjige(text, integer) from public, anon;
grant execute on function public.trazi_knjige(text, integer) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Prava pristupa
-- ─────────────────────────────────────────────────────────────────────────────

revoke all on all functions in schema privatno from public, anon;
grant execute on all functions in schema privatno to authenticated, service_role;
