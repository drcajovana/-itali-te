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
| Prometej (prometej.rs) | zabranjuje samo poznate SEO/analitičke botove (Sistrix, Ahrefs, DotBot...), za ostale nema zabrana | pretraga se ne koristi (ISBN-pretraga ne nalazi knjige koje nisu na sajtu); **dva sitemap-a** proizvoda `product-sitemap.xml` i `product-sitemap2.xml` (treći ne postoji; oko 1760 adresa `/prodavnica/<kategorija>/<naslov>/`), na stranici ISBN (sa crticama) i korica (`og:image`, isti domen) | **uključen** (2026-11-24, po potvrdi vlasnice; domen na beloj listi, migracija 0028); probni uzorak od 10 od 21 knjige: 1 nađena, 8 nije u sitemap-u (sajt ih ne prodaje), 1 odbijena kao druga knjiga (isti naslov, drugačiji tom) |
| Data Status (datastatus.rs) | **Crawl-delay: 10** (skripta ga poštuje samo za ovaj sajt, ostali sajtovi idu 1 zahtev u sekundi); zabranjeni su samo parametri filtera (`orderby`, `add-to-cart`, `izdavac`, `autor`, `product-page`...) | sitemap proizvoda ima oko 365 fajlova (uz pauzu od 10 s to je sat vremena samo za spisak), pa se NE koristi; **pretraga po ISBN-u** (`/?s=<isbn>&post_type=product`, nije zabranjena) preusmerava pravo na stranicu `/knjige/<naslov>/` kad ima jedan rezultat; na stranici ISBN i korica (`og:image`, isti domen) | **uključen** (2026-11-24, po potvrdi vlasnice; domen na beloj listi, migracija 0028); probni uzorak od 6 od 35 knjiga: 5 nađeno po ISBN-u, 1 slika prevelika (preko 1,5 MB); po knjizi 1 zahtev (stranica se kešira i pod završnom adresom), što je oko 10 s |
| Delfi knjižare (delfi.rs) | nema robots.txt-a (404); uslovi korišćenja (/uslovi_koriscenja) su uslovi kupovine i privatnosti, bez odredbe o automatskom pristupu ili kopiranju slika | sajt je JavaScript aplikacija (svaka adresa vraća praznu ljusku), nema sitemap-a; **pretraga po naslovu** je GET `/api/pc-frontend-api/search/advance-search/<naslov>?limit=20&skip=0` (isti poziv koji šalje njihova stranica), pretraga po ISBN-u ne radi (0 rezultata), a ćirilicu ne razume | **probni režim** (odluka vlasnice, 2026-11-20); knjižara, ne izdavač: obrađuje sve knjige iz fonda bez korice |

## Pauza po sajtu
Opšte pravilo je najviše jedan zahtev u sekundi ka bilo kom sajtu. Crawl-delay iz robots.txt-a nekog sajta (Data Status: 10 s) važi **samo za taj sajt**: u režimu „sve" se
zahtevi ka Data Statusu razmiču na 10 s, a ostali sajtovi se ne usporavaju. Izdavač može da ima više sitemap-ova (`sitemapi`, kod Prometeja dva), a izdavač bez sitemap-a
može da koristi pretragu po ISBN-u koja preusmerava na stranicu knjige (`uzorakStranice`, Data Status).

## Delfi knjižare (probni režim)
`npm run admin:obogati-korice -- --izdavac=delfi --uzorak=20`. Pokreće se **posle** izdavača (ostaju samo knjige koje oni nisu pokrili). Jedan zahtev vraća do 20 proizvoda sa
ISBN-om (barcode ili atribut), autorima i adresama slika, pa po knjizi ide 1 zahtev (2 ako prva strana nema isti ISBN). Traži se normalizovan glavni naslov (latinica, bez
kvačica), a prihvata se **samo proizvod sa istim ISBN-om** (Delfi ima više izdanja istog naslova); knjiga bez ISBN-a se prihvata samo kad tačno jedan proizvod ima isti naslov i
sve reči autora. Slika: xl, pa l, pa m (samo `/_img/...` na delfi.rs, bez zamenskih slika). Izveštaj upozorava kad ista slika stigne za više knjiga (moguća zamenska slika).
Upis (`--upisi`) tek posle provere uzorka.

## Režim „sve" (--izdavac=sve)
`npm run admin:obogati-korice -- --izdavac=sve --limit=30` (probno), pa `--upisi`. Uzima SVE knjige iz fonda bez korice (`korice_url is null`, bez spojenih) koje imaju ISBN, i za svaku redom:
1. **sajt njenog izdavača** (samo uključeni izdavači iz tabele iznad; izdavač se prepoznaje po nazivu iz baze),
2. **Delfi** (samo uz `--delfi`, odluka vlasnice od 2026-11-20),
3. **Open Library** po ISBN-u: prvo ISBN-13, pa ISBN-10 (samo 978...), `https://covers.openlibrary.org/b/isbn/<ISBN>-M.jpg?default=false`. Prihvata se samo odgovor 200 sa
   image/jpeg većim od 1 KB (i po zaglavlju i po sadržaju). Najviše jedan zahtev na 3.5 s ka Open Library (njihov limit je oko 100 zahteva na 5 minuta po IP adresi);
   isključuje se sa `--bez-open-library`.

Isto kao ranije: jedan zahtev u sekundi, robots.txt, jasan User-Agent, prekid na 403 i 429, keš odgovora na disku, bez opisa, korica se nikad ne prepisuje (`korice_url is null` pri upisu).
Stanje je u `uvoz/korice-sve.json` (nastavlja se gde je stalo; „nije nađeno" je konačno tek kad je probana i Open Library). Izveštaj: zbir po izvoru (sajt izdavača / Delfi / Open Library /
nije nađeno), tabela po izdavaču i spisak izdavača BEZ podrške u skripti (kandidati za proveru robots.txt-a i pretrage po ISBN-u pre uključivanja).

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
