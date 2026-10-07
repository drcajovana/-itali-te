# PLAN.md — Čitalište

Čitalačka platforma Narodne biblioteke „Dositej Novaković" u Negotinu.

---

## 1. Šta je ovo

Veb aplikacija (PWA) u kojoj članovi negotinske biblioteke vode evidenciju
pročitanih knjiga, ostavljaju utiske, dobijaju preporuke i okupljaju se u
čitalačkim klubovima.

Nije Goodreads na srpskom. Razlika je u tome što je platforma vezana za **fond
naše biblioteke** — knjiga koju vidiš u preporuci možeš odmah da proveriš da li
je slobodna i da je rezervišeš.

**Ime:** „Čitalište" — po istorijskom nazivu za srpska čitalačka društva iz
19. veka. Vezuje projekat za tradiciju same institucije.

### Zašto biblioteka ovo radi

- Digitalna usluga za članove, bez dodatnih troškova licenci
- Podaci o tome šta se stvarno čita → osnov za plan nabavke
- Merljivi pokazatelji aktivnosti za izveštaje prema osnivaču i Ministarstvu
- Oživljavanje čitalačkih klubova (online diskusija između sastanaka uživo)

### Šta NIJE u obimu

- Čitanje e-knjiga u aplikaciji (nije biblioteka e-izdanja)
- Prodaja i plaćanje bilo čega
- Zamena za COBISS — COBISS ostaje izvor istine za katalog i zaduženja

---

## 2. Korisnici

| Uloga | Ko | Šta radi |
|---|---|---|
| Čitalac | Aktivan član biblioteke, svi uzrasti | Polica, ocene, utisci, klubovi |
| Bibliotekar | Zaposleni | Uređuje klubove, preporuke, vesti, moderiše utiske |
| Administrator | Jedna osoba (ti) | Korisnici, uvoz knjiga, podešavanja |

