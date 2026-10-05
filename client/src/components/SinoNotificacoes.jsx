import React, { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Bell } from "lucide-react";
import { api } from "../api.js";

const POLL_MS = 60000;

// Contador de notificações não lidas no cabeçalho (atualiza a cada minuto e ao navegar).
export default function SinoNotificacoes() {
  const navigate = useNavigate();
  const location = useLocation();
  const [count, setCount] = useState({ nao_lidas: 0, criticas: 0 });

  useEffect(() => {
    let active = true;
    const load = () => api.notificacoesContador().then((result) => { if (active) setCount(result); }).catch(() => {});
    load();
    const timer = setInterval(load, POLL_MS);
    window.addEventListener("notificacoes:atualizar", load);
    return () => { active = false; clearInterval(timer); window.removeEventListener("notificacoes:atualizar", load); };
  }, [location.pathname]);

  const label = count.nao_lidas
    ? `${count.nao_lidas} notificação(ões) não lida(s)${count.criticas ? `, ${count.criticas} crítica(s)` : ""}`
    : "Notificações";
  return (
    <button type="button" onClick={() => navigate("/notificacoes")} aria-label={label} title={label}
      className="relative grid h-9 w-9 place-items-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800">
      <Bell className="h-5 w-5" />
      {count.nao_lidas > 0 && <span className={`absolute -right-0.5 -top-0.5 min-w-[1.15rem] rounded-full px-1 text-center text-[10px] font-bold leading-[1.15rem] text-white ${count.criticas ? "bg-rose-600" : "bg-indigo-600"}`}>
        {count.nao_lidas > 99 ? "99+" : count.nao_lidas}
      </span>}
    </button>
  );
}
