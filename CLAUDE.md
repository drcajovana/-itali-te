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

Kad politika treba da zna ulogu ili vezu, zove pomoćnu funkciju
(`je_bibliotekar()`, `su_povezani()`), nikad ne gleda `clanovi` direktno —
`clanovi` i sama ima RLS, pa direktan upit proizvodi beskonačnu rekurziju.

Pogledi se prave sa `with (security_invoker = true)`. Bez toga pogled se
izvršava sa pravima vlasnika i tiho zaobiđe RLS.

Polja koja korisnik ne sme da menja (`uloga`, `aktivan`, `skriven`,
`u_fondu`, …) čuvaju BEFORE triggeri, ne aplikacija. RLS ume da kaže „smeš da
menjaš ovaj red", ali ne i „smeš da menjaš ovu kolonu".

## Klijent

Supabase klijent je singleton u `src/lib/supabase.js`. Uvozi se odatle, nikad
se ne pravi novi `createClient`.

Broj članske karte nije e-adresa, pa Auth radi sa sintetičkom
`{broj_kartice}@citaliste.local` i PIN-om kao lozinkom (plan, tačka 4).

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
