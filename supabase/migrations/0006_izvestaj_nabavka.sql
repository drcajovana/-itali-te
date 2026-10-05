-- 0006 — извештај за набавку (план, тачка 3 и корак 5а).
--
-- Члан који тражи наслов који немамо јесте највреднији податак који
-- апликација производи. Овде се тај податак претвара у прилог уз предлог
-- плана набавке.
--
-- Сви погледи су security_invoker: извршавају се са правима онога ко их чита,
-- па их политике на `polica` и `knjige` и даље штите. Практично значи да
-- пуну слику види библиотекар, јер само он има увид у све полице.

-- ─────────────────────────────────────────────────────────────────────────────
-- Наслови ван фонда, поређани по броју тражења
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
  and k.spojena_sa_id is null      -- дупликати се броје уз матични запис
group by k.id
order by count(*) desc, max(p.izmenjeno) desc;

comment on view public.izvestaj_nabavka is
  'Наслови које чланови траже а немамо их. Извози се као прилог уз предлог плана набавке.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Наслови у фонду који су стално издати → предлог за додатни примерак
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
  'Наслови који јесу у фонду а стално су издати — основ за предлог додатног примерка.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Спајање дупликата
--
-- Исти наслов, унет различито ("Мостови", "Na Drini ćuprija", са и без
-- потписа издавача) — библиотекар спаја ручно (план, тачка 3). Полице,
-- утисци и резервације прелазе на матични запис; дупликат остаје у бази са
-- показивачем `spojena_sa_id`, да стари линкови не пукну.
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
    raise exception 'Само библиотекар спаја записе';
  end if;

  if dupli = maticni then
    raise exception 'Не могу да спојим запис са самим собом';
  end if;

  if not exists (select 1 from public.knjige where id = dupli) then
    raise exception 'Дупликат не постоји';
  end if;

  if not exists (select 1 from public.knjige where id = maticni and spojena_sa_id is null) then
    raise exception 'Матични запис не постоји или је и сам спојен';
  end if;

  -- Полица: ако члан већ има матични запис, дупли ред се брише, иначе се
  -- премешта. Уникат (clan_id, knjiga_id) би иначе пукао.
  delete from public.polica p
   where p.knjiga_id = dupli
     and exists (select 1 from public.polica q
                  where q.clan_id = p.clan_id and q.knjiga_id = maticni);
  update public.polica set knjiga_id = maticni where knjiga_id = dupli;

  -- Утисци: исто, с тим што се задржава онај на матичном запису.
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

  -- Дупликати дупликата показују на исти матични запис, да ланац остане плитак.
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
