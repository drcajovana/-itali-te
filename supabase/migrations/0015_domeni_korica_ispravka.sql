-- 0015 — ispravka liste dozvoljenih domena za korice (privatno.domeni_korica) u bazi.
--
-- Zašto: u bazu je puštena STARIJA verzija migracije 0009, a ne ona koja je kasnije
-- završila u repozitorijumu (0009 je izmenjena na mestu pre prvog commit-a, pa je baza
-- ostala sa starom listom). Stara lista je imala books.google.com i
-- books.googleusercontent.com, a nije imala naš Supabase domen. Google Books NIJE
-- dozvoljen za čuvanje (uslovi: CLAUDE.md, „Korice i ISBN"), a naš Storage mora da bude
-- na listi, inače okidač knjige_korice_biu postavlja adresu fotografije na NULL.
--
-- Ova migracija postavlja listu u bazi na ISTO što piše u 0009 i u api/_lib/bela-lista.js
-- (DOZVOLJENI_DOMENI_KORICA), i radi to idempotentno:
--   - na bazi koja je već ispravljena rukom u SQL Editoru: ne menja ništa;
--   - na bazi koja još ima staru listu: briše oba Google domena i dodaje naš Supabase domen;
--   - na bazi napravljenoj iz 0001–0014 u repozitorijumu: ne menja ništa.
-- Može da se pusti proizvoljno puta.
--
-- Ne dira ostale domene (izdavači i Open Library) ni redove u knjige: adrese koje su
-- već upisane ostaju kakve jesu (0011 je ranije očistila Google korice).
--
-- Tabela privatno.domeni_korica već ima uključen RLS i politiku samo za service_role
-- (0009); ova migracija samo menja redove. Pravilo ostaje: migracija koja je već u bazi
-- se ne menja na mestu, ispravka je nova migracija (README, „Migracije").

delete from privatno.domeni_korica
 where domen in ('books.google.com', 'books.googleusercontent.com');

insert into privatno.domeni_korica (domen) values
  ('jrmzgulxvxtpghwbhmrc.supabase.co')
on conflict (domen) do nothing;
