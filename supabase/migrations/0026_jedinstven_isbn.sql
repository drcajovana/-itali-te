-- 0026 — Svaki ISBN samo jednom: baza ne dozvoljava dve matične knjige sa istim ISBN-om.
--
-- ISBN se u bazi već čuva kao ISBN-13 (okidač iz 0010), pa je isti ISBN iz bilo kog izvora (unos člana, link, Google, uvoz fonda,
-- ručna izmena) ista niska i može da se zaštiti običnim jedinstvenim indeksom. Do sada je postojao samo običan (nejedinstven)
-- indeks, pa je zaštitu od duplikata radila samo aplikacija (provera pre upisa), što ne pomaže pri istovremenom unosu ni u uvozu.
--
-- DEO A — spajanje duplikata koji već postoje. Indeks se ne može napraviti dok ih ima, pa se pre njega duplikati spajaju na isti
-- način kao ručno (public.spoji_knjige iz 0006): police, utisci, rezervacije, preporuke i objave prelaze na matični zapis, a
-- duplikat OSTAJE u bazi sa pokazivačem spojena_sa_id (stari linkovi ne pucaju; ništa se ne briše). Za matični zapis se uzima:
-- knjiga koja je u fondu, pa ona sa odlukom nabavke, pa ona sa koricom, pa sa više primeraka, pa najstarija. Podaci iz duplikata
-- se NE prepisuju u matični zapis (ni primerci ni korica); duplikat ostaje sa svojim podacima pa ih bibliotekar može pogledati.
-- Ako nema duplikata, DEO A ne radi ništa.
--
-- DEO B — jedinstven indeks na ISBN među matičnim knjigama (spojena_sa_id is null; spojeni duplikat sme da zadrži isti ISBN
-- kao njegov matični zapis). Knjige bez ISBN-a (null) se ne ograničavaju. Pokušaj upisa ili izmene u već postojeći ISBN
-- vraća grešku 23505 (unique_violation), koju aplikacija pretvara u poruku.
--
-- Nema novih tabela, kolona ni politika. Idempotentna: može da se pusti proizvoljno puta. Ovo je NOVA migracija: 0001 do 0025
-- se ne menjaju.
--
-- Posle puštanja: notify pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────────────────────
-- DEO A: spajanje postojećih duplikata po ISBN-u
-- ─────────────────────────────────────────────────────────────────────────────
do $spajanje$
declare
  g        record;
  d        record;
  v_maticni uuid;
  v_spojeno integer := 0;
begin
  for g in
    select k.isbn
      from public.knjige k
     where k.isbn is not null and k.spojena_sa_id is null
     group by k.isbn
    having count(*) > 1
  loop
    select k.id into v_maticni
      from public.knjige k
     where k.isbn = g.isbn and k.spojena_sa_id is null
     order by k.u_fondu desc,
              (k.odluka_nabavke is not null) desc,
              (k.korice_url is not null) desc,
              k.broj_primeraka desc,
              k.kreirana asc,
              k.id asc
     limit 1;

    for d in
      select k.id
        from public.knjige k
       where k.isbn = g.isbn and k.spojena_sa_id is null and k.id <> v_maticni
    loop
      -- polica i utisci: ako član već ima matični zapis, red duplikata se briše, inače prelazi (unikat clan_id + knjiga_id)
      delete from public.polica p
       where p.knjiga_id = d.id
         and exists (select 1 from public.polica q where q.clan_id = p.clan_id and q.knjiga_id = v_maticni);
      update public.polica set knjiga_id = v_maticni where knjiga_id = d.id;

      delete from public.utisci u
       where u.knjiga_id = d.id
         and exists (select 1 from public.utisci w where w.clan_id = u.clan_id and w.knjiga_id = v_maticni);
      update public.utisci set knjiga_id = v_maticni where knjiga_id = d.id;

      -- rezervacije: jedna otvorena (nova ili spremna) po članu i knjizi
      delete from public.rezervacije r
       where r.knjiga_id = d.id
         and r.status in ('nova', 'spremna')
         and exists (select 1 from public.rezervacije s
                      where s.clan_id = r.clan_id and s.knjiga_id = v_maticni and s.status in ('nova', 'spremna'));
      update public.rezervacije set knjiga_id = v_maticni where knjiga_id = d.id;

      -- preporuke: jedna neprocitana po istom pošiljaocu, primaocu i knjizi
      delete from public.preporuke e
       where e.knjiga_id = d.id
         and not e.procitana
         and exists (select 1 from public.preporuke f
                      where f.posiljalac_id = e.posiljalac_id and f.primalac_id = e.primalac_id
                        and f.knjiga_id = v_maticni and not f.procitana);
      update public.preporuke set knjiga_id = v_maticni where knjiga_id = d.id;

      update public.objave set knjiga_id = v_maticni where knjiga_id = d.id;

      -- duplikati duplikata pokazuju na isti matični zapis (lanac ostaje plitak), pa sam duplikat
      update public.knjige set spojena_sa_id = v_maticni where spojena_sa_id = d.id;
      update public.knjige set spojena_sa_id = v_maticni where id = d.id;
      v_spojeno := v_spojeno + 1;
    end loop;
  end loop;

  raise notice '0026: spojenih duplikata po ISBN-u: %', v_spojeno;
end
$spajanje$;

-- ─────────────────────────────────────────────────────────────────────────────
-- DEO B: jedinstven ISBN među matičnim knjigama
-- ─────────────────────────────────────────────────────────────────────────────
create unique index if not exists knjige_isbn_jedinstven_idx
  on public.knjige (isbn)
  where isbn is not null and spojena_sa_id is null;

comment on index public.knjige_isbn_jedinstven_idx is
  'Svaki ISBN samo jednom među matičnim knjigama; spojeni duplikat (spojena_sa_id) sme da zadrži isti ISBN. Greška 23505 pri upisu.';

notify pgrst, 'reload schema';
