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
| 4–5. Polica, stranica knjige, utisci | ✅ početna „Moja polica”, `/knjiga/:id` sa stanjem police, napretkom i utiscima (vidi „Polica, stranica knjige i utisci”). **Treba migracija 0017** |
| 6. Bibliotekarski panel | ✅ `/bibliotekar/clanovi` (upis člana, štampa kartice, novi PIN, aktivacija) ; `api/napravi-clana.js` i `api/resetuj-pin.js`. Vidi „Uputstvo za bibliotekare”. Rezervacije i dostupnost knjiga iz COBISS-a nisu deo aplikacije (vidi CLAUDE.md, „Šta se ne radi”). **Migracija 0018 je u bazi, ali se ne koristi** |
| 7. Čitaoci | ✅ `/citaoci` (moja šifra, poziv, pozivi na čekanju, preporuke za mene, povezani) i `/citaoci/:id` (polica, utisci, preporuka, raskid, blokada, prijava), tačka na navigaciji, preporuka sa stranice knjige. Vidi „Čitaoci: veze, preporuke, blokada”. **Treba migracija 0019** |
| 8–11. | ⬜ |

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
| `0015_domeni_korica_ispravka.sql` | ispravka liste domena za korice u bazi: briše `books.google.com` i `books.googleusercontent.com`, dodaje naš Supabase domen; idempotentna (može i na već ispravljenoj bazi) |
| `0016_search_path_pomocne_funkcije.sql` | `search_path = pg_catalog` za `privatno.norm_tekst`, `norm_sifra`, `dodirni_izmenjeno` i `isbn13` (`alter function`, idempotentno) |
| `0017_polica_napredak_utisci_autor.sql` | `polica.napredak` (0–100), pogled `utisci_sa_autorom` (nadimak autora uz utisak, RLS važi), rezervacija samo za knjigu u fondu |
| `0018_rezervacije_statusi.sql` | **(puštena, ali ništa je ne koristi: aplikacija nema rezervacije)** stanja rezervacije `nova`, `spremna`, `preuzeta`, `otkazana` (stara `obradjena` postaje `preuzeta`); jedinstveni indeks „jedna otvorena rezervacija po članu i knjizi” važi za `nova` i `spremna`. Politike se ne menjaju; idempotentna |
| `0019_citaoci_nadimci_preporuke.sql` | pogledi `moje_veze` i `moje_preporuke` (samo moje, samo nadimak druge strane, bez blokiranih), `privatno.ima_blokade()`, prijava člana (`prijave.tip = 'clan'`), napomena preporuke do 280 znakova i jedna neobrađena preporuka iste knjige po paru. Nijedna politika se ne menja; idempotentna. Posle puštanja: `notify pgrst, 'reload schema';` |

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
| `api/napravi-clana.js` | **samo bibliotekar i administrator**: pravi Auth nalog `{karta}@citaliste.local` i red u `clanovi` (uloga uvek `citalac`), vraća PIN jednom (vidi „Uputstvo za bibliotekare”) |
| `api/resetuj-pin.js` | **samo bibliotekar i administrator**: postavlja novi 6-cifreni PIN i vraća ga jednom; bibliotekar samo čitaocima |

Kandidati za koricu se traže na ovim mestima, redom: JSON-LD `image` (tekst, niz ili objekat sa
`url`), `og:image:secure_url`, `og:image`, `og:image:url`, `twitter:image`, `link rel="image_src"`,
`itemprop="image"`. Svaka adresa se prvo **dopunjava prema konačnoj adresi stranice** (relativne i one
koje počinju sa `//`), pa se tek onda proverava bezbednost (https, bez korisnika i porta, bez IP
adrese i localhost-a, najviše 500 znakova). Slike iz `<img>` oznaka (`cover`, `korica`, `product`,
`book`) se samo navode u dijagnostici, ne predlažu se same. Delfi je prazna ljuska (SPA), pa se njegova
slika čita iz odgovora njihovog API-ja (`images`, redom xl, xxl, l, m, s); ISBN iz `barcode` samo ako je
ispravan ISBN-13.

