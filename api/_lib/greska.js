// Greška sa HTTP statusom i kodom koji klijent prevodi u tekst (src/lib/tekst.js).
// Poruka je samo rezervna, za razvoj i logove; korisnik je ne vidi.
export class ApiGreska extends Error {
  constructor(status, kod, poruka = kod) {
    super(poruka);
    this.status = status;
    this.kod = kod;
  }
}

export function posalji(res, status, telo, zaglavlja = {}) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  for (const [k, v] of Object.entries(zaglavlja)) res.setHeader(k, v);
  res.end(JSON.stringify(telo));
}

export function posaljiGresku(res, e) {
  if (e instanceof ApiGreska) {
    const zaglavlja = e.ponovoZaSekundi ? { "Retry-After": String(e.ponovoZaSekundi) } : {};
    return posalji(res, e.status, { greska: { kod: e.kod, poruka: e.message, ponovoZaSekundi: e.ponovoZaSekundi } }, zaglavlja);
  }
  // Neočekivana greška: detalji idu u log, ne korisniku (mogu da sadrže interne podatke).
  console.error("neočekivana greška:", e);
  return posalji(res, 500, { greska: { kod: "greska_servera", poruka: "Greška na serveru." } });
}
