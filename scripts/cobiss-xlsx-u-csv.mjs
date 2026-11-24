// Pretvara izvoz iz COBISS-a (xlsx) u CSV koji čita scripts/uvezi-fond.mjs. Bez ikakve biblioteke: xlsx je zip, a čita se samo
// sharedStrings.xml i prvi list. Ništa ne čita iz baze i ne treba .env.
//
//   npm run admin:cobiss-csv -- "C:\Users\PC\Downloads\export (1).xlsx" --izlaz=uvoz/fond-2023.csv
//
// Pravila pretvaranja su u scripts/cobiss-izvoz.mjs (autor: varijanta sa ćirilicom u obliku „Ime Prezime", ISBN bez napomena u zagradama,
// primeraka iz polja 998c). Dalje: npm run admin:uvezi-fond -- --fajl=uvoz/fond-2023.csv (probno), pa --upisi.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { csvIzKnjiga, knjigeIzCobissa, redoviIzXlsx } from "./cobiss-izvoz.mjs";

const ulaz = process.argv.slice(2).find((a) => !a.startsWith("--"));
const izlaz = process.argv.find((a) => a.startsWith("--izlaz="))?.slice(8);
if (!ulaz || !izlaz) {
  console.error('Upotreba: npm run admin:cobiss-csv -- "putanja\\do\\izvoza.xlsx" --izlaz=uvoz/fond-2023.csv');
  process.exit(2);
}
if (!existsSync(ulaz)) {
  console.error(`Nema fajla: ${ulaz}`);
  process.exit(2);
}
if (existsSync(izlaz) && !process.argv.includes("--prepisi")) {
  console.error(`${izlaz} već postoji (ne prepisuje se bez --prepisi).`);
  process.exit(2);
}

// Zip: središnji direktorijum na kraju fajla, pa lokalno zaglavlje svakog fajla (deflate ili stored).
function raspakuj(zip) {
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 70000); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("fajl nije xlsx (zip bez središnjeg direktorijuma)");
  const broj = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  const fajlovi = new Map();
  for (let n = 0; n < broj; n++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) throw new Error("oštećen zip");
    const metod = zip.readUInt16LE(p + 10);
    const velicina = zip.readUInt32LE(p + 20);
    const lokalno = zip.readUInt32LE(p + 42);
    const imeDuzina = zip.readUInt16LE(p + 28);
    const extra = zip.readUInt16LE(p + 30);
    const komentar = zip.readUInt16LE(p + 32);
    const ime = zip.toString("utf8", p + 46, p + 46 + imeDuzina);
    const pocetak = lokalno + 30 + zip.readUInt16LE(lokalno + 26) + zip.readUInt16LE(lokalno + 28);
    const sirovo = zip.subarray(pocetak, pocetak + velicina);
    fajlovi.set(ime, () => (metod === 8 ? inflateRawSync(sirovo) : metod === 0 ? sirovo : (() => { throw new Error(`nepoznata kompresija ${metod}`); })()).toString("utf8"));
    p += 46 + imeDuzina + extra + komentar;
  }
  return fajlovi;
}

const f = raspakuj(readFileSync(ulaz));
const list = f.get("xl/worksheets/sheet1.xml");
if (!list) throw new Error("u xlsx-u nema prvog lista (xl/worksheets/sheet1.xml)");
const redovi = redoviIzXlsx(f.get("xl/sharedStrings.xml")?.() ?? "", list());
const { knjige, preskoceno, greska } = knjigeIzCobissa(redovi);
if (greska) {
  console.error(`Greška: ${greska}`);
  process.exit(3);
}
writeFileSync(izlaz, csvIzKnjiga(knjige), "utf8");
const bez = (k) => knjige.filter((x) => !x[k]).length;
console.log(`Pročitano redova: ${redovi.length - 1}; u CSV: ${knjige.length}; preskočeno: ${preskoceno.length}`);
for (const s of preskoceno.slice(0, 10)) console.log(`   red ${s.red}: ${s.razlog}`);
console.log(`Bez autora: ${bez("autor")}; bez ISBN-a: ${bez("isbn")}; bez izdavača: ${bez("izdavac")}; bez godine: ${bez("godina")}`);
console.log(`Upisano u ${izlaz}. Sledeće: npm run admin:uvezi-fond -- --fajl=${izlaz}   (probno; upis tek sa --upisi)`);
