import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CheckCircle2, Hourglass, UserCheck, XCircle } from "lucide-react";
import { api } from "../api.js";
import { useAuth } from "../auth.jsx";
import { Badge, Btn, Card, Eyebrow, Spinner, inputCls, statusTone } from "../components/ui.jsx";
import { dateTimeBr } from "../components/FormRenderer.jsx";
import ThemeIcon from "../components/ThemeIcon.jsx";

const FILTERS = [["Nova", "Novas"], ["Aceita", "Aceitas"], ["Rejeitada", "Rejeitadas"], ["", "Todas"]];
const percent = (value) => `${Math.round((value || 0) * 100)}%`;
const hours = (value) => (value == null ? "—" : `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(value)} h`);

function ScoreBar({ value }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100" aria-hidden="true"><div className="h-full rounded-full bg-indigo-600" style={{ width: percent(value) }} /></div>
      <span className="font-mono text-xs tabular-nums text-slate-700">{percent(value)}</span>
    </div>
  );
}

export default function IA() {
  const { user } = useAuth();
  const manager = user.papel !== "EXECUTANTE";
  const [params] = useSearchParams();
  const [lista, setLista] = useState(null);
  const [filtro, setFiltro] = useState("Nova");
  const [sel, setSel] = useState(() => Number(params.get("id")) || null);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");

  const carregar = () => api.sinalizacoes().then(setLista).catch((e) => setErro(e.message));
  useEffect(() => { carregar(); }, []);
  // Ao abrir pelo atalho da tela de Campo, mostra a sinalização mesmo que já decidida.
  useEffect(() => {
    if (!lista || !sel) return;
    const chosen = lista.find((item) => item.id === sel);
    if (chosen && filtro && chosen.status !== filtro) setFiltro("");
  }, [lista]);

  if (!lista) return erro ? <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{erro}</div> : <Spinner />;
  const visiveis = lista.filter((item) => !filtro || item.status === filtro);
  const s = visiveis.find((item) => item.id === sel) || visiveis[0];
  const decidido = async (message) => {
    setAviso(message);
    await carregar();
    window.dispatchEvent(new Event("sinalizacoes:atualizar"));
    window.dispatchEvent(new Event("notificacoes:atualizar"));
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3 rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-sm text-indigo-900">
        <UserCheck className="mt-0.5 h-5 w-5 shrink-0 text-indigo-700" />
        <div>
          <div className="font-semibold">Decisão humana (human-in-the-loop)</div>
          <p className="mt-0.5">A IA apenas sinaliza e sugere. Nenhum dado é alterado sem que uma pessoa do PCM ou CCM analise e decida; cada aceite ou rejeição fica na trilha de auditoria com nome, data e justificativa.</p>
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-slate-200" role="tablist" aria-label="Situação das sinalizações">
        {FILTERS.map(([id, label]) => (
          <button key={label} type="button" role="tab" aria-selected={filtro === id} onClick={() => { setFiltro(id); setAviso(""); }}
            className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-semibold transition-colors ${filtro === id ? "border-indigo-600 text-indigo-700" : "border-transparent text-slate-500 hover:text-slate-800"}`}>
            {label} <span className="rounded-full bg-slate-100 px-1.5 text-xs tabular-nums text-slate-500">{id ? lista.filter((item) => item.status === id).length : lista.length}</span>
          </button>
        ))}
      </div>
      {erro && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{erro}</div>}
      {aviso && <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{aviso}</div>}

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
            <div className="flex items-center gap-2 font-semibold text-slate-800"><ThemeIcon name="warning" className="h-5 w-5" /> Sinalizações de inconsistência</div>
            <Badge tone="indigo"><ThemeIcon name="monitor-pulse" className="mr-1 h-3.5 w-3.5" /> detecção heurística + faixa</Badge>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="px-5 py-2.5 font-semibold">OM</th>
                  <th className="px-5 py-2.5 font-semibold">Tipo</th>
                  <th className="px-5 py-2.5 font-semibold">Score</th>
                  <th className="px-5 py-2.5 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {visiveis.map((item) => (
                  <tr key={item.id} onClick={() => { setSel(item.id); setAviso(""); }} aria-selected={s?.id === item.id}
                    className={`cursor-pointer border-b border-slate-50 last:border-0 ${s?.id === item.id ? "bg-indigo-50" : "hover:bg-slate-50"}`}>
                    <td className="px-5 py-3"><div className="font-mono font-semibold text-slate-700">{item.ordem_numero || "—"}</div><div className="font-mono text-xs text-slate-400">{item.equipamento || ""}</div></td>
                    <td className="px-5 py-3"><div className="text-slate-700">{item.tipo}</div><div className="text-xs text-slate-400">{dateTimeBr(item.criado_em)}</div></td>
                    <td className="px-5 py-3"><ScoreBar value={item.score} /></td>
                    <td className="px-5 py-3"><Badge tone={statusTone(item.status)}>{item.status}</Badge></td>
                  </tr>
                ))}
                {!visiveis.length && <tr><td colSpan={4} className="px-5 py-10 text-center text-sm text-slate-400">{filtro === "Nova" ? "Nenhuma inconsistência aguardando análise." : "Nenhuma sinalização nesta situação."}</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="p-5 lg:col-span-2">
          {s ? <Detalhe key={s.id} s={s} manager={manager} onDecided={decidido} onError={setErro} /> : <div className="py-10 text-center text-sm text-slate-400">Selecione uma sinalização.</div>}
        </Card>
      </div>
    </div>
  );
}

function Detalhe({ s, manager, onDecided, onError }) {
  const [valor, setValor] = useState(String(s.valor_sugerido ?? ""));
  const [justificativa, setJustificativa] = useState("");
  const [saving, setSaving] = useState(false);
  const fatores = [...(s.fatores || [])].sort((left, right) => right.v - left.v);

  const decide = async (action, message) => {
    setSaving(true);
    onError("");
    try { await action(); await onDecided(message); } catch (e) { onError(e.message); } finally { setSaving(false); }
  };

  return (
    <div className="space-y-5">
      <div>
        <Eyebrow>Detalhe da sinalização</Eyebrow>
        <h2 className="mt-1 font-semibold text-slate-900">{s.tipo}</h2>
        <p className="mt-0.5 font-mono text-xs text-slate-500">OM {s.ordem_numero || "—"}{s.equipamento ? ` · ${s.equipamento}` : ""} · campo {s.campo}</p>
        {s.apontado_por && <p className="mt-1 text-xs text-slate-500">{s.apontamento_tipo} registrada por {s.apontado_por}{s.apontamento_data ? ` em ${dateTimeBr(s.apontamento_data)}` : ""}</p>}
      </div>

      <div className={`grid gap-3 ${s.status === "Aceita" ? "grid-cols-3" : "grid-cols-2"}`}>
        <div className="rounded-lg bg-slate-50 p-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Valor registrado</div>
          <div className="mt-0.5 text-lg font-bold tabular-nums text-slate-900">{hours(s.valor_atual)}</div>
        </div>
        <div className="rounded-lg bg-slate-50 p-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Sugerido pela IA</div>
          <div className="mt-0.5 text-lg font-bold tabular-nums text-indigo-700">{hours(s.valor_sugerido)}</div>
        </div>
        {s.status === "Aceita" && <div className="rounded-lg bg-emerald-50 p-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">Aplicado</div>
          <div className="mt-0.5 text-lg font-bold tabular-nums text-emerald-800">{hours(s.valor_aplicado)}</div>
        </div>}
      </div>

      <div>
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-800">Por que foi sinalizado (explicação da IA)</h3>
          <span className="text-xs text-slate-500">Confiança {percent(s.score)}</span>
        </div>
        <p className="mt-0.5 text-xs text-slate-400">Peso de cada fator na sinalização (0 a 100%).</p>
        <ul className="mt-3 space-y-3">
          {fatores.map((factor) => (
            <li key={factor.t}>
              <div className="flex justify-between gap-2 text-xs text-slate-600"><span>{factor.t}</span><span className="font-semibold tabular-nums text-slate-800">{percent(factor.v)}</span></div>
              <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-100" role="img" aria-label={`${factor.t}: ${percent(factor.v)}`}>
                <div className="h-2 rounded-full bg-indigo-600" style={{ width: percent(factor.v) }} />
              </div>
            </li>
          ))}
          {!fatores.length && <li className="text-sm text-slate-400">Sem fatores de explicação registrados.</li>}
        </ul>
      </div>

      {s.status === "Nova" && manager && <div className="space-y-3 border-t border-slate-100 pt-4">
        <h3 className="text-sm font-semibold text-slate-800">Sua decisão</h3>
        <label className="block">
          <span className="text-xs font-semibold text-slate-500">HH a aplicar ao aceitar (sugestão da IA, pode ajustar)</span>
          <input type="number" min="0.01" step="0.25" className={`mt-1 ${inputCls} tabular-nums`} value={valor} onChange={(event) => setValor(event.target.value)} />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-slate-500">Justificativa (obrigatória para rejeitar)</span>
          <textarea rows={2} maxLength={1000} className={`mt-1 resize-y ${inputCls}`} value={justificativa} onChange={(event) => setJustificativa(event.target.value)}
            placeholder="Ex.: confirmado com o executante; serviço estendido aprovado." />
        </label>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Btn disabled={saving || !(Number(valor) > 0)} onClick={() => decide(() => api.aceitarSinal(s.id, { valor: Number(valor), justificativa }), `Sugestão aceita: apontamento corrigido para ${hours(Number(valor))}.`)}>
            <CheckCircle2 className="h-4 w-4" /> Aceitar e corrigir
          </Btn>
          <Btn variant="danger" disabled={saving || !justificativa.trim()} onClick={() => decide(() => api.rejeitarSinal(s.id, justificativa), "Sinalização rejeitada: o valor registrado foi mantido.")}>
            <XCircle className="h-4 w-4" /> Rejeitar e manter
          </Btn>
        </div>
      </div>}

      {s.status === "Nova" && !manager && <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
        <Hourglass className="mt-0.5 h-4 w-4 shrink-0" /> Em análise pelo PCM/CCM. O seu apontamento só muda se uma pessoa aceitar a sugestão.
      </p>}

      {s.status !== "Nova" && <div className={`rounded-lg px-4 py-3 text-sm ${s.status === "Aceita" ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-700"}`}>
        <div className="flex items-center gap-2 font-semibold">
          {s.status === "Aceita" ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
          {s.status === "Aceita" ? `Aceita: apontamento corrigido para ${hours(s.valor_aplicado)}.` : "Rejeitada: valor registrado mantido."}
        </div>
        <p className="mt-1 text-xs">Decisão de {s.decidido_por || "—"}{s.decidido_em ? ` em ${dateTimeBr(s.decidido_em)}` : ""}{s.justificativa ? ` — "${s.justificativa}"` : ""}</p>
      </div>}
    </div>
  );
}