**Napomena o uzrastu:** korisnici su i osnovci i penzioneri. Interfejs mora da
radi bez objašnjenja — velika slova, jasna dugmad, bez gejmifikacije koja
odbija starije. Bibliotekar može da unese utisak u ime člana koji nije
digitalno vešt („zapisano na pultu").

---

## 3. Funkcionalnosti

### Faza 1 — MVP (cilj: upotrebljivo za prvi klub)

**Nalog**
- Prijava brojem članske karte + PIN koji dodeljuje bibliotekar
- Nema samostalne registracije — nalog postoji samo ako je članstvo aktivno
- Profil: ime, nadimak za prikaz, avatar (opciono), izbor omiljenih žanrova

**Polica**
- Tri stanja: *Čitam* / *Pročitano* / *Želim da pročitam*
- Dodavanje knjige pretragom baze
- Datum početka i završetka čitanja (opciono)

**Naslov koji nemamo — ključna funkcionalnost**

Kad pretraga ne nađe knjigu, član je **upisuje sam**: naslov, autor, i ništa
više. Zapis ide na policu sa oznakom *nije u fondu* i ulazi u listu za nabavku.

Ovo je namerno, a ne zaobilaznica. Član koji traži naslov koji nemamo jeste
najvredniji podatak koji aplikacija proizvodi. Ako ga pretraga odbije zato što
naslova nema u bazi, gubi se upravo ono zbog čega se sve i pravi.

**Izveštaj za nabavku (bibliotekar)**
- Naslovi sa liste želja koji nisu u fondu, poređani po broju traženja
- Spajanje duplikata (isti naslov unet različito) — bibliotekar spaja ručno
- Izvoz u tabelu, kao prilog uz predlog plana nabavke
- Naslovi koji jesu u fondu a stalno su izdati → predlog za dodatni primerak

**Knjiga**
- Osnovni podaci: naslov, autor, izdavač, godina, ISBN, signatura, žanr
- Prosečna ocena i broj utisaka
- **Dostupnost u fondu** (slobodno / izdato / nije u fondu) + dugme „Rezerviši"
- Lista utisaka drugih čitalaca

**Utisak (recenzija)**
- Ocena 1–10 (ne zvezdice — razlika između 7 i 8 je bitna)
- Tekst, opciono
- Vidljivost: javno / samo prijatelji / samo ja
- Označavanje spojlera (tekst se prikazuje zamagljen dok se ne klikne)

**Povezivanje čitalaca (pozivnicom)**
- Svaki član ima **šifru za poziv** (npr. `NEG·4471·KJ`), koju daje kome hoće
- Poziv se šalje unosom tuđe šifre; veza postoji **tek kad je druga strana prihvati**
- Nema javnog spiska članova i nema pretrage ljudi po imenu — jedini način da se
  dođe do nekoga jeste da ti on lično da šifru
- Povezani čitaoci vide: šta drugi trenutno čita, poslednje pročitano, ocene i
  utiske označene kao „samo prijatelji"
- **Direktna preporuka**: sa stranice knjige biraš kome šalješ + kratko
  obrazloženje. Primalac je dodaje na policu jednim dodirom ili odgovara.
- Raskidanje veze u svakom trenutku, bez obaveštenja drugoj strani

> Zašto pozivnicom, a ne otvorenom mrežom: korisnici su svih uzrasta, uključujući
> osnovce. Zatvoren model znači da niko ne može da priđe detetu koje ga ne poznaje.

**Ograničenja komunikacije (svesna odluka)**
- Nema slobodnog dopisivanja. Poruka uvek visi o konkretnoj knjizi — preporuka
  ili odgovor na preporuku. Time se kanal drži u okviru svrhe.
- Dugme „Prijavi" na svakoj poruci → ide bibliotekaru
- Blokiranje čitaoca, bez obaveštavanja blokiranog
- Za maloletne članove: roditeljska saglasnost pri otvaranju naloga; bibliotekar
  vidi prijave i može da raskine vezu i zaključa nalog

**Bibliotekarski panel**
- Unos knjiga linkovima (`/bibliotekar/unos`): adrese sa sajtova izdavača, redom, uz
  izmenljivu karticu po knjizi; stanje „U fondu" ili „Za nabavku"; opis piše bibliotekar
- „Preporuka bibliotekara" — istaknuta knjiga sa obrazloženjem
- Objave/vesti (promocije knjiga, gostovanja, radionice)
- Moderacija: prijavljene poruke, skrivanje neprimerenog utiska
- Uvid u veze maloletnih članova, mogućnost raskidanja

### Faza 2

- **Čitalački klubovi** — naziv, moderator-bibliotekar, knjiga meseca, termin
  sastanka u čitaonici, diskusija između sastanaka. Izbačeno iz MVP-a jer traži
  moderaciju i stalno održavanje sadržaja; ima smisla tek kad platforma ima
  aktivne čitaoce.
- **Katalozi izdavača.** Zvaničan dopis sa memoranduma biblioteke desetak
  najvećih izdavača (Laguna, Vulkan, Dereta, Booka, Geopoetika, Arhipelag,
  Čarobna knjiga, Kreativni centar, Klett, Clio) sa molbom za katalog u
  elektronskom obliku — ONIX ako imaju, inače Excel. Biblioteka im je kupac, pa
  je odziv verovatan. Deset mejlova umesto trista integracija; pokriva većinu
  onoga što čitaoci traže. Uvozi se istom skriptom kao i fond.
- Čitalački izazovi („12 knjiga za 12 meseci", „Zavičajna zbirka")
- Preporuke po žanru na osnovu istorije čitanja
- Zavičajna zbirka kao izdvojena celina (negotinski autori i lokalna istorija)
- Proširena statistika: najčitanije po žanru i uzrastu, aktivnost po mesecima,
  izveštaj u PDF-u za osnivača i Ministarstvo
- Ekran u biblioteci koji prikazuje trenutne preporuke članova

### Faza 3 (ako projekat zaživi)

- Događaji sa prijavom mesta
- Razmena knjiga među članovima
- Otvaranje platforme za druge biblioteke Borskog okruga (multi-tenant)

---

## 4. Tehnička arhitektura

**Stek** (standardni, kao na prethodnim projektima):

- React + Vite
- Tailwind CSS
- Supabase (Postgres, Auth, Storage) — RLS uključen u istoj migraciji
  kao i kreiranje tabele
- Vercel (hosting + serverless funkcije)
- Infobip za SMS — samo preko Vercel serverless funkcije, nikad sa klijenta
- PWA: Service Worker **nikad ne presreće POST zahteve**

**Supabase klijent:** singleton u `lib/supabase.js`.

### Autentifikacija

Broj članske karte nije e-mail, pa Supabase Auth koristimo sa sintetičkim
e-mailom oblika `{broj_kartice}@citaliste.local` + lozinkom (PIN-om). Bibliotekar
kreira nalog i štampa PIN na pultu. Reset PIN-a ide preko bibliotekara ili SMS-om
ako član ima upisan broj telefona.

### Izvor podataka o knjigama

Aplikaciji **nije potrebna baza svih knjiga izdatih u Srbiji** — potreban joj je
fond naše biblioteke. Ti podaci su naši. Zvaničan pristup COBISS API-ju nije
opcija i ne traži se.

**Osnova — izvoz iz COBISS3 klijenta.** Biblioteka ima licencu i pristup COBISS3
aplikaciji, koja ima modul za izveštaje i izvoz podataka (ISO 2709 / MARC, ili
izveštaj u Excel). To nije integracija nego redovna funkcionalnost softvera koji
već koristimo, sa korisničkom podrškom IZUM-a. Jednokratni izvoz monografskih
publikacija → uvoz u Supabase kao seed. Ponavlja se ručno posle veće nabavke,
npr. dva puta godišnje.

**Pomoć pri pretrazi uživo — Google Books API.** Zvaničan API, besplatan, ali traži
API ključ (bez njega Google vraća grešku). To je **pomoć pri pretrazi uživo, ne izvor
podataka**: njegovi uslovi (Google APIs ToS, odeljak 5e) ne dozvoljavaju pravljenje
baze ni trajnih kopija sadržaja iz API-ja. Zato se rezultati samo prikazuju (korica uz
oznaku „Google Books" i vezu ka njihovoj stranici za tu knjigu), a **trajno se čuva samo
ono što član potvrdi: ISBN-13, naslov, autor, godina, izdavač. Nikad opis, nikad
korica, nikad masovno** (nema uvoza ni seed-a iz Google-a). Nikad kao osnova —
pokrivenost starijih izdanja, malih izdavača i zavičajne građe je slaba.

**Popunjavanje rupa — unos uz skeniranje bar-koda.** Bibliotekar telefonom
skenira ISBN, forma se popuni iz Google Books-a, bibliotekar proveri i potvrdi naslov,
autora, izdavača, godinu i ISBN, dopuni se signatura i sačuva (opis i korica iz Google-a
se ne čuvaju).
Za nov naslov 20-ak sekundi. Ako naslov ulazi u bazu kad ga neko prvi put
zatraži, baza se popuni sama za nekoliko meseci.

### Pretraga i unos (odluka: varijanta B)

Aplikacija **ne pretražuje sajtove izdavača uživo**. Razlog nije tehnički nego
troškovi održavanja: svaki sajt je svoj parser, redizajn tiho obori pretragu, a
brzina zavisi od najsporijeg tuđeg servera. Ostaje kao mogućnost za kasnije, ako
se pokaže da izvori ispod ne pokrivaju dovoljno.

Redosled kojim se knjiga nalazi:

1. **Naša baza** (seed iz fonda + sve što je do sad uneto)
2. **Google Books API** po naslovu ili ISBN-u — zvaničan API, ne kvari se; samo pomoć
   pri pretrazi uživo, trajno se čuva samo ono što član potvrdi
3. **Unos linkom** — član zalepi link sa sajta izdavača ili knjižare, serverless
   funkcija pročita Open Graph i JSON-LD (`schema.org/Book`). Postojeći softver
   koji je Jovana već napisala za spiskove nabavke; prilagoditi, ne pisati nanovo.
   Bela lista domena, keširanje po URL-u, jedan generički parser + izuzeci.
4. **Ručni upis** naslova i autora — uvek dostupan, nikad ćorak

### Korice

Isti princip — više izvora, redom, sa pouzdanim rezervnim rešenjem:

1. Korica iz naše baze (fotografisana, u Supabase Storage-u, ili sa sajta izdavača)
2. Open Library Covers po ISBN-u — bez ključa i registracije (prikazuje se uživo)
3. `og:image` sa linka koji je član zalepio — čuva se samo ako je domen na listi
   dozvoljenih (izdavači, Open Library, naš Storage)
4. **Rezervno rešenje: složena pločica** sa naslovom i autorom u bojama
   aplikacije

**Google Books korica** se prikazuje samo u rezultatima pretrage uživo, uz oznaku
„Google Books" i vezu ka njihovoj stranici za tu knjigu. Ne čuva se nigde: ni kao
fajl, ni kao adresa u bazi (uslovi Google-a ne dozvoljavaju trajne kopije).

Poslednja stavka nije sporedna. Za zavičajnu građu i starija izdanja korica ne
postoji nigde i to je normalno stanje, ne greška. Ako je pločica lepo odrađena,
polica izgleda uredno i kad trećina knjiga nema sliku.

**Fotografisanje korica:** bibliotekar može da okači fotografiju sa telefona
(Supabase Storage). Za zavičajnu zbirku je to često jedini izvor, a usput se
pravi građa koja nigde drugde ne postoji.

**Šta se NE radi:** skidanje podataka sa sajtova izdavača i knjižara (Delfi,
Laguna, Vulkan). Uslovi korišćenja to po pravilu zabranjuju, a ustanova ne treba
da nosi taj rizik; struktura sajtova se menja pa se održava tuđi HTML; a ono što
se dobije je komercijalni katalog aktuelnih naslova, ne naš fond.
**Linkovanje** ka COBISS+ zapisu ili sajtu izdavača ostaje i poželjno je.

**Dostupnost u fondu** se u prvoj fazi vodi u našoj bazi (broj primeraka,
slobodno / izdato), a bibliotekar je ažurira. COBISS ostaje izvor istine za
zaduženja — „Rezerviši" u aplikaciji je obaveštenje bibliotekaru, ne upis u
COBISS.

### Model podataka (skica)

```
clanovi        id, broj_kartice, ime, nadimak, uloga, aktivan, telefon
knjige         id, naslov, autor, izdavac, godina, isbn, signatura,
               zanrovi[], cobiss_id, opis, korice_url, u_fondu, broj_primeraka,
               izvor(fond|clan; google_books se više ne upisuje), uneo_id, spojena_sa_id
polica         id, clan_id, knjiga_id, status, datum_pocetka, datum_kraja
utisci         id, clan_id, knjiga_id, ocena, tekst, vidljivost, spojler,
               skriven, kreiran
veze           id, pozivalac_id, pozvani_id, status(na_cekanju|prihvacena),
               kreirana, potvrdjena
preporuke      id, posiljalac_id, primalac_id, knjiga_id, poruka, procitana,
               odgovor, kreirana
prijave        id, prijavio_id, tip(preporuka|utisak), stavka_id, razlog, resena
objave         id, autor_id, naslov, tekst, slika_url, objavljena
```

**RLS — ključna pravila:**
- Čitalac vidi svoju policu uvek
- Tuđu policu i utiske sa vidljivošću „prijatelji" vidi **samo** ako u tabeli
  `veze` postoji red sa statusom `prihvacena` u kom se nalaze oba člana
- `preporuke` su vidljive samo pošiljaocu i primaocu
- Preporuka se može upisati samo ako veza postoji — provera u policy-ju, ne u
  aplikaciji
- Bibliotekar vidi prijave; administrator sve

---

## 5. Redosled razvoja

1. Supabase šema + RLS + seed sa ~200 knjiga iz fonda
2. Prijava članskom kartom, profil
3. Pretraga knjiga (baza → Google Books) i stranica knjige
3a. Unos linkom — prilagođavanje postojećeg parsera, kao serverless funkcija
3b. Korice: lanac izvora + rezervna pločica
4. Polica (tri stanja)
5. Utisci i ocene + ručni upis naslova koji nije u bazi
5a. Izveštaj za nabavku
6. Veze pozivnicom + RLS provera (najosetljiviji deo — testirati temeljno)
7. Direktne preporuke između povezanih čitalaca
8. Bibliotekarski panel + prijave
9. PWA omotač, instalacija na telefon
10. Testiranje sa 10–15 članova uživo → ispravke
11. Objava svim članovima

---

## 6. Rizici

| Rizik | Odgovor |
|---|---|
| Prazna platforma na startu | Bibliotekari unose prvih 50 utisaka pre objave; prvi krug članova se poziva lično |
| Neprimeren kontakt sa maloletnima | Veza samo pozivnicom uz obostranu potvrdu, poruke vezane za knjigu, prijava i blokiranje, uvid bibliotekara |
| Izvoz iz COBISS3 nije izvodljiv | Unos skeniranjem bar-koda (Google Books samo kao pomoć pri unosu, uz potvrdu bibliotekara); baza se puni postupno |
| Stariji članovi ne koriste | Bibliotekar unosi utiske sa pulta; štampani QR na članskoj karti |
| Neprimereni sadržaj | Moderacija + pravila korišćenja, utisci se mogu skriti |
| Lični podaci članova | Minimalno prikupljanje, saglasnost pri otvaranju naloga, ZZPL |

---

## 7. Prvi koraci pre koda

- [ ] Saglasnost direktora / odluka o projektu
- [ ] Provera sa kolegama iz obrade: kako se iz COBISS3 izvozi popis fonda
- [ ] Uzorak izvoza od 100 zapisa, da se vidi u kom je formatu
- [ ] Dogovor ko od kolega vodi sadržaj i moderaciju prijava
- [ ] Obrazac roditeljske saglasnosti za članove mlađe od 15 godina
- [ ] Odluka o imenu i vizuelnom identitetu
- [ ] Pravila korišćenja i obaveštenje o obradi podataka
