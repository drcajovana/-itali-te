-- 0028 — dva nova izdavača na listi dozvoljenih domena za korice: prometej.rs i datastatus.rs.
--
-- Zašto: vlasnica je potvrdila (2026-11-24) da se Prometej i Data Status uključe u skriptu za korice
-- (scripts/obogati-korice.mjs) i da njihovi domeni uđu na belu listu. Provereno pre toga:
--   - prometej.rs: robots.txt zabranjuje samo poznate SEO/analitičke botove, a za ostale nema zabrana; stranice knjiga su
--     /prodavnica/<kategorija>/<naslov>/ (nalaze se u sitemap-u proizvoda), a ISBN i slika su na stranici;
--   - datastatus.rs: robots.txt traži Crawl-delay od 10 s i zabranjuje samo parametre filtera (orderby, add-to-cart, izdavac, autor...);
--     pretraga po ISBN-u (/?s=<isbn>&post_type=product) nije zabranjena i preusmerava na stranicu knjige /knjige/<naslov>/.
--
-- Lista u bazi mora da odgovara DOZVOLJENI_DOMENI_KORICA u api/_lib/bela-lista.js (test:db proverava da se ne razilaze).
-- privatno.korice_dozvoljena propušta domen i njegove poddomene, pa važi i za www.prometej.rs.
--
-- Samo se dodaju dva reda. Tabela privatno.domeni_korica već ima RLS i politiku samo za service_role (0009), nijedna
-- politika, funkcija ni grant se ne dira. Idempotentno: može da se pusti proizvoljno puta.

insert into privatno.domeni_korica (domen) values
  ('prometej.rs'),
  ('datastatus.rs')
on conflict (domen) do nothing;

notify pgrst, 'reload schema';
