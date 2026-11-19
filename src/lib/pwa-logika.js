// Čista logika PWA ljuske (bez React-a i bez pregledača), da je test:api proverava bez pregledača.

// Da li je aplikacija već otvorena kao instalirana (sa početnog ekrana): Chrome/Android i drugi kroz
// display-mode: standalone, Safari na iPhone-u kroz navigator.standalone.
export function jeInstalirana({ standaloneMedija = false, standaloneSafari = false } = {}) {
  return Boolean(standaloneMedija || standaloneSafari);
}

// iPhone, iPad i iPod. iPadOS 13+ se predstavlja kao Mac, pa se prepoznaje po dodirnom ekranu
// (pravi Mac nema više od jedne tačke dodira).
export function jeIOS({ userAgent = "", platforma = "", tackeDodira = 0 } = {}) {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return true;
  return platforma === "MacIntel" && tackeDodira > 1;
}

// Šta da pokaže kartica „Инсталирај апликацију" na Profilu:
//   "nista"  : već instalirana ili nema načina da se instalira iz ove stranice
//   "dugme"  : pregledač je javio beforeinstallprompt, pa može pravo dugme
//   "uputstvo": iPhone/iPad (Safari ne šalje beforeinstallprompt): kratko uputstvo „Подели → Додај на почетни екран"
export function nacinInstalacije({ instalirana, imaPrompt, ios }) {
  if (instalirana) return "nista";
  if (imaPrompt) return "dugme";
  if (ios) return "uputstvo";
  return "nista";
}

// Da li je veza „prekinuta" po pregledaču. navigator.onLine je približan (true može da znači samo lokalnu
// mrežu), pa greške pri učitavanju ekrana i dalje imaju svoje poruke; ovo je samo opšta traka.
export const jeBezVeze = (onLine) => onLine === false;

// Koliko često (ms) se traži nova verzija dok je aplikacija otvorena: jednom na sat.
export const PROVERA_VERZIJE_MS = 60 * 60 * 1000;
