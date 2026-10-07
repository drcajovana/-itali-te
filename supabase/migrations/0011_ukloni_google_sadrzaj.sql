-- 0011 — uklanja sadržaj iz Google Books-a koji je već upisan u bazu.
--
-- Uslovi Google-a (Google APIs ToS, odeljak 5e) ne dozvoljavaju pravljenje baze ni
-- trajnih kopija sadržaja iz API-ja. Odluka: Google Books je pomoć pri pretrazi
-- uživo; iz njega se trajno čuva samo ono što član potvrdi (ISBN-13, naslov, autor,
-- godina, izdavač), nikad opis, nikad korica, nikad masovno.
--
--  - OPIS se postavlja na NULL za knjige čiji je izvor 'google_books' i za knjige čija
--    je korica iz Google-a (korice_izvor = 'google_books'): tamo je opis skoro sigurno
--    došao iz Google-a.
--  - KORICA (korice_url) se postavlja na NULL gde je korice_izvor 'google_books'. I
--    korice_izvor postaje NULL: izvor korice bez korice nema smisla (isto pravilo kao
--    u okidaču iz 0009).
--
-- Ne diraju se: naslov, autor, izdavač, godina i ISBN (ono što član potvrđuje), niti
-- izvor knjige. Ne diraju se ni opisi iz fonda (izvor 'fond'), niti korice sa sajtova
-- izdavača ('og_slika'), Open Library ili fotografije bibliotekara ('fotografija').
--
-- Migracija se izvršava kao postgres (SQL Editor), pa okidači za zaštitu polja
-- propuštaju izmenu; ponovno puštanje ne menja ništa više (idempotentna).
--
-- Ovo je NOVA migracija: 0001 do 0010 se ne menjaju.

update public.knjige
   set opis = null
 where opis is not null
   and (izvor = 'google_books' or korice_izvor = 'google_books');

update public.knjige
   set korice_url = null,
       korice_izvor = null
 where korice_izvor = 'google_books';
