// POST /api/pretraga-google   (Authorization: Bearer <Supabase JWT člana>)
// Telo: { naslov?, autor?, isbn?, q? }  (bar jedno polje)
// Odgovor: { rezultati: [{ naslov, autori, izdavac, godina, isbn, opis, korica, izvor: 'google_books', url }] }
import { ApiGreska } from "./_lib/greska.js";
import { pretraziGoogle } from "./_lib/google-books.js";
import { obradi } from "./_lib/zajednicko.js";

const tekst = (v) => {
  if (v === undefined || v === null) return "";
  if (typeof v !== "string") throw new ApiGreska(400, "neispravan_zahtev", "Polja moraju biti tekst.");
  return v;
};

export default function handler(req, res) {
  return obradi(req, res, {
    proveri(telo) {
      const p = { naslov: tekst(telo.naslov), autor: tekst(telo.autor), isbn: tekst(telo.isbn), q: tekst(telo.q) };
      if (!Object.values(p).some((v) => v.trim())) {
        throw new ApiGreska(400, "prazan_upit", "Upišite naslov, autora ili ISBN.");
      }
      return p;
    },
    radi: (parametri) => pretraziGoogle(parametri),
  });
}
