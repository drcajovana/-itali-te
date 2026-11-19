// PWA ljuska: registracija Service Workera, javljanje nove verzije, stanje veze i instalacija.
// Sve je u jednom malom spoljnom skladištu (subscribe/getSnapshot), da React ekrani koriste
// useSyncExternalStore i da događaji koji stignu PRE nego što se ekran učita ne propadnu
// (beforeinstallprompt stiže samo jednom, često pre Profila). Zato se modul uvozi u main.jsx.
//
// Pravila: Service Worker ne presreće POST, a API pozivi i Supabase nikad ne idu iz keša (vite.config.js:
// nema runtimeCaching, API putanje su van navigateFallback). Keširaju se samo statički fajlovi aplikacije.
import { registerSW } from "virtual:pwa-register";
import { PROVERA_VERZIJE_MS, jeBezVeze, jeIOS, jeInstalirana } from "./pwa-logika.js";

let stanje = {
  novaVerzija: false,
  bezVeze: typeof navigator !== "undefined" && jeBezVeze(navigator.onLine),
  imaPrompt: false,
  instalirana: false,
  ios: false,
};
const slusaoci = new Set();
let promptDogadjaj = null;
let osveziSW = null;

function postavi(izmena) {
  stanje = { ...stanje, ...izmena };
  slusaoci.forEach((f) => f());
}

export const pretplati = (f) => {
  slusaoci.add(f);
  return () => slusaoci.delete(f);
};
export const uzmiStanje = () => stanje;

if (typeof window !== "undefined") {
  postavi({
    instalirana: jeInstalirana({ standaloneMedija: window.matchMedia?.("(display-mode: standalone)")?.matches, standaloneSafari: window.navigator.standalone }),
    ios: jeIOS({ userAgent: navigator.userAgent, platforma: navigator.platform, tackeDodira: navigator.maxTouchPoints }),
  });

  window.addEventListener("online", () => postavi({ bezVeze: false }));
  window.addEventListener("offline", () => postavi({ bezVeze: true }));

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // sami nudimo dugme na Profilu, ne mini-traku pregledača
    promptDogadjaj = e;
    postavi({ imaPrompt: true });
  });
  window.addEventListener("appinstalled", () => {
    promptDogadjaj = null;
    postavi({ imaPrompt: false, instalirana: true });
  });

  // Nova verzija se NE primenjuje sama (registerType: "prompt"): korisnik vidi traku i dodirne „Освежи".
  // Tako se ne gubi uneto u polju usred rada, a zastareli keš nije neprimetan.
  osveziSW = registerSW({
    onNeedRefresh: () => postavi({ novaVerzija: true }),
    onRegisteredSW: (_adresa, registracija) => {
      if (!registracija) return;
      const proveri = () => registracija.update().catch(() => {});
      setInterval(proveri, PROVERA_VERZIJE_MS);
      document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && proveri());
    },
  });
}

// „Освежи": nova verzija preuzima kontrolu i stranica se ponovo učitava.
export const primeniNovuVerziju = () => osveziSW?.(true);

// „Инсталирај апликацију": pokazuje sistemski dijalog. Dogadjaj važi samo za jedan poziv.
export async function instaliraj() {
  const d = promptDogadjaj;
  if (!d) return null;
  promptDogadjaj = null;
  postavi({ imaPrompt: false });
  await d.prompt();
  const izbor = await d.userChoice.catch(() => null);
  return izbor?.outcome ?? null;
}
