import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle2, ShieldAlert, ShieldCheck } from "lucide-react";
import { api } from "../api.js";
import { Badge, Btn } from "./ui.jsx";

const STATUS_TONE = { Solicitada: "amber", Aprovada: "emerald", Reprovada: "rose", Cancelada: "slate", Encerrada: "indigo" };
const validityBr = (value) => value.replace("T", " ").replace(/^(\d{4})-(\d{2})-(\d{2})/, "$3/$2/$1");

// Situação da Permissão de Trabalho na OM: exigência, PT vigente e histórico.
export default function PermissaoOM({ ordem, podeConfigurar, onChanged }) {
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const closed = ordem.status === "Encerrada" || ordem.status === "Cancelada";
  const toggle = async () => {
    setError("");
    try { await api.exigenciaPT(ordem.id, !ordem.exige_pt); onChanged?.(); } catch (e) { setError(e.message); }
  };

  return (
    <div className="space-y-3">
      {ordem.pt_vigente
        ? <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800"><ShieldCheck className="h-4 w-4" /> {ordem.pt_vigente.numero} aprovada e vigente.</div>
        : ordem.exige_pt
          ? <div className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800"><ShieldAlert className="h-4 w-4" /> Esta OM exige PT aprovada e vigente para iniciar a execução.</div>
          : <p className="text-sm text-slate-500">Esta OM não exige permissão de trabalho.</p>}
      {podeConfigurar && !closed && <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={ordem.exige_pt} onChange={toggle} /> Exigir PT aprovada para iniciar a execução
      </label>}
      {ordem.permissoes?.length > 0 && <ul className="divide-y divide-slate-100 text-sm">
        {ordem.permissoes.map((permit) => (
          <li key={permit.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span className="font-mono font-semibold text-slate-800">{permit.numero}</span>
            <span className="text-xs tabular-nums text-slate-500">{validityBr(permit.validade_inicio)} até {validityBr(permit.validade_fim)}</span>
            <Badge tone={STATUS_TONE[permit.status]}>{permit.status}</Badge>
          </li>
        ))}
      </ul>}
      {error && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
      <div className="flex flex-wrap gap-2">
        {!closed && !ordem.pt_vigente && <Btn size="sm" variant={ordem.exige_pt ? "primary" : "ghost"} onClick={() => navigate(`/permissoes?om=${ordem.id}`)}>Solicitar PT</Btn>}
        {ordem.permissoes?.length > 0 && <Btn size="sm" variant="ghost" onClick={() => navigate("/permissoes")}><CheckCircle2 className="h-3.5 w-3.5" /> Ver permissões</Btn>}
      </div>
    </div>
  );
}
