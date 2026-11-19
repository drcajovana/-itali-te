import { useEffect } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

// Pri prelasku na drugu stranicu (dodir na stavku menija, link, navigate) ekran počinje od vrha, a ne na sredini prethodnog.
// Dugme „nazad" (POP) se NE dira: tada pregledač sam vraća raniju poziciju. Menja se samo putanja: promena filtera u adresi
// iste stranice (npr. ?izvor= na „Све књиге") ne vraća skrol na vrh.
export default function PovratakNaVrh() {
  const { pathname } = useLocation();
  const tip = useNavigationType();

  useEffect(() => {
    if (tip !== "POP") window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    // tip je namerno izostavljen: važi samo za promenu putanje
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  return null;
}
