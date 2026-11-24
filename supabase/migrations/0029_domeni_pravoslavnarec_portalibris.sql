-- 0029 — još dva izdavača na listi dozvoljenih domena za korice: pravoslavnarec.com i portalibris.rs.
--
-- Zašto: vlasnica je potvrdila (2026-11-24) da se uključe još izdavači u skriptu za korice (scripts/obogati-korice.mjs).
-- Provereno pre dodavanja (oba sajta su WordPress sa Yoast-om):
--   - pravoslavnarec.com: robots.txt zabranjuje samo /wp-admin/, wc-logs i ?add-to-cart=; sitemap proizvoda ima 54 adrese
--     /proizvod/<naslov>/, na stranici su ISBN i slika (og:image);
--   - portalibris.rs: isti robots.txt; sitemap proizvoda ima oko 980 adresa /<naslov>-<autor>/, na stranici su ISBN i slika (og:image).
-- Skripta prihvata stranicu samo uz poklapanje ISBN-a ili naslova, pa adresa „naslov-autor" ne može da dovede do tuđe korice.
--
-- Lista u bazi mora da odgovara DOZVOLJENI_DOMENI_KORICA u api/_lib/bela-lista.js (test:db proverava da se ne razilaze).
-- Samo se dodaju dva reda; RLS, politike i prava tabele privatno.domeni_korica (0009) se ne diraju. Idempotentno.

insert into privatno.domeni_korica (domen) values
  ('pravoslavnarec.com'),
  ('portalibris.rs')
on conflict (domen) do nothing;

notify pgrst, 'reload schema';
