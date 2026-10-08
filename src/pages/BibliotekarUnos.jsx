import { useCallback, useEffect, useRef, useState } from "react";
import KarticaUnosa from "../components/KarticaUnosa.jsx";
import { GreskaApija, porukaGreske } from "../lib/api.js";
import { useAuth } from "../lib/auth-context.js";
import { dodajPrimerke, izLinka, koricaIzLinka, nadjiDuplikate, postaviKoricu, sacuvajKnjigu } from "../lib/knjige.js";
import { izborKorice, primeniKoricu, sacuvajPaKoricu, sacuvajSve as sacuvajSveRedom, tekstSazetka } from "../lib/korica-tok.js";
import { tekst } from "../lib/tekst.js";
import { nasaFotografija } from "../lib/korica-slika.js";
import { lokalnoNeispravan, obradiRedom, pocetnaForma, razdvojiLinkove, sledecaZaObradu, urediUnos } from "../lib/unos-knjiga.js";

const T = tekst.unos;
const dugme = "block w-full rounded-lg bg-pecat px-5 py-3 text-xl font-semibold text-white disabled:opacity-60 sm:w-auto";


function porukaKartice(u) {
  const g = T.greskeKartice;
  // opis, žanr i signatura imaju svoju poruku za predugačak unos; naslov, autor i izdavač opštu
  if (u.razlog === "predugo") return g[`${u.polje}_predugo`] ?? g.predugo;
  return g[`${u.polje}_${u.razlog}`] ?? g.predugo;
}

// Jedna adresa: lokalna provera, pa JEDAN zahtev ka api/iz-linka (jedna stranica).
async function procitajJedan(adresa) {
  if (lokalnoNeispravan(adresa)) throw new GreskaApija("nije_https");
  const rezultati = await izLinka(adresa);
  if (!rezultati[0]) throw new GreskaApija("nema_podataka");
  return rezultati[0];
}

