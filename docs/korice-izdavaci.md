# Korice sa sajtova izdavača (scripts/obogati-korice.mjs)

Skripta za knjige iz fonda bez korice (`izvor = 'fond'`, `korice_url is null`) nalazi stranicu knjige kod izdavača, proverava da je to ta knjiga i **preuzima sliku u naš
Storage** (bucket `korice`, `korice_izvor = 'preuzeto'`, `korice_poreklo` = adresa slike), isto kao `api/korica-iz-linka.js`. Adresa slike sa tuđeg servera se ne čuva kao
`korice_url`: aplikacija prikazuje samo naš Storage (CLAUDE.md, „Korice i ISBN"). Link ka stranici knjige nema svoju kolonu, pa se samo ispisuje u izveštaju i čuva u
lokalnom fajlu stanja (`uvoz/korice-<izdavac>.json`).

```bash
npm run admin:obogati-korice -- --izdavac=laguna --uzorak=20     # probno (podrazumevano): ništa se ne upisuje
npm run admin:obogati-korice -- --izdavac=laguna --upisi         # upis
npm run admin:obogati-korice -- --izdavac=laguna --open-library  # za knjige koje izdavač ne daje: Open Library po ISBN-u (isključeno podrazumevano)
```

## Pravila
- Jedan zahtev u sekundi (i duže ako robots.txt traži Crawl-delay), User-Agent `Citaliste-NBDN/1.0 (biblioteka Negotin)`, robots.txt za svaku adresu, prekid na HTTP 429 i 403.
- Svaki odgovor se kešira na disku (`uvoz/kes-korice/`, van GitHub-a), pa se isti zahtev ne ponavlja. Stanje po knjizi je u `uvoz/korice-<izdavac>.json`; ponovno pokretanje nastavlja gde je stalo.
- Čita se samo naslov, ISBN i adresa slike (parser-knjige.js); **opis se ne čuva**. Ostala polja knjige se ne menjaju.
- Link se prihvata samo ako se poklapa ISBN ili naslov; inače se preskače i upisuje u izveštaj.
- Slika: jpeg, png ili webp po sadržaju, veća od 1 KB, sa domena iz bele liste (`DOZVOLJENI_DOMENI_KORICA`) ili sa domena koje je za tog izdavača dozvolila vlasnica (`slikeDomeni` u `IZDAVACI`; za Lagunu `laguna.oozmi-cdn.com`, od 2026-11-20, samo u ovoj skripti); Open Library samo `covers.openlibrary.org` (i njegovo preusmeravanje na archive.org).
- Upis samo uz `korice_url is null`: postojeća korica se nikad ne prepisuje.

## Šta je proveravano po izdavaču (2026-11-20)

| Izdavač | robots.txt | Pretraga po ISBN-u / sitemap | Stanje |
|---|---|---|---|
| Laguna (laguna.rs) | dozvoljava sve osim `/auth*?*` i `/*?qfunc=`; uslovi korišćenja (`/uslovi-koriscenja/`) su uslovi kupovine, bez odredbe o automatskom pristupu | pretraga je klijentska (Qwik), nema obične adrese; **sitemap** proizvoda ima ~7 hiljada adresa `/proizvodi/knjige/<naslov>/`, pa se knjiga nalazi po naslovu i proverava po ISBN-u ili naslovu na stranici | **uključena** |
| Vulkan (vulkani.rs) | zabranjuje samo pretragu (`/*?search=`), `*.php` i upitne parametre | pretraga se ne koristi; **sitemap** `product.xml` (3574 adrese `/<kategorija>/<broj>-<naslov>`), na stranici ISBN i korica (`vulkani.rs`, webp) | **uključen** (2026-11-20); probni uzorak od 20 knjiga: 3 nađene (po ISBN-u), 5 odbijeno kao druge knjige, 12 nije u sitemap-u (sitemap je nepotpun: najnoviji naslovi nedostaju, a pretraga je zabranjena) |
| Kreativni centar | zabranjuje samo `/pretraga.php?q=` i administraciju | pretraga se ne koristi; **sitemap** `/sitemaps/proizvodi.php` (XML sa prefiksom `n1:`), adrese `/p/knjiga/<naslov>/` | **uključen** (2026-11-20) |
| Pčelica | prazan (sve dozvoljeno, pa i pretraga) | nema sitemap-a; **pretraga po ISBN-u** je obična adresa (`index.php?route=product/search&search=<isbn>`), pa stranica knjige: 2 zahteva po knjizi | **uključena** (2026-11-20); probni uzorak: 20 od 20 nađeno po ISBN-u (kod 8 je najveća slika prevelika, pa se uzima druga predložena sa iste stranice) |
| Publik Praktikum | nema ga (404) | nema sitemap-a (404); pretraga `/proizvodi?search=<isbn>` vraća praznu ljusku, a rezultate učitava JavaScript preko internog POST API-ja (`/api`, uz Auth), što se ne koristi | **nije uključen** (proveren 2026-11-20; 68 knjiga ostaje za ručno dodavanje korica) |
| Booka | zabranjuje `/?s=` i `/search/` | pretraga se ne koristi; **sitemap** `product-sitemap.xml` (oko 280 adresa `/knjige/<kategorija>/<naslov>/`), na stranici ISBN i korica (`booka.rs`) | **uključena** (2026-11-20); mala pokrivenost |

## Pogađanje adrese (Laguna)
1. Ceo naslov, pa naslov bez podnaslova (`slug`) traži se u sitemap-u; stranica se prihvata po ISBN-u **ili** naslovu.
2. Prošireno (verzija pravila 3), samo ako 1. nije dalo prihvaćenu stranicu: serija sa brojem (`Knj. 3, Materinstvo` → `…-3-materinstvo`), `Deo 1`/`Deo 2` (→ `…-deo-prvi`/`…-deo-drugi`) i varijante po pismu
   (`…-cirilica`, `…-latinica`). Adresa se uzima samo ako postoji u sitemap-u (ne izmišlja se), najviše tri po knjizi, a stranica se prihvata **samo po ISBN-u**: knjige iz iste serije imaju skoro isti naslov.
3. Ako izabrana slika ne može da se preuzme (npr. prevelika), probaju se najviše dve druge predložene sa iste stranice (`alternativneKorice`).
4. Stanja „nije nađeno" i „ne odgovara" pamte verziju pravila, pa se posle proširenja ponovo pokušavaju; „upisano" se nikad ne ponavlja.

### Vulkan (2026-11-20)
31 od 221 knjige dobilo je koricu (sitemap je nepotpun: najnoviji naslovi nedostaju, a pretraga je zabranjena); 4 odbijena kao druge knjige.

### Stanje prvog uvoza (2026-11-20)
342 od 384 Laguninih knjiga iz fonda dobilo je koricu; 42 nije nađeno (adrese nema u sitemap-u pod naslovom). Ostatak su verovatno knjige koje sajt ne prodaje ili ih vodi pod drugim naslovom
(greške u COBISS-u, npr. mešana pisma u naslovu); one se rešavaju ručno (korica uz knjigu) ili posle provere drugih izdavača.

## Slike Lagune
Slike su na CDN-u **laguna.oozmi-cdn.com**. Taj domen je dozvoljen **samo u ovoj skripti** (`slikeDomeni`), ne i u opštoj beloj listi (`api/_lib/bela-lista.js`, `privatno.domeni_korica`),
jer se slika preuzima u naš Storage i u `korice_url` ide naša adresa. `robots.txt` tog domena se proverava kao za svaki drugi.
