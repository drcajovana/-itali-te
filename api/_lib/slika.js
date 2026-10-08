// Stvaran tip slike po SADRŽAJU (prvi bajtovi), nikad po nastavku adrese ni po zaglavlju
// Content-Type: sajt može da pošalje HTML ili SVG pod imenom slike. Dozvoljeni su samo
// jpeg, png i webp (isto kao bucket „korice", migracije 0013 i 0014).
//
//   jpeg  FF D8 FF
//   png   89 50 4E 47 0D 0A 1A 0A
//   webp  "RIFF" <4 bajta veličine> "WEBP"
//
// Vraća { mime, ekstenzija } ili null.
export function tipSlike(bajtovi) {
  if (!bajtovi || bajtovi.length < 12) return null;
  const b = bajtovi;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: "image/jpeg", ekstenzija: "jpg" };
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) {
    return { mime: "image/png", ekstenzija: "png" };
  }
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    return { mime: "image/webp", ekstenzija: "webp" };
  }
  return null;
}
