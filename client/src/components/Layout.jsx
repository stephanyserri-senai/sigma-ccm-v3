import React from "react";
import { NavLink, useLocation } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { useAuth, PERMS } from "../auth.jsx";
import ThemeIcon from "./ThemeIcon.jsx";

const NAV = [
  { id: "dashboard", to: "/dashboard", label: "Visão geral", icon: "report" },
  { id: "indicadores", to: "/indicadores", label: "Indicadores", icon: "chart" },
  { id: "notas", to: "/notas", label: "Notas", icon: "document-gear" },
  { id: "ordens", to: "/ordens", label: "Ordens", icon: "wrench" },
  { id: "planejamento", to: "/planejamento", label: "Planejamento", icon: "calendar" },
  { id: "passagem-turno", to: "/passagem-turno", label: "Passagem de turno", icon: "documents" },
  { id: "inspecoes", to: "/inspecoes", label: "Inspeções", icon: "map" },
  { id: "permissoes", to: "/permissoes", label: "Permissões (PT)", icon: "shield-check" },
  { id: "formularios", to: "/formularios", label: "Formulários", icon: "checklist" },
  { id: "meu-plano", to: "/meu-plano", label: "Meu plano", icon: "calendar" },
  { id: "apropriacao", to: "/apropriacao", label: "Apropriação", icon: "worker" },
  { id: "ocorrencias", to: "/ocorrencias", label: "Ocorrências", icon: "bell" },
  { id: "mao-de-obra", to: "/mao-de-obra", label: "Mão de obra", icon: "worker" },
  { id: "ia", to: "/ia", label: "Qualidade de dados", icon: "monitor-pulse" },
  { id: "metas", to: "/metas", label: "Metas dos KPIs", icon: "list-check" },
  { id: "usuarios", to: "/usuarios", label: "Usuários", icon: "users" },
  { id: "cadastros", to: "/cadastros", label: "Cadastros", icon: "gears" },
];

const TITLES = {
  dashboard: "Visão geral", notas: "Notas de manutenção", ordens: "Ordens de manutenção",
  apropriacao: "Apropriação", execucao: "Relatório da OM", ia: "Qualidade de dados", usuarios: "Usuários", cadastros: "Cadastros",
  "mao-de-obra": "Mão de obra", ocorrencias: "Ocorrências da equipe", indicadores: "Indicadores", "meu-plano": "Meu plano de manutenção", metas: "Metas e parâmetros dos KPIs", planejamento: "Planejamento e Programação", "passagem-turno": "Passagem de turno", formularios: "Formulários e checklists", inspecoes: "Rotas de inspeção", permissoes: "Permissão de Trabalho (APR/PT)",
};
const PAGE_ICONS = {
  dashboard: "report", notas: "document-gear", ordens: "wrench",
  apropriacao: "worker", execucao: "report", ia: "warning", usuarios: "users", cadastros: "gears",
  "mao-de-obra": "worker", ocorrencias: "bell", indicadores: "chart", "meu-plano": "calendar", metas: "list-check", planejamento: "calendar", "passagem-turno": "documents", formularios: "checklist", inspecoes: "map", permissoes: "shield-check",
};

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const loc = useLocation();
  const allowed = PERMS[user.papel] || [];
  const items = NAV.filter((n) => allowed.includes(n.id));
  const current = loc.pathname.split("/")[1] || "dashboard";

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50 font-sans text-slate-900">
      <aside className="flex w-60 shrink-0 flex-col bg-slate-900">
        <div className="flex items-center gap-2 px-5 py-5">
          <img src="/sigma-icon.svg" alt="" className="h-8 w-8 rounded-lg" />
          <span className="font-bold text-white">SIGMA<span className="text-indigo-400">·CCM</span></span>
        </div>
        <nav className="mt-2 flex-1 space-y-1 px-3">
          {items.map((n) => (
              <NavLink key={n.id} to={n.to}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                    isActive ? "bg-slate-800 font-semibold text-white" : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                  }`}>
                {({ isActive }) => (<>
                  <ThemeIcon name={n.icon} className="h-6 w-6" /> {n.label}
                  {isActive && <ChevronRight className="ml-auto h-4 w-4 text-indigo-400" />}
                </>)}
              </NavLink>
          ))}
        </nav>
        <button onClick={logout} className="flex items-center gap-2 px-5 py-4 text-sm text-slate-400 hover:text-white">
          <ThemeIcon name="logout" className="h-5 w-5" /> Sair
        </button>
      </aside>

      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-16 items-center justify-between border-b border-slate-200 bg-white px-6">
          <h1 className="flex items-center gap-2 text-lg font-bold text-slate-900">
            <ThemeIcon name={PAGE_ICONS[current] || "documents"} className="h-6 w-6" />
            {TITLES[current] || ""}
          </h1>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-sm font-semibold text-slate-800">{user.nome}</div>
              <div className="text-xs text-slate-500">{user.papel}</div>
            </div>
            <div className="grid h-9 w-9 place-items-center rounded-full bg-indigo-600 text-sm font-bold text-white">
              {user.nome ? user.nome[0] : "U"}
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