**Dijagnostika (samo bibliotekar i administrator):** odgovor `iz-linka` ima i polje `dijagnostika`
(uloga se čita na serveru; čitalac ga ne dobija ni iz keša). Sadrži iz kog izvora je pročitano svako
polje (naslov, autor, izdavač, godina, ISBN, korica) i sve kandidate za koricu: sirova vrednost, vrsta
(apsolutna, relativna, `//`), adresa posle dopune, ishod (prihvaćena ili odbijena) i razlog (nije
https, port, IP adresa, duža od 500 znakova, data:...). Najviše 30 kandidata, vrednosti skraćene na
300 znakova, nikad ceo HTML. Vidi se u odgovoru (Network u pregledaču). Keš odgovora (7 dana) je
verzionisan: stariji zapisi, bez korice i dijagnostike, se ne koriste.

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
5. **Korica se preuzima zajedno sa čuvanjem.** Kad je link dao predlog korice, kartica pre
   čuvanja pokazuje pregled slike i kvačicu **Preuzmi i koricu** (podrazumevano uključena), a pored
   nje **Bez korice** i **Izaberi drugu sliku** (sa računara ili telefona; telefon nudi i kameru).
   Pregled učitava sliku sa sajta samo u vašem pregledaču. Na **Sačuvaj** se prvo upiše knjiga, pa
   tek onda, ako je kvačica uključena, server preuzme sliku (ili se pošalje izabrana slika).
   - **Greška pri koricu ne poništava čuvanje.** Knjiga ostaje sačuvana, sa pločicom, a kartica
     piše razlog (sajt ne daje sliku, slika je prevelika, pogrešan tip, nemate dozvolu) i nudi
     **Pokušaj ponovo**. Pored toga i dalje stoje **Slikaj koricu**, **Izaberi sliku sa računara ili
     telefona** i **Bez korice**.
   - Izabrana druga slika se u pregledaču smanji na najviše 600 px širine (webp ili jpeg) i šalje
     se tek pošto se knjiga sačuva. Kartica bez predloga korice nudi samo fotografiju, posle čuvanja.
   - **Sačuvaj sve potvrđene** radi isto za svaku knjigu, redom, uz pauzu između dva preuzimanja
     (kao kod čitanja linkova). Na kraju piše sažetak: koliko je knjiga sačuvano, kod koliko je korica
     preuzeta, a kod kojih nije i zašto. Ograničenje je **100 preuzimanja na sat**; kad se potroši,
     ostale knjige se čuvaju bez korice i to piše u sažetku (koricu dodate kasnije).
   - Korica se preuzima samo sa adrese koju ste sami nalepili, jedna slika po adresi; nikad
     pretraživanjem ni automatskim obilaskom sajtova.
