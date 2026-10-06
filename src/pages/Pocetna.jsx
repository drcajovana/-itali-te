import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth-context.js";
import { tekst } from "../lib/tekst.js";

export default function Pocetna() {
  const { clan } = useAuth();

  return (
    <>
      <h1 className="text-3xl font-semibold text-pecat">
        {tekst.pocetna.pozdrav}, {clan.nadimak || clan.ime}
      </h1>
      <Link to="/pretraga" className="mt-6 block rounded-lg bg-pecat px-5 py-4 text-center text-xl font-semibold text-white sm:inline-block">
        {tekst.pocetna.trazi}
      </Link>
      <p className="mt-6 text-lg text-mastilo/70">{tekst.pocetna.uIzradi}</p>
    </>
  );
}
