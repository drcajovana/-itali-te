# CLAUDE.md

Smernice za rad u ovom repozitorijumu. Projektni okvir je u `PLAN.md` — on je
izvor istine za obim i redosled; ovo su samo pravila izrade.

## Komande

```bash
npm run dev      # Vite dev server
npm run build    # produkcioni build u dist/
npm run lint     # ESLint
```

Testova nema. Provera je ručna, kroz UI — osim RLS-a, koji se proverava
upitima u bazi pod različitim nalozima (plan, tačka 5, korak 6).

## Jezik i pismo

Celokupan kod, komentari, nazivi tabela i kolona su **na srpskom, latinicom**.
Nije dekoracija: ovo piše službenik biblioteke, a ne tim programera, i
održavaće ga neko ko zna bibliotečki posao a ne englesku terminologiju.
`polica`, `utisci`, `veze` — ne `shelf`, `reviews`, `connections`.

Sav tekst koji korisnik vidi živi u `src/lib/tekst.js`, kao jedan objekat.
Komponente ga čitaju odatle (`tekst.pocetna.naslov`) i nikad ne pišu natpise
direktno u JSX. Tako se ćirilični prevod kasnije dodaje kao drugi objekat
pored `lat`, bez diranja komponenti. Fajl mora ostati običan JS bez uvoza,
jer ga čita i `vite.config.js` (manifest, naslov stranice).

Jedina ćirilica u repozitorijumu je u funkciji `norm_tekst()` u migraciji
`0001`: tamo je to podatak (mapa slova za pretragu), ne tekst. Ne
transliterovati je.

## Šta se ne radi

- **Ne skidaju se podaci sa sajtova izdavača i knjižara** (Delfi, Laguna,
  Vulkan). Uslovi korišćenja to po pravilu zabranjuju i ustanova ne treba da
  nosi taj rizik. Linkovanje ka COBISS+ zapisu i sajtu izdavača ostaje.
