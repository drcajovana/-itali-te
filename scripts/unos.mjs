// Unos iz terminala za skripte: vidljivo pitanje, vidljiv ili skriven odgovor.
//
// Zašto ne readline: u terminalnom režimu readline sam crta svoj (prazan)
// prompt i pri tome briše red u koji je pitanje već ispisano, pa na Windows-u
// pitanja nisu vidljiva. Ovde se pitanje ispisuje jednom i niko ga ne briše,
// a odgovor se čita znak po znak (raw mode).
//
// Odgovor je UVEK tekst. Broj karte i PIN mogu da počinju nulom, pa se nigde
// ne pretvaraju u broj.

const { stdin, stdout } = process;
const spavaj = (ms) => new Promise((r) => setTimeout(r, ms));

// Ctrl-C. Ne zove se process.exit() dok je terminal otvoren: na Windows-u to
// ruši Node (Assertion failed: UV_HANDLE_CLOSING). Skripta uhvati ovo i izađe
// prirodno, preko process.exitCode.
export class Prekinuto extends Error {}

// Terminal se uvek vraća u običan režim, i kad skripta pukne.
process.on("exit", () => {
  try {
    stdin.setRawMode(false);
  } catch {
    /* stdin nije terminal ili je već zatvoren */
  }
});

// Odbaci sve što je stiglo dok skripta nije pitala (npr. Enter kojim je
// pokrenuta komanda ili tasteri pritisnuti dok je čekala mrežu); inače bi se
// to pročitalo kao odgovor na prvo pitanje.
async function isprazniUlaz(ms = 100) {
  const odbaci = () => {};
  stdin.on("data", odbaci);
  stdin.resume();
  await spavaj(ms);
  stdin.off("data", odbaci);
}

function citaj(tajno) {
  return new Promise((resolve, reject) => {
    const znakovi = []; // niz, ne string: jedan taster može biti dva UTF-16 koda
    stdin.setRawMode(true);
    stdin.setEncoding("utf8");
    stdin.resume();

    const gotovo = () => {
      stdin.off("data", naPodatke);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write("\n");
      resolve(znakovi.join(""));
    };

    function naPodatke(deo) {
      if (deo.startsWith("\u001b")) return; // strelice, Home/End, F-tasteri
      for (const znak of deo) {
        if (znak === "\r" || znak === "\n") return gotovo();
        if (znak === "\u0003") {
          // Ctrl-C: u raw režimu ga ne obrađuje terminal.
          stdin.off("data", naPodatke);
          stdin.setRawMode(false);
          stdin.pause();
          stdout.write("\n");
          return reject(new Prekinuto());
        }
        if (znak === "\u007f" || znak === "\b") {
          if (znakovi.length) {
            znakovi.pop();
            stdout.write("\b \b");
          }
          continue;
        }
        if (znak < " ") continue; // ostali kontrolni znaci
        znakovi.push(znak);
        stdout.write(tajno ? "*" : znak);
      }
    }
    stdin.on("data", naPodatke);
  });
}

export async function pitaj(pitanje) {
  await isprazniUlaz();
  stdout.write(pitanje);
  return (await citaj(false)).trim();
}

// Odgovor se ne prikazuje (zvezdice umesto znakova) i ne skraćuje.
export async function pitajTajno(pitanje) {
  await isprazniUlaz();
  stdout.write(pitanje);
  return citaj(true);
}
