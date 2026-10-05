import React, { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Minus, Plus, Trash2 } from "lucide-react";
import { api } from "../api.js";
import { Badge, Btn, Card, Eyebrow, Modal, Spinner, dataBr, inputCls, statusTone, ErrorState } from "../components/ui.jsx";
import { useToast } from "../components/toast.jsx";

const WEEKDAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const number = (value, digits = 1) => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: digits }).format(value);
const toIso = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const shift = (iso, days) => {
  const [year, month, day] = iso.split("-").map(Number);
  return toIso(new Date(year, month - 1, day + days));
};

function LoadBar({ alocado, capacidade, carga, sobrecarga }) {
  if (!alocado && !capacidade) return <div className="text-[11px] text-slate-300">—</div>;
  return (
    <div>
      <div className="flex items-center justify-between gap-1 text-[11px] tabular-nums">
        <span className="text-slate-500">{number(alocado)}/{number(capacidade)} h</span>
        <span className={`inline-flex items-center gap-0.5 font-semibold ${sobrecarga ? "text-rose-700" : "text-slate-600"}`}>
          {sobrecarga && <AlertTriangle className="h-3 w-3" aria-label="Sobrecarga" />}
          {carga == null ? (alocado ? "sem capacidade" : "") : `${number(carga, 0)}%`}
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
        <div className={`h-full rounded-full ${sobrecarga ? "bg-rose-500" : "bg-indigo-500"}`} style={{ width: `${Math.min(100, carga ?? (alocado ? 100 : 0))}%` }} />
      </div>
    </div>
  );
}

function Summary({ label, value, detail, status }) {
  const Icon = status === "ok" ? CheckCircle2 : status === "alerta" ? AlertTriangle : Minus;
  return (
    <Card className="p-4">
      <Eyebrow>{label}</Eyebrow>
      <div className="mt-2 text-2xl font-bold tabular-nums text-slate-900">{value}</div>
      {detail && <div className="mt-1 flex items-center gap-1 text-xs text-slate-600">
        {status && <Icon className={`h-3.5 w-3.5 ${status === "ok" ? "text-emerald-600" : status === "alerta" ? "text-rose-600" : "text-slate-400"}`} />}
        {detail}
      </div>}
    </Card>
  );
}

