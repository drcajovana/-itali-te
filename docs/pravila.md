# Pravila korišćenja: šta stoji u tekstu i odakle to znamo

Ekran `/pravila` (javan, bez prijave) prikazuje `tekst.pravila` iz `src/lib/tekst.js`. **Tekst je nacrt**: mora da ga pročita i
odobri biblioteka (direktor ili pravnik) pre objave. Menja se samo u `tekst.js`; ekran se ne dira.

Svaka tvrdnja u tekstu mora da odgovara onome što aplikacija stvarno radi. Ako se ponašanje aplikacije promeni, menja se i tekst.

| Tvrdnja u tekstu | Odakle znamo |
|---|---|
| Nalog otvara bibliotekar, nema samoregistracije | `api/napravi-clana.js` (samo bibliotekar/administrator); nema ekrana za registraciju |
| Prijava brojem karte i PIN-om; PIN se vidi samo jednom, novi pravi bibliotekar | `api/resetuj-pin.js`, CLAUDE.md „Članovi" |
| Mlađi od 15 godina uz saglasnost roditelja | **Pravilo biblioteke, ne aplikacije**: aplikacija to ne proverava (kolona `roditeljska_saglasnost` postoji, ne koristi se). Biblioteka mora da potvrdi da pravilo važi |
| Bibliotekar na molbu upisuje utisak u ime člana; član ga vidi, menja i briše | `/bibliotekar/utisak`, potpis `uneo_bibliotekar_id` (0022), napomena uz utisak |
| Bibliotekar sakriva utisak ili preporuku i deaktivira nalog | `/bibliotekar/prijave` (0021) i `/bibliotekar/clanovi` |
| Veza samo pozivom i prihvatanjem; bez šifre nema nalaženja | `posalji_poziv`, `prihvati_poziv`, CLAUDE.md „Čitaoci" |
| Povezani vide policu i utiske „samo povezani"; ostali javne utiske pod nadimkom | RLS: `polica_povezani_select`, `utisci_javni_select`, pogled `utisci_sa_autorom` |
| Nema slobodnih poruka, samo preporuka sa napomenom (280 znakova) | 0019, CLAUDE.md „Čitaoci" |
| Raskid i blokada bez obaveštenja druge strane | `raskiniVezu`, `blokiraj` (`src/lib/citaoci.js`) |
| Čuva se: ime i prezime, broj karte, nadimak, šifra poziva, polica, utisci, veze, preporuke, prijave | Šema (migracije 0001 do 0021). **Kolone `datum_rodjenja` i telefon postoje u šemi; ako biblioteka ih popunjava, dodati ih u tekst** |
| Ne koristi se za reklame, ne daje se trećima | Nema takvog koda; Google Books dobija samo upit (`api/pretraga-google.js`) |
| Bibliotekari vide članove, **sve** police i **sve** utiske, i „samo ja" | RLS: `utisci_bibliotekar_select`, `polica_bibliotekar_select`. To je stvarno stanje baze, pa je u tekstu. Ako biblioteka to ne želi, to je izmena RLS-a, ne teksta |
| Brisanjem naloga brišu se polica, utisci, veze, preporuke | Strani ključevi `on delete cascade` na `clanovi`. **Prijave koje je član podneo takođe nestaju; prijave NA člana ostaju** (nema stranog ključa na stavku) |
| „Podaci se čuvaju dok ste član" | **Odluka biblioteke** o roku čuvanja; aplikacija ništa ne briše sama |
| Kome se obratiti | „Bibliotekari na pultu": bez izmišljenog telefona ili mejla. Ako biblioteka ima mejl/telefon za zaštitu podataka, dodati u poslednji odeljak |

## Šta aplikacija NE radi, a pravila bi mogla da obećaju

- Ne beleži da je član pročitao i prihvatio pravila (nema kolone ni ekrana). Saglasnost je na pultu, pri upisu: bibliotekar
  pokaže ovaj ekran ili ga pošalje na telefon. Ako biblioteka traži evidenciju prihvatanja, to je nova migracija i ekran.
- Ne postoji izvoz „svih mojih podataka" za člana; to radi bibliotekar na zahtev (Supabase).