export default function BibliotekarUnos() {
  const { clan } = useAuth();
  const [tekstLinkova, setTekstLinkova] = useState("");
  const [stavke, setStavke] = useState([]);
  const [radi, setRadi] = useState(false); // čitanje adresa u toku
  const [cuvaSve, setCuvaSve] = useState(false);
  const [obavest, setObavest] = useState(null); // { poruka, greska }
  const stopRef = useRef(false);
  const limitRef = useRef(null);
  const stavkeRef = useRef(stavke);
  useEffect(() => {
    stavkeRef.current = stavke;
  }, [stavke]);

  const izmeni = useCallback((id, delta) => {
    setStavke((s) => s.map((x) => (x.id === id ? { ...x, ...(typeof delta === "function" ? delta(x) : delta) } : x)));
  }, []);

  async function procitaj(e) {
    e.preventDefault();
    if (radi || cuvaSve) return;
    const { linkovi, ponovljenih, previse } = razdvojiLinkove(tekstLinkova);
    if (!linkovi.length) return setObavest({ poruka: T.greske.prazno, greska: true });
    if (previse) return setObavest({ poruka: T.greske.previse, greska: true });

    stopRef.current = false;
    limitRef.current = null;
    const prefiks = Date.now();
    const pocetne = linkovi.map((link, i) => ({ id: `${prefiks}-${i}`, link, status: "ceka", potvrdjeno: false }));
    setStavke(pocetne);
    setObavest(ponovljenih ? { poruka: T.ponovljene.replace("{n}", String(ponovljenih)) } : null);
    setRadi(true);

    const { prekinuto } = await obradiRedom(linkovi, {
      obradi: procitajJedan,
      stop: () => stopRef.current,
      naStatus: (i, status, podaci) => {
        const id = pocetne[i].id;
        if (status === "prepoznato" || status === "delimicno") {
          izmeni(id, { status, rezultat: podaci.rezultat, forma: pocetnaForma(podaci.rezultat) });
        } else if (status === "nije_uspelo") {
          if (podaci.greska?.kod === "previse_zahteva") limitRef.current = podaci.greska.ponovoZaSekundi;
          izmeni(id, { status, poruka: porukaGreske(podaci.greska) });
        } else {
          izmeni(id, { status });
        }
      },
    });

    setRadi(false);
    if (prekinuto === "limit") {
      const minuta = Math.max(1, Math.ceil((limitRef.current ?? 3600) / 60));
      setObavest({ poruka: T.ogranicenje.replace("{minuta}", String(minuta)), greska: true });
    } else if (prekinuto === "korisnik") {
      setObavest({ poruka: T.prekinuto });
    }
  }

  // ───────── čuvanje ─────────
  // Upis ide preko običnog klijenta kao prijavljeni bibliotekar (RLS i okidači važu).
  // Duplikati se proveravaju neposredno pre upisa, po ISBN-13 i po normalizovanom naslovu i autoru.
  // Upis same knjige (bez korice). Vraća { status: 'sacuvano', id } | { status: 'duplikat' | 'greska' }.
  async function upisiStavku(s, { ipak = false } = {}) {
    const u = urediUnos(s.forma, { uneoId: clan.id });
    if (!u.ok) {
      izmeni(s.id, { greskaPolja: porukaKartice(u) });
      return { status: "greska" };
    }
    izmeni(s.id, { saljem: true, greskaPolja: null });
    try {
      if (!ipak) {
        const d = await nadjiDuplikate({ isbn: u.podaci.isbn, naslov: u.podaci.naslov, autor: u.podaci.autor });
        if (d.poIsbn.length || d.poTekstu.length) {
          izmeni(s.id, { saljem: false, duplikati: d });
          return { status: "duplikat" };
        }
      }
      const upisano = await sacuvajKnjigu(u.red);
      izmeni(s.id, { saljem: false, duplikati: null, sacuvano: { id: upisano.id, naslov: upisano.naslov, isbn: u.podaci.isbn, uFondu: upisano.u_fondu, korica: null } });
      return { status: "sacuvano", id: upisano.id };
    } catch (err) {
      console.error("čuvanje knjige:", err);
      izmeni(s.id, { saljem: false, greskaPolja: T.greskeKartice.upis });
      return { status: "greska" };
    }
  }

  // ───────── korica uz čuvanje (korica-tok.js) ─────────
  // Knjiga se prvo upiše; korica se primenjuje tek posle toga i njena greška NE poništava upis:
  // knjiga ostaje sačuvana (sa pločicom), a kartica pokaže razlog i „Pokušaj ponovo".
  const preuzmiKoricu = (knjigaId, url) => koricaIzLinka(knjigaId, url);
  const otpremiSliku = (knjigaId, blob) => postaviKoricu(knjigaId, blob, null);

  function koricaNaKarticu(id, k) {
    if (k.ishod === "preuzeta" || k.ishod === "slika") {
      izmeni(id, (x) => ({ sacuvano: { ...x.sacuvano, korica: k.korica, koricaStanje: "gotovo", koricaRazlog: null, bezKorice: false } }));
    } else if (k.ishod === "greska" || k.ishod === "limit") {
      izmeni(id, (x) => ({ sacuvano: { ...x.sacuvano, koricaStanje: "greska", koricaRazlog: k.razlog } }));
    } else {
      izmeni(id, (x) => ({ sacuvano: { ...x.sacuvano, koricaStanje: null } }));
    }
  }
  const koricaRadi = (id) => izmeni(id, (x) => ({ sacuvano: { ...x.sacuvano, koricaStanje: "radi", koricaRazlog: null } }));
  const ulazKorice = (s) => ({ izbor: izborKorice(s), predlog: s.rezultat?.korica ?? null, slika: s.slika ?? null });

  async function sacuvajStavku(s, { ipak = false } = {}) {
    const r = await sacuvajPaKoricu({
      upisi: () => upisiStavku(s, { ipak }),
      ...ulazKorice(s),
      preuzmi: preuzmiKoricu,
      otpremi: otpremiSliku,
      naKorici: () => koricaRadi(s.id),
    });
    if (r.korica) koricaNaKarticu(s.id, r.korica);
    return r.upis;
  }

  async function ponoviKoricu(s) {
    const n = stavkeRef.current.find((x) => x.id === s.id);
    if (!n?.sacuvano) return;
    koricaRadi(n.id);
    const k = await primeniKoricu({ ...ulazKorice(n), knjigaId: n.sacuvano.id, preuzmi: preuzmiKoricu, otpremi: otpremiSliku });
    koricaNaKarticu(n.id, k);
  }

  async function dodajPrimerkeStavci(s, postojeca) {
    const tekstPrimeraka = String(s.forma.primerci).trim();
    if (!/^\d{1,3}$/.test(tekstPrimeraka) || Number(tekstPrimeraka) < 1) {
      return izmeni(s.id, { greskaPolja: T.greskeKartice.primerci_neispravno });
    }
    izmeni(s.id, { saljem: true, greskaPolja: null });
    try {
      await dodajPrimerke(postojeca, Number(tekstPrimeraka));
      izmeni(s.id, {
        saljem: false,
        duplikati: null,
        sacuvano: { id: postojeca.id, naslov: postojeca.naslov, isbn: postojeca.isbn, primerci: true, uFondu: true, korica: nasaFotografija(postojeca) },
      });
    } catch (err) {
      // zapis se u međuvremenu promenio: duplikati se brišu, pa sledeće „Sačuvaj" proverava ponovo
      izmeni(s.id, {
        saljem: false,
        duplikati: null,
        greskaPolja: err?.kod === "izmenjeno_u_medjuvremenu" ? T.duplikat.izmenjeno : T.greskeKartice.upis,
      });
    }
  }

  // „Sledeća knjiga": skroluje do sledeće kartice kojoj treba pažnja (čeka pregled ili čeka koricu),
  // da bibliotekar sa telefonom prođe kroz gomilu knjiga bez vraćanja na vrh liste.
  function idiNaSledecu(id) {
    const sledeca = sledecaZaObradu(stavkeRef.current, id);
    const kartica = sledeca && document.querySelector(`[data-kartica="${sledeca.id}"]`);
    if (!kartica) return;
    const manjePokreta = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    kartica.scrollIntoView({ block: "start", behavior: manjePokreta ? "auto" : "smooth" });
    kartica.focus({ preventScroll: true });
  }

  // „Sačuvaj sve potvrđene": redom, jedna po jedna; korica po izboru sa kartice, uz pauzu između
  // dva preuzimanja. Kartice sa duplikatom ili greškom ostaju otvorene za odluku bibliotekara.
  // Kad se potroši ograničenje preuzimanja, ostatak se čuva bez korice (piše u sažetku).
  async function sacuvajSve() {
    if (radi || cuvaSve) return;
    const potvrdjene = stavkeRef.current.filter((s) => s.potvrdjeno && !s.sacuvano && s.forma);
    if (!potvrdjene.length) return setObavest({ poruka: T.sacuvajSve.nema });
    setCuvaSve(true);
    setObavest(null);
    const naslovi = Object.fromEntries(potvrdjene.map((s) => [s.id, s.forma.naslov]));
    const lista = potvrdjene.map((s) => ({ id: s.id, ...ulazKorice(s) }));
    const zbir = await sacuvajSveRedom(lista, {
      sacuvaj: (st, { ogranicenjePotroseno, pauza }) => {
        const najnovija = stavkeRef.current.find((x) => x.id === st.id);
        return sacuvajPaKoricu({
          upisi: () => upisiStavku(najnovija),
          izbor: st.izbor,
          predlog: st.predlog,
          slika: st.slika,
          preuzmi: preuzmiKoricu,
          otpremi: otpremiSliku,
          ogranicenjePotroseno,
          pauza,
          naKorici: () => koricaRadi(st.id),
        });
      },
      naStavku: (id, r) => r.korica && koricaNaKarticu(id, r.korica),
    });
    setCuvaSve(false);
    setObavest({ poruka: tekstSazetka(zbir, naslovi) });
  }

  const obradjeno = stavke.filter((s) => !["ceka", "trazi"].includes(s.status)).length;
  const brojPotvrdjenih = stavke.filter((s) => s.potvrdjeno && !s.sacuvano && s.forma).length;

  return (
    <>
      <h1 className="text-3xl font-semibold text-pecat">{T.naslov}</h1>
      <p className="mt-1 text-lg">{T.uvod}</p>

      <form onSubmit={procitaj} className="mt-4 space-y-3" noValidate>
        <label htmlFor="linkovi" className="sr-only">
          {T.polje}
        </label>
        <textarea
          id="linkovi"
          rows={6}
          autoCapitalize="off"
          spellCheck={false}
          placeholder={T.polje}
          value={tekstLinkova}
          onChange={(e) => setTekstLinkova(e.target.value)}
          disabled={radi}
          className="block w-full rounded-lg border-2 border-ivica bg-white px-4 py-3 font-mono text-base focus:border-pecat focus:outline-none"
        />
        <div className="flex flex-col gap-3 sm:flex-row">
          <button type="submit" disabled={radi || cuvaSve} className={dugme}>
            {radi ? T.citam : T.procitaj}
          </button>
          {radi && (
            <button
              type="button"
              onClick={() => {
                stopRef.current = true;
              }}
              className="block w-full rounded-lg border-2 border-pecat px-5 py-3 text-xl font-semibold text-pecat sm:w-auto"
            >
              {T.prekini}
            </button>
          )}
        </div>
      </form>

      {obavest && (
        <p role={obavest.greska ? "alert" : "status"} className={`mt-4 rounded-lg border-2 p-3 text-lg font-medium ${obavest.greska ? "border-pecat text-pecat" : "border-ivica"}`}>
          {obavest.poruka}
        </p>
      )}

      {stavke.length > 0 && (
        <section className="mt-6" aria-live="polite">
          <p className="text-lg font-medium">{T.obradjeno.replace("{n}", String(obradjeno)).replace("{ukupno}", String(stavke.length))}</p>
          <ul className="mt-3 space-y-4">
            {stavke.map((s) => (
              <KarticaUnosa
                key={s.id}
                stavka={s}
                onPromeni={(ime, vrednost) =>
                  ["potvrdjeno", "koricaIzbor", "slika"].includes(ime)
                    ? izmeni(s.id, { [ime]: vrednost })
                    : izmeni(s.id, (x) => ({ forma: { ...x.forma, [ime]: vrednost }, greskaPolja: null }))
                }
                onSacuvaj={() => sacuvajStavku(stavkeRef.current.find((x) => x.id === s.id))}
                onDodajPrimerke={(postojeca) => dodajPrimerkeStavci(stavkeRef.current.find((x) => x.id === s.id), postojeca)}
                onIpak={() => sacuvajStavku(stavkeRef.current.find((x) => x.id === s.id), { ipak: true })}
                onKorica={(adresa) => izmeni(s.id, (x) => ({ sacuvano: { ...x.sacuvano, korica: adresa, bezKorice: false } }))}
                onKoricaPonovi={() => ponoviKoricu(s)}
                onBezKorice={(bez) => izmeni(s.id, (x) => ({ sacuvano: { ...x.sacuvano, bezKorice: bez } }))}
                onSledeca={() => idiNaSledecu(s.id)}
                imaSledecu={Boolean(sledecaZaObradu(stavke, s.id))}
              />
            ))}
          </ul>

          <button type="button" onClick={sacuvajSve} disabled={radi || cuvaSve || !brojPotvrdjenih} className={`${dugme} mt-6`}>
            {cuvaSve ? tekst.opste.sacekajte : T.sacuvajSve.dugme.replace("{n}", String(brojPotvrdjenih))}
          </button>
        </section>
      )}
    </>
  );
}
