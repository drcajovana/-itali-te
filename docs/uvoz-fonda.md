# Uvoz fonda iz CSV-a (jednokratno)

Skripta `scripts/uvezi-fond.mjs` uvozi `uvoz/fond-2025-2026.csv` (izvoz iz COBISS-a: `cobiss_id, naslov, autor, izdavac, godina, isbn, primeraka`)
u tabelu `knjige`. Logika je u `src/lib/uvoz-fonda.js` (proverava je `npm run test:api`), a `npm run test:db` proverava kako se okidači ponašaju
prema ovakvom upisu. Fajl `uvoz/` je u `.gitignore` i ne ide na GitHub.

```bash
npm run admin:uvezi-fond              # probno (podrazumevano): ništa se ne upisuje, ispisuje se plan
npm run admin:uvezi-fond -- --upisi   # upis u bazu, serije po 200, pa kontrola da je drugi prolaz prazan
npm run admin:uvezi-fond -- --fajl=drugi.csv --primeri=20
```

Radi sa servisnim ključem iz `.env` (`SUPABASE_SERVICE_ROLE_KEY`), kao `scripts/resetuj-pin.mjs`. Ključ se nigde ne ispisuje. I probni režim čita bazu (samo
`select` iz `knjige`), da bi mogao da kaže šta je novo, a šta već postoji.

## Šta se upisuje

Nova knjiga: `naslov`, `autor`, `izdavac`, `godina`, `isbn`, `zanrovi` (ako CSV ima kolonu `zanrovi`, vidi ispod), `izvor = 'fond'`, `u_fondu = true`. Ništa drugo: **ne** upisuju se COBISS ID (veza sa COBISS-om je
uklonjena iz aplikacije), broj primeraka (aplikacija ih ne vodi; ostaje 0), opis, korice, `uneo_id` (prazan) ni odluka nabavke (prazna: knjiga u fondu bez odluke je
efektivno „Имамо", isto kao u izveštaju za nabavku i u „Све књиге").

## Kako se poznaje ista knjiga

- **Sa ISBN-om:** isti normalizovan ISBN (13 cifara, kao u `src/lib/isbn.js` i `privatno.isbn13`) je ista knjiga. Svaki ISBN postoji samo jednom (migracija 0026).
- **Isti ISBN a različit naslov** je i dalje ista knjiga: u bazi se postojeća knjiga dopunjava (naslov se ne prepisuje), a u CSV-u se uvozi samo prvi red, ostali se
  preskaču. Takvi slučajevi se ispisuju u izveštaju (dva odeljka), da naslove proverite ručno.
- **Bez ISBN-a:** normalizovan naslov + autor + godina.
- Dodatno (da se ne napravi duplikat): knjiga iste godine, naslova i autora koja u bazi **nema** ISBN smatra se istom, pa dobija ISBN. U izveštaju se broji posebno.
- Spojeni duplikati u bazi (`spojena_sa_id`) se ne porede.
- Ista knjiga dvaput u samom CSV-u (više COBISS zapisa) uvozi se jednom; ponovljeni redovi se ispisuju.

## Postojeća knjiga se samo dopunjava

`u_fondu = true`, `izvor = 'fond'` (ako je bio drugi), i samo **prazna** polja (autor, izdavač, godina, ISBN, žanrovi). Popunjeno se ne prepisuje (žanr koji je bibliotekar upisao ostaje). **Odluka nabavke se ne menja**:
ako je postojeća knjiga imala odluku „набављамо" ili „не набављамо", a sada postaje „у фонду", to se ispiše u izveštaju da ga bibliotekar ručno uskladi.

## Neispravan ISBN ili godina

Knjiga se uvozi, polje se izostavlja i to se ispisuje kao upozorenje (neispravan ISBN bi se inače, pri servisnom upisu, upisao kakav jeste: okidač `knjige_isbn`
ne odbija servisnu ulogu). Odbija se samo red bez naslova.

## Zaštite u bazi koje su proverene pre prvog pokretanja

| Okidač / pravilo | Ponašanje prema uvozu |
|---|---|
| `knjige_unos_clana` (BEFORE INSERT) | Servisna uloga je izuzeta: ne prepisuje `izvor`, `u_fondu`, `uneo_id` (za članove bi ih vratio na `clan`, `false`, `auth.uid()`) |
| `knjige_odluka_zastita` (BEFORE UPDATE) | Radi samo pri izmeni odluke; uvoz je ne dira, pa `odluka_nabavke` i `odluka_datum` ostaju kakvi jesu |
| `knjige_isbn` (BEFORE INSERT/UPDATE OF isbn) | ISBN sa crticama postaje 13 cifara; neispravan bi ostao sirov, zato ga skripta ne šalje |
| `knjige_korice_biu` | Skripta ne šalje korice, pa se ne aktivira |
| `knjige_slobodnih_ne_vise_od_primeraka` | 0 i 0, u redu |
| RLS | Servisna uloga zaobilazi RLS |

## Korice

