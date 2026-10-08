-- 0016 — search_path = pg_catalog za pomoćne funkcije privatno.norm_tekst, privatno.norm_sifra,
-- privatno.dodirni_izmenjeno i privatno.isbn13.
--
-- Zašto: migracije 0001 (norm_tekst, norm_sifra), 0003 (dodirni_izmenjeno) i 0010 (isbn13) ih
-- prave bez postavljenog search_path, pa se imena objekata unutar tela razrešavaju prema putanji
-- pozivaoca. Ove funkcije koriste samo ugrađene objekte iz pg_catalog (lower, replace, translate,
-- upper, regexp_replace, substr, now, operatori ~, ||, % i *, i kastovi u integer i text), pa im
-- putanja može da bude samo pg_catalog: ne zavise ni od jedne šeme koju bi neko mogao da zameni.
-- Posebno je važno za norm_tekst i norm_sifra, koje stoje u indeksima (knjige_pretraga_idx,
-- clanovi_sifra_poziva) i u politikama, i za isbn13, koju poziva okidač za upis knjiga.
--
-- Radi se alter function, ne ponovnim pisanjem tela: ponašanje i potpis ostaju isti, indeksi
-- se ne prave ponovo. Idempotentno: može da se pusti proizvoljno puta, i na bazi koja je već
-- ispravljena rukom.
--
-- Nema novih tabela, pa nema ni novih politika (RLS postojećih tabela se ne menja).
--
-- Ovo je NOVA migracija: 0001 do 0015 se ne menjaju (README, „Migracije su puštene ručno").

alter function privatno.norm_tekst(text) set search_path = pg_catalog;
alter function privatno.norm_sifra(text) set search_path = pg_catalog;
alter function privatno.dodirni_izmenjeno() set search_path = pg_catalog;
alter function privatno.isbn13(text) set search_path = pg_catalog;
