import { useState } from "react";
import { adreseKorica } from "../lib/knjige.js";
import { tekst } from "../lib/tekst.js";

// Boje aplikacije za pločicu; izbor zavisi od naslova, pa je ista knjiga uvek iste boje.
const BOJE = [
  "bg-pecat text-white",
  "bg-pecat-svetli text-white",
  "bg-mastilo text-papir",
  "bg-ivica text-mastilo",
];

function boja(naslov) {
  let h = 0;
  for (const znak of String(naslov)) h = (h * 31 + znak.codePointAt(0)) % 997;
  return BOJE[h % BOJE.length];
}

// Poslednja karika lanca: korica ne postoji nigde i to je normalno stanje za
// zavičajnu građu i starija izdanja, ne greška. Lepo odrađena pločica drži policu
// urednom i kad trećina knjiga nema sliku.
function Plocica({ naslov, autor }) {
  return (
    <div className={`flex h-full w-full flex-col justify-between rounded p-2 text-left ${boja(naslov)}`} aria-hidden="true">
      <span className="line-clamp-5 text-sm font-semibold leading-tight">{naslov}</span>
      {autor && <span className="line-clamp-2 text-xs opacity-80">{autor}</span>}
    </div>
  );
}

// Lanac (PLAN.md): korica iz naše baze (ili iz rezultata, za prikaz) → Open Library po
// ISBN-u → pločica. Svaka adresa koja se ne učita (404) prelazi na sledeću. Pozivalac
// daje `key` po knjizi, da se brojač vrati na početak kad se knjiga promeni.
//
// `google`: rezultat je iz Google Books. Korica se tada samo prikazuje (nikad se ne
// čuva) i obavezno ide uz oznaku „Google Books" i vezu ka njihovoj stranici za tu knjigu
// (smernice za brendiranje: Google se navodi uz svaki prikaz njihovog sadržaja).
export default function Korica({ knjiga, autor, google = null }) {
  const adrese = adreseKorica(knjiga);
  const [neuspele, setNeuspele] = useState(0);
  const adresa = adrese[neuspele];

  return (
    <div className="w-20 shrink-0">
      <div className="h-28 w-20 overflow-hidden rounded border border-ivica bg-white">
        {adresa ? (
          <img
            src={adresa}
            alt={`${tekst.pretraga.knjiga.koricaZa} ${knjiga.naslov}`}
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setNeuspele((n) => n + 1)}
            className="h-full w-full object-cover"
          />
        ) : (
          <Plocica naslov={knjiga.naslov} autor={autor} />
        )}
      </div>
      {google &&
        (google.url ? (
          <a href={google.url} target="_blank" rel="noopener noreferrer" className="mt-1 block text-center text-xs font-medium text-pecat underline">
            {tekst.pretraga.knjiga.googleBooks}
          </a>
        ) : (
          <span className="mt-1 block text-center text-xs text-mastilo/70">{tekst.pretraga.knjiga.googleBooks}</span>
        ))}
    </div>
  );
}
