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
direktno u JSX. Fajl mora ostati običan JS bez uvoza, jer ga čita i
`vite.config.js` (manifest, naslov stranice).

**Tekst aplikacije je na ćirilici, u src/lib/tekst.js.** Ekavica, obraćanje sa „vi".
Ključevi, nazivi promenljivih, rute, tabele, kolone i vrednosti koje se čuvaju u bazi
(`nova`, `spremna`, `citalac`...) ostaju latinični; ćirilica je samo u vrednostima.
Latinicom ostaju i nazivi koji se ne prevode: {placeholderi}, https://, Google Books,
COBISS, ISBN, jpeg, png, webp, MB. „PIN” se piše „ПИН”. Poruke grešaka iz `api/`
(`poruka` u `ApiGreska`) su takođe na ćirilici, a kodovi (`kod`) latinični; korisnik
vidi tekst iz `tekst.js` po kodu. Komentari u kodu, README i ovaj fajl ostaju na latinici.
Novi natpis se piše odmah na ćirilici u `tekst.js`; ne ugrađivati tekst (ni latinicom ni
ćirilicom) u komponente ili `src/lib` (reči u množini, kao „примерак/примерка/примерака”, takođe idu u `tekst.js`).
`npm run test:api` proverava da u `tekst.js` nema latinice izvan zaštićenih izraza i da ostali
fajlovi nemaju ni ćirilicu ni latinične rečenice.

**Fontovi:** naslovi `Onest`, tekst `Inter`, oba **iz projekta** (`src/fonts.css`, paketi `@fontsource-variable/onest`
i `/inter`; promenljiva težina; samo podskupovi cyrillic, cyrillic-ext, latin, latin-ext). Nikakvih zahteva ka Google-u
(ni `index.html`, ni CSS ne smeju da pominju fonts.googleapis.com). Bricolage Grotesque iz prototipa nema ćirilicu i ne koristi se.

**Pretraga i ime pismom-neutralni:** knjige se traže u bazi (`trazi_knjige` → `privatno.norm_tekst`),
koja izjednačava ćirilicu i latinicu, pa klijent ne poredi tekst sam. Gde baza ne normalizuje
(pretraga članova po imenu) upit se šalje u oba pisma (`src/lib/pismo.js`). Nadimak „Ime P." radi i za
ćirilicu („Ана Петровић” daje „Ана П.”).

