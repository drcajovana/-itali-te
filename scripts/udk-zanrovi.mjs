// UDK iz COBISS-a → žanrovi za kolonu knjige.zanrovi. Čista logika (proverava je npm run test:api), bez fajlova i mreže.
//
// Polje „УДК за претраживање" u izvozu izgleda ovako:
//   „821.163.41 - Српска књижевност; 821.163.41.09 - Српска књижевност (студије); 821.0 - Светска књижевност (теорија и студије)".
// Svaka oznaka se pretvara u jednu grupu iz tabele ispod (prvo poklapanje pobeđuje); grupe se sabiraju bez ponavljanja, najviše tri po knjizi
// (UDK ume da nabroji i pet oznaka za istu temu, a više od tri žanra bi samo zatrpalo filter). Oznake koje nijedno pravilo ne poznaje se
// ignorišu: knjiga bez poznate oznake ostaje bez žanra, a ne sa pogrešnim.
//
// Nazivi grupa su podaci koji idu u bazu (kao kolone iz izvoza), a ne tekst aplikacije, zato su ovde, a ne u src/lib/tekst.js.
// Za promenu naziva ili pravila menja se samo ova tabela; već upisani žanrovi se ne prepisuju (vidi docs/uvoz-fonda.md).

export const NAJVISE_ZANROVA = 3;

const SRPSKA = "Српска књижевност";
const REGION = "Књижевност региона";
const STRANA = "Страна књижевност";
const DECJE = "Дечје књиге";
const KRITIKA = "Књижевна критика и историја";
const STRIP = "Стрипови";
const ISTORIJA = "Историја";
const BIOGRAFIJE = "Биографије и мемоари";
const GEOGRAFIJA = "Географија и путописи";
const FILOZOFIJA = "Филозофија и религија";
const PSIHOLOGIJA = "Психологија";
const DRUSTVO = "Друштво и политика";
const EKONOMIJA = "Економија и право";
const OBRAZOVANJE = "Образовање";
const JEZIK = "Језик";
const PRIRODA = "Природне науке";
const MEDICINA = "Медицина и здравље";
const TEHNIKA = "Техника и рачунарство";
const KUCA = "Кување и пољопривреда"; // nazivi ne smeju da imaju zarez ni tačku-zarez: njima se razdvajaju žanrovi (uvoz i ručni unos)
const UMETNOST = "Уметност и архитектура";
const SCENA = "Музика и сценска уметност";
const SPORT = "Спорт и рекреација";
const OPSTE = "Опште знање";

export const GRUPE = [SRPSKA, REGION, STRANA, DECJE, KRITIKA, STRIP, ISTORIJA, BIOGRAFIJE, GEOGRAFIJA, FILOZOFIJA, PSIHOLOGIJA, DRUSTVO, EKONOMIJA, OBRAZOVANJE, JEZIK, PRIRODA, MEDICINA, TEHNIKA, KUCA, UMETNOST, SCENA, SPORT, OPSTE];

// Redosled je bitan: posebna pravila (dečje, strip, kritika) idu pre opštih. Pravilo se primenjuje na glavni deo oznake, bez pomoćnih
// oznaka u zagradama, iza „=", „:" i slično (npr. „94(497.11)" → „94", „821.163.41-93" ostaje kakvo jeste).
const PRAVILA = [
  [/^82[\d.]*-93/, DECJE], // književnost za decu (npr. 821.163.41-93)
  [/^087\.5/, DECJE], // izdanja za decu
  [/^741\.5/, STRIP],
  [/^82[\d.]*\.09|^82-09|^82\.0|^821\.0/, KRITIKA], // teorija, istorija i kritika književnosti
  [/^82$/, KRITIKA], // „82 - Књижевност. Историја књижевности"
  [/^821$/, STRANA], // „821(082.2) - Светска књижевност. Антологије" (pomoćna oznaka u zagradi se odseca)
  [/^821\.163\.41/, SRPSKA],
  [/^821\.163\./, REGION], // hrvatska, bosanska, makedonska, slovenačka i ostala južnoslovenska
  [/^821\./, STRANA],
  [/^8[01]/, JEZIK],
  [/^929/, BIOGRAFIJE],
  [/^(9[34]|90[2-4])/, ISTORIJA],
  [/^(91|908)/, GEOGRAFIJA],
  [/^159\.9/, PSIHOLOGIJA],
  [/^1(?!5)/, FILOZOFIJA],
  [/^2/, FILOZOFIJA], // religija
  [/^37/, OBRAZOVANJE],
  [/^(33|34|65)/, EKONOMIJA],
  [/^3/, DRUSTVO], // politika, sociologija, vojska, etnologija, folklor
  [/^5/, PRIRODA],
  [/^61/, MEDICINA],
  [/^(004|62|66|67|68|69)/, TEHNIKA],
  [/^(63|64)/, KUCA],
  [/^(78|79[1-3])/, SCENA],
  [/^(79[4-9]|379\.8)/, SPORT],
  [/^7/, UMETNOST],
  [/^0/, OPSTE],
];

// „94(497.11)" → „94"; „73/76" → „73"; „821.163.41-93" → „821.163.41-93"
const glavniDeo = (kod) => String(kod).split(/[(=":'+/[]/)[0];

export function grupaZaUdk(kod) {
  const glavni = glavniDeo(kod);
  for (const [uzorak, grupa] of PRAVILA) if (uzorak.test(glavni)) return grupa;
  return null;
}

// Cela vrednost polja „УДК за претраживање" → niz žanrova (bez ponavljanja, najviše NAJVISE_ZANROVA).
// Oznake su odvojene sa „; " i svaka počinje ciframa ili zagradom (naziv grupe može da ima i tačku-zarez, pa se ne deli bilo gde).
export function zanroviIzUdk(sirov) {
  const lista = [];
  for (const deo of String(sirov ?? "").split(/;\s+(?=[\d(])/)) {
    const kod = /^\s*(\S+)/.exec(deo)?.[1];
    if (!kod) continue;
    const g = grupaZaUdk(kod);
    if (g && !lista.includes(g)) lista.push(g);
    if (lista.length >= NAJVISE_ZANROVA) break;
  }
  return lista;
}
