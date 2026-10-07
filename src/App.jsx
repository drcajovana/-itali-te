import { Navigate, Route, Routes } from "react-router-dom";
import AuthProvider from "./components/AuthProvider.jsx";
import RutaZaBibliotekare from "./components/RutaZaBibliotekare.jsx";
import ZasticenaRuta from "./components/ZasticenaRuta.jsx";
import BibliotekarUnos from "./pages/BibliotekarUnos.jsx";
import Pocetna from "./pages/Pocetna.jsx";
import Prijava from "./pages/Prijava.jsx";
import Pretraga from "./pages/Pretraga.jsx";
import Profil from "./pages/Profil.jsx";

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/prijava" element={<Prijava />} />
        <Route element={<ZasticenaRuta />}>
          <Route path="/" element={<Pocetna />} />
          <Route path="/pretraga" element={<Pretraga />} />
          <Route path="/profil" element={<Profil />} />
          <Route element={<RutaZaBibliotekare />}>
            <Route path="/bibliotekar/unos" element={<BibliotekarUnos />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
