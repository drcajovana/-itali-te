import { bojaAvatara, inicijaliNadimka } from "../lib/citaoci-logika.js";

// Krug sa inicijalima nadimka (prototip: .avatar). Boja je iz teme, po id-u člana. Samo nadimak:
// prava imena drugih članova ekran nikad ne dobija.
export default function Avatar({ id, nadimak, velika = false }) {
  return (
    <span
      aria-hidden="true"
      className={`flex flex-none items-center justify-center rounded-full font-semibold text-white ${bojaAvatara(id)} ${velika ? "size-14 text-lg" : "size-11 text-[13px]"}`}
    >
      {inicijaliNadimka(nadimak)}
    </span>
  );
}
