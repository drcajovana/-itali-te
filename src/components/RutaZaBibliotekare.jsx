import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../lib/auth-context.js";
import { jeBibliotekar } from "../lib/uloge.js";

// Samo bibliotekar i administrator; ostali se preusmeravaju na početnu. Provera je
// udobnost u interfejsu: upis štiti RLS u bazi (vidi lib/uloge.js).
// Mora da stoji unutar ZasticenaRuta, koja garantuje da je član učitan.
export default function RutaZaBibliotekare() {
  const { clan } = useAuth();
  return jeBibliotekar(clan?.uloga) ? <Outlet /> : <Navigate to="/" replace />;
}
