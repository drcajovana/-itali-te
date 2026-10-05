-- 0006 — izveštaj za nabavku (plan, tačka 3 i korak 5a).
--
-- Član koji traži naslov koji nemamo jeste najvredniji podatak koji
-- aplikacija proizvodi. Ovde se taj podatak pretvara u prilog uz predlog
-- plana nabavke.
--
-- Svi pogledi su security_invoker: izvršavaju se sa pravima onoga ko ih čita,
-- pa ih politike na `polica` i `knjige` i dalje štite. Praktično znači da
-- punu sliku vidi bibliotekar, jer samo on ima uvid u sve police.

-- ─────────────────────────────────────────────────────────────────────────────
-- Naslovi van fonda, poređani po broju traženja
-- ─────────────────────────────────────────────────────────────────────────────

create view public.izvestaj_nabavka
with (security_invoker = true)
as
select
  k.id,
  k.naslov,
  k.autor,
  k.izdavac,
  k.godina,
  k.isbn,
  k.izvor,
  count(*)                                  as broj_trazenja,
  count(*) filter (where p.status = 'zelim') as na_listi_zelja,
  min(p.izmenjeno)                          as prvi_put,
  max(p.izmenjeno)                          as poslednji_put
from public.knjige k
join public.polica p on p.knjiga_id = k.id
where k.u_fondu = false
  and k.spojena_sa_id is null      -- duplikati se broje uz matični zapis
group by k.id
order by count(*) desc, max(p.izmenjeno) desc;

comment on view public.izvestaj_nabavka is
  'Naslovi koje članovi traže a nemamo ih. Izvozi se kao prilog uz predlog plana nabavke.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Naslovi u fondu koji su stalno izdati → predlog za dodatni primerak
-- ─────────────────────────────────────────────────────────────────────────────

create view public.izvestaj_dodatni_primerak
with (security_invoker = true)
as
select
  k.id,
  k.naslov,
  k.autor,
  k.signatura,
  k.broj_primeraka,
  k.broj_slobodnih,
  coalesce(z.ceka, 0)        as ceka_na_listi_zelja,
  coalesce(r.rezervacija, 0) as otvorenih_rezervacija
from public.knjige k
left join (
  select knjiga_id, count(*) as ceka
    from public.polica
   where status = 'zelim'
   group by knjiga_id
) z on z.knjiga_id = k.id
left join (
  select knjiga_id, count(*) as rezervacija
    from public.rezervacije
   where status = 'nova'
   group by knjiga_id
) r on r.knjiga_id = k.id
where k.u_fondu
  and k.spojena_sa_id is null
  and k.broj_slobodnih = 0
  and (coalesce(z.ceka, 0) + coalesce(r.rezervacija, 0)) > 0
order by (coalesce(z.ceka, 0) + coalesce(r.rezervacija, 0)) desc;

comment on view public.izvestaj_dodatni_primerak is
  'Naslovi koji jesu u fondu a stalno su izdati — osnov za predlog dodatnog primerka.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Spajanje duplikata
--
-- Isti naslov, unet različito ("Mostovi", "Na Drini ćuprija", sa i bez
-- potpisa izdavača) — bibliotekar spaja ručno (plan, tačka 3). Police,
-- utisci i rezervacije prelaze na matični zapis; duplikat ostaje u bazi sa
-- pokazivačem `spojena_sa_id`, da stari linkovi ne puknu.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.spoji_knjige(dupli uuid, maticni uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $fn$
begin
  if not public.je_bibliotekar() then
    raise exception 'Samo bibliotekar spaja zapise';
  end if;

  if dupli = maticni then
    raise exception 'Ne mogu da spojim zapis sa samim sobom';
  end if;

  if not exists (select 1 from public.knjige where id = dupli) then
    raise exception 'Duplikat ne postoji';
  end if;

  if not exists (select 1 from public.knjige where id = maticni and spojena_sa_id is null) then
    raise exception 'Matični zapis ne postoji ili je i sam spojen';
  end if;

  -- Polica: ako član već ima matični zapis, dupli red se briše, inače se
  -- premešta. Unikat (clan_id, knjiga_id) bi inače pukao.
  delete from public.polica p
   where p.knjiga_id = dupli
     and exists (select 1 from public.polica q
                  where q.clan_id = p.clan_id and q.knjiga_id = maticni);
  update public.polica set knjiga_id = maticni where knjiga_id = dupli;

  -- Utisci: isto, s tim što se zadržava onaj na matičnom zapisu.
  delete from public.utisci u
   where u.knjiga_id = dupli
     and exists (select 1 from public.utisci v
                  where v.clan_id = u.clan_id and v.knjiga_id = maticni);
  update public.utisci set knjiga_id = maticni where knjiga_id = dupli;

  delete from public.rezervacije r
   where r.knjiga_id = dupli
     and r.status = 'nova'
     and exists (select 1 from public.rezervacije s
                  where s.clan_id = r.clan_id and s.knjiga_id = maticni and s.status = 'nova');
  update public.rezervacije set knjiga_id = maticni where knjiga_id = dupli;

  update public.preporuke set knjiga_id = maticni where knjiga_id = dupli;
  update public.objave    set knjiga_id = maticni where knjiga_id = dupli;

  -- Duplikati duplikata pokazuju na isti matični zapis, da lanac ostane plitak.
  update public.knjige set spojena_sa_id = maticni where spojena_sa_id = dupli;
  update public.knjige set spojena_sa_id = maticni where id = dupli;
end;
$fn$;

revoke all on public.izvestaj_nabavka           from anon;
revoke all on public.izvestaj_dodatni_primerak  from anon;
grant select on public.izvestaj_nabavka          to authenticated;
grant select on public.izvestaj_dodatni_primerak to authenticated;

revoke all on function public.spoji_knjige(uuid, uuid) from public, anon;
grant execute on function public.spoji_knjige(uuid, uuid) to authenticated;
