// Domeni sa kojih api/iz-linka.js sme da pročita stranicu knjige. Jedno mesto,
// lako se proširuje: dodaje se samo domen, bez „www." (važi i za poddomene, pa
// „laguna.rs" propušta i „www.laguna.rs"). Sve ostalo se odbija.
//
// Pre dodavanja domena proveriti da sajt dozvoljava ovakvo čitanje (link koji
// član sam zalepi, jedna stranica, uz ograničenje 30 zahteva na sat). Ovo nije
// i ne sme da postane skidanje kataloga (CLAUDE.md, „Šta se ne radi").
export const DOZVOLJENI_DOMENI = [
  // Izdavači koje je tražila biblioteka
  "laguna.rs",
  "delfi.rs",
  "vulkani.rs",
  "dereta.rs",
  "booka.rs",
  "geopoetika.rs",
  "arhipelag.rs",
  "carobnaknjiga.rs",
  "kreativnicentar.rs",

  // Iz starog parsera (docs/nabavka-extract.js)
  "pcelica.rs",
  "publikpraktikum.rs",
  "stelaknjige.rs",

  // Predlog: izdavači koji su odgovarali na proveru (oktobar 2026)
  "clio.rs",
  "klett.rs",
  // geopoetika.rs ne odgovara; izdavač je na geopoetika.com
  "geopoetika.com",
];
