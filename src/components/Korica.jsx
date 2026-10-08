import { useState } from "react";
import { adreseKorica } from "../lib/korica-slika.js";
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
// urednom i kad trećina knjiga nema sliku. Natpis je isti tekst koji stoji pored
// (naslov, autor), pa je za čitač ekrana sakrivena.
function Plocica({ naslov, autor }) {
  return (
    <div className={`flex h-full w-full flex-col justify-between rounded p-2 text-left ${boja(naslov)}`} aria-hidden="true">
      <span className="line-clamp-5 text-sm font-semibold leading-tight">{naslov}</span>
      {autor && <span className="line-clamp-2 text-xs opacity-80">{autor}</span>}
    </div>
  );
}

const VELICINE = {
  mala: { okvir: "h-28 w-20", sirina: "w-20", px: [80, 112] },
  velika: { okvir: "h-44 w-32", sirina: "w-32", px: [128, 176] },
};

function opisKorice(naslov, autor) {
  const T = tekst.pretraga.knjiga;
  return (autor ? T.koricaAltAutor.replace("{autor}", autor) : T.koricaAlt).replace("{naslov}", naslov);
}

// Lanac (korica-slika.js, adreseKorica): naša fotografija → Open Library po ISBN-u →
// pločica. Svaka adresa koja se ne učita (404) prelazi na sledeću. Brojač neuspelih
// pamti uz koji skup adresa važi, pa se sam vraća na početak kad se knjiga ili
// fotografija promeni (nije potreban `key`).
//
// `google`: rezultat je iz Google Books. Sličica se tada samo prikazuje (nikad se ne
// čuva) i obavezno ide uz oznaku „Google Books" i vezu ka njihovoj stranici za tu knjigu
// (smernice za brendiranje: Google se navodi uz svaki prikaz njihovog sadržaja).
export default function Korica({ knjiga, autor, google = null, velicina = "mala" }) {
  const adrese = adreseKorica(knjiga);
  const kljuc = adrese.join("|");
  const [neuspele, setNeuspele] = useState({ kljuc, n: 0 });
  const adresa = adrese[neuspele.kljuc === kljuc ? neuspele.n : 0];
  const v = VELICINE[velicina];

  return (
    <div className={`${v.sirina} shrink-0`}>
      <div className={`${v.okvir} overflow-hidden rounded border border-ivica bg-white`}>
        {adresa ? (
          <img
            src={adresa}
            alt={opisKorice(knjiga.naslov, autor)}
            width={v.px[0]}
            height={v.px[1]}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => setNeuspele({ kljuc, n: (neuspele.kljuc === kljuc ? neuspele.n : 0) + 1 })}
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
