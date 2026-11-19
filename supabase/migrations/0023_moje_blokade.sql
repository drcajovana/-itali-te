-- 0023 — spisak koga sam blokirao (za „Одблокирај" na ekranu „Читаоци").
--
-- Blokada je do sada postojala samo kao red u public.blokade, i član ga je mogao da napravi, ali ne i da vidi ko je
-- blokiran: nadimak druge strane se ne čita iz clanovi (RLS), a bez njega bi blokirani bili nerazlikovljivi.
-- Brisanje blokade (odblokiranje) ne traži ništa novo: politika blokade_svoje (0002) već dozvoljava članu da briše
-- SVOJE blokade, a pravo delete je dato. Ovde se dodaje samo pogled za čitanje.
--
--   public.moje_blokade (security_invoker): samo blokade koje sam JA napravio (blokirao_id = auth.uid()), sa
--   nadimkom blokiranog preko privatno.javno_ime (ista funkcija kao u pogledima iz 0017 i 0019). Nikad ime, broj karte ni
--   šifra poziva. Bibliotekar kroz ovaj pogled vidi samo svoje (uslov u samom pogledu), kao i kod moje_veze.
--
-- Blokirani i dalje NE saznaje ništa: pogled čita samo onaj ko je blokirao. Odblokiranje ne vraća vezu (veza je pri blokadi
-- obrisana): obojica mogu ponovo da se pozovu pozivom. Nova politika se ne dodaje, postojeće se ne menjaju.
--
-- Idempotentna: može da se pusti proizvoljno puta. Ovo je NOVA migracija: 0001 do 0022 se ne menjaju.
--
-- Posle puštanja: notify pgrst, 'reload schema';  (da PostgREST vidi novi pogled)

create or replace view public.moje_blokade
with (security_invoker = true)
as
select
  b.id,
  b.blokirani_id as clan_id,
  b.kreirana,
  privatno.javno_ime(b.blokirani_id) as nadimak
from public.blokade b
where b.blokirao_id = auth.uid();

comment on view public.moje_blokade is
  'Koga sam ja blokirao, sa nadimkom (bez imena, broja karte i šifre poziva). security_invoker: blokade_svoje važi; uslov u pogledu ograničava i bibliotekara na svoje.';

revoke all on public.moje_blokade from public, anon, authenticated;
grant select on public.moje_blokade to authenticated;

notify pgrst, 'reload schema';
