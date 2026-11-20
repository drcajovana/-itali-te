// Jednokratni uvoz fonda biblioteke iz CSV-a u tabelu knjige.
//
//   npm run admin:uvezi-fond                  probni režim (podrazumevani): ništa se ne upisuje, ispisuje se plan
//   npm run admin:uvezi-fond -- --upisi       upisuje u bazu (serije po 200), pa proverava da je drugi prolaz prazan
//   npm run admin:uvezi-fond -- --fajl=putanja.csv --primeri=20
//
// Radi sa servisnim ključem iz .env (SUPABASE_SERVICE_ROLE_KEY), kao scripts/resetuj-pin.mjs. Ključ se nigde ne ispisuje.
// Pravila uvoza su u src/lib/uvoz-fonda.js (ista logika koju proverava npm run test:api): izvor 'fond', u_fondu = true, odluka
// nabavke prazna, bez opisa, korica, COBISS ID-a i broja primeraka; postojeća knjiga se samo dopunjava; idempotentno.
//
// Zaštite u bazi koje su proverene pre prvog pokretanja (vidi docs/uvoz-fonda.md): okidač knjige_unos_clana izuzima servisnu
// ulogu (ne prepisuje izvor ni u_fondu), knjige_odluka_zastita radi samo pri izmeni odluke (uvoz je ne dira), knjige_isbn
// normalizuje ISBN u 13 cifara.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { indeksiKolona, parsirajCsv, planiraj, redZaUpis, sazetak, urediRed } from "../src/lib/uvoz-fonda.js";

const URL_ = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !SERVICE) {
  console.error("Nedostaju VITE_SUPABASE_URL i/ili SUPABASE_SERVICE_ROLE_KEY u .env");
  process.exit(2);
}
const bezTajni = (t) => String(t ?? "").split(SERVICE).join("***");

const arg = (ime) => process.argv.find((a) => a === `--${ime}` || a.startsWith(`--${ime}=`));
const vrednost = (ime, podrazumevano) => {
  const a = arg(ime);
  return a?.includes("=") ? a.slice(a.indexOf("=") + 1) : podrazumevano;
};
const UPISI = Boolean(arg("upisi"));
if (UPISI && arg("probno")) {
  console.error("--probno i --upisi se međusobno isključuju.");
  process.exit(2);
}
const FAJL = vrednost("fajl", "uvoz/fond-2025-2026.csv");
const PRIMERA = Math.max(1, Number(vrednost("primeri", "10")) || 10);
const SERIJA = 200;

const S = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

async function ucitajPostojece() {
  const sve = [];
  for (let od = 0; ; od += 1000) {
    const { data, error } = await S.from("knjige")
      .select("id, naslov, autor, izdavac, godina, isbn, izvor, u_fondu, odluka_nabavke, spojena_sa_id")
      .order("id")
      .range(od, od + 999);
    if (error) throw new Error(`čitanje knjiga: ${error.message}`);
    sve.push(...data);
    if (data.length < 1000) break;
  }
  return sve;
}

const skrati = (t, n = 70) => (String(t).length > n ? `${String(t).slice(0, n - 1)}…` : String(t));
const naslovi = (lista, f) => lista.slice(0, PRIMERA).forEach((x) => console.log(`   ${f(x)}`));

