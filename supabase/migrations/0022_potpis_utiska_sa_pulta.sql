-- 0022 — utisak sa pulta: potpis bibliotekara se ne može lažirati.
--
-- Bibliotekar sme da upiše utisak U IME člana (plan, tačka 2: članovi koji nisu digitalno vešti). Politika
-- utisci_insert (0003) to već dozvoljava uz uslov „uneo_bibliotekar_id = auth.uid()", ali samo za bibliotekara; druga
-- grana politike (član upisuje svoj utisak) ne gleda tu kolonu, pa je član mogao da upiše bilo čiji id kao „bibliotekara
-- koji je kucao". Potpis je upravo ono što član vidi („Овај утисак је записао библиотекар"), pa mora da je istinit.
-- Politike se ne menjaju (politika zna „smeš li ovaj red", ne i „smeš li ovu vrednost"); sve ide kroz okidač:
--
--   UPIS
--     - ko nije bibliotekar/administrator: potpis se poništava;
--     - bibliotekar upisuje svoj utisak (clan_id = on sam): nema potpisa, jer nije ničiji „u ime";
--     - bibliotekar upisuje tuđi utisak: član mora da postoji i da bude aktivan, inače greška 22023; potpis je
--       uvek on sam (politika to već traži).
--   IZMENA
--     - bibliotekar (npr. sakrivanje utiska iz moderacije) ne dira potpis;
--     - autor koji promeni ocenu ili tekst poništava potpis, jer su to sada njegove reči, a ne bibliotekareve;
--       sve ostalo (vidljivost, spojler) potpis ne dira.
--   Servisna uloga je izuzeta.
--
-- Nema novih tabela, kolona ni politika. Idempotentna. Ovo je NOVA migracija: 0001 do 0021 se ne menjaju.

create or replace function privatno.utisci_potpis()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
begin
  if privatno.servisna_uloga() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if not privatno.je_bibliotekar() or new.clan_id = auth.uid() then
      new.uneo_bibliotekar_id := null;
      return new;
    end if;
    if not exists (select 1 from public.clanovi c where c.id = new.clan_id and c.aktivan) then
      raise exception 'Član nije aktivan' using errcode = '22023';
    end if;
    return new;
  end if;

  -- UPDATE
  if privatno.je_bibliotekar() then
    new.uneo_bibliotekar_id := old.uneo_bibliotekar_id;
  elsif new.ocena is distinct from old.ocena or new.tekst is distinct from old.tekst then
    new.uneo_bibliotekar_id := null;
  else
    new.uneo_bibliotekar_id := old.uneo_bibliotekar_id;
  end if;
  return new;
end;
$fn$;

drop trigger if exists utisci_potpis_bi on public.utisci;
create trigger utisci_potpis_bi
  before insert on public.utisci
  for each row execute function privatno.utisci_potpis();

drop trigger if exists utisci_potpis_bu on public.utisci;
create trigger utisci_potpis_bu
  before update on public.utisci
  for each row execute function privatno.utisci_potpis();

-- Prava: nova funkcija u privatno (ponavlja se kao u svakoj migraciji)
revoke all on all functions in schema privatno from public, anon;
grant execute on all functions in schema privatno to authenticated, service_role;

notify pgrst, 'reload schema';
