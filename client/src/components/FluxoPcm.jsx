import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, ArrowRight, CheckCircle2, ChevronRight } from "lucide-react";
import { api } from "../api.js";
import { useAuth, PERMS } from "../auth.jsx";
import { Card, Eyebrow } from "./ui.jsx";

const number = (value) => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(value);

// Consulta rápida do PCM: as etapas do fluxo da OM com contadores e os alertas do dia.
export default function FluxoPcm() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const allowed = PERMS[user.papel] || [];

  useEffect(() => { api.resumoPcm().then(setData).catch((e) => setError(e.message)); }, []);

  if (error) return <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">Fluxo do PCM indisponível: {error}</div>;
  if (!data) return null;

  const go = (page) => (allowed.includes(page) ? () => navigate(`/${page}`) : null);
  const steps = [
    { label: "Notas abertas", value: data.fluxo.notas_abertas, hint: "converter em OM", page: "notas" },
    { label: "OMs a programar", value: data.fluxo.oms_abertas, hint: "datas, equipe e HH", page: "planejamento" },
    { label: "Sem executante", value: data.fluxo.oms_sem_executante, hint: "distribuir", page: "ordens" },
    { label: "Distribuídas", value: data.fluxo.oms_distribuidas, hint: "aguardando início", page: "ordens" },
    { label: "Em execução", value: data.fluxo.oms_em_execucao, hint: "em campo", page: "ordens" },
  ];
  const { semana, alertas } = data;
  const adherenceOk = semana.aderencia_prevista != null && semana.aderencia_prevista >= semana.meta_aderencia;
  const alerts = [
    { label: "OMs atrasadas", value: alertas.oms_atrasadas, bad: alertas.oms_atrasadas > 0, page: "ordens" },
    { label: "OMs sem alocação", value: alertas.oms_sem_alocacao, bad: alertas.oms_sem_alocacao > 0, page: "planejamento" },
    { label: "Carga da semana", value: semana.carga == null ? "—" : `${number(semana.carga)}%`, bad: semana.carga != null && semana.carga > semana.carga_maxima, page: "planejamento" },
    { label: "Aderência prevista", value: semana.aderencia_prevista == null ? "—" : `${number(semana.aderencia_prevista)}%`, bad: semana.aderencia_prevista != null && !adherenceOk, page: "planejamento" },
    { label: "Passagens não lidas", value: alertas.passagens_nao_lidas, bad: alertas.passagens_nao_lidas > 0, page: "passagem-turno" },
    { label: "Sinalizações de dados", value: alertas.sinalizacoes_novas, bad: alertas.sinalizacoes_novas > 0, page: "ia" },
    { label: "PTs aguardando aprovação", value: alertas.pts_aguardando, bad: alertas.pts_aguardando > 0, page: "permissoes" },
    { label: "Rondas em andamento", value: alertas.rondas_em_andamento, bad: false, page: "inspecoes" },
    { label: "Ocorrências de HH na semana", value: alertas.ocorrencias_semana, bad: false, page: "mao-de-obra" },
  ];

  const Clickable = ({ onClick, className, children, label }) => onClick
    ? <button type="button" onClick={onClick} aria-label={label} className={`${className} text-left transition-colors hover:border-indigo-300 hover:bg-indigo-50`}>{children}</button>
    : <div className={className}>{children}</div>;

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <Eyebrow>Fluxo do PCM · consulta rápida</Eyebrow>
          <h2 className="mt-1 text-sm font-semibold text-slate-800">Da nota à execução, hoje</h2>
        </div>
        {go("planejamento") && <button type="button" onClick={go("planejamento")} className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-700 hover:text-indigo-900">Abrir planejamento <ArrowRight className="h-3.5 w-3.5" /></button>}
      </div>

      <ol className="mt-3 flex flex-col gap-2 md:flex-row md:items-stretch">
        {steps.map((step, index) => (
          <li key={step.label} className="flex flex-1 items-center gap-2">
            <Clickable onClick={go(step.page)} label={`${step.label}: ${step.value}`} className="flex-1 rounded-xl border border-slate-200 px-3 py-2.5">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{index + 1}. {step.label}</div>
              <div className="mt-0.5 text-2xl font-bold tabular-nums text-slate-900">{step.value}</div>
              <div className="text-[11px] text-slate-500">{step.hint}</div>
            </Clickable>
            {index < steps.length - 1 && <ChevronRight className="hidden h-4 w-4 shrink-0 text-slate-300 md:block" aria-hidden="true" />}
          </li>
        ))}
      </ol>

      <div className="mt-3 flex flex-wrap gap-2">
        {alerts.map((alert) => (
          <Clickable key={alert.label} onClick={go(alert.page)} label={`${alert.label}: ${alert.value}`}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${alert.bad ? "border-rose-200 bg-rose-50 text-rose-800" : "border-slate-200 bg-white text-slate-600"}`}>
            {alert.bad ? <AlertTriangle className="h-3.5 w-3.5 text-rose-600" /> : <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />}
            {alert.label}: <span className="font-semibold tabular-nums">{alert.value}</span>
          </Clickable>
        ))}
      </div>
    </Card>
  );
}
