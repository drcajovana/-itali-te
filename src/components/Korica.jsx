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

// Lanac (PLAN.md): korica iz naše baze → Google Books → Open Library po ISBN-u →
// slika sa linka → pločica. Prve tri adrese stižu kroz adreseKorica; svaka koja se
// ne učita (404) prelazi na sledeću. Pozivalac daje `key` po knjizi, da se
// brojač vrati na početak kad se knjiga promeni.
export default function Korica({ knjiga, autor }) {
  const adrese = adreseKorica(knjiga);
  const [neuspele, setNeuspele] = useState(0);
  const adresa = adrese[neuspele];

  return (
    <div className="h-28 w-20 shrink-0 overflow-hidden rounded border border-ivica bg-white">
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
  );
}
