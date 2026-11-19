# Objava svim članovima: spisak za izvođenje

Ovo je spisak, ne izveštaj: **objavu ne izvodi kod**, nego ljudi, i većina stavki je izvan repozitorijuma. Redosled je važan.
Svaka stavka ima ko je radi i kako se zna da je gotova. Plan (PLAN.md, tačka 6) traži tri stvari pre objave: napunjena platforma,
prvi krug pozvan lično i pravila korišćenja sa obaveštenjem o obradi podataka.

## 0. Šta je u kodu spremno, a šta nije

Spremno (sve prolazi `build`, `lint`, `test:api`, `test:db`): prijava kartom i PIN-om, polica, utisci, čitaoci i preporuke,
blokada i prijave, moderacija, članovi i štampa kartice, unos knjiga linkom i sa stranice izdavača, izveštaj za nabavku, PWA.

**Nije u aplikaciji, a plan ili rizici to pominju** (odlučite da li je uslov za objavu):

| Šta | Zašto je bitno | Stanje |
|---|---|---|
| Pravila korišćenja i obaveštenje o obradi podataka (ZZPL) | PLAN tačka 7 i rizik „Lični podaci članova"; članovi su i maloletni | Nema teksta ni ekrana. Tekst mora da napiše i odobri biblioteka (pravnik/direktor); ja ga ne izmišljam. Kad postoji, ekran je mali posao. |
| Roditeljska saglasnost za mlađe od 15 godina | Kolona `clanovi.roditeljska_saglasnost` postoji, ništa je ne popunjava ni proverava | Dogovoriti da li je to papir na pultu (pa ništa u aplikaciji) |
| Utisak „sa pulta" (bibliotekar unosi u ime člana) | Rizik „Stariji članovi ne koriste" | **Gotovo** (`/bibliotekar/utisak`, migracija 0022). Ne stavlja knjigu na policu člana |
| QR na članskoj karti | Isti rizik | Nema |
| Odblokiranje člana | Blokada je bila jednosmerna u interfejsu | **Gotovo** (ekran „Читаоци”, migracija 0023) |
| Kanal za povratne informacije članova | Posle objave neko mora da čuje šta ne radi | Dogovoriti (mejl, papir, razgovor na pultu) |

## 1. Baza (Supabase) — radi osoba sa pristupom SQL Editoru

