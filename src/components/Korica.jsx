import { useState } from "react";
import { adreseKorica } from "../lib/korica-slika.js";
import { tekst } from "../lib/tekst.js";

// Gradijent pločice izabran po naslovu, pa je ista knjiga uvek iste boje. Osam parova iz prototipa
// (src/index.css, --korica-N-a i --korica-N-b).
function gradijent(naslov) {
  let h = 0;
  for (const znak of String(naslov)) h = (h * 31 + znak.codePointAt(0)) % 997;
  return h % 8;
}

// Poslednja karika lanca: korica ne postoji nigde i to je normalno stanje za
// zavičajnu građu i starija izdanja, ne greška. Lepo odrađena pločica (gradijent, svetli „hrbat",
// naslov i autor) drži policu urednom i kad trećina knjiga nema sliku. Natpis je isti tekst koji
// stoji pored (naslov, autor), pa je za čitač ekrana sakrivena.
function Plocica({ naslov, autor, velicina }) {
  const i = gradijent(naslov);
  return (
    <div className="korica" style={{ "--korica-a": `var(--korica-${i}-a)`, "--korica-b": `var(--korica-${i}-b)` }} aria-hidden="true">
      <b className={`korica-naslov line-clamp-5 ${velicina.naslov}`}>{naslov}</b>
      {autor && !velicina.bezAutora && <i className="korica-autor line-clamp-2 not-italic">{autor}</i>}
    </div>
  );
}

// Veličine iz prototipa: sitna (rezultat pretrage, 44 px), mala (mreža i redovi), glavna (kartica
// „čitam", 76 px), velika (stranica knjige, 88 px), puna (širina kolone u mreži police).
const VELICINE = {
  sitna: { sirina: "w-11", px: [44, 66], naslov: "text-[8px]", bezAutora: true },
  mala: { sirina: "w-20", px: [80, 120], naslov: "text-xs" },
  glavna: { sirina: "w-[76px]", px: [76, 114], naslov: "text-xs" },
  velika: { sirina: "w-22", px: [88, 132], naslov: "text-[13px]" },
  puna: { sirina: "w-full", px: [120, 180], naslov: "text-[11.5px]" },
};

function opisKorice(naslov, autor) {
  const T = tekst.pretraga.knjiga;
  return (autor ? T.koricaAltAutor.replace("{autor}", autor) : T.koricaAlt).replace("{naslov}", naslov);
}

// Lanac (korica-slika.js, adreseKorica): naša slika → Open Library po ISBN-u →
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
  const v = VELICINE[velicina] ?? VELICINE.mala;

  return (
    <div className={`${v.sirina} shrink-0`}>
      {adresa ? (
        <div className="korica-slika">
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
        </div>
      ) : (
        <Plocica naslov={knjiga.naslov} autor={autor} velicina={v} />
      )}
      {google &&
        (google.url ? (
          <a href={google.url} target="_blank" rel="noopener noreferrer" className="mt-1 flex min-h-11 items-center justify-center text-center text-xs font-medium text-bordo underline">
            {tekst.pretraga.knjiga.googleBooks}
          </a>
        ) : (
          <span className="mt-1 block text-center text-xs text-mastilo-2">{tekst.pretraga.knjiga.googleBooks}</span>
        ))}
    </div>
  );
}
