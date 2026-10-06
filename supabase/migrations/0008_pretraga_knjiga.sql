-- 0008 — pretraga naše baze knjiga: public.trazi_knjige.
--
-- Javna je samo ova funkcija, jer je klijent zove. Normalizacija teksta
-- (privatno.norm_tekst) je pomoćna logika i ostaje u šemi privatno: funkcija je
-- koristi iznutra, pa „Андрић", „Andrić" i „andric" daju iste rezultate.
--
-- SECURITY INVOKER (podrazumevano): izvršava se sa pravima člana koji traži, pa
-- RLS na knjige (knjige_select: samo aktivan član) važi kao i za običan upit.
-- Zato nema kvačice za zaobilaženje politike.
--
-- Ovo je NOVA migracija: 0001 do 0007 su već u bazi i ne menjaju se.

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
      -- % i _ su džokeri u LIKE; iz upita se zamenjuju razmakom
      -- (btrim posle zamene: upit od samih džokera mora da postane prazan, ne da
      -- ostane niz razmaka koji prođe proveru dužine i vrati sve knjige)
      btrim(translate(privatno.norm_tekst(btrim(coalesce(upit, ''))), '%_', '  ')) as tekst,
      -- „978-86-521-2603-3" i „9788652126033" su isti ISBN
      regexp_replace(upper(coalesce(upit, '')), '[^0-9X]', '', 'g') as cifre
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
           -- ISBN: samo ako je upit nalik ISBN-u (10 ili 13 cifara)
           (length(ulaz.cifre) in (10, 13)
            and regexp_replace(upper(coalesce(k.isbn, '')), '[^0-9X]', '', 'g') = ulaz.cifre)
        or
           -- svaka reč iz upita mora da stoji u naslovu ili autoru. Ovaj oblik ne
           -- koristi trigramski indeks (knjige_pretraga_idx), ali za desetine hiljada
           -- naslova prolazak kroz tabelu je brz; ako zatreba, prepisuje se u novoj migraciji.
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

comment on function public.trazi_knjige(text, integer) is
  'Pretraga knjiga po naslovu, autoru ili ISBN-u; ćirilica i latinica daju iste rezultate.';

revoke all on function public.trazi_knjige(text, integer) from public, anon;
grant execute on function public.trazi_knjige(text, integer) to authenticated;
