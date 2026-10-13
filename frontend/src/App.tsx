import { Navigate, Route, Routes } from "react-router-dom";
import { homeFor, RequireRole, useAuth } from "./auth";
import Login from "./pages/Login";
import TouristApp from "./tourist/TouristApp";
import AdminLayout from "./admin/AdminLayout";

export default function App() {
  const { session } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/app/*" element={<RequireRole roles={["tourist", "admin"]}><TouristApp /></RequireRole>} />
      <Route path="/admin/*" element={<RequireRole roles={["admin"]}><AdminLayout /></RequireRole>} />
      <Route path="*" element={<Navigate to={homeFor(session)} replace />} />
    </Routes>
  );
}