function ispisi(plan, ukupnoRedova) {
  const z = sazetak(plan, ukupnoRedova);
  console.log("\n── Zbir");
  console.log(`   redova u CSV-u (bez zaglavlja):                 ${z.ukupnoRedova}`);
  console.log(`   NOVE knjige (upisuju se):                       ${z.nove}`);
  console.log(`   DOPUNJENE (isti ISBN u bazi):${z.dopune}`);
  console.log(`   DOPUNJENE bez ISBN-a u bazi (naslov+autor+god): ${z.dopuneBezIsbna}`);
  console.log(`   PRESKOČENE, već u fondu (nema šta da se menja): ${z.vecUFondu}`);
  console.log(`   PRESKOČENE, ponovljene u samom CSV-u:           ${z.duplikatiUFajlu}`);
  console.log(`   ODBIJENE:                                       ${z.odbijeni}`);
  console.log(`   upozorenja (knjiga se uvozi, polje se izostavlja): ${z.upozorenja}`);

  console.log(`\n── Prvih ${PRIMERA} novih knjiga`);
  naslovi(plan.nove, (k) => `red ${k.linija}: ${skrati(k.naslov)} | ${k.autor ?? "—"} | ${k.izdavac ?? "—"} | ${k.godina ?? "—"} | ISBN ${k.isbn ?? "—"}`);
  if (plan.dopune.length + plan.dopuneBezIsbna.length) {
    console.log(`\n── Prvih ${PRIMERA} dopuna postojećih knjiga`);
    naslovi([...plan.dopune, ...plan.dopuneBezIsbna], (d) => `red ${d.linija}: ${skrati(d.naslov)} → ${JSON.stringify(d.izmena)}`);
  }

  console.log(`\n── Odbijeni redovi (${plan.odbijeni.length})`);
  if (!plan.odbijeni.length) console.log("   nijedan");
  for (const o of plan.odbijeni) console.log(`   red ${o.linija}: ${o.razlog}${o.naslov ? ` (${skrati(o.naslov)})` : ""}`);

  console.log(`\n── Ponovljeno u CSV-u, preskočeno (${plan.duplikatiUFajlu.length})`);
  if (!plan.duplikatiUFajlu.length) console.log("   nijedan");
  for (const d of plan.duplikatiUFajlu) console.log(`   red ${d.linija}: ${skrati(d.naslov)} (isto kao red ${d.prvaLinija})`);

  console.log(`\n── Upozorenja (${plan.upozorenja.length})`);
  if (!plan.upozorenja.length) console.log("   nijedno");
  for (const w of plan.upozorenja) console.log(`   red ${w.linija}: ${skrati(w.naslov, 50)}: ${w.tekst}`);

  console.log(`\n── Isti ISBN, različit naslov u CSV-u: ISBN je jedinstven, uvozi se samo prvi red, ostali se preskaču — proverite (${plan.isbnRazlicitNaslov.length})`);
  if (!plan.isbnRazlicitNaslov.length) console.log("   nijedan");
  for (const x of plan.isbnRazlicitNaslov) console.log(`   ISBN ${x.isbn}: redovi ${x.naslovi.map((n) => n.linija).join(", ")}`);

  console.log(`\n── ISBN već ima knjiga u bazi sa DRUGIM naslovom: to je ista knjiga (ne pravi se nova), proverite naslov (${plan.isbnDrugiNaslovUBazi.length})`);
  if (!plan.isbnDrugiNaslovUBazi.length) console.log("   nijedan");
  for (const x of plan.isbnDrugiNaslovUBazi.slice(0, 50)) console.log(`   red ${x.linija}: ${skrati(x.naslov, 45)} ↔ u bazi: ${skrati(x.naslovUBazi, 45)}`);

  if (plan.viseSlucajeva.length) {
    console.log(`\n── Više knjiga u bazi odgovara istom redu (dopunjena je prva, proverite ručno) (${plan.viseSlucajeva.length})`);
    for (const v of plan.viseSlucajeva) console.log(`   red ${v.linija}: ${skrati(v.naslov)} (${v.broj} u bazi)`);
  }
  if (plan.saOdlukom.length) {
    console.log(`\n── Postojeće knjige koje postaju „u fondu", a imaju odluku nabavke koja nije „imamo" (odluka se NE menja) (${plan.saOdlukom.length})`);
    for (const v of plan.saOdlukom) console.log(`   red ${v.linija}: ${skrati(v.naslov)} (odluka: ${v.odluka})`);
  }
}