Ćirilica u funkciji `norm_tekst()` u migraciji `0001` je podatak (mapa slova za pretragu), ne
tekst aplikacije. Ne transliterovati je i ne dirati migracije radi pisma.

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
- **Aplikacija nije povezana sa COBISS-om i ne treba da bude** (nemamo API ključ, a to nije cilj): to je lična
  evidencija čitalaca (polica, utisci, preporuke). Zato **nema rezervacija, dostupnosti ni stanja zaliha** u
  interfejsu: ni „Rezerviši”, ni „U fondu, N primeraka”, ni „Slobodnih”, ni „Izdato”. Ne vraćati ih. Migracija
  0018 (stanja rezervacije) je puštena u bazu, ali je ništa ne koristi; tabela `rezervacije` ostaje nedirnuta.
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
- **Uvoz sa stranice izdavača** (`api/iz-liste.js`, `UvozSaListe.jsx`) ne menja ovo pravilo, nego ga proširuje na
  jedan korak ranije: bibliotekar lepi adresu STRANICE SA SPISKOM, na dugme se čita jedna stranica i izvlači najviše
  50 linkova (`api/_lib/spisak-knjiga.js`); izabrani (najviše 20) idu kroz istu `obradiRedom`, jedna po jedna, sa
  pauzom. **Pravila koja se ne oslabljuju:** samo na klik bibliotekara (nema automatskog ni zakazanog prolaska i
  nema praćenja paginacije: „sledeća stranica" je novi klik); ista SSRF zaštita i bela lista kao `iz-linka`; pre
  stranice se čita `robots.txt` istim zaštićenim preuzimačem (`api/_lib/robots.js`): zabrana za „Citaliste" ili „*"
  prekida uz poruku, nečitljiv `robots.txt` ne prekida, `Crawl-delay` se poštuje (najviše 30 s) i primenjuje i između
  knjiga; linkovi koje `robots.txt` zabranjuje se ne nude; kanta je ista kao za `iz-linka` osoblja (200 na sat; spisak
  troši 1, svaka obrađena knjiga po 1); server ništa ne čuva (nema tabele ni keša za spisak). Kartice iz uvoza počinju
  kao „Само нацрт" (ništa se ne upisuje bez izbora „Имамо"/„Набављамо" i potvrde). Heuristika „liči na knjigu" nije
  proveravana na pravim sajtovima; kad sajt promeni izgled, dopunjava se `OBRASCI_SAJTOVA` (po jedan obrazac putanje).
- **Opis se ne povlači sa sajta.** `pocetnaForma` ga ostavlja praznim, a piše ga bibliotekar.
  `npm run test:api` proverava da opis sa sajta nikad ne dospe u formu ni u red za upis.
- **Upis** ide običnim klijentom kao prijavljeni bibliotekar, nikad kroz `service_role`. Izvor je
  `fond` za „U fondu" i `link` za „Za nabavku"; okidač `knjige_unos_clana` za bibliotekare ne dira
  `izvor`, `u_fondu` ni broj primeraka (čitaocima ih vraća na `clan`, `false`, 0). `test:db` i `test:rls` to proveravaju.
- **Duplikati** se proveravaju neposredno pre upisa preko `trazi_knjige` (ISBN-13, pa naslov i
  autor; normalizaciju radi baza). Povećanje primeraka je izmena sa uslovom na staro stanje, pa
  istovremena izmena ne daje pogrešan broj.

## Članovi (/bibliotekar/clanovi)

- **Nalog pravi samo server** (`api/napravi-clana.js`, `api/resetuj-pin.js`): Auth nalog i PIN traže
  `service_role`, koji nikad ne dolazi u pregledač. Klijent (`src/lib/clanovi.js`) ih zove preko
  `pozoviApi`. Aktivacija i deaktivacija i liste idu običnim klijentom (RLS).
- **PIN**: 6 cifara iz `crypto.randomInt` (`api/_lib/pin.js`), tekst, sme da počne nulom. Vraća se
  **jednom** u odgovoru; ne čuva se, ne loguje, ne ide u poruku greške (log preko `bezPina`), a u
  pregledaču živi samo u stanju ekrana (nikad localStorage). Ne praviti „prikaži PIN opet".
- **Uloga novog člana je uvek `citalac`** i ne čita se iz zahteva. Uloga pozivaoca se čita iz baze.
  Bibliotekar resetuje PIN samo čitaocima; administrator svima. Isto pravilo ponavlja
  `mozeDaUpravlja` u interfejsu, ali bezbednost je u funkciji i u bazi.
- **Bibliotekar ne dira administratora ni u bazi** (0020): okidač `clanovi_zastita` baca 42501 za izmenu reda sa
  ulogom administrator, ne dozvoljava promenu uloge, a `clanovi_insert_zastita` bibliotekaru dozvoljava samo
  upis čitaoca. Politike na `clanovi` se ne menjaju (politika ne zna za vrednost kolone). Ne vraćati proveru
  samo u interfejs.
- **Broj karte člana je 7 cifara kao tekst** (`proveriBrojKarte`, `src/lib/clan-unos.js`); broj koji
  stigne kao JSON broj se odbija jer je vodeća nula već izgubljena. Ostalo o kartama: „Klijent".
- **Ograničenje**: kanta `clanovi:bibliotekar`, 60 na sat po korisniku, zajednička za obe funkcije.
- **Kartica za štampu** (`PinPrikaz.jsx`) je portal u `<body>`; `@media print` u `index.css` sakriva
  sve ostalo. Ne vraćati štampu na `visibility: hidden` (ostavlja prazne stranice).

## Čitaoci (/citaoci, /citaoci/:id)

- **Veza je samo pozivom; nema spiska ni pretrage članova.** Ekran nikad ne čita `clanovi` (osim sopstvene šifre iz profila
  prijavljenog člana). Nadimak drugog člana dolazi samo iz pogleda `moje_veze` i `moje_preporuke` (0019). Ne dodavati upit koji vraća
  ime, broj karte ili šifru poziva drugog člana.
- **Nepostojeća šifra i šifra blokiranog člana daju istu poruku**: baza vraća istu grešku (`P0001`), `posaljiPoziv` je pretvara u jedan
  kod, a ekran ima jednu poruku. Ne razlikovati ih, ni u tekstu ni u kodu.
- **Blokirani ne saznaje za blokadu**: pogled izbacuje blokirane parove za obe strane, a blokada ne šalje nikakav signal.
- **Slobodnih poruka nema.** Jedino što član šalje drugom članu je preporuka knjige sa napomenom do 280 znakova (granica i u bazi).
- Šta se prikazuje određuje RLS i pogledi; React ništa ne filtrira po vezi ni po vidljivosti. Jedino pravilo ekrana je da se profil ne
  učitava dok veza nije prihvaćena (prvo `ucitajVezuSaClanom`).
- `preporuke.procitana = true` znači „primalac je odlučio" (želim, već pročitano, nije za mene). `skrivena` je samo moderacija.
- Svaka nova migracija za ovaj ekran ostaje idempotentna i bez izmene politika (0019 ne dira nijednu politiku).
- **Odblokiranje** (0023): spisak dolazi iz pogleda `moje_blokade` (samo moje blokade, samo nadimak), a odblokiranje je običan DELETE svoje
  blokade (`blokade_svoje`). Veza se ne vraća sama (pri blokadi je obrisana). Blokirani ne saznaje ni za blokadu ni za odblokiranje: nikakav
  signal, nikakva poruka. Ekran Читаоци ne pominje blokadu u toku poziva (isti odgovor za nepostojeću i blokiranu šifru).

## Nabavka (/bibliotekar/nabavka)

- **Izveštaj je samo agregat.** Čita se isključivo pogled `izvestaj_za_nabavku` (nad `privatno.izvestaj_nabavke()`,
  SECURITY DEFINER, proverava `je_bibliotekar()`): po knjizi samo `zele` i `citaju_ili_procitali` (brojevi), ostalo su
  podaci o knjizi. Nema id-a članova, imena, nadimaka ni vremena kad je neko stavio knjigu na policu, i ekran ne sme da
  dobije put do njih. RLS na `polica` se ne menja. Broj se prikazuje tačno (i 1): ekran je samo za bibliotekare, a bez
  imena i vremena broj nikoga ne otkriva. Ne dodavati spisak čitalaca uz knjigu ni „ko je želi".
- **Odluka** (`knjige.odluka_nabavke`: `imamo`, `nabavljamo`, `ne_nabavljamo`, null) i datum su jedino mesto gde se kaže da li
  biblioteka ima knjigu (nema COBISS-a). Datum postavlja okidač; „imamo" postavlja `u_fondu = true`, ostale odluke
  `u_fondu = false`. Odluku menja samo bibliotekar (postojeća politika `knjige_update_bibliotekar`); član koji sam
  upiše naslov ne može da je postavi. **Okidač radi samo pri izmeni (UPDATE), ne pri upisu (INSERT)**: ekran za unos zato
  sam upisuje `odluka_nabavke` (`imamo`/`nabavljamo` po stanju kartice) i `odluka_datum` uz knjigu (`urediUnos`), pa sačuvana
  knjiga nije među „Нове"; `u_fondu` je već u skladu sa odlukom. Datum pri upisu je sat bibliotekara.
- CSV (`nabavka-logika.js`): UTF-8 sa BOM-om, `sep=;`, polja u navodnicima, tekst koji liči na formulu dobija apostrof,
  ISBN se piše kao `="…"`.

## Све књиге (/bibliotekar/knjige)

- Ekran čita **samo** dve funkcije iz 0024 (`pregled_knjiga_zbir`, `pregled_knjiga`): knjige i zbirni brojevi. Nikad tabele `polica` i `clanovi`,
  nikad `knjige.uneo_id`. Bibliotekar po politici sme da čita celu policu red po red (sa id-evima članova); zato se zbir računa u bazi i
  klijent nikad ne dobija nijedan red police. Ne dodavati kolonu koja vodi do člana (unosilac, ko je stavio, vreme na polici).
- `izvor` je stvarna kolona (`fond`, `link`, `google_books`, `clan`). Okidač `knjige_unos_clana` članu uvek upiše `clan`, pa `google_books` i `link`
  dolaze od bibliotekara/servisa; ekran zato piše „Додао члан" samo za `clan`.
- Odluka je efektivna (isto kao izveštaj za nabavku): `u_fondu` bez odluke je „imamo". Spojeni duplikati se ne računaju u ukupno.
- Nepoznata vrednost filtera ili redosleda je greška 22023 u bazi; klijent je ne šalje (`parametriPregleda`).
- **Izdavač** (0025): ključ je `privatno.norm_tekst(btrim(izdavac))`, a prikaz je najčešći zapis u grupi (nad svim matičnim knjigama). Spisak izdavača prati pretragu,
  izvor i odluku, ne i izabranog izdavača. Pretraga, izvor i odluka su na JEDNOM mestu (`privatno.pregled_knjige_filter`); spisak i lista ga dele, pa se ne razilaze.
  `p_izdavac` je ključ, a `__bez__` znači bez izdavača. Filteri ekrana žive u adresi (`?q=&izvor=&odluka=&izdavac=&redosled=`).

## Utisak sa pulta (/bibliotekar/utisak)

- Bibliotekar upisuje utisak U IME člana (običan klijent, RLS `utisci_insert` uz `uneo_bibliotekar_id = auth.uid()`). **Potpis čuva okidač**
  (0022): član ga ne može lažirati ni skinuti, bibliotekar ga ne postavlja naknadno, a autor koji promeni ocenu ili tekst preuzima utisak
  (potpis se poništava). Ne vraćati proveru potpisa u interfejs.
- **Vidljivost se ne pretpostavlja**: bibliotekar pita člana i bira, pa potvrđuje da član to želi. Ništa se ne objavljuje „iz navike".
- **Postojeći utisak člana se ne prepisuje** (nema update-a ni upsert-a u `pult.js`); svoje reči menja samo član.
- Neaktivnom članu se ne upisuje (22023). **Polica se ne dira**: `polica_svoja` dozvoljava pisanje samo vlasniku, a ne proširivati je.
- Član vidi napomenu `tekst.utisak.zapisanNaPultu` uz svoj utisak; to je jedino mesto gde se potpis prikazuje (drugi članovi ga ne vide).

## Prijave (/bibliotekar/prijave)

- **Osoblje vidi samo prijavljeno.** Preporuku čita bibliotekar jedino dok postoji prijava na nju (`preporuke_prijavljene_select`,
  0005); ekran nikad ne traži preporuke koje nisu u nekoj prijavi i ne dodaje spisak „sve preporuke". Ne širiti ovo pravo.
- **Prijavljuje se samo ono što prijavilac vidi** (0021, okidač `prijave_provera_bi`, namerno NIJE SECURITY DEFINER da RLS
  prijavioca određuje šta „vidi"): tuđi utisak, preporuka koju je prijavilac primio, ili član sa kojim je povezan. Bez toga je prijava
  bila put do tuđe prepiske. Okidač propušta prijavu u tuđe ime (to odbija politika) i servisnu ulogu.
- **Bibliotekar menja samo `resena` i `beleska`** (okidač `prijave_zastita_bu`); ko je rešio (`resio_id`) i kada (`resena_datum`)
  postavlja baza (`auth.uid()`, `now()`), nikad klijent. Ne slati ta polja iz `src/lib/prijave.js`.
- **Ništa se ne briše.** Radnje su sakrivanje i vraćanje utiska (`utisci.skriven`) i preporuke (`preporuke.skrivena`) i
  deaktivacija člana (ista pravila kao na ekranu Članovi, administratora štiti baza). Prijava preživi brisanje stavke (nema
  stranog ključa), pa ekran piše „više ne postoji".
- **Ni prijavljeni ni prijavilac ne saznaju ishod.** Prijavljeni nema politiku za čitanje prijava. Nema obaveštenja ni „statusa
  prijave" za članove.
- Tačka na stavci „Библиотека" (Okvir) i broj na početnom ekranu osoblja dolaze iz brojanja nerešenih (`ucitajBrojOtvorenih`).

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

## Miran prelaz između ekrana

- `html { scrollbar-gutter: stable }` (index.css): bez toga kratka stranica (bez trake za skrolovanje) i duga (sa trakom) imaju različitu širinu sadržaja, pa se
  pri prelasku između kartica sve pomera levo-desno. Ne uklanjati.
- `PovratakNaVrh` vraća skrol na vrh samo pri promeni putanje (ne za POP/„nazad", ne za filtere u adresi). Okvir je izgled sa Outlet-om i ostaje montiran.
- Ekrani sa podacima drže `Skeleton` (blokovi stalne visine) umesto reda „Учитавам…". Naslov svake kartice ima `pt-2`. Značke u navigaciji su apsolutno
  pozicionirane. Dozvoljena je samo providnost (animate-pulse); nikakvo translate/slide, a prefers-reduced-motion gasi sve.

## PWA ljuska

- `vite.config.js`: `registerType: "prompt"`, `generateSW`, precache samo statičkih fajlova (html, js, css, slike, fontovi, manifest),
  `navigateFallback: "/index.html"` sa `/api` van njega. **Nema `runtimeCaching`**: Supabase i `/api` pozivi uvek idu na mrežu,
  nikad iz keša. Ne dodavati keširanje podataka; polica i utisci moraju da budu svežu iz baze.
- `src/lib/pwa.js` (uvozi se u `main.jsx`, da ne propadne `beforeinstallprompt`) drži jedno malo spoljno skladište: nova verzija,
  veza, instalacija. Nova verzija se primenjuje **tek na dodir „Освежи"** (traka `TrakeLjuske`), nikad tiho usred rada.
- Traka „Нема везе са интернетом" prati `navigator.onLine` (približno); greške učitavanja i dalje imaju poruke na ekranima.
- Instalacija: `KarticaInstalacije` na Profilu (dugme preko `beforeinstallprompt`; iPhone: uputstvo „Подели → Додај на почетни екран").
- `theme_color` i `background_color` su boja aplikacije (`#f4efe5`), jer je zaglavlje bež.

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
