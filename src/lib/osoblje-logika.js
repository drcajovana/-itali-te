// Čista logika ekrana za bibliotekare (članovi). Bez React-a i bez mreže, da je
// proverava `npm run test:api`.

// Da li član sme da menja uloge i naloge ovog reda u prikazu: administrator sve; bibliotekar samo
// čitaoce (isto pravilo kao api/resetuj-pin.js). Samo udobnost: server i baza proveravaju sami.
export function mozeDaUpravlja(ulogaPozivaoca, ulogaCilja) {
  return ulogaPozivaoca === "administrator" || (ulogaPozivaoca === "bibliotekar" && ulogaCilja === "citalac");
}

// Vreme iz baze („2026-11-10T09:30:00+00:00") → datum po lokalnom vremenu „2026-11-10", u obliku koji
// razume formatDatum. Neispravan ulaz se vraća kakav jeste.
export function datumIzVremena(iso) {
  const d = new Date(String(iso ?? ""));
  if (Number.isNaN(d.getTime())) return String(iso ?? "");
  const dvocifreno = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${dvocifreno(d.getMonth() + 1)}-${dvocifreno(d.getDate())}`;
}
