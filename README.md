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
| 2. Prijava članskom kartom | ⬜ |
| 3. Pretraga i stranica knjige | ⬜ |
| 3a. Unos linkom | ⬜ parser postoji u `nabavka-knjiga`, treba ga preneti |
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

Redosled nije proizvoljan: `0003` i `0005` se oslanjaju na
`privatno.su_povezani()` iz `0002`, a politika na `preporuke` gleda u `prijave`,
pa `0004` mora pre `0005`.

### Migracije su puštene ručno

Port 5432 je blokiran sa razvojne mreže, pa `supabase db push` ne radi. Svih
šest migracija je zalepljeno u SQL Editor, redom. Zato je tabela
`supabase_migrations.schema_migrations` u bazi **prazna** i CLI misli da ništa
nije primenjeno. Kad se ostvari veza, uskladiti:

```bash
npx supabase migration repair --status applied 0001 0002 0003 0004 0005 0006
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
   `posalji_poziv()`, `prihvati_poziv()` i `spoji_knjige()`.

## Tehnički stek

React 19 + Vite 8, Tailwind 4, Supabase (Postgres, Auth, Storage), Vercel.
PWA preko `vite-plugin-pwa` — Service Worker nikad ne presreće POST zahteve
(plan, tačka 4).

Sav tekst interfejsa je u [`src/lib/tekst.js`](src/lib/tekst.js) (latinica; ćirilični
prevod se dodaje kao drugi objekat, bez diranja komponenti).

Supabase klijent je **singleton** u [`src/lib/supabase.js`](src/lib/supabase.js).
Ako se negde napravi drugi, Auth sesija počinje da se duplira.
