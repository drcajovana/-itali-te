// Zajednički izgled kontrola iz prototipa (docs/prototip.html), kao Tailwind klase. Samo boje iz
// teme (src/index.css), nikakve nove vrednosti. Sve kontrole su najmanje 44 px (min-h-11 ili više).
// Komponente pišu className={stil.x}, da se isti oblik ne prepisuje na dvadeset mesta.

const dodir = "flex items-center justify-center text-center transition active:scale-[.985] disabled:opacity-60";

export const stil = {
  // velika dugmad (prototip: .veliko): puna bordo, „tiho" na površini, „okvirno" sa linijom
  veliko: `${dodir} min-h-12 w-full rounded-full bg-bordo px-5 py-3 text-base font-semibold text-white hover:bg-bordo-tamna sm:w-auto`,
  tiho: `${dodir} min-h-12 w-full rounded-full bg-povrsina px-5 py-3 text-base font-semibold text-mastilo shadow-senka sm:w-auto`,
  okvirno: `${dodir} min-h-12 w-full rounded-full border border-linija bg-povrsina px-5 py-3 text-base font-semibold text-bordo sm:w-auto`,
  // pilule (prototip: .pilula): manje dugme u redu karte
  pilula: `${dodir} min-h-11 flex-1 rounded-full bg-pozadina px-4 py-2 text-sm font-medium text-mastilo hover:bg-bordo-svetla`,
  pilulaPuna: `${dodir} min-h-11 flex-1 rounded-full bg-bordo px-4 py-2 text-sm font-medium text-white hover:bg-bordo-tamna`,
  // čip za izbor (prototip: .cip), pritisnut je tamno
  cip: "flex min-h-11 items-center rounded-full bg-pozadina px-4 py-2 text-sm font-medium text-mastilo-2 transition aria-pressed:bg-mastilo aria-pressed:text-white",
  // polja (prototip: .polje, textarea)
  polje: "block w-full rounded-srednji border border-linija bg-pozadina px-3.5 py-3 text-base text-mastilo placeholder:text-mastilo-3 focus:bg-povrsina focus:outline-2 focus:-outline-offset-1 focus:outline-bordo",
  // karta i blok (prototip: .karta, .blok): površina sa blagom senkom
  karta: "rounded-velik bg-povrsina p-4 shadow-senka",
  // naslov odeljka (prototip: .pododeljak)
  odeljak: "mb-3 mt-7 font-naslov text-[17px] font-bold tracking-tight",
  // ceo naslov ekrana (prototip: h1.naslov)
  naslov: "font-naslov text-[30px] font-bold leading-[1.1] tracking-[-0.035em]",
  uvod: "mt-2 text-[14.5px] text-mastilo-2",
  // pločica izvora (prototip: .izvor)
  izvor: "inline-block rounded-full bg-pozadina px-2.5 py-0.5 text-xs font-medium text-mastilo-2",
  izvorFond: "inline-block rounded-full bg-bordo-svetla px-2.5 py-0.5 text-xs font-medium text-bordo",
  izvorSpolja: "inline-block rounded-full bg-zlato-svetlo px-2.5 py-0.5 text-xs font-medium text-zlato",
};
