import React, { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../api.js";
import ThemeIcon from "./ThemeIcon.jsx";

// Contador de sinalizações da IA aguardando decisão humana (cabeçalho).
export default function BadgeQualidade() {
  const navigate = useNavigate();
  const location = useLocation();
  const [novas, setNovas] = useState(0);

  useEffect(() => {
    let active = true;
    const load = () => api.sinalizacoesContador().then((result) => { if (active) setNovas(result.novas); }).catch(() => {});
    load();
    const timer = setInterval(load, 60000);
    window.addEventListener("sinalizacoes:atualizar", load);
    return () => { active = false; clearInterval(timer); window.removeEventListener("sinalizacoes:atualizar", load); };
  }, [location.pathname]);

  const label = novas ? `${novas} inconsistência(s) da IA aguardando decisão` : "Qualidade de dados: nenhuma inconsistência pendente";
  return (
    <button type="button" onClick={() => navigate("/ia")} aria-label={label} title={label}
      className="relative grid h-9 w-9 place-items-center rounded-full transition-colors hover:bg-slate-100">
      <ThemeIcon name="monitor-pulse" className="h-5 w-5" />
      {novas > 0 && <span className="absolute -right-0.5 -top-0.5 min-w-[1.15rem] rounded-full bg-amber-500 px-1 text-center text-[10px] font-bold leading-[1.15rem] text-white">{novas > 99 ? "99+" : novas}</span>}
    </button>
  );
}
