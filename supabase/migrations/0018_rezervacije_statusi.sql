-- 0018 — statusi rezervacije za bibliotekarski panel: nova, spremna, preuzeta, otkazana.
--
-- Šta se menja i zašto:
--   * Do sada su postojala tri statusa (nova, obradjena, otkazana). Bibliotekar treba da kaže
--     tri različite stvari: „knjiga je izdvojena i čeka člana" (spremna), „član ju je uzeo"
--     (preuzeta) i „odustalo se" (otkazana). Zato se ograničenje statusa menja na četiri vrednosti.
--   * Postojeće 'obradjena' postaje 'preuzeta': „obrađena" je značilo da je bibliotekar završio
--     posao sa rezervacijom, a to je najbliže „preuzeta". Redovi se ne brišu.
--   * Jedinstveni indeks „jedna otvorena rezervacija po članu i knjizi" do sada je važio samo za
--     'nova'. Spremna rezervacija je i dalje otvorena (knjiga čeka člana), pa indeks sada važi za
--     'nova' i 'spremna'. Bez toga bi član mogao da rezerviše istu knjigu još jednom dok ona
--     već stoji izdvojena.
--
-- Šta se NE menja:
--   * Politike na public.rezervacije ostaju iste (RLS se ne dira): član i dalje sme da upiše
--     samo 'nova' i da otkaže samo svoju 'nova'; sve ostalo menja samo bibliotekar
--     (rezervacije_bibliotekar_all). Nova tabela nema, pa nema ni nove politike.
--   * Izveštaj „dodatni primerak" (0006) i dalje broji samo 'nova': spremna rezervacija je već
--     rešena izdvojenom knjigom, pa nije potreba za dodatnim primerkom.
--
-- Idempotentna: može da se pusti više puta (na bazi koja je ispravljena rukom i na onoj koja nije).
-- Ovo je NOVA migracija; 0001 do 0017 se ne menjaju.

-- 1. Ograničenje se skida prvo, jer stara vrednost 'obradjena' ne sme da postoji u novom.
alter table public.rezervacije drop constraint if exists rezervacije_status_check;

-- 2. Postojeći redovi: 'obradjena' → 'preuzeta'. Drugo puštanje ovde ne nalazi ništa.
update public.rezervacije set status = 'preuzeta' where status = 'obradjena';

-- 3. Novo ograničenje.
alter table public.rezervacije
  add constraint rezervacije_status_check
  check (status in ('nova', 'spremna', 'preuzeta', 'otkazana'));

-- 4. Jedna otvorena rezervacija (nova ili spremna) po članu i knjizi.
drop index if exists public.rezervacije_otvorena_idx;
create unique index rezervacije_otvorena_idx
  on public.rezervacije (clan_id, knjiga_id)
  where status in ('nova', 'spremna');

-- 5. Spisak otvorenih rezervacija za panel (najstarije prvo), kao što je do sada bio za 'nova'.
drop index if exists public.rezervacije_nove_idx;
create index rezervacije_nove_idx
  on public.rezervacije (kreirana)
  where status in ('nova', 'spremna');