1. Zalepiti u SQL Editor, tim redom, migracije koje još nisu u bazi (**0013 do 0021**; proveriti u README, „Migracije su puštene ručno").
   Posle svake koja menja poglede ili kolone: `notify pgrst, 'reload schema';`.
2. Pokrenuti `npm run test:rls` **na bazi koja ima iste migracije** (piše test naloge `rls-test-*@citaliste.test` i čisti ih).
   Ovo je jedina provera prave baze; do sada nikad nije pokrenuta u celini. **Ne objavljivati dok sve faze (1 do 16) ne prođu.**
   Ako padne, ne ispravljati test, nego pravilo.
3. Napraviti prvog administratora: `npm run admin:napravi` (vidi README). Odmah proveriti da se prijavljuje i da vidi `/bibliotekar`.
4. Uključiti dnevne rezervne kopije baze (Supabase: Database → Backups; na besplatnom planu ih nema, pa je potreban plan sa
   kopijama ili ručni izvoz pre objave). Zabeležiti ko i kako vraća bazu.

## 2. Vercel

1. Promenljive okruženja (Production): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY` (Secret), `GOOGLE_BOOKS_API_KEY`. `ZAHTEVI_BEZ_BAZE` **ne sme** biti postavljena. `INFOBIP_*` nisu
   potrebne (SMS nije u aplikaciji). Servisni ključ nikad sa `VITE_` prefiksom.
2. Posle puštanja proveriti u pregledaču (Network): `/api/*` odgovara samo na POST, bez ključa u odgovoru; u zaglavljima stoje
   `X-Frame-Options`, `X-Content-Type-Options` (vercel.json) i `/sw.js` ima `no-cache`.
3. Domen i HTTPS (obavezan za instalaciju na telefon). Adresa koja se deli članovima mora da bude konačna: promena domena kasnije
   ruši instalirane ikone i ulogovane sesije.
4. Aplikacija ima `noindex` (pretraživači je ne indeksiraju); ako biblioteka želi da se prijava nalazi pretragom, ukloniti
   meta oznaku iz `index.html`.

## 3. Sadržaj pre objave („prazna platforma")

1. Uneti fond: `Библиотека → Унос књига` (link ili stranica izdavača). Cilj iz plana: bar nekoliko stotina knjiga koje članovi znaju.
2. Bibliotekari sami (kao članovi) stavljaju knjige na policu i pišu prvih ~50 utisaka pre nego što ih vide drugi.
3. Proveriti `Библиотека → Набавка`: nema stavki bez odluke koje su ostale od probe.
4. Obrisati probne naloge i probne knjige iz faze 10 (probni članovi se deaktiviraju ili brišu iz Supabase Auth; brisanje naloga
   kaskadno briše policu, utiske, veze i preporuke).

## 4. Bibliotekari

1. Svaki bibliotekar dobije nalog (administrator ga pravi preko `Чланови`) i prođe README „Uputstvo za bibliotekare":
   upis člana, štampa kartice, novi PIN, prijave, nabavka.
2. Dogovoriti **ko moderira**: ko svakog dana otvara `Библиотека → Пријаве` (tačka na meniju upozorava), u koliko sati se odgovara,
   šta se radi sa prijavom koja je ozbiljna (maloletnik, uznemiravanje): to je odluka biblioteke, ne aplikacije.
3. Isprobati na pultu ceo tok jednog člana: upis, štampa kartice sa PIN-om, prva prijava na telefonu, instalacija, jedan utisak.

## 5. Prvi krug (pozvan lično)

1. 10 do 15 članova različitog uzrasta; bar jedan sa iPhone-om, bar jedan sa starijim Android telefonom.
2. Svaki dobija štampanu karticu sa PIN-om (PIN se vidi samo jednom, pa se štampa odmah) i usmeno: kako se instalira
   („Подели → Додај на почетни екран" na iPhone-u, dugme na Profilu na Androidu).
3. Posle 1 do 2 nedelje: pregledati prijave, izveštaj za nabavku i šta su članovi javili. Tek onda širiti.

## 6. Širenje na sve članove

1. Članove upisuje bibliotekar na pultu uz članstvo (aplikacija nema samoregistraciju, to je namerno).
2. Obaveštenje (plakat, društvene mreže, članska karta): adresa, i da se prijava radi brojem karte i PIN-om.
3. Rezerva za prvi mesec: jedna osoba koja prati prijave i povratne informacije svakog radnog dana.

## 7. Ako nešto krene naopako

| Problem | Šta |
|---|---|
| Neprimeren sadržaj | Sakriti utisak ili preporuku iz `Пријаве`; po potrebi deaktivirati člana |
| Član zaboravio PIN | `Чланови → Нови ПИН` (administratora resetuje samo administrator) |
| Loša nova verzija | Vercel: Deployments → prethodna verzija → Promote. Instalirani telefoni dobijaju traku „Нова верзија је спремна" |
| Baza ne odgovara | Funkcije odbijaju zahteve (500/503), ekrani pokazuju grešku; ništa se ne gubi. Proveriti Supabase status |
| Procureo ključ | Zameniti ga u Supabase i Vercel odmah (servisni ključ: Settings → API); redeploy |

## 8. Šta nije provereno (poštenje spiska)

Prava baza i `test:rls`, pravi telefon, rad bez mreže, instalacija, izgled na 375 px, parser stranica izdavača na pravim
sajtovima, Google Books ključ u produkciji, štampa kartice na pravom štampaču.
