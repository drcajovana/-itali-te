-- 0024 — „Све књиге": pregled svih knjiga za bibliotekare (zbirni brojevi i lista sa brojem čitalaca).
--
-- Ekran /bibliotekar/knjige prikazuje ukupan broj knjiga, raščlanjen po izvoru unosa (knjige.izvor) i po odluci nabavke
-- (knjige.odluka_nabavke), i listu knjiga sa brojem čitalaca koji knjigu imaju na polici.
--
-- Zašto funkcije, a ne običan upit: knjige bibliotekar već čita (knjige_select), ali broj čitalaca traži polica, a nju bibliotekar
-- po politici (polica_bibliotekar_select) čita red po red, sa id-evima članova. Ovde se zato izračunava SAMO zbir u bazi i klijent
-- nikad ne dobija nijedan red police.
--
-- PRIVATNOST. Nijedna kolona ne vodi do člana: nema knjige.uneo_id (ko je knjigu uneo), nema id-eva, imena, brojeva karte ni
-- nadimaka, nema vremena kad je neko stavio knjigu na policu. Od polica dolazi samo broj. Broje se aktivni članovi (isto kao u
-- izvestaj_nabavke, 0020). Ako treba ko je unosilac radi moderacije, to se ne čita ovde.
--
-- Dve funkcije u šemi public (PostgREST izlaže samo public), obe SECURITY DEFINER sa search_path i sa proverom
-- privatno.je_bibliotekar() u samom telu: ostali dobijaju prazan odgovor, bez greške (kao izvestaj_za_nabavku).
--
--   public.pregled_knjiga_zbir()  jedan red: ukupno, fond, link, google_books, clan, imamo, nabavljamo, ne_nabavljamo,
--                                  bez_odluke, spojenih. Broje se samo matične knjige (spojena_sa_id is null); spojeni
--                                  duplikati se izdvajaju u kolonu spojenih, kao i u pretrazi (trazi_knjige).
--   public.pregled_knjiga(...)    stranica liste. Pretraga (naslov, autor, ISBN) je neosetljiva na pismo i kvačice
--                                  (privatno.norm_tekst), kao trazi_knjige. Filteri: izvor (fond, link, google_books, clan),
--                                  odluka (imamo, nabavljamo, ne_nabavljamo, bez). Redosled: najnovije, citaoca, naslov.
--
-- „Odluka" je efektivna odluka, ista kao u izveštaju za nabavku: knjiga koja je u_fondu, a nema postavljenu odluku, vodi se kao
-- „imamo". Nepoznata vrednost filtera ili redosleda je greška 22023.
--
-- Nema novih tabela, kolona ni politika. Idempotentna. Ovo je NOVA migracija: 0001 do 0023 se ne menjaju.
--
-- Posle puštanja: notify pgrst, 'reload schema';  (da PostgREST vidi nove funkcije)

create or replace function public.pregled_knjiga_zbir()
returns table (
  ukupno        integer,
  fond          integer,
  link          integer,
  google_books  integer,
  clan          integer,
  imamo         integer,
  nabavljamo    integer,
  ne_nabavljamo integer,
  bez_odluke    integer,
  spojenih      integer
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  select * from (
    select
      (count(*) filter (where k.spojena_sa_id is null))::integer,
      (count(*) filter (where k.spojena_sa_id is null and k.izvor = 'fond'))::integer,
      (count(*) filter (where k.spojena_sa_id is null and k.izvor = 'link'))::integer,
      (count(*) filter (where k.spojena_sa_id is null and k.izvor = 'google_books'))::integer,
      (count(*) filter (where k.spojena_sa_id is null and k.izvor = 'clan'))::integer,
      (count(*) filter (where k.spojena_sa_id is null and coalesce(k.odluka_nabavke, case when k.u_fondu then 'imamo' end) = 'imamo'))::integer,
      (count(*) filter (where k.spojena_sa_id is null and coalesce(k.odluka_nabavke, case when k.u_fondu then 'imamo' end) = 'nabavljamo'))::integer,
      (count(*) filter (where k.spojena_sa_id is null and coalesce(k.odluka_nabavke, case when k.u_fondu then 'imamo' end) = 'ne_nabavljamo'))::integer,
      (count(*) filter (where k.spojena_sa_id is null and coalesce(k.odluka_nabavke, case when k.u_fondu then 'imamo' end) is null))::integer,
      (count(*) filter (where k.spojena_sa_id is not null))::integer
    from public.knjige k
  ) t
  where privatno.je_bibliotekar();
$fn$;

create or replace function public.pregled_knjiga(
  p_upit     text    default null,
  p_izvor    text    default null,
  p_odluka   text    default null,
  p_redosled text    default 'najnovije',
  p_najvise  integer default 50,
  p_pomeraj  integer default 0
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
  v_tekst  text;
  v_cifre  text;
  v_izvor  text := nullif(btrim(p_izvor), '');
  v_odluka text := nullif(btrim(p_odluka), '');
  v_red    text := coalesce(nullif(btrim(p_redosled), ''), 'najnovije');
begin
  if not privatno.je_bibliotekar() then
    return;
  end if;

  if v_izvor is not null and v_izvor not in ('fond', 'link', 'google_books', 'clan') then
    raise exception 'Nepoznat izvor' using errcode = '22023';
  end if;
  if v_odluka is not null and v_odluka not in ('imamo', 'nabavljamo', 'ne_nabavljamo', 'bez') then
    raise exception 'Nepoznata odluka' using errcode = '22023';
  end if;
  if v_red not in ('najnovije', 'citaoca', 'naslov') then
    raise exception 'Nepoznat redosled' using errcode = '22023';
  end if;

  -- džokeri iz upita postaju razmaci (kao u trazi_knjige), pa upit od samih džokera ne vraća sve
  v_tekst := btrim(translate(privatno.norm_tekst(btrim(coalesce(p_upit, ''))), '%_', '  '));
  v_cifre := regexp_replace(coalesce(p_upit, ''), '[^0-9Xx]', '', 'g');

  return query
    select k.id, k.naslov, k.autor, k.izdavac, k.godina, k.isbn, k.korice_url, k.korice_izvor,
           k.izvor, k.kreirana,
           coalesce(k.odluka_nabavke, case when k.u_fondu then 'imamo' end),
           coalesce(b.n, 0),
           count(*) over ()
      from public.knjige k
      left join (
        select p.knjiga_id, count(*)::integer as n
          from public.polica p
          join public.clanovi c on c.id = p.clan_id and c.aktivan
         group by p.knjiga_id
      ) b on b.knjiga_id = k.id
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
            or (length(v_cifre) >= 4 and k.isbn like '%' || upper(v_cifre) || '%'))
     order by (case when v_red = 'citaoca' then coalesce(b.n, 0) end) desc nulls last,
              (case when v_red = 'naslov' then privatno.norm_tekst(k.naslov) end) asc nulls last,
              k.kreirana desc,
              k.id
     limit least(greatest(coalesce(p_najvise, 50), 1), 100)
    offset greatest(coalesce(p_pomeraj, 0), 0);
end;
$fn$;

revoke all on function public.pregled_knjiga_zbir() from public, anon, authenticated;
grant execute on function public.pregled_knjiga_zbir() to authenticated, service_role;

revoke all on function public.pregled_knjiga(text, text, text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.pregled_knjiga(text, text, text, text, integer, integer) to authenticated, service_role;

notify pgrst, 'reload schema';
