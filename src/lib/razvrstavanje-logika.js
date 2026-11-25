// Čista logika ekrana „Разврставање књига" (bibliotekar). Bez React-a i bez mreže; upiti su u razvrstavanje.js.
//
// Šta radi ekran: književne knjige (grupe iz UDK-a: srpska, regionalna i strana književnost) kojima još nije upisan oblik (roman, poezija,
// pripovetke, drama, eseji, ostalo) dolaze jedna po jedna. Oblik se čuva kao još jedan žanr knjige (knjige.zanrovi), pa se vidi i filtrira
// u „Све књиге". Nazivi grupa i oblika su podaci koji idu u bazu; drže se u tekst.js (jedini izvor teksta), a ovde stižu kao parametri.

// Najviše žanrova po knjizi (isto ograničenje kao u unos-knjiga.js i uvoz-fonda.js).
export const NAJVISE_ZANROVA = 5;

// Tasteri 1–6 biraju oblike ovim redom.
export const KLJUCEVI_OBLIKA = ["roman", "poezija", "pripovetke", "drama", "eseji", "ostalo"];

// Spisak naziva oblika iz teksta, redom tastera: ["Роман", "Поезија", ...].
export const naziviOblika = (oblici) => KLJUCEVI_OBLIKA.map((k) => oblici[k]);

const niz = (z) => (Array.isArray(z) ? z.map((x) => String(x ?? "").trim()).filter(Boolean) : []);

// Da li knjiga čeka razvrstavanje: ima grupu književnosti, a nijedan oblik.
export function trebaOblik(zanrovi, knjizevneGrupe, nazivi) {
  const z = niz(zanrovi);
  return z.some((x) => knjizevneGrupe.includes(x)) && !z.some((x) => nazivi.includes(x));
}

// Žanrovi posle izbora oblika: ostali žanrovi ostaju, oblik se dodaje (jedan, bez ponavljanja; ranije upisan drugi oblik se zamenjuje),
// najviše 5 (ako bi bilo više, otpada najstariji žanr, nikad novi oblik).
export function saOblikom(zanrovi, oblik, nazivi) {
  const ostali = niz(zanrovi).filter((x) => !nazivi.includes(x));
  return [...ostali, oblik].slice(-NAJVISE_ZANROVA);
}

// Koliko je knjiga u redu isto autora kao izabrana (bez nje); autor bez imena nema „iste autore".
export function josIstogAutora(red, knjiga) {
  const a = String(knjiga?.autor ?? "").trim();
  if (!a) return 0;
  return red.filter((k) => k.id !== knjiga.id && String(k.autor ?? "").trim() === a).length;
}

// Taster → oblik: 1–6 (gornji red i numerički deo), nepoznat taster daje null. Cifre su na istom mestu na svakoj tastaturi, pa se poredi `code`.
export function oblikZaTaster(kod, nazivi) {
  const m = /^(?:Digit|Numpad)([1-9])$/.exec(String(kod ?? ""));
  return m ? (nazivi[Number(m[1]) - 1] ?? null) : null;
}

// Slovo → radnja: S/С preskoči, Z/З poništi (po slovu koje taster ispisuje, ne po položaju: srpska tastatura je QWERTZ, pa se položaj
// Z i Y razlikuje od američke; prihvataju se latinično i ćirilično slovo). Ostalo daje null.
export function radnjaZaSlovo(slovo) {
  const s = String(slovo ?? "").toLowerCase();
  if (s === "s" || s === "\u0441") return "preskoci";
  if (s === "z" || s === "\u0437") return "ponisti";
  return null;
}

// Format niza naziva u PostgREST oblik za `ov` i `not.ov`: {"A b","C"}.
export const nizZaUpit = (a) => `{${a.map((x) => `"${String(x).replace(/["\\]/g, "")}"`).join(",")}}`;