async function main() {
  console.log(`Uvoz fonda — projekat: ${new URL(URL_).host}`);
  console.log(`Režim: ${UPISI ? "UPISUJE SE U BAZU (--upisi)" : "PROBNO (ništa se ne upisuje)"}`);
  console.log(`Fajl: ${FAJL}`);

  const redovi = parsirajCsv(readFileSync(FAJL, "utf8"));
  const ind = indeksiKolona(redovi[0]?.polja);
  if (ind.greska) {
    console.error(`CSV nije ispravan: ${ind.greska}`);
    return 1;
  }
  const podaci = redovi.slice(1);
  const sirova = podaci.map((r) => (r.polja.length === Object.keys(ind).length ? urediRed(r, ind) : { ok: false, razlog: `očekivano ${Object.keys(ind).length} kolona, ima ${r.polja.length}`, linija: r.linija }));
  // redovi iz urediRed nose liniju u knjiga.linija; odbijeni nemaju knjigu, pa im se linija dodaje ovde
  const unos = sirova.map((u, i) => (u.ok ? u : { ...u, linija: podaci[i].linija, naslov: String(podaci[i].polja[ind.naslov] ?? "").trim() || null }));

  const postojece = await ucitajPostojece();
  console.log(`U bazi je ${postojece.length} knjiga (${postojece.filter((k) => k.spojena_sa_id).length} spojenih duplikata se ne porede).`);

  const plan = planiraj(unos, postojece);
  ispisi(plan, podaci.length);

  if (!UPISI) {
    console.log("\nPROBNI REŽIM: ništa nije upisano. Za upis pokrenite sa --upisi.");
    return 0;
  }

  // ───── upis ─────
  console.log("\n── Upis");
  const izvestaj = { nove: 0, dopune: 0, greske: [] };
  const redoviZaUpis = plan.nove.map(redZaUpis);
  for (let i = 0; i < redoviZaUpis.length; i += SERIJA) {
    const serija = redoviZaUpis.slice(i, i + SERIJA);
    const { data, error } = await S.from("knjige").insert(serija).select("id");
    if (error) {
      izvestaj.greske.push(`serija ${i / SERIJA + 1}: ${bezTajni(error.message)}`);
      console.error(`   GREŠKA u seriji ${i / SERIJA + 1}: ${bezTajni(error.message)}. Upis se prekida; ponovno pokretanje nastavlja bez duplikata.`);
      break;
    }
    izvestaj.nove += data.length;
    console.log(`   nove: ${izvestaj.nove}/${redoviZaUpis.length}`);
  }
  if (!izvestaj.greske.length) {
    for (const d of [...plan.dopune, ...plan.dopuneBezIsbna]) {
      const { data, error } = await S.from("knjige").update(d.izmena).eq("id", d.id).select("id");
      if (error || data?.length !== 1) {
        izvestaj.greske.push(`dopuna reda ${d.linija}: ${bezTajni(error?.message ?? "nijedan red nije izmenjen")}`);
        console.error(`   GREŠKA pri dopuni reda ${d.linija}: ${bezTajni(error?.message ?? "nijedan red nije izmenjen")}`);
        break;
      }
      izvestaj.dopune++;
    }
    console.log(`   dopunjeno: ${izvestaj.dopune}/${plan.dopune.length + plan.dopuneBezIsbna.length}`);
  }

  // kontrola idempotentnosti: ponovno planiranje nad stanjem posle upisa ne sme da ima šta da radi
  const posle = planiraj(unos, await ucitajPostojece());
  const z2 = sazetak(posle, podaci.length);
  console.log("\n── Izveštaj");
  console.log(`   upisano novih: ${izvestaj.nove}, dopunjeno: ${izvestaj.dopune}, grešaka: ${izvestaj.greske.length}`);
  console.log(`   kontrola: novih ${z2.nove}, dopuna ${z2.dopune + z2.dopuneBezIsbna} (oba moraju biti 0)`);
  if (izvestaj.greske.length || z2.nove || z2.dopune || z2.dopuneBezIsbna) {
    console.error("   UPIS NIJE ČIST: pogledajte greške iznad i pokrenite ponovo (idempotentno).");
    return 1;
  }
  return 0;
}

let kod = 1;
try {
  kod = await main();
} catch (e) {
  console.error(`Greška: ${bezTajni(e?.message ?? e)}`);
}
process.exitCode = kod;
