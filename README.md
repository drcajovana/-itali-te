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
| 3. Pretraga knjiga | ✅ `/pretraga`: naša baza, Google Books, link, ručni upis; dodavanje na policu. **0007 i 0008 još nisu u bazi**, a Google Books traži API ključ (vidi niže) |
| 3a. Unos linkom | ✅ `api/iz-linka.js`, parser prenet iz `docs/nabavka-extract.js` |
| 3b. Korice | ✅ lanac: naša baza → Google Books → Open Library → slika sa linka → pločica |
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

Redosled nije proizvoljan: `0003` i `0005` se oslanjaju na
`privatno.su_povezani()` iz `0002`, a politika na `preporuke` gleda u `prijave`,
pa `0004` mora pre `0005`.

### Pretraga, unos linkom i API funkcije

Strana `/pretraga` traži redom: naša baza (`trazi_knjige`, ćirilica i latinica
daju iste rezultate) → Google Books → polje „zalepi link" → ručni upis naslova i
autora, koji je uvek dostupan. Ručno upisana knjiga ide na policu kao „nije u
fondu" i ulazi u izveštaj za nabavku.

Dve funkcije na Vercel-u (`api/`), obe: samo POST, proveravaju Supabase JWT iz
`Authorization` zaglavlja (bez njega 401), ograničavaju na **30 zahteva na sat po
članu** (tabela `zahtevi_api`) i vraćaju isti normalizovan oblik
`{ naslov, autori, izdavac, godina, isbn, opis, korica, izvor, url }`:

| Funkcija | Šta radi |
|---|---|
| `api/pretraga-google.js` | Google Books po naslovu, autoru ili ISBN-u (`izvor: 'google_books'`) |
| `api/iz-linka.js` | čita Open Graph i JSON-LD jedne stranice knjige (`izvor: 'link'`); kad parser ne nađe ništa, vraća bar naslov iz `<title>` |

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
se lepe u SQL Editor, redom (0001 do 0006 su tamo; 0007 i 0008 treba zalepiti). Zato je tabela
`supabase_migrations.schema_migrations` u bazi **prazna** i CLI misli da ništa
nije primenjeno. Kad se ostvari veza, uskladiti:

```bash
npx supabase migration repair --status applied 0001 0002 0003 0004 0005 0006 0007 0008
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