Uvoz ne dira korice. U aplikaciji se korica za knjigu bez fotografije traži **pri prikazu** (ne pozadinski): Open Library po ISBN-u, a ako je nema (ili knjiga nema ISBN),
prikazuje se generisana pločica u boji sa naslovom i autorom (`Korica.jsx`). Fotografiju bibliotekar dodaje na stranici knjige.

## Izvoz iz COBISS-a u xlsx obliku (2023.)

Sirov izvoz iz COBISS-a (xlsx, 29 kolona na ćirilici) pretvara se u CSV iz ovog dokumenta bez ikakve biblioteke:

```bash
npm run admin:cobiss-csv -- "C:\Users\PC\Downloads\export (1).xlsx" --izlaz=uvoz/fond-2023.csv   # ne treba .env ni bazu; ne prepisuje postojeći CSV bez --prepisi
npm run admin:uvezi-fond -- --fajl=uvoz/fond-2023.csv                                             # probno
npm run admin:uvezi-fond -- --fajl=uvoz/fond-2023.csv --upisi
```

Pravila pretvaranja (`scripts/cobiss-izvoz.mjs`, proverava ih `npm run test:api`), ista kao u ranijim CSV-ima: **autor** je varijanta sa ćirilicom („Арден, Кетрин = Arden, Katherine"
→ „Кетрин Арден"; ako je nema, prva), „Prezime, Ime" postaje „Ime Prezime" (osim kad iza zareza ima cifara); **ISBN** je prva vrednost bez napomena u zagradama
(„978-86-7818-742-1 (PortaLibris; брош.)" → 9788678187421); **primeraka** iz polja 998c (`?c2/…` → 2); naslov i izdavač ostaju kakvi jesu. Redovi bez naslova se preskaču.
Izvoz iz 2023. ima 1359 zapisa (sve su iz 2023, monografske publikacije); 93 su bez autora, 7 bez ISBN-a („Брош." bez broja), takvi se uvoze bez tih polja.

## Žanrovi (iz UDK-a)

Izvoz iz COBISS-a ima kolonu „УДК за претраживање" (npr. „821.163.41 - Српска књижевност; 94(497.11) - Историја Србије"). Pretvarač (`npm run admin:cobiss-csv`) je
pretvara u kolonu `zanrovi` CSV-a: svaka UDK oznaka ide u jednu od oko 23 grupe po oblasti (srpska / strana književnost i književnost regiona, dečje knjige, strip, istorija,
biografije, psihologija, filozofija i religija, ekonomija i pravo, medicina, tehnika, umetnost, sport, opšte znanje…), grupe se sabiraju bez ponavljanja, **najviše tri**
po knjizi. Oznaka koju nijedno pravilo ne poznaje se ignoriše: knjiga bez poznate oznake ostaje bez žanra, a ne sa pogrešnim.

Tabela pravila i nazivi grupa su u `scripts/udk-zanrovi.mjs` (menja se samo tamo; nazivi ne smeju da imaju zarez ni tačku-zarez, jer se žanrovi njima razdvajaju). Nazivi su
podaci koji idu u bazu, ne tekst aplikacije. UDK je naučna klasifikacija: razlikuje oblast i jezik književnosti, ali ne i krimić, ljubavni roman ili fantastiku.

U aplikaciji se žanr vidi i filtrira u „Све књиге" (bibliotekar i administrator): padajući izbor „Жанр" sa brojem knjiga u svakom žanru i opcijom „Без жанра", žanrovi na kartici
i u dijalogu o knjizi. To je migracija `0030_pregled_knjiga_zanr.sql` (proširuje funkcije pregleda, a nova je `pregled_knjiga_zanrovi`); stanje filtera je u adresi (`?zanr=`).

Kolona `zanrovi` nije obavezna (stariji CSV-ovi je nemaju, uvoz tada radi kao pre). Ponovni uvoz izvoza **dopunjava žanrove i knjigama koje su već u bazi** (isti ISBN):
probni režim to prikazuje kao „postojećim knjigama se dopunjuje žanr", a knjiga kojoj je žanr već upisan se ne menja. Da bi se žanrovi dopunili starim knjigama, treba ponovo
izvesti iz COBISS-a (stari CSV-ovi nemaju UDK) i pustiti `admin:cobiss-csv`, pa `admin:uvezi-fond` (probno, pa `--upisi`).

**Obrisane knjige.** Uvoz ne zna da je neka knjiga namerno obrisana iz baze: za njega je „nova" i vratio bi je. Zato postoji `--samo-dopune`
(`npm run admin:uvezi-fond -- --fajl=… --samo-dopune [--upisi]`): nove knjige se ne upisuju, samo se dopunjuju one koje su već u bazi (npr. žanrovi iz ponovnog izvoza).
Probni režim ispiše koliko novih knjiga se preskače.

## Idempotentnost

Drugo pokretanje ne pravi duplikate: skripta pri `--upisi` na kraju ponovo čita bazu i proverava da su „novih" i „dopuna" 0.

## Poznata posledica

Uvezene knjige imaju `broj_primeraka = 0`. Ekran za unos bibliotekara pri upozorenju o duplikatu ispisuje „u fondu, N primeraka"; za uvezene knjige piše 0 (primerci se
ne vode). Pregled „Све књиге" i izveštaj za nabavku ne zavise od toga.
