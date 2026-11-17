// Čista logika ekrana „Набавка" (bez React-a i bez mreže), da je proverava test:api.
// Podaci stižu iz pogleda izvestaj_za_nabavku (0020): samo brojevi po knjizi, samo za bibliotekare.
// Ovde nema ničega što bi vodilo do imena člana: nema ni jednog polja o članu.
import { uLatinicu } from "./pismo.js";

const BOM = String.fromCharCode(0xfeff);

export const ODLUKE = ["imamo", "nabavljamo", "ne_nabavljamo"];
export const FILTERI = ["nove", "nabavljamo", "imamo", "sve"];

export const jeOdluka = (o) => ODLUKE.includes(o);

// Pretraga ne zavisi od pisma ni od kvačica: „Ђорђе", „Djordje" i „Đorđe" su isto.
export function normalizuj(unos) {
  return uLatinicu(String(unos ?? ""))
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "dj")
    .replace(/\s+/g, " ")
    .trim();
}

// Filter: nove = bez odluke; nabavljamo i imamo = ta odluka; sve = sve (i „ne nabavljamo").
// „Imamo" obuhvata i knjige koje su pri unosu upisane kao u fondu (pogled ih vodi kao „imamo").
export function filtrirajNabavku(redovi, filter, upit = "") {
  const q = normalizuj(upit);
  return (redovi ?? []).filter((r) => {
    if (filter === "nove" && r.odluka != null) return false;
    if (filter === "nabavljamo" && r.odluka !== "nabavljamo") return false;
    if (filter === "imamo" && r.odluka !== "imamo") return false;
    if (!q) return true;
    return normalizuj(`${r.naslov ?? ""} ${r.autor ?? ""}`).includes(q);
  });
}

// Broj knjiga po filteru (za natpise dugmadi); pretraga se ne računa.
export function brojeviPoFilteru(redovi) {
  const b = { nove: 0, nabavljamo: 0, imamo: 0, sve: 0 };
  for (const r of redovi ?? []) {
    b.sve++;
    if (r.odluka == null) b.nove++;
    else if (r.odluka === "nabavljamo") b.nabavljamo++;
    else if (r.odluka === "imamo") b.imamo++;
  }
  return b;
}

// Podrazumevani redosled: po broju onih koji žele, opadajuće; ista brojka po naslovu.
export function poredjajNabavku(redovi) {
  return [...(redovi ?? [])].sort((a, b) => (b.zele ?? 0) - (a.zele ?? 0) || String(a.naslov ?? "").localeCompare(String(b.naslov ?? ""), "sr"));
}

// Red posle izmene odluke (iz reda knjige koji vraća update): efektivna odluka je postavljena ili,
// bez nje, „imamo" za knjigu u fondu.
export function saNovomOdlukom(red, knjiga) {
  const postavljena = knjiga.odluka_nabavke ?? null;
  return { ...red, u_fondu: knjiga.u_fondu, odluka: postavljena ?? (knjiga.u_fondu ? "imamo" : null), odluka_postavljena: postavljena !== null, odluka_datum: knjiga.odluka_datum ?? null };
}

// ── CSV (Excel): UTF-8 sa BOM da se ćirilica lepo prikaže ──
// Polje u navodnicima. Tekst koji bi Excel pročitao kao formulu (počinje sa = + - @ ili tabom) dobija
// apostrof ispred. ISBN (samo cifre) se piše kao ="…" da ga Excel ne pretvori u 9,79E+12.
export function csvPolje(vrednost, { isbn = false } = {}) {
  let s = String(vrednost ?? "").replace(/\r?\n/g, " ");
  if (isbn && /^[0-9Xx]{10,13}$/.test(s)) return `"=""${s}"""`;
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export function izvestajUCsv(redovi, zaglavlja, nazivOdluke) {
  const red = (polja) => polja.join(";");
  const linije = [red([zaglavlja.naslov, zaglavlja.autor, zaglavlja.izdavac, zaglavlja.isbn, zaglavlja.zele, zaglavlja.odluka].map((z) => csvPolje(z)))];
  for (const r of redovi) {
    linije.push(red([csvPolje(r.naslov), csvPolje(r.autor), csvPolje(r.izdavac), csvPolje(r.isbn, { isbn: true }), csvPolje(r.zele), csvPolje(r.odluka ? nazivOdluke[r.odluka] : "")]));
  }
  return `${BOM}sep=;\r\n${linije.join("\r\n")}\r\n`;
}

// Ime fajla sa današnjim datumom (lokalno), latinicom da ga svaki sistem prihvati.
export function imeFajlaNabavke(d = new Date()) {
  const dv = (n) => String(n).padStart(2, "0");
  return `nabavka-${d.getFullYear()}-${dv(d.getMonth() + 1)}-${dv(d.getDate())}.csv`;
}
