-- 0013 — Supabase Storage: bucket „korice" za fotografije korica koje okači bibliotekar.
--
-- Korica dolazi samo iz fotografije koju bibliotekar sam snimi (telefonom, na ekranu za
-- unos ili na stranici knjige). Slike sa tuđih sajtova se ne uzimaju (CLAUDE.md, „Korice").
--
--   čitanje:  javno (anon i authenticated). Slika se prikazuje običnim <img src>, a javna
--             adresa https://<projekat>.supabase.co/storage/v1/object/public/korice/... radi
--             i bez ovih politika; politika samo dozvoljava i spisak/preuzimanje preko API-ja.
--   upis:     samo bibliotekar i administrator (privatno.je_bibliotekar()), i samo u
--             putanju <id knjige>/<ime fajla>.(webp|jpg|png)
--   brisanje: samo bibliotekar i administrator (stara korica se briše pri zameni)
--   izmena:   niko (nema UPDATE politike): zamena je nov fajl sa novim imenom + brisanje
--             starog, pa se ne dešava da pregledač i CDN prikazuju staru sliku.
--
-- Ograničenja bucket-a (proverava ih Storage API, pre politika):
--   veličina  najviše 1 MB. Pregledač pre slanja smanji sliku na najviše 600 px širine
--             (src/lib/korica-slika.js), pa je prava veličina oko 30–100 KB; 1 MB je
--             rezerva, ne cilj.
--   tip       samo image/jpeg, image/png, image/webp (ostalo, uključujući SVG i HTML, se odbija).
--
-- Domen Storage-a je već na listi dozvoljenih za knjige.korice_url (0009), pa okidač
-- knjige_korice_biu propušta adresu fotografije.
--
-- Pokretanje: nalepiti ceo fajl u SQL Editor (kao 0001–0012). Može se pokrenuti više puta.
--
-- Ovo je NOVA migracija: 0001 do 0012 se ne menjaju.

-- ─────────────────────────────────────────────────────────────────────────────
-- Bucket
-- ─────────────────────────────────────────────────────────────────────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('korice', 'korice', true, 1048576, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
   set public             = true,
       file_size_limit    = excluded.file_size_limit,
       allowed_mime_types = excluded.allowed_mime_types;

-- ─────────────────────────────────────────────────────────────────────────────
-- Politike na storage.objects (RLS je već uključen na toj tabeli)
-- ─────────────────────────────────────────────────────────────────────────────

drop policy if exists korice_citanje_svi        on storage.objects;
drop policy if exists korice_upis_bibliotekar   on storage.objects;
drop policy if exists korice_brisanje_bibliotekar on storage.objects;

create policy korice_citanje_svi on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'korice');

-- Putanja: <uuid knjige>/<ime>.<webp|jpg|png>. Nijedan drugi oblik imena (ni dublje
-- fascikle, ni „..") ne prolazi.
create policy korice_upis_bibliotekar on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'korice'
    and privatno.je_bibliotekar()
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9_-]{1,64}\.(webp|jpg|png)$'
  );

create policy korice_brisanje_bibliotekar on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'korice'
    and privatno.je_bibliotekar()
  );
