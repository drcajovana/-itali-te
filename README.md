# Čitalište

Čitalačka platforma Narodne biblioteke „Dositej Novaković" u Negotinu.

Pun opis projekta, obim, faze i redosled razvoja su u [PLAN.md](PLAN.md).

## Stanje

Skela i baza. Urađen je korak 1 iz plana (tačka 5) — šema i RLS.
Aplikacija još nema ekrane.

| Korak iz plana | Stanje |
|---|---|
| 1. Šema + RLS | ✅ puštena ručno u SQL Editoru (vidi „Migracije su puštene ručno"); RLS **još nije testiran** |
| 1. Seed ~200 knjiga iz fonda | ⛔ čeka izvoz iz COBISS3 (plan, tačka 7) |
| 2. Prijava članskom kartom, profil | ✅ prijava, zaštićene rute, odjava, `/profil` (izmena nadimka); proveren sa lažnim serverom, **ne** sa pravom bazom |
| 3. Pretraga knjiga | ✅ `/pretraga`: naša baza, Google Books, link, ručni upis; dodavanje na policu. Pre dodavanja spoljne knjige član potvrđuje izmenljiva polja. **0013 i 0014 (Storage za korice) treba zalepiti u SQL Editor, tim redom**, a Google Books traži API ključ (vidi niže) |
| 3a. Unos linkom | ✅ `api/iz-linka.js`, parser prenet iz `docs/nabavka-extract.js` |
| 3b. Korice | ✅ lanac: naša slika iz Storage-a (fotografija bibliotekara, ili slika preuzeta sa linka na njegov zahtev) → Open Library po ISBN-u → pločica sa naslovom i autorom. Slika se nikad ne učitava sa tuđeg servera. Google sličica se samo prikazuje u rezultatima pretrage, ne čuva se. **Trebaju migracije 0013 i 0014** |
| 4–11. | ⬜ |

## Pokretanje

```bash
npm install
cp .env.example .env    # popuniti VITE_SUPABASE_URL i VITE_SUPABASE_ANON_KEY
npm run dev
```

## Baza

Migracije se puštaju redom, brojevima:

| Fajl | Šta uvodi |
|---|---|
| `0001_osnova.sql` | šema `privatno`, normalizacija teksta, `clanovi`, `knjige`, pomoćne funkcije za RLS |
| `0002_veze.sql` | `blokade`, `veze`, `privatno.su_povezani()`, slanje i prihvatanje pozivnice |
| `0003_polica_utisci.sql` | `polica`, `utisci`, pogled `ocene_knjiga` |
| `0004_moderacija.sql` | `prijave`, `objave`, `rezervacije` |
| `0005_preporuke.sql` | `preporuke` |
| `0006_izvestaj_nabavka.sql` | izveštaji za nabavku, spajanje duplikata |
| `0007_kes_i_ogranicenje.sql` | `kes_linkova`, `zahtevi_api` (samo service_role), `uzmi_zahtev()` |
| `0008_pretraga_knjiga.sql` | `trazi_knjige()`, pretraga naše baze (ćirilica i latinica) |
| `0009_korice_domeni.sql` | `knjige.korice_url`: samo https, do 500 znakova, samo dozvoljeni domeni (`privatno.domeni_korica`); drugo postaje NULL |
| `0010_isbn13.sql` | `privatno.isbn13()`, okidač koji čuva ISBN kao ISBN-13, pretraga po ISBN-u |
| `0011_ukloni_google_sadrzaj.sql` | čisti Google opis i Google koricu koji su već u bazi (podaci, ne šema) |
| `0012_ogranicenje_po_kanti.sql` | `uzmi_zahtev()` broji po kanti: opšta (30 na sat) i bibliotekarska za iz-linka (200 na sat) |
| `0013_storage_korice.sql` | Storage bucket `korice` (javno čitanje, jpeg/png/webp) i politike na `storage.objects`: upis i brisanje samo bibliotekar i administrator |
| `0014_korice_preuzeto.sql` | `knjige.korice_poreklo`, izvor korice `'preuzeto'`, okidač koji čuva poreklo, i granica bucket-a podignuta na 1.5 MB. Puštati posle 0013 (ponovno puštanje 0013 vraća 1 MB, pa tada ponoviti i 0014) |

Redosled nije proizvoljan: `0003` i `0005` se oslanjaju na
`privatno.su_povezani()` iz `0002`, a politika na `preporuke` gleda u `prijave`,
pa `0004` mora pre `0005`.

### Pretraga, unos linkom i API funkcije

Strana `/pretraga` traži redom: naša baza (`trazi_knjige`, ćirilica i latinica
daju iste rezultate) → Google Books (pomoć pri pretrazi uživo) → polje „zalepi link" →
ručni upis naslova i autora, koji je uvek dostupan. Ručno upisana knjiga ide na policu kao „nije u
fondu" i ulazi u izveštaj za nabavku.

Dve funkcije na Vercel-u (`api/`), obe: samo POST, proveravaju Supabase JWT iz
`Authorization` zaglavlja (bez njega 401), ograničavaju na **30 zahteva na sat po
članu** (tabela `zahtevi_api`) i vraćaju normalizovan oblik
`{ naslov, autori, izdavac, godina, isbn, izvor, url }`. Google pretraga dodaje `opis` i `korica`,
samo za prikaz uživo. `iz-linka` dodaje `korica`: samo **predlog adrese** slike (JSON-LD `image` ili
`og:image`), koji se ne preuzima ni ne prikazuje; opis se ne čita:

| Funkcija | Šta radi |
|---|---|
| `api/pretraga-google.js` | Google Books po naslovu, autoru ili ISBN-u (`izvor: 'google_books'`) |
| `api/iz-linka.js` | čita Open Graph i JSON-LD jedne stranice knjige: bibliotekarska polja (naslov, autor, izdavač, godina, ISBN; `izvor: 'link'`) i predlog adrese korice; kad parser ne nađe ništa, vraća bar naslov iz `<title>` |
| `api/korica-iz-linka.js` | **samo bibliotekar i administrator** (uloga se čita na serveru): preuzima predloženu sliku jednom i čuva je u Storage (vidi „Korice”) |

`iz-linka` čita samo https adrese sa bele liste domena u
[`api/_lib/bela-lista.js`](api/_lib/bela-lista.js) (jedan niz, dodaje se domen),
odbija IP adrese, `localhost` i privatne/link-local adrese (provera je u samom
DNS upitu kojim se otvara veza), svako preusmeravanje proverava posebno (najviše
3, van bele liste se odbija), ima rok 8 s i najviše 1.5 MB, i kešira odgovor po
adresi 7 dana (`kes_linkova`). Predstavlja se pošteno (`Citaliste/1.0`), pa neki
sajt može da odbije; tada član upisuje knjigu ručno.

**Promenljive okruženja na Vercel-u**

| Promenljiva | Čemu služi |
|---|---|
| `VITE_SUPABASE_URL`, `SUPABASE_ANON_KEY` | provera prijave (JWT) |
| `SUPABASE_SERVICE_ROLE_KEY` (Secret) | keš i ograničenje zahteva; bez nje funkcije **odbijaju** zahteve (500) |
| `GOOGLE_BOOKS_API_KEY` | **obavezan za Google Books**: bez ključa Google vraća 429 (dnevna kvota za anonimne zahteve je 0). Besplatan; Books API se uključuje u Google Cloud konzoli |

**Lokalno testiranje bez servisnog ključa** (on je Secret i ne može da se povuče):

- `npm run test:api` radi potpuno van mreže i bez ikakvih ključeva (lažni
  Supabase, podmetnuti odgovori): bezbednosna pravila, parser na uzorcima,
  normalizacija Google odgovora, handleri (401/403/429, keš, zatvoreno bez baze).
- Za rad aplikacije sa funkcijama: `vercel env pull .env.local` (povlači samo
  one koje nisu Secret), pa u `.env.local` dodati `ZAHTEVI_BEZ_BAZE=1` (preskače
  keš i ograničenje; **provera prijave ostaje prava**) i, za Google Books,
  `GOOGLE_BOOKS_API_KEY=...`. Zatim `vercel dev`. Ta promenljiva se ignoriše na
  Vercel-u (`VERCEL_ENV` je tamo `production` ili `preview`).
- Samo `npm run dev` (Vite) nema `/api`: pretraga naše baze i ručni upis rade, a
  Google Books i link javljaju da nisu dostupni.

### Za bibliotekara: unos knjiga linkovima

Stavka **Unos knjiga** u meniju (vide je samo bibliotekar i administrator; ostale vraća na
početnu) služi da se knjiga upiše iz stranice izdavača, bez kucanja:

1. **Nalepite adrese** knjiga sa sajtova izdavača, jednu u svakom redu (najviše 20), i
   kliknite „Pročitaj adrese". Čitaju se **jedna po jedna, redom**, uz kratku pauzu, i
   svaka dobija status: *Prepoznato*, *Delimično* ili *Nije uspelo*. „Prekini obradu"
   zaustavlja ostatak. Čita se samo ta jedna stranica po adresi, a sajt mora biti na listi
   dozvoljenih (`api/_lib/bela-lista.js`).
2. **Svaka kartica se menja**: naslov, autor, izdavač, godina, ISBN (ispravan ISBN-10 ili
   ISBN-13; čuva se kao ISBN-13) i žanr. **Opis se ne preuzima sa sajta**: ako ga želite,
   upišite ga sami.
3. **Stanje**: *U fondu* (obavezan broj primeraka, signatura po želji) ili *Za nabavku*
   (knjiga nije u fondu, bez primeraka, i ulazi u izveštaj za nabavku).
4. **Sačuvaj** čuva jednu karticu. Ako knjiga već postoji (isti ISBN, ili sličan naslov i
   autor), prikazuje se postojeći zapis i nudi: *Otvori*, *Dodaj primerke ovom zapisu* (samo
   za „U fondu") ili *Ipak sačuvaj kao novi zapis*. Označite „Potvrđeno" na više kartica pa
   **Sačuvaj sve potvrđene**: čuvaju se redom, a kartice sa duplikatom ili greškom čekaju vašu odluku.
5. **Korica**: čim sačuvate knjigu u fond, kartica nudi **Slikaj koricu**. Na telefonu se
   otvara kamera, na računaru izbor fajla. Slika se u pregledaču smanji na najviše 600 px
   širine (webp, ili jpeg ako pregledač ne zna webp), pošalje u našu bazu i odmah postane
   korica; ne treba ništa više da kliknete. Ako je sajt ponudio sliku (predlog), sliku možete
   i **preuzeti sa linka** (vidi „Korice"); ona se kopira u našu bazu, nikad se ne učitava sa
   tuđeg servera. Opis i ostalo sa sajta se ne čuvaju.
6. **Sledeća knjiga**: posle čuvanja (i posle fotografije) dugme vodi na sledeću karticu kojoj
   treba pažnja (čeka pregled, ili je sačuvana u fond a nema koricu). Telefonom se tako prolazi
   kroz gomilu knjiga bez vraćanja na vrh liste.
7. Postojeću knjigu otvara **Detalji** u pretrazi (stranica `/knjiga/…`): bibliotekar tamo vidi
   **Slikaj koricu** ili **Zameni koricu** (stara fotografija se briše).

Ograničenje: **200 pročitanih adresa na sat** za bibliotekare (čitaoci imaju 30). Kad se
dostigne, ostale adrese nisu poslate; pokušajte ponovo kasnije.

### Korice: slike u našem Storage-u

Slika korice se prikazuje **samo iz našeg bucket-a `korice`** (migracije `0013` i `0014`; zalepiti u
SQL Editor redom): javno čitanje, najviše 1.5 MB, samo jpeg, png i webp. Dva načina da slika dođe tamo:

1. **Fotografija** (`korice_izvor = 'fotografija'`): bibliotekar je snimi telefonom. Pregledač je smanji
   na najviše 600 px širine i pošalje preko politika na `storage.objects` (upis i brisanje samo
   bibliotekar i administrator, izmene niko: zamena je nov fajl).
2. **Preuzeto sa linka** (`korice_izvor = 'preuzeto'`): `api/iz-linka` vrati predlog adrese slike;
   na zahtev bibliotekara `api/korica-iz-linka` preuzme sliku **jednom** (isti SSRF zaštita kao
   `iz-linka`: https, bez privatnih i lokalnih adresa, provera svakog preusmeravanja, rok 8 s,
   najviše 1.5 MB; domen slike nije ograničen listom), proveri **stvaran tip po sadržaju**
   (jpeg, png, webp; ne po nastavku ni zaglavlju), sačuva je **onakvu kakva je** (bez menjanja
   veličine na serveru) i upiše `korice_url` (naša adresa), `korice_izvor = 'preuzeto'` i
   `korice_poreklo` (adresa sa koje je uzeta). Ograničenje: 100 preuzimanja na sat po
   bibliotekaru. Pošto se slika kopira, pre upotrebe proverite da sajt to dozvoljava.

Fajlovi se zovu `<id knjige>/<vreme>.<ekstenzija>`. Prikaz (`src/lib/korica-slika.js`, `Korica.jsx`):
naša slika → Open Library po ISBN-u → pločica; slika koja se ne učita prelazi na sledeću. Stare
adrese (`og_slika`) se ne prikazuju. Pri prelasku na drugi Supabase projekat menja se
`SUPABASE_STORAGE_DOMEN` u `bela-lista.js` i u novoj migraciji.

`npm run test:rls` proverava na pravoj bazi (posle `0013` i `0014`): čitalac ne može da upiše ni obriše,
anon može da čita, bibliotekar može da upiše i obriše, loš tip i veličina se odbijaju, čitalac ne
može da lažira izvor `'preuzeto'`. Preuzimanje sa linka proverava samo `test:api` (lažni Supabase).

### Prvi administrator

```bash
npm run admin:napravi
```

Skripta [`scripts/napravi-administratora.mjs`](scripts/napravi-administratora.mjs)
pita u terminalu za broj karte, ime i PIN (6 do 12 cifara, ne prikazuje se
pri kucanju i traži se dvaput), pa pravi Auth nalog i red u `clanovi` sa
ulogom `administrator`. Podaci se ne daju kao argumenti komande, da ne ostanu u
istoriji ljuske. Treba joj `SUPABASE_SERVICE_ROLE_KEY` u `.env`. Ako upis u
`clanovi` ne uspe, Auth nalog se poništava.

### Test migracija (test:db)

```bash
npm run test:db
```

[`scripts/test-db.mjs`](scripts/test-db.mjs) pušta **sve** migracije redom na pravom
Postgresu u procesu ([PGlite](https://pglite.dev), bez Docker-a, bez mreže, bez ključeva) i proverava:
pretragu (ćirilica/latinica, ISBN, džokeri), ograničenje zahteva, tabele samo za
`service_role`, pravila za korice i ISBN, i opšta pravila (svaka tabela ima RLS i
politiku, svaka `SECURITY DEFINER` funkcija ima `search_path`, tačan spisak javnih
funkcija). Podatke koji su mogli da postoje pre `0009` i `0010` ubacuje pre njih, pa
proverava i čišćenje postojećih redova.

Za `0013` postoji zamena za šemu `storage` (`buckets`, `objects` sa uključenim RLS-om): proverava se
bucket, politike (ko sme da čita, upiše i obriše, i da nema izmene) i oblik imena fajla. Veličinu i tip
fajla proverava Storage API, ne baza, pa to proverava samo `test:rls`.

Ograničenje: ovo nije Supabase. Uloge, `auth.uid()` i podrazumevane privilegije su
zamene; test ne proverava ni istovremene zahteve (jedna veza). Prolaz znači da SQL radi
i da pravila važe, ne da je tvoj projekat u tom stanju.

### Test RLS

```bash
npm run test:rls
```

Skripta [`scripts/test-rls.mjs`](scripts/test-rls.mjs) proverava stvarno
ponašanje politika pod stvarnim prijavama (čitaoci A, B, C, bibliotekar i
anonimni korisnik). Za razliku od aplikacije, treba joj i
`SUPABASE_SERVICE_ROLE_KEY` u `.env` (bez `VITE_` prefiksa) za pripremu i čišćenje.

Piše u bazu na koju pokazuje `.env`: pravi naloge `rls-test-*@citaliste.test` i
knjige čiji naslov počinje sa `RLS-TEST`, a sve briše na kraju, i kad neka
provera padne. Može da se pokreće više puta. Izlazi sa kodom različitim od
nule ako ijedna provera padne.

### Migracije su puštene ručno

Port 5432 je blokiran sa razvojne mreže, pa `supabase db push` ne radi. Migracije
se lepe u SQL Editor, redom (0001 do 0012 su tamo; 0013 i 0014 treba zalepiti, tim redom). Zato je tabela
`supabase_migrations.schema_migrations` u bazi **prazna** i CLI misli da ništa
nije primenjeno. Kad se ostvari veza, uskladiti:

```bash
npx supabase migration repair --status applied 0001 0002 0003 0004 0005 0006 0007 0008 0009 0010 0011 0012 0013 0014
```

Do tada: izmena postojeće migracije u repozitorijumu **nije** u bazi dok se
ručno ne ponovi u SQL Editoru.

### Tri pravila koja drže celu zaštitu

1. **Veza pre svega.** Tuđu policu, utiske „samo prijatelji" i preporuke vidi
   samo onaj ko ima prihvaćenu vezu. Provera je u politici, ne u aplikaciji —
   `privatno.su_povezani()`.
2. **Nema spiska članova.** Do drugog člana se dolazi isključivo preko šifre
   poziva koju on lično da. Zato `posalji_poziv()` jeste funkcija a ne INSERT:
   član nema pravo da pročita tuđi red u `clanovi`, pa ne može ni da sazna
   čiji je `id`. Nepostojeća šifra i blokada daju isti odgovor, da se blokada
   ne otkrije.
3. **Pomoćne funkcije žive u šemi `privatno`.** Politike na ostalim tabelama
   moraju da pročitaju „ko sam ja" iz `clanovi`, a `clanovi` i sama ima RLS.
   Zato su te funkcije `SECURITY DEFINER` (inače politika zove samu sebe i
   Postgres prijavi beskonačnu rekurziju). Šema `privatno` se ne izlaže kroz
   API, pa do njih ne može preko `/rpc`. Javne funkcije su samo
   `posalji_poziv()`, `prihvati_poziv()`, `spoji_knjige()` i `trazi_knjige()`
   (plus `uzmi_zahtev()`, koju sme da zove samo `service_role`, to jest naše
   `api/` funkcije).

## Tehnički stek

React 19 + Vite 8, Tailwind 4, Supabase (Postgres, Auth, Storage), Vercel.
PWA preko `vite-plugin-pwa` — Service Worker nikad ne presreće POST zahteve
(plan, tačka 4).

Sav tekst interfejsa je u [`src/lib/tekst.js`](src/lib/tekst.js) (latinica; ćirilični
prevod se dodaje kao drugi objekat, bez diranja komponenti).

Supabase klijent je **singleton** u [`src/lib/supabase.js`](src/lib/supabase.js).
Ako se negde napravi drugi, Auth sesija počinje da se duplira.
