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
- Svaka promena u ovim funkcijama prolazi `npm run test:api`.

Član koji dodaje knjigu iz Google-a ili sa linka upisuje je običnim INSERT-om: okidač
`knjige_unos_clana` uvek postavlja `izvor='clan'` i `u_fondu=false`. Odakle je korica
čuva se u `korice_izvor`. (Zato izvor knjige ne razlikuje Google od ručnog upisa.)

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
