import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth, homeFor, PERMS } from "./auth.jsx";
import Layout from "./components/Layout.jsx";
import { Spinner } from "./components/ui.jsx";

import Login from "./pages/Login.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Notas from "./pages/Notas.jsx";
import Ordens from "./pages/Ordens.jsx";
import Apropriacao from "./pages/Apropriacao.jsx";
import IA from "./pages/IA.jsx";
import Usuarios from "./pages/Usuarios.jsx";
import Cadastros from "./pages/Cadastros.jsx";
import Execucao from "./pages/Execucao.jsx";

export default function App() {
  const { user, loading } = useAuth();

  if (loading) return <div className="grid h-screen place-items-center bg-slate-50"><Spinner /></div>;
  if (!user) return <Login />;

  const home = homeFor(user.papel);
  const allowed = PERMS[user.papel] || [];
  const guard = (id, el) => (allowed.includes(id) ? el : <Navigate to={home} replace />);

  return (
    <Layout>
      <Routes>
        <Route path="/dashboard" element={guard("dashboard", <Dashboard />)} />
        <Route path="/notas" element={guard("notas", <Notas />)} />
        <Route path="/ordens" element={guard("ordens", <Ordens />)} />
        <Route path="/apropriacao" element={guard("apropriacao", <Apropriacao />)} />
        <Route path="/ia" element={guard("ia", <IA />)} />
        <Route path="/usuarios" element={guard("usuarios", <Usuarios />)} />
        <Route path="/cadastros" element={guard("cadastros", <Cadastros />)} />
          <Route path="/execucao/:id" element={guard("execucao", <Execucao />)} />
        <Route path="*" element={<Navigate to={home} replace />} />
      </Routes>
    </Layout>
  );
}