- **Google Books je pomoć pri pretrazi uživo, ne izvor podataka.** Iz Google-a se
  trajno čuva samo ono što član potvrdi (ISBN-13, naslov, autor, godina, izdavač);
  **nikad opis, nikad korica, nikad masovno.** Nema skripti za uvoz iz Google-a
  (ni seed, ni bulk, ni „popuni opise"). Uslovi (Google APIs ToS, odeljak 5e) ne
  dozvoljavaju pravljenje baze ni trajnih kopija sadržaja iz API-ja; korica se
  prikazuje uz oznaku „Google Books" i vezu ka njihovoj stranici, nikad se ne čuva.
  Isto važi za opis sa tuđeg sajta (link): ne čuva se. Slika sa linka je predlog adrese; vidi
  „Korice i ISBN”.
- **Ne piše se ništa u COBISS.** COBISS je izvor istine za katalog i
  zaduženja; „Rezerviši" je obaveštenje bibliotekaru, ništa više.
- **Nema samostalne registracije.** Nalog postoji samo ako je članstvo
  aktivno, otvara ga bibliotekar.
- **Nema slobodnog dopisivanja.** Poruka uvek visi o konkretnoj knjizi.
- **Nema javnog spiska članova ni pretrage po imenu.**

## Baza

RLS ide u **istoj migraciji** kao i kreiranje tabele. Tabela bez politike
nikad ne sme da prođe.

Kad politika treba da zna ulogu ili vezu, zove pomoćnu funkciju iz šeme
`privatno` (`privatno.je_bibliotekar()`, `privatno.su_povezani()`), nikad ne
gleda `clanovi` direktno — `clanovi` i sama ima RLS, pa direktan upit
proizvodi beskonačnu rekurziju.

**Nove pomoćne funkcije za RLS se prave u `privatno`, nikad u `public`.**
Sve što je u `public` Supabase izlaže kao RPC (`/rest/v1/rpc/...`) svakom
prijavljenom korisniku, pa pomoćna funkcija tamo postaje upit koji sme da
postavi bilo ko: da je `su_povezani(a, b)` u `public`, otkrivala bi ko je s kim povezan. Zato:

- funkcija ide u `privatno`, a na kraju migracije se ponavljaju
  `revoke all on all functions in schema privatno from public, anon;` i
  `grant execute on all functions in schema privatno to authenticated, service_role;`
  (nove funkcije inače može da pozove svako);
- `service_role` mora da ima `execute`, jer se podrazumevana vrednost
  `clanovi.sifra_poziva` i trigeri izvršavaju i pod tom ulogom;
- šema `privatno` ne sme da se doda u izložene šeme (Project Settings → API).

Javne funkcije (RPC) su samo `posalji_poziv()`, `prihvati_poziv()`,
`spoji_knjige()` i `trazi_knjige()`; `uzmi_zahtev()` je javna samo za
`service_role` (zovu je `api/` funkcije, nikad klijent). Nova javna funkcija se dodaje samo kad klijent zaista mora
da je pozove, i sama proverava ko je zove.

Pretraga knjiga ne može da zove `privatno.norm_tekst()` iz klijenta; ide
preko `trazi_knjige()`, javne funkcije koja je koristi iznutra (`SECURITY INVOKER`,
pa RLS na `knjige` važi).

Tabele samo za `service_role` (`kes_linkova`, `zahtevi_api`): RLS uključen, jedna
politika `to service_role`, `revoke all` od `anon` i `authenticated`.

Trigeri za zaštitu polja su `SECURITY INVOKER` i prvo propuštaju
`privatno.servisna_uloga()` (postgres, service_role, supabase_admin), da uvoz
fonda i prvi administrator rade. U definer funkciji `current_user` je uvek
vlasnik, pa ta provera tamo ne bi radila.

Tabele: `revoke all … from anon, authenticated`, pa `grant` samo ono što
aplikacija radi. Supabase podrazumevano daje sve, a RLS ne štiti `TRUNCATE`.

Migracije su puštene ručno u SQL Editoru (vidi README, „Migracije su puštene
ručno"): izmena fajla u repozitorijumu nije u bazi dok se ne ponovi tamo.

Pogledi se prave sa `with (security_invoker = true)`. Bez toga pogled se
izvršava sa pravima vlasnika i tiho zaobiđe RLS.

Polja koja korisnik ne sme da menja (`uloga`, `aktivan`, `skriven`,
`u_fondu`, …) čuvaju BEFORE triggeri, ne aplikacija. RLS ume da kaže „smeš da
menjaš ovaj red", ali ne i „smeš da menjaš ovu kolonu".

## Korice i ISBN

- **Slika korice se prikazuje samo iz NAŠEG Storage-a** (bucket `korice`, migracije 0013 i 0014);
  nikad se ne učitava sa tuđeg servera (nema hotlinka). Dva izvora: fotografija koju bibliotekar
  snimi (`korice_izvor = 'fotografija'`) i slika preuzeta sa linka (`'preuzeto'`, uz
  `korice_poreklo`). Lanac prikaza (`src/lib/korica-slika.js`): naša slika → Open Library po
  ISBN-u → pločica. Google sličica je samo prikaz uživo u rezultatima pretrage. Stare adrese sa
  drugim izvorom (npr. `og_slika`) se ne prikazuju.
- **Odluka vlasnice (2026-10-08): preuzimanje korice sa linka je dozvoljeno**, što menja raniji
  dogovor „korica sa tuđeg sajta se ne uzima”. Pravilo: **korica se preuzima samo sa adrese koju je
  bibliotekar nalepio, jedna slika po adresi, nikad pretraživanjem ni automatskim obilaskom
  sajtova.** `iz-linka` samo **predlaže** adresu (`korica`), ništa ne preuzima; preuzima
  `api/korica-iz-linka.js`, samo za bibliotekare (uloga se čita na serveru, `granicaKorice`), 100 na
  sat. Preuzima se zajedno sa čuvanjem knjige (kvačica „Preuzmi i koricu”, podrazumevano uključena),
  ali **posle upisa**: prvo se upiše knjiga, pa korica, i **greška pri koricu nikad ne poništava
  upis** (knjiga ostaje sa pločicom, kartica piše razlog i nudi „Pokušaj ponovo”). „Sačuvaj sve”
  radi to redom, uz pauzu između dva preuzimanja; kad se potroši ograničenje, ostatak se čuva bez
  korice, a sažetak kaže koliko je sačuvano, preuzeto i kod kojih nije i zašto. Tok je u
  `src/lib/korica-tok.js` (čist modul, testira ga `test:api`). Ista SSRF zaštita kao `iz-linka` (`bezbedan-fetch.js`, `lista: null`
  skida samo ograničenje domenom), najviše 1.5 MB, tip po sadržaju (`api/_lib/slika.js`), bez
  menjanja veličine na serveru i bez novih biblioteka. Pre upotrebe proveriti da sajt dozvoljava
  kopiranje slike (uslovi korišćenja); `korice_poreklo` čuva odakle je uzeta.
- **Ne dodavati domene izdavača** u listu za korice. `knjige.korice_url`: samo https, do 500
  znakova, samo domeni sa liste (`DOZVOLJENI_DOMENI_KORICA` u `api/_lib/bela-lista.js` I
  `privatno.domeni_korica`; `npm run test:db` pada ako se razilaze). U praksi se koriste samo
  Open Library i naš Storage (`SUPABASE_STORAGE_DOMEN`); domeni izdavača ostaju na listi iz
  istorijskih razloga (0009), a lista za čitanje linkova je zasebna. Nedozvoljena adresa se
  **ne odbija, nego postaje NULL**. Servisna uloga (api/korica-iz-linka) je izuzeta. Pri
  prelasku na drugi Supabase projekat menja se domen u JS-u i u novoj migraciji.
- **Okidač `knjige_korice_biu`** (0014): `korice_poreklo` ostaje samo uz izvor `'preuzeto'` i samo kao
  https do 500 znakova; izvor `'preuzeto'` sme da postavi samo bibliotekar, administrator ili
  servis (član ne može da lažira poreklo).
- **Storage politike** (`0013`): čitanje javno, upis i brisanje samo `privatno.je_bibliotekar()`,
  izmene nema (zamena = nov fajl + brisanje starog); ime fajla `<uuid knjige>/<ime>.(webp|jpg|png)`,
  isti obrazac u `putanjaKorice` (test:api poredi JS i SQL). Bucket: 1.5 MB (0014). Fotografija se
  smanjuje u pregledaču na 600 px pre slanja (`smanjiSliku`). Stara slika se briše samo ako je
  adresa sa našeg bucket-a (tačan prefiks) i iz fascikle iste knjige (`putanjaIzAdrese`).
- **ISBN** se čuva i traži kao ISBN-13. Pravilo je na dva mesta koja moraju da se slažu:
  `src/lib/isbn.js` (`uIsbn13`) i `privatno.isbn13()`; `test:db` ih poredi na fiksnim i
  slučajnim primerima. Ne pisati treću implementaciju. Neispravan ISBN odbija baza (osim
  servisne uloge, koja ga čuva: uvoz fonda ne sme da izgubi zapis).
- Svaka izmena migracija prolazi `npm run test:db` (puštanje svih migracija od nule).
- **Migracija koja je puštena u bazu se ne menja na mestu**: ispravka je nova migracija (sledeći
  broj), idempotentna, da radi i na bazi koja je ispravljena rukom i na onoj koja nije (primer:
  0015 za listu domena za korice). Baza ne pamti koju je verziju fajla dobila.

## Ekran za bibliotekare (/bibliotekar/unos)

- **Ruta** je za ulogu `bibliotekar` i `administrator` (`RutaZaBibliotekare`, `src/lib/uloge.js`).
  To je samo udobnost u interfejsu: upis štiti RLS i okidači, a ograničenje čita ulogu na
  serveru. Na interfejs se bezbednost ne oslanja.
- **Adrese se čitaju REDOM, jedna po jedna, najviše 20, sa pauzom** (`obradiRedom` u
  `src/lib/unos-knjiga.js`). Nikad paralelno, nikad „pretraga" kataloga izdavača: samo adrese
  koje je korisnik nalepio, jedna stranica po adresi. Kad server javi ograničenje, ostatak se ne šalje.
- **Opis se ne povlači sa sajta.** `pocetnaForma` ga ostavlja praznim, a piše ga bibliotekar.
  `npm run test:api` proverava da opis sa sajta nikad ne dospe u formu ni u red za upis.
- **Upis** ide običnim klijentom kao prijavljeni bibliotekar, nikad kroz `service_role`. Izvor je
  `fond` za „U fondu" i `link` za „Za nabavku"; okidač `knjige_unos_clana` za bibliotekare ne dira
  `izvor`, `u_fondu` ni broj primeraka (čitaocima ih vraća na `clan`, `false`, 0). `test:db` i `test:rls` to proveravaju.
- **Duplikati** se proveravaju neposredno pre upisa preko `trazi_knjige` (ISBN-13, pa naslov i
  autor; normalizaciju radi baza). Povećanje primeraka je izmena sa uslovom na staro stanje, pa
  istovremena izmena ne daje pogrešan broj.

## API funkcije (api/)

Vercel funkcije su jedino mesto gde se zovu spoljni servisi (Google Books, stranice
izdavača) i gde se koristi `SUPABASE_SERVICE_ROLE_KEY`. Pravila:

- Zajednički kod ide u `api/_lib/` (podvlaka: Vercel ga ne pretvara u rutu). Funkcija
  sme da uveze čist JS iz `src/lib/` (npr. `isbn.js`), nikad obrnuto.
- Redosled u svakoj funkciji (`obradi` u `api/_lib/zajednicko.js`): samo POST →
  provera JWT-a (401) → provera oblika zahteva → ograničenje broja zahteva → posao.
  Neispravan zahtev ne troši ograničenje.
- Ograničenje je zatvoreno: ako baza ne odgovara, zahtev se odbija (503), ne propušta.
  `ZAHTEVI_BEZ_BAZE=1` radi samo van Vercel-a.
- Greške idu kao `{ greska: { kod } }`; tekst za korisnika se prevodi na klijentu iz
  `tekst.js` (`tekst.pretraga.greske`). Ključevi se nikad ne ispisuju, ni u greškama.
- **`iz-linka` je najopasnija funkcija** (SSRF). Ne oslabljivati: samo https, bela lista
  (jedan niz), provera adrese u samom DNS upitu, ručno praćenje preusmeravanja, rok i
  veličina. Novi domen se dodaje samo u `bela-lista.js`, uz proveru da sajt dozvoljava
  čitanje jedne stranice koju je član zalepio. Ovo je pregled linka, ne skidanje
  kataloga (`Šta se ne radi`).
- **Ograničenje zavisi od uloge**: `iz-linka` ima 30 na sat za čitaoce i 200 za bibliotekare i
  administratore; Google pretraga je 30 za sve. Uloga se čita **na serveru iz tabele `clanovi`
  pomoću `service_role`** (`ulogaClana`), nikad iz tela ni zaglavlja zahteva. Zahtevi se broje po
  kanti (`uzmi_zahtev`, migracija 0012): `api` (čitaoci i Google) i `iz-linka:bibliotekar`.
  Kad se uloga ne može pročitati, zahtev se odbija.
- Svaka promena u ovim funkcijama prolazi `npm run test:api`.

Član koji dodaje knjigu iz Google-a ili sa linka prvo vidi **izmenljiva polja** sa
vrednostima iz rezultata; upis ide tek na dugme „Potvrdi" (`RezultatKnjige.jsx`).
Upisuje se običnim INSERT-om, i to **samo** naslov, autor, izdavač, godina i ISBN-13
(`urediPotvrdu` i `redZaUpis` u `src/lib/red-knjige.js`; `npm run test:api` proverava da u
red nikad ne uđu opis ni korica). Koricu bibliotekar postavlja posle upisa (`postaviKoricu`). Okidač `knjige_unos_clana` uvek postavlja `izvor='clan'` i
`u_fondu=false`, pa izvor knjige ne razlikuje Google od ručnog upisa.

Google-ov `korica` u rezultatu služi samo za prikaz (`api/_lib/google-books.js` ga vraća
samo sa Google-ovih domena za slike). Migracija 0009 (okidač i lista domena) sprečava novo
čuvanje, a 0011 je očistila ono što je već bilo upisano.

## Klijent

Supabase klijent je singleton u `src/lib/supabase.js`. Uvozi se odatle, nikad
se ne pravi novi `createClient`.

Broj članske karte nije e-adresa, pa Auth radi sa sintetičkom
`{broj_kartice}@citaliste.local` i PIN-om kao lozinkom (plan, tačka 4).
Normalizacija karte (razmaci, veličina slova), pretvaranje u adresu i oblik
PIN-a žive samo u `src/lib/kartica.js`; koriste ih aplikacija, skripta za
administratora i test. Nigde se ne sklapa adresa ručno. PIN ima 6 do 12 cifara,
jer Supabase Auth traži najmanje 6 znakova lozinke.

Broj karte i PIN su **uvek tekst**, nikad broj: počinju nulom (`0101228`), a
`Number("0101228")` je `101228`. Ne koristiti `Number`, `parseInt`, `type="number"`
ni `valueAsNumber` na njima, a kolona `broj_kartice` je `text`.

Skripte koje pitaju korisnika koriste `scripts/unos.mjs`, ne `readline`: na
Windows-u `readline` u terminalnom režimu briše već ispisano pitanje. U njima
se ne zove `process.exit()` posle oslobađanja terminala (ruši Node na Windows-u,
`UV_HANDLE_CLOSING`); koristi se `process.exitCode`.

Poruka greške pri prijavi je ista za pogrešnu kartu i pogrešan PIN, i ne sme da
sadrži ni broj karte ni sintetičku adresu. `scripts/test-rls.mjs` to proverava.

Tajne (`SUPABASE_SERVICE_ROLE_KEY`, Infobip ključ) nikad ne smeju da dobiju
`VITE_` prefiks — Vite ih ugrađuje u bandl. SMS ide isključivo preko
serverless funkcije.

Service Worker **nikad ne presreće POST zahteve**.

## Interfejs

Korisnici su i osnovci i penzioneri. Interfejs mora da radi bez objašnjenja:
krupna osnova (17px), dodirne mete najmanje 44px, jasna dugmad, bez
gejmifikacije. To je razlog za pravila u `src/index.css`, nisu proizvoljna.

Ocena je 1–10, ne zvezdice: razlika između 7 i 8 je bitna.

## Postojeći kod koji se prenosi, a ne piše iznova

Parser za unos linkom već postoji u `../nabavka-knjiga/src/lib/extract.js`
(schema.org JSON-LD → skeniranje DOM oznaka → OG/meta, plus poseban put za
Delfijev JSON API). Vezan je za Tauri `fetch`; pri prenosu u Vercel
serverless funkciju menja se samo taj sloj. Uz njega ide i
`../nabavka-knjiga/src/lib/cyrillic.js` — transliteracija i normalizacija
imena izdavača.
