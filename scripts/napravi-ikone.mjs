// Pravi znak aplikacije (lepeza knjiga) kao SVG i PNG ikone. Bez novih paketa: PNG se crta ovde (pokrivenost tačaka 4x4), kodira zlib-om.
//
//   node scripts/napravi-ikone.mjs
//
// Izlaz (public/): znak.svg (zaglavlje), favicon-32.png, apple-touch-icon.png (180, bez prozirnosti), icons/icon-192.png, icons/icon-512.png
// (zaobljen kvadrat, prozirni uglovi), icons/icon-maskable-512.png (cela pozadina, znak u bezbednoj zoni).
// Logo biblioteke (public/logo.png) se NE dira: on ostaje na ekranu za prijavu i na članskoj karti za štampu.
import { mkdirSync, writeFileSync } from "node:fs";
import { crc32, deflateSync } from "node:zlib";

const BORDO = [0x4d, 0x00, 0x00];
const ZLATO = [0xa8, 0x7a, 0x28];
const KREM = [0xf4, 0xef, 0xe5];

// Znak u prostoru crteža: pet korena knjiga raširenih u lepezu oko tačke (150, 158), pa pločica u sredini.
const PIVOT = [150, 158];
const KORENI = [
  { ugao: -58, visina: 74, boja: "glavna" },
  { ugao: -29, visina: 82, boja: "zlato" },
  { ugao: 0, visina: 88, boja: "glavna" },
  { ugao: 29, visina: 82, boja: "zlato" },
  { ugao: 58, visina: 74, boja: "glavna" },
];
const SIRINA_KORENA = 14;
const ZAOBLJENJE = 2;
const SREDISTE_ZNAKA = [150, 119]; // sredina okvira znaka (x 83..217, y 70..168)

// ───── SVG ─────
function svgZnak() {
  const koreni = KORENI.map((k) => {
    const x = PIVOT[0] - SIRINA_KORENA / 2;
    const y = PIVOT[1] - k.visina;
    const boja = k.boja === "zlato" ? "#a87a28" : "#4d0000";
    const r = k.ugao === 0 ? "" : ` transform="rotate(${k.ugao} ${PIVOT[0]} ${PIVOT[1]})"`;
    return `  <rect x="${x}" y="${y}" width="${SIRINA_KORENA}" height="${k.visina}" rx="${ZAOBLJENJE}" fill="${boja}"${r}/>`;
  }).join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="75 44 150 150" width="150" height="150">
${koreni}
  <circle cx="${PIVOT[0]}" cy="${PIVOT[1]}" r="10" fill="#4d0000"/>
  <circle cx="${PIVOT[0]}" cy="${PIVOT[1]}" r="6" fill="#f4efe5"/>
</svg>
`;
}

// ───── PNG ─────
const NADUZORKOVANJE = 4;

function sdZaobljenPravougaonik(px, py, cx, cy, hx, hy, r) {
  const qx = Math.abs(px - cx) - (hx - r);
  const qy = Math.abs(py - cy) - (hy - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

// Boja tačke (crtež, tamna pozadina): null ako je tačka van oblika (prozirna).
function bojaTacke(x, boje, ivica) {
  // pozadina: zaobljen kvadrat ili cela površina
  if (ivica && sdZaobljenPravougaonik(x.px, x.py, ivica.s / 2, ivica.s / 2, ivica.s / 2, ivica.s / 2, ivica.r) > 0) return null;
  // tačka u prostoru crteža
  const dx = x.dx;
  const dy = x.dy;
  const hub = Math.hypot(dx - PIVOT[0], dy - PIVOT[1]);
  if (hub <= 6) return boje.hubUnutra;
  if (hub <= 10) return boje.hubSpolja;
  for (let i = KORENI.length - 1; i >= 0; i--) {
    const k = KORENI[i];
    const a = (k.ugao * Math.PI) / 180;
    const rx = dx - PIVOT[0];
    const ry = dy - PIVOT[1];
    const lx = rx * Math.cos(a) + ry * Math.sin(a);
    const ly = -rx * Math.sin(a) + ry * Math.cos(a);
    if (sdZaobljenPravougaonik(lx, ly, 0, -k.visina / 2, SIRINA_KORENA / 2, k.visina / 2, ZAOBLJENJE) <= 0) return k.boja === "zlato" ? ZLATO : boje.glavna;
  }
  return boje.pozadina;
}

function nacrtaj({ velicina, razmera, zaobljenje, tamna = true }) {
  const boje = tamna ? { pozadina: BORDO, glavna: KREM, hubSpolja: KREM, hubUnutra: BORDO } : { pozadina: KREM, glavna: BORDO, hubSpolja: BORDO, hubUnutra: KREM };
  const ivica = zaobljenje ? { s: velicina, r: velicina * zaobljenje } : null;
  const s = velicina * razmera;
  const rgba = Buffer.alloc(velicina * velicina * 4);
  const n = NADUZORKOVANJE;
  for (let py = 0; py < velicina; py++) {
    for (let px = 0; px < velicina; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < n; sy++) {
        for (let sx = 0; sx < n; sx++) {
          const fx = px + (sx + 0.5) / n;
          const fy = py + (sy + 0.5) / n;
          const c = bojaTacke({ px: fx, py: fy, dx: (fx - velicina / 2) / s + SREDISTE_ZNAKA[0], dy: (fy - velicina / 2) / s + SREDISTE_ZNAKA[1] }, boje, ivica);
          if (c) {
            r += c[0];
            g += c[1];
            b += c[2];
            a += 1;
          }
        }
      }
      const o = (py * velicina + px) * 4;
      if (a) {
        rgba[o] = Math.round(r / a);
        rgba[o + 1] = Math.round(g / a);
        rgba[o + 2] = Math.round(b / a);
      }
      rgba[o + 3] = Math.round((a / (n * n)) * 255);
    }
  }
  return kodirajPng(velicina, velicina, rgba);
}

function kodirajPng(w, h, rgba) {
  const redovi = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    redovi[y * (w * 4 + 1)] = 0;
    rgba.copy(redovi, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const deo = (tip, podaci) => {
    const t = Buffer.from(tip, "ascii");
    const len = Buffer.alloc(4);
    len.writeUInt32BE(podaci.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([t, podaci])) >>> 0);
    return Buffer.concat([len, t, podaci, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // 8 bita
  ihdr[9] = 6; // RGBA
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), deo("IHDR", ihdr), deo("IDAT", deflateSync(redovi, { level: 9 })), deo("IEND", Buffer.alloc(0))]);
}

mkdirSync("public/icons", { recursive: true });
writeFileSync("public/znak.svg", svgZnak());
// razmera: koliko jedinica crteža ide na jedan piksel (znak je širok oko 133 jedinice); veća ikona = veći znak
writeFileSync("public/icons/icon-512.png", nacrtaj({ velicina: 512, razmera: 0.0046, zaobljenje: 0.22 }));
writeFileSync("public/icons/icon-192.png", nacrtaj({ velicina: 192, razmera: 0.0046, zaobljenje: 0.22 }));
writeFileSync("public/icons/icon-maskable-512.png", nacrtaj({ velicina: 512, razmera: 0.0041, zaobljenje: 0 }));
writeFileSync("public/apple-touch-icon.png", nacrtaj({ velicina: 180, razmera: 0.0046, zaobljenje: 0 }));
writeFileSync("public/favicon-32.png", nacrtaj({ velicina: 32, razmera: 0.0054, zaobljenje: 0.22 }));
console.log("ok: public/znak.svg, favicon-32.png, apple-touch-icon.png, icons/icon-192.png, icon-512.png, icon-maskable-512.png");
