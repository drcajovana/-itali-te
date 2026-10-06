// ISBN: normalizacija i provera. Običan JS bez uvoza: koriste ga aplikacija i
// Vercel funkcije u api/ (relativnim uvozom), pa nema import.meta ni aliasa.
//
// ISBN je TEKST (može da počinje nulom, a ISBN-10 može da završava na X).

// Ostavlja samo cifre i X: „978-86-521-2603-3" → „9788652126033".
export function ocistiIsbn(unos) {
  return String(unos ?? "").toUpperCase().replace(/[^0-9X]/g, "");
}

function ispravanIsbn13(s) {
  if (!/^[0-9]{13}$/.test(s)) return false;
  let zbir = 0;
  for (let i = 0; i < 12; i++) zbir += Number(s[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (zbir % 10)) % 10 === Number(s[12]);
}

function ispravanIsbn10(s) {
  if (!/^[0-9]{9}[0-9X]$/.test(s)) return false;
  let zbir = 0;
  for (let i = 0; i < 10; i++) zbir += (s[i] === "X" ? 10 : Number(s[i])) * (10 - i);
  return zbir % 11 === 0;
}

// Vraća ISBN-13 (ISBN-10 se pretvara), ili null ako unos nije ispravan ISBN.
// Čuvamo uvek 13 cifara, da isti naslov iz različitih izvora bude ista knjiga.
export function uIsbn13(unos) {
  const s = ocistiIsbn(unos);
  if (ispravanIsbn13(s)) return s;
  if (ispravanIsbn10(s)) {
    const osnova = `978${s.slice(0, 9)}`;
    let zbir = 0;
    for (let i = 0; i < 12; i++) zbir += Number(osnova[i]) * (i % 2 === 0 ? 1 : 3);
    return `${osnova}${(10 - (zbir % 10)) % 10}`;
  }
  return null;
}

export const jeIsbn = (unos) => uIsbn13(unos) !== null;