export default function Planejamento() {
  const toast = useToast();
  const [semana, setSemana] = useState("");
  const [plan, setPlan] = useState(null);
  const [revision, setRevision] = useState(0);
  const [dialog, setDialog] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    api.planejamento(semana)
      .then((result) => { if (active) setPlan(result); })
      .catch((e) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [semana, revision]);

  if (!plan) return error ? <ErrorState message={error} /> : <Spinner />;

  const inicio = plan.semana.inicio;
  const today = toIso(new Date());
  const { resumo } = plan;
  const adherenceOk = resumo.aderencia_prevista != null && resumo.aderencia_prevista >= resumo.meta_aderencia;
  const saved = (message) => { setDialog(null); setRevision((value) => value + 1); toast.success(message); };
  const novo = (prefill = {}) => setDialog({ item: null, prefill: { data: inicio <= today && today <= plan.semana.fim ? today : inicio, ...prefill } });

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <Eyebrow>Calendário semanal por equipe</Eyebrow>
          <h2 className="mt-1 text-lg font-bold text-slate-900">Semana de {dataBr(inicio)} a {dataBr(plan.semana.fim)}</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Btn variant="ghost" onClick={() => setSemana(shift(inicio, -7))}><ChevronLeft className="h-4 w-4" /><span className="sr-only">Semana anterior</span></Btn>
          <Btn variant="ghost" onClick={() => setSemana("")}>Esta semana</Btn>
          <Btn variant="ghost" onClick={() => setSemana(shift(inicio, 7))}><ChevronRight className="h-4 w-4" /><span className="sr-only">Próxima semana</span></Btn>
          <Btn onClick={() => novo()}><Plus className="h-4 w-4" /> Alocar atividade</Btn>
        </div>
      </header>

      {error && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

      <section aria-label="Resumo da semana" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Summary label="Carga da semana" value={resumo.carga == null ? "—" : `${number(resumo.carga, 0)}%`}
          detail={`${number(resumo.alocado)} h alocadas de ${number(resumo.capacidade)} h`}
          status={resumo.carga == null ? null : resumo.carga > resumo.carga_maxima ? "alerta" : "ok"} />
        <Summary label="Aderência prevista" value={resumo.aderencia_prevista == null ? "—" : `${number(resumo.aderencia_prevista, 0)}%`}
          detail={resumo.aderencia_prevista == null ? "Nenhuma OM alocada" : `Meta ≥ ${number(resumo.meta_aderencia)}% · ${adherenceOk ? "dentro da meta" : "fora da meta"}`}
          status={resumo.aderencia_prevista == null ? null : adherenceOk ? "ok" : "alerta"} />
        <Summary label="OMs alocadas" value={resumo.oms_alocadas} detail={`${resumo.oms_aderentes} sem conflito de capacidade`} />
        <Summary label="Dias em sobrecarga" value={resumo.dias_sobrecarga} detail={`Acima de ${number(resumo.carga_maxima, 0)}% da capacidade`}
          status={resumo.dias_sobrecarga ? "alerta" : "ok"} />
      </section>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1080px] table-fixed text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-xs text-slate-500">
                <th className="w-44 px-3 py-2.5 text-left font-semibold uppercase tracking-wide">Equipe</th>
                {plan.dias.map((data, index) => (
                  <th key={data} className={`px-2 py-2.5 text-left font-semibold ${data === today ? "text-indigo-700" : ""}`}>
                    {WEEKDAYS[index]} <span className="font-normal tabular-nums text-slate-400">{dataBr(data).slice(0, 5)}</span>
                  </th>
                ))}
                <th className="w-32 px-3 py-2.5 text-left font-semibold uppercase tracking-wide">Semana</th>
              </tr>
            </thead>
            <tbody>
              {plan.equipes.map((team) => (
                <tr key={team.id} className="border-b border-slate-100 align-top last:border-0">
                  <td className="px-3 py-3">
                    <div className="font-semibold text-slate-800">{team.nome}</div>
                    <div className="text-xs text-slate-400">{team.pessoas} pessoa(s)</div>
                    {team.capacidade_estimada && <div className="mt-1 text-[11px] text-amber-700" title="Sem HH disponível lançado em Mão de obra: capacidade estimada pelo HH semanal de referência por pessoa.">capacidade estimada</div>}
                  </td>
                  {team.dias.map((day) => (
                    <td key={day.data} className={`px-2 py-2 ${day.data === today ? "bg-indigo-50/40" : ""}`}>
                      <div className="flex min-h-24 flex-col gap-1.5">
                        {plan.alocacoes.filter((item) => item.equipe_id === team.id && item.data === day.data).map((item) => (
                          <button key={item.id} type="button" onClick={() => setDialog({ item })} title={item.observacao || undefined}
                            className={`rounded-md border px-2 py-1 text-left transition-colors hover:bg-indigo-50 ${item.sobrecarga ? "border-rose-300" : "border-slate-200"}`}>
                            <div className="flex items-center justify-between gap-1">
                              <span className="font-mono text-[11px] font-semibold text-slate-800">{item.numero}</span>
                              <span className="text-[11px] tabular-nums text-slate-500">{number(item.hh_previsto)} h</span>
                            </div>
                            <div className="truncate font-mono text-[10px] text-slate-500">{item.equipamento || "—"}</div>
                          </button>
                        ))}
                        <button type="button" onClick={() => novo({ equipe_id: team.id, data: day.data })} aria-label={`Alocar para ${team.nome} em ${dataBr(day.data)}`}
                          className="rounded-md border border-dashed border-slate-200 py-0.5 text-xs text-slate-400 hover:border-indigo-300 hover:text-indigo-600">+</button>
                        <div className="mt-auto pt-1"><LoadBar {...day} /></div>
                      </div>
                    </td>
                  ))}
                  <td className="px-3 py-3">
                    <LoadBar {...team.total} />
                    {team.total.dias_sobrecarga > 0 && <div className="mt-1 text-[11px] text-rose-700">{team.total.dias_sobrecarga} dia(s) em sobrecarga</div>}
                  </td>
                </tr>
              ))}
              {!plan.equipes.length && <tr><td colSpan={9} className="px-5 py-12 text-center text-sm text-slate-400">Nenhuma equipe cadastrada.</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-400">
          Capacidade diária = HH disponível da semana (Mão de obra) ÷ 5 dias úteis, menos as ocorrências do dia; sem lançamento, usa pessoas × HH semanal de referência.
          A aderência prevista conta as OMs da semana cujas alocações não caem em dia de sobrecarga.
        </p>
      </Card>

      <Card>
        <div className="border-b border-slate-100 px-5 py-3">
          <div className="font-semibold text-slate-800">OMs a programar</div>
          <p className="mt-0.5 text-xs text-slate-500">OMs não encerradas com HH alocado menor que o HH previsto.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="px-5 py-3 font-semibold">OM</th>
                <th className="px-5 py-3 font-semibold">Status</th>
                <th className="px-5 py-3 font-semibold">Equipe</th>
                <th className="px-5 py-3 text-right font-semibold">HH alocado / previsto</th>
                <th className="px-5 py-3 text-right font-semibold"><span className="sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody>
              {plan.pendentes.map((order) => (
                <tr key={order.id} className="border-b border-slate-50 last:border-0">
                  <td className="px-5 py-3"><div className="font-mono font-semibold text-slate-800">{order.numero}</div><div className="font-mono text-xs text-slate-500">{order.equipamento || "Sem equipamento"} · {order.tipo}</div></td>
                  <td className="px-5 py-3"><Badge tone={statusTone(order.status)}>{order.status}</Badge></td>
                  <td className="px-5 py-3 text-slate-600">{order.equipe || "—"}</td>
                  <td className="px-5 py-3 text-right tabular-nums text-slate-600">{number(order.hh_alocado)} / {number(order.hh_previsto)} h</td>
                  <td className="px-5 py-2 text-right">
                    <Btn size="sm" variant="ghost" onClick={() => novo({ ordem_id: order.id, equipe_id: order.equipe_id || "", hh_previsto: Math.max(0.5, order.hh_previsto - order.hh_alocado) })}>Alocar</Btn>
                  </td>
                </tr>
              ))}
              {!plan.pendentes.length && <tr><td colSpan={5} className="px-5 py-10 text-center text-sm text-slate-400">Todas as OMs abertas estão alocadas.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      {dialog && <AlocacaoModal plan={plan} item={dialog.item} prefill={dialog.prefill} onClose={() => setDialog(null)} onSaved={saved} />}
    </div>
  );
}

function AlocacaoModal({ plan, item, prefill = {}, onClose, onSaved }) {
  const [values, setValues] = useState(() => item
    ? { ordem_id: String(item.ordem_id), equipe_id: String(item.equipe_id), data: item.data, hh_previsto: String(item.hh_previsto), observacao: item.observacao || "" }
    : { ordem_id: prefill.ordem_id ? String(prefill.ordem_id) : "", equipe_id: prefill.equipe_id ? String(prefill.equipe_id) : "", data: prefill.data || "", hh_previsto: prefill.hh_previsto ? String(prefill.hh_previsto) : "", observacao: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const order = plan.ordens.find((entry) => String(entry.id) === values.ordem_id);
  const set = (key) => (event) => setValues((previous) => ({ ...previous, [key]: event.target.value }));

  const run = async (action, message) => {
    setSaving(true);
    setError("");
    try { await action(); onSaved(message); } catch (e) { setError(e.message); setSaving(false); }
  };
  const submit = (event) => {
    event.preventDefault();
    run(() => item ? api.editarAlocacao(item.id, values) : api.alocarAtividade(values), item ? "Alocação atualizada." : "Atividade alocada.");
  };
  const chooseOrder = (event) => {
    const chosen = plan.ordens.find((entry) => String(entry.id) === event.target.value);
    setValues((previous) => ({
      ...previous,
      ordem_id: event.target.value,
      equipe_id: previous.equipe_id || (chosen?.equipe_id ? String(chosen.equipe_id) : ""),
      hh_previsto: previous.hh_previsto || (chosen ? String(Math.max(0.5, chosen.hh_previsto - chosen.hh_alocado)) : ""),
    }));
  };

  return (
    <Modal title={item ? `Alocação · OM ${item.numero}` : "Alocar atividade"} subtitle="Ordem, equipe, data e HH previsto." onClose={onClose} className="max-w-lg">
      <form onSubmit={submit} className="space-y-4">
        <label className="block">
          <span className="text-xs font-semibold text-slate-500">Ordem de manutenção</span>
          <select required disabled={Boolean(item)} className={`mt-1 ${inputCls}`} value={values.ordem_id} onChange={chooseOrder}>
            <option value="">Selecione a OM</option>
            {plan.ordens.map((entry) => <option key={entry.id} value={entry.id}>{entry.numero} · {entry.equipamento || "sem equipamento"} · {entry.status}</option>)}
          </select>
          {order && <span className="mt-1 block text-xs text-slate-500">HH previsto da OM: {number(order.hh_previsto)} h · já alocado: {number(order.hh_alocado)} h</span>}
        </label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-semibold text-slate-500">Equipe</span>
            <select required className={`mt-1 ${inputCls}`} value={values.equipe_id} onChange={set("equipe_id")}>
              <option value="">Selecione a equipe</option>
              {plan.equipes.map((team) => <option key={team.id} value={team.id}>{team.nome}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-slate-500">Data</span>
            <input type="date" required className={`mt-1 ${inputCls}`} value={values.data} onChange={set("data")} />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-slate-500">HH previsto</span>
            <input type="number" min="0.5" step="0.5" required className={`mt-1 ${inputCls}`} value={values.hh_previsto} onChange={set("hh_previsto")} />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-slate-500">Observação (opcional)</span>
            <input maxLength={500} className={`mt-1 ${inputCls}`} value={values.observacao} onChange={set("observacao")} />
          </label>
        </div>
        <p className="text-xs text-slate-500">A OM recebe a data da primeira e da última alocação e passa a "Programada" se estiver aberta.</p>
        {error && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
        <div className="flex flex-wrap justify-between gap-2">
          {item ? <Btn type="button" variant="danger" disabled={saving}
            onClick={() => window.confirm(`Remover a alocação da OM ${item.numero} em ${dataBr(item.data)}?`) && run(() => api.removerAlocacao(item.id), "Alocação removida.")}>
            <Trash2 className="h-4 w-4" /> Remover
          </Btn> : <span />}
          <div className="flex gap-2">
            <Btn type="button" variant="ghost" onClick={onClose}>Cancelar</Btn>
            <Btn type="submit" disabled={saving}>{saving ? "Salvando…" : "Salvar"}</Btn>
          </div>
        </div>
      </form>
    </Modal>
  );
}
