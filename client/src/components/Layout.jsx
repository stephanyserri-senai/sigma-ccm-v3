import React, { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { ChevronRight, Menu, X } from "lucide-react";
import { useAuth, PERMS } from "../auth.jsx";
import ThemeIcon from "./ThemeIcon.jsx";
import SinoNotificacoes from "./SinoNotificacoes.jsx";
import StatusConexao from "./StatusConexao.jsx";
import BadgeQualidade from "./BadgeQualidade.jsx";
import MarcaConjunta from "./MarcaConjunta.jsx";

const NAV = [
  { id: "inicio", to: "/inicio", label: "Início", icon: "report" },
  { id: "dashboard", to: "/dashboard", label: "Visão geral", icon: "report" },
  { id: "indicadores", to: "/indicadores", label: "Indicadores", icon: "chart" },
  { id: "notas", to: "/notas", label: "Notas", icon: "document-gear" },
  { id: "ordens", to: "/ordens", label: "Ordens", icon: "wrench" },
  { id: "planejamento", to: "/planejamento", label: "Planejamento", icon: "calendar" },
  { id: "passagem-turno", to: "/passagem-turno", label: "Passagem de turno", icon: "documents" },
  { id: "notificacoes", to: "/notificacoes", label: "Notificações", icon: "bell" },
  { id: "inspecoes", to: "/inspecoes", label: "Inspeções", icon: "map" },
  { id: "permissoes", to: "/permissoes", label: "Permissões (PT)", icon: "shield-check" },
  { id: "formularios", to: "/formularios", label: "Formulários", icon: "checklist" },
  { id: "meu-plano", to: "/meu-plano", label: "Meu plano", icon: "calendar" },
  { id: "apropriacao", to: "/apropriacao", label: "Apropriação", icon: "worker" },
  { id: "ocorrencias", to: "/ocorrencias", label: "Ocorrências", icon: "bell" },
  { id: "mao-de-obra", to: "/mao-de-obra", label: "Mão de obra", icon: "worker" },
  { id: "ia", to: "/ia", label: "Qualidade de dados", icon: "monitor-pulse" },
  { id: "metas", to: "/metas", label: "Metas dos KPIs", icon: "list-check" },
  { id: "auditoria", to: "/auditoria", label: "Auditoria", icon: "database" },
  { id: "usuarios", to: "/usuarios", label: "Usuários", icon: "users" },
  { id: "cadastros", to: "/cadastros", label: "Cadastros", icon: "gears" },
];

const TITLES = {
  inicio: "Minha visão geral", dashboard: "Visão geral", notas: "Notas de manutenção", ordens: "Ordens de manutenção",
  apropriacao: "Apropriação", execucao: "Relatório da OM", ia: "Qualidade de dados", usuarios: "Usuários", cadastros: "Cadastros",
  "mao-de-obra": "Mão de obra", ocorrencias: "Ocorrências da equipe", indicadores: "Indicadores", "meu-plano": "Meu plano de manutenção", metas: "Metas e parâmetros dos KPIs", planejamento: "Planejamento e programação", "passagem-turno": "Passagem de turno", formularios: "Formulários e checklists", inspecoes: "Rotas de inspeção", permissoes: "Permissão de Trabalho (APR/PT)", notificacoes: "Notificações", auditoria: "Trilha de auditoria",
};
const PAGE_ICONS = {
  inicio: "report", dashboard: "report", notas: "document-gear", ordens: "wrench",
  apropriacao: "worker", execucao: "report", ia: "warning", usuarios: "users", cadastros: "gears",
  "mao-de-obra": "worker", ocorrencias: "bell", indicadores: "chart", "meu-plano": "calendar", metas: "list-check", planejamento: "calendar", "passagem-turno": "documents", formularios: "checklist", inspecoes: "map", permissoes: "shield-check", notificacoes: "bell", auditoria: "database",
};

function Navegacao({ items, onLogout }) {
  return (
    <>
      <nav aria-label="Menu principal" className="mt-2 flex-1 space-y-1 overflow-y-auto px-3 pb-3">
        {items.map((n) => (
          <NavLink key={n.id} to={n.to}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors focus-visible:outline-indigo-400 ${
                isActive ? "bg-slate-800 font-semibold text-white" : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
              }`}>
            {({ isActive }) => (<>
              <ThemeIcon name={n.icon} className="h-6 w-6" /> {n.label}
              {isActive && <ChevronRight className="ml-auto h-4 w-4 text-indigo-400" aria-hidden="true" />}
            </>)}
          </NavLink>
        ))}
      </nav>
      <div className="flex items-center justify-between px-5 py-4">
        <button type="button" onClick={onLogout} className="flex items-center gap-2 text-sm text-slate-400 hover:text-white focus-visible:outline-indigo-400">
          <ThemeIcon name="logout" className="h-5 w-5" /> Sair
        </button>
        <span className="text-[11px] tabular-nums text-slate-500" title="Versão do sistema">v{__APP_VERSION__}</span>
      </div>
    </>
  );
}

// Assinatura conjunta VLI | SIGMA·CCM no topo do menu, na versão para fundo escuro.
const Marca = () => (
  <div className="flex items-center px-2 py-1">
    <MarcaConjunta size="xs" tema="escuro" />
  </div>
);

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const loc = useLocation();
  const [menuAberto, setMenuAberto] = useState(false);
  const allowed = PERMS[user.papel] || [];
  const items = NAV.filter((n) => allowed.includes(n.id));
  const current = loc.pathname.split("/")[1] || "dashboard";

  // No celular, o menu é uma gaveta: fecha ao navegar e com Esc.
  useEffect(() => { setMenuAberto(false); }, [loc.pathname]);
  useEffect(() => {
    if (!menuAberto) return undefined;
    const onKey = (event) => { if (event.key === "Escape") setMenuAberto(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuAberto]);

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50 font-sans text-slate-900">
      <a href="#conteudo" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[70] focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-indigo-700 focus:shadow-lg">
        Pular para o conteúdo
      </a>

      <aside className="hidden w-60 shrink-0 flex-col bg-slate-900 lg:flex">
        <div className="px-3 py-4"><Marca /></div>
        <Navegacao items={items} onLogout={logout} />
      </aside>

      {menuAberto && <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
        <div className="absolute inset-0 bg-slate-900/50" onClick={() => setMenuAberto(false)} aria-hidden="true" />
        <aside className="relative flex h-full w-72 max-w-[85vw] flex-col bg-slate-900 shadow-xl">
          <div className="flex items-center justify-between gap-2 px-3 py-4">
            <Marca />
            <button type="button" onClick={() => setMenuAberto(false)} aria-label="Fechar menu" autoFocus
              className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white focus-visible:outline-indigo-400"><X className="h-5 w-5" /></button>
          </div>
          <Navegacao items={items} onLogout={logout} />
        </aside>
      </div>}

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex h-16 shrink-0 items-center justify-between gap-2 border-b border-slate-200 bg-white px-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <button type="button" onClick={() => setMenuAberto(true)} aria-label="Abrir menu" aria-expanded={menuAberto}
              className="rounded-md p-2 text-slate-600 hover:bg-slate-100 lg:hidden"><Menu className="h-5 w-5" /></button>
            <h1 className="flex min-w-0 items-center gap-2 text-base font-bold text-slate-900 sm:text-lg">
              <ThemeIcon name={PAGE_ICONS[current] || "documents"} className="hidden h-6 w-6 sm:block" />
              <span className="truncate">{TITLES[current] || ""}</span>
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
            <StatusConexao />
            {allowed.includes("ia") && <BadgeQualidade />}
            <SinoNotificacoes />
            <div className="hidden text-right md:block">
              <div className="text-sm font-semibold text-slate-800">{user.nome}</div>
              <div className="text-xs text-slate-500">{user.papel}{user.equipe ? ` · ${user.equipe}` : ""}</div>
            </div>
            <div className="grid h-9 w-9 place-items-center rounded-full bg-indigo-600 text-sm font-bold text-white" title={`${user.nome} · ${user.papel}`} aria-hidden="true">
              {user.nome ? user.nome[0] : "U"}
            </div>
          </div>
        </header>
        <main id="conteudo" tabIndex={-1} className="flex-1 overflow-y-auto p-3 focus:outline-none sm:p-6">{children}</main>
      </div>
    </div>
  );
}