6. **Sledeća knjiga**: posle čuvanja (i posle korice) dugme vodi na sledeću karticu kojoj
   treba pažnja (čeka pregled, ili je sačuvana u fond a nema koricu i niste izabrali „Bez korice").
   Telefonom se tako prolazi kroz gomilu knjiga bez vraćanja na vrh liste.
7. **Zamena i uklanjanje**: postojeću knjigu otvara **Detalji** u pretrazi (stranica `/knjiga/…`).
   Bibliotekar tamo vidi **Zameni koricu** (isti izbori kao gore, stara slika se briše) i
   **Ukloni koricu**: pita „Ukloniti koricu?", a na „Da, ukloni" briše sliku iz baze i prazni podatke
   o korici (adresu, izvor i poreklo). Knjiga tada ponovo dobija Open Library ili pločicu.

Ograničenje: **200 pročitanih adresa na sat** za bibliotekare (čitaoci imaju 30). Kad se
dostigne, ostale adrese nisu poslate; pokušajte ponovo kasnije.

### Korice: slike u našem Storage-u

Slika korice se prikazuje **samo iz našeg bucket-a `korice`** (migracije `0013` i `0014`; zalepiti u
SQL Editor redom): javno čitanje, najviše 1.5 MB, samo jpeg, png i webp. Dva načina da slika dođe tamo:

1. **Fotografija** (`korice_izvor = 'fotografija'`): bibliotekar je snimi telefonom. Pregledač je smanji
   na najviše 600 px širine i pošalje preko politika na `storage.objects` (upis i brisanje samo
   bibliotekar i administrator, izmene niko: zamena je nov fajl).
2. **Preuzeto sa linka** (`korice_izvor = 'preuzeto'`): `api/iz-linka` vrati predlog adrese slike;
   `api/korica-iz-linka` (poziva je kartica pošto se knjiga sačuva, ili dugme „Pokušaj ponovo”) preuzme sliku **jednom** (isti SSRF zaštita kao
   `iz-linka`: https, bez privatnih i lokalnih adresa, provera svakog preusmeravanja, rok 8 s,
   najviše 1.5 MB; domen slike nije ograničen listom), proveri **stvaran tip po sadržaju**
   (jpeg, png, webp; ne po nastavku ni zaglavlju), sačuva je **onakvu kakva je** (bez menjanja
   veličine na serveru) i upiše `korice_url` (naša adresa), `korice_izvor = 'preuzeto'` i
   `korice_poreklo` (adresa sa koje je uzeta). Ograničenje: 100 preuzimanja na sat po
   bibliotekaru. Samo sa adrese koju je bibliotekar nalepio, jedna slika po adresi. Pošto se slika kopira, pre upotrebe proverite da sajt to dozvoljava.

Fajlovi se zovu `<id knjige>/<vreme>.<ekstenzija>`. Prikaz (`src/lib/korica-slika.js`, `Korica.jsx`):
naša slika → Open Library po ISBN-u → pločica; slika koja se ne učita prelazi na sledeću. Stare
adrese (`og_slika`) se ne prikazuju. Pri prelasku na drugi Supabase projekat menja se
`SUPABASE_STORAGE_DOMEN` u `bela-lista.js` i u novoj migraciji.

`npm run test:rls` proverava na pravoj bazi (posle `0013` i `0014`): čitalac ne može da upiše ni obriše,
anon može da čita, bibliotekar može da upiše i obriše, loš tip i veličina se odbijaju, čitalac ne
može da lažira izvor `'preuzeto'`. Preuzimanje sa linka proverava samo `test:api` (lažni Supabase).

### Polica, stranica knjige i utisci

- **Početna („Moja polica”)**: knjige u toku sa trakom napretka, tri kartice (**Čitam**, **Pročitano**, **Želim**,
  svaka sa brojem knjiga) i mreža korica izabrane kartice (naša slika, pa Open Library po ISBN-u, pa složena
  pločica sa naslovom i autorom). Prazna polica, prazna kartica
  i greška pri učitavanju imaju svoje poruke. Čita se samo SVOJA polica (RLS pokazuje i policu povezanih članova).
- **`/knjiga/:id`**: prosečna ocena
  iz pogleda `ocene_knjiga`, promena stanja (Želim, Čitam, Pročitano), napredak u procentima za knjige u toku,
  i **Označi kao pročitano** (datum kraja je danas, napredak 100). Nema dostupnosti ni rezervacije (to je COBISS). Datum početka čitanja se upisuje kad knjiga postane „Čitam”.
- **Utisak**: ocena 1 do 10 sa opisom vrednosti, tekst, vidljivost (svi članovi / samo povezani / samo ja), kvačica
  „Sadrži spojler”; izmena i brisanje (uz potvrdu) sopstvenog utiska. **Tuđi utisci**: samo oni koje RLS pokazuje, uz
  nadimak autora; tekst sa spojlerom je zamagljen dok se ne dodirne. Ni ovde nema filtriranja po vidljivosti u React
  kodu: pogled `utisci_sa_autorom` je `security_invoker`, pa važe politike tabele `utisci`.
- **Ručni upis naslova koji nemamo** (pretraga) ostaje; takva knjiga ulazi u izveštaj za nabavku.
- Pravila (prelaz stanja, napredak, ocena, utisak) su u `src/lib/polica-logika.js`, upiti u `src/lib/polica.js`.
  `test:db` proverava pogled i napredak; `test:rls` (faza 12) isto na pravoj bazi.

### Uputstvo za bibliotekare

Ovo je kratko uputstvo za rad u aplikaciji. Tekst u aplikaciji je na ćirilici, pa su natpisi dugmadi i menija ovde navedeni onako kako ih vidite na ekranu. Prijavite se svojom kartom i PIN-om. Dole u meniju
postoji stavka **Библиотека** (vide je samo bibliotekari i administratori). U njoj su dva alata:
**Унос књига** i **Чланови**.

**Kako se upisuje novi član**

1. Otvorite **Библиотека → Чланови** i dodirnite **Нови члан**.
2. Upišite **broj karte** (tačno 7 cifara, i vodeću nulu: `0101228`, a ne `101228`) i **ime i prezime**.
3. Dodirnite **Направи члана**. Ako karta već postoji, aplikacija to kaže i ništa se ne pravi.
4. Na ekranu se pojavi **PIN od 6 cifara**. **Vidi se samo sada.** Odštampajte karticu ili ga zapišite
   pre nego što zatvorite prozor. Ako se izgubi, napravite novi PIN (vidi niže).
5. Novi član je **čitalac**. Uloge bibliotekara i administratora ne dodeljuju se ovde.

**Kako se štampa kartica**

1. Posle upisa člana (ili posle novog PIN-a) dodirnite **Штампај картицу**.
2. Otvara se štampanje pregledača. Štampa se **samo kartica**: ime biblioteke, grb 1846, ime člana,
   broj karte, PIN i kratko uputstvo za prijavu. Ništa drugo sa stranice ne ide na papir.
3. Karticu predajte članu. PIN se posle toga ne može ponovo videti.

**Kako se menja PIN (kad ga član zaboravi ili izgubi)**

1. **Библиотека → Чланови**, pronađite člana (upišite deo imena ili broj karte).
2. Dodirnite **Нови ПИН** i potvrdite. Stari PIN prestaje da važi.
3. Prikazuje se novi PIN, jednom, sa dugmetom **Штампај картицу**.
4. Bibliotekar menja PIN samo čitaocima. PIN drugog bibliotekara ili administratora menja administrator.

**Kako se član deaktivira ili aktivira**

Na istom ekranu dodirnite **Деактивирај** (uz potvrdu) ili **Активирај**. Neaktivan član se ne može
prijaviti i ne vidi ništa, ali njegovi podaci ostaju. Sebe ne možete da deaktivirate.

**Za one koji održavaju aplikaciju**

- PIN pravi server (`crypto.randomInt`, 6 cifara, može da počne nulom) i vraća ga **jednom** u odgovoru
  funkcije. Ne čuva se nigde (Auth čuva samo hash), ne ispisuje se u logove ni u poruke grešaka, a
  pregledač ga drži samo dok je prozor sa PIN-om otvoren.
- Obe funkcije proveravaju prijavu, pa ulogu čitaju **iz baze** (`service_role`), nikad iz zahteva.
  Ograničenje je **60 zahteva na sat po korisniku**, zajedno za obe (kanta `clanovi:bibliotekar` u
  `uzmi_zahtev`); kad baza ne odgovara, zahtev se odbija (503).
- Greška pri upisu reda poništava i Auth nalog. Postojeće sesije člana posle novog PIN-a ostaju dok ne
  isteknu: promena lozinke ih ne prekida.
- Deaktivacija ide običnim klijentom (RLS: `clanovi_bibliotekar_update`), ne kroz funkciju. Baza
  dozvoljava bibliotekaru da promeni `aktivan` i administratoru; zato ekran nudi dugme samo za čitaoce
  (administrator vidi sve), ali to nije zaštita u bazi.
- `npm run test:api` proverava uloge, ograničenje, vodeću nulu i da PIN nije u logu ni u poruci greške;
  `test:db` migraciju 0018; `test:rls` (faza 13) isto na pravoj bazi.

### Čitaoci: veze, preporuke, blokada

Ekran **Čitaoci** (`/citaoci`) i profil povezanog čitaoca (`/citaoci/:id`) rade samo preko postojećih tabela i funkcija
(`veze`, `blokade`, `preporuke`, `prijave`, `posalji_poziv`, `prihvati_poziv`) i dva nova pogleda iz migracije 0019.

- **Veza je samo pozivom.** Član unosi šifru poziva drugog člana (razmaci i mala slova su u redu), drugi prihvata ili odbija.
  Nema spiska članova ni pretrage članova. Nepostojeća šifra, sopstvena šifra i šifra člana koji je blokirao (ili je blokiran)
  daju **istu** grešku u bazi (`P0001`), a ekran pokazuje jednu poruku.
- **Drugom članu se vidi samo nadimak**, iz pogleda `moje_veze` i `moje_preporuke` (`security_invoker`, samo moje veze, bez
  blokiranih). Ime, broj karte i šifra poziva drugog člana ne stižu u pregledač. `clanovi` i dalje vide samo sam član i bibliotekari.
- **Pozivi.** Primljeni (Prihvati: `prihvati_poziv`, Odbij: DELETE reda), poslati (Povuci poziv: DELETE). Nadimak pošiljaoca se vidi
  dok poziv čeka; kad ga nema, piše „Нови позив”. Nadimak primaoca se vidi pošiljaocu poziva na čekanju.
- **Povezani.** Dodir otvara profil: njegova polica (Čita, Pročitano, Želi, sa ocenom ako je ima) i utisci „svi” i „povezani”
  (pogled `utisci_sa_autorom`, spojler je zamagljen). Ništa se ne učitava dok veza nije prihvaćena; ako nema veze ili postoji blokada,
  ekran pokazuje isto prazno stanje.
- **Raskid** je običan DELETE reda u `veze` (bez obaveštenja drugoj strani). **Blokada** upisuje red u `blokade` pa briše vezu;
  blokirani ne dobija nikakav signal (veza mu nestaje kao pri raskidu), a pozivi i preporuke od blokiranog nestaju iz pogleda.
  Otblokiranja u interfejsu još nema (red u `blokade` može da obriše administrator u bazi).
- **Prijava člana** (razlog do 300 znakova) ide bibliotekaru kao `prijave.tip = 'clan'`; prijavljeni je ne vidi.
- **Preporuke.** Jedini oblik poruke je preporuka knjige uz napomenu do 280 znakova (granica je i u bazi). Šalje se sa profila
  (knjiga sa moje police ili iz pretrage) i sa stranice knjige. Primalac bira: „Желим да прочитам” (polica, Želim, samo ako knjige
  još nema na polici), „Прочитано је већ” (polica, Pročitano), „Није за мене” (samo sklanja). Sve tri obeležavaju preporuku kao
  obrađenu (`procitana = true`); `skrivena` ostaje potez moderacije.
- **Tačka na navigaciji** (stavka „Читаоци”): ima primljenih poziva na čekanju ili neobrađenih preporuka. Osvežava se pri promeni
  ekrana i kad se prozor vrati u prvi plan.
- Testovi: `test:api` (logika i pravila u izvornom kodu), `test:db` (pogledi, blokada, ista greška za šifru, ograničenja),
  `test:rls` faza 14 (na pravoj bazi, pod stvarnim prijavama).

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
se lepe u SQL Editor, redom (0001 do 0012 su tamo; 0013 do 0019 treba zalepiti, tim redom). Zato je tabela
`supabase_migrations.schema_migrations` u bazi **prazna** i CLI misli da ništa
nije primenjeno. Kad se ostvari veza, uskladiti:

```bash
npx supabase migration repair --status applied 0001 0002 0003 0004 0005 0006 0007 0008 0009 0010 0011 0012 0013 0014 0015 0016 0017 0018 0019
```

Do tada: izmena postojeće migracije u repozitorijumu **nije** u bazi dok se
ručno ne ponovi u SQL Editoru.

**Migracija koja je već puštena u bazu se ne menja na mestu: dodaje se nova.** Baza ne pamti
koju verziju fajla je dobila (tabela `schema_migrations` je prazna), pa izmena fajla na mestu tiho
ostavlja bazu drugačijom od repozitorijuma, a to se otkrije tek kad nešto zakaže. Ispravka je
nova migracija sa sledećim brojem, napisana idempotentno (`create or replace`, `if not exists`,
`delete … where`, `insert … on conflict do nothing`) da može da se pusti i na bazi koja je već
ispravljena rukom i na onoj koja nije. Tako je bilo sa listom domena za korice: u bazu je ušla
starija verzija `0009` (sa Google domenima, bez našeg Supabase domena), a ispravlja je `0015`.
`npm run test:db` poredi listu u bazi sa `api/_lib/bela-lista.js` i puštanjem `0015` na staroj i
ispravnoj bazi. Istoriju fajla pokazuje `git log --follow supabase/migrations/<fajl>`.

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

Sav tekst interfejsa je u [`src/lib/tekst.js`](src/lib/tekst.js) (ćirilica, ekavica;
ključevi i nazivi u kodu ostaju latinični). Dokumentacija (ovaj fajl i CLAUDE.md) ostaje na latinici.

Supabase klijent je **singleton** u [`src/lib/supabase.js`](src/lib/supabase.js).
Ako se negde napravi drugi, Auth sesija počinje da se duplira.
