import React, { useEffect, useState } from "react";
import { RotateCcw, Save } from "lucide-react";
import { api } from "../api.js";
import { Btn, Card, Spinner, inputCls, ErrorState } from "../components/ui.jsx";
import { useNoticeToast } from "../components/toast.jsx";

const GROUPS = [
  ["meta", "Metas dos indicadores", "Linha de meta dos gráficos e situação \"dentro/fora da meta\" na Visão geral e em Indicadores."],
  ["calculo", "Parâmetros de cálculo", "Referências usadas no cálculo dos KPIs e nos lançamentos de mão de obra."],
];

const number = (value) => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(value);
// O servidor grava data e hora em UTC ("AAAA-MM-DD HH:MM:SS").
const dateTimeBr = (value) => new Date(`${value.replace(" ", "T")}Z`).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

export default function Parametros() {
  const [items, setItems] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const setNotice = useNoticeToast();

  const apply = (list) => {
    setItems(list);
    setDrafts(Object.fromEntries(list.map((item) => [item.chave, String(item.valor)])));
  };
  useEffect(() => { api.parametrosKpi().then(apply).catch((e) => setError(e.message)); }, []);

  if (!items) return error ? <ErrorState message={error} /> : <Spinner />;

  const changed = items.filter((item) => drafts[item.chave] !== String(item.valor));
  const differsFromExample = items.some((item) => Number(drafts[item.chave]) !== item.padrao);

  const save = async (event) => {
    event.preventDefault();
    setSaving(true); setError(""); setNotice("");
    try {
      const result = await api.salvarParametrosKpi(Object.fromEntries(changed.map((item) => [item.chave, drafts[item.chave]])));
      apply(result.parametros);
      setNotice(`${result.alterados} valor(es) atualizado(s). Os indicadores já usam os novos valores e a alteração foi registrada na auditoria.`);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save} className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-slate-500">
          Valores de referência dos KPIs. Os atuais são exemplos: ajuste conforme as metas da operação. As alterações valem para todo o histórico exibido.
        </p>
        <div className="flex flex-wrap gap-2">
          <Btn variant="ghost" disabled={!differsFromExample || saving}
            onClick={() => setDrafts(Object.fromEntries(items.map((item) => [item.chave, String(item.padrao)])))}>
            <RotateCcw className="h-4 w-4" /> Usar valores de exemplo
          </Btn>
          <Btn type="submit" disabled={!changed.length || saving}><Save className="h-4 w-4" /> {saving ? "Salvando…" : `Salvar${changed.length ? ` (${changed.length})` : ""}`}</Btn>
        </div>
      </div>

      {error && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

      {GROUPS.map(([grupo, titulo, descricao]) => (
        <Card key={grupo}>
          <div className="border-b border-slate-100 px-5 py-3">
            <h2 className="font-semibold text-slate-800">{titulo}</h2>
            <p className="mt-0.5 text-xs text-slate-500">{descricao}</p>
          </div>
          <div className="divide-y divide-slate-50">
            {items.filter((item) => item.grupo === grupo).map((item) => {
              const dirty = drafts[item.chave] !== String(item.valor);
              return (
                <div key={item.chave} className="grid grid-cols-1 items-center gap-3 px-5 py-4 md:grid-cols-[minmax(0,1fr)_16rem]">
                  <div>
                    <label htmlFor={`parametro-${item.chave}`} className="font-semibold text-slate-800">
                      {item.label}
                      {item.direcao && <span className="ml-2 text-xs font-normal text-slate-500">{item.direcao === "lower" ? "quanto menor, melhor" : "quanto maior, melhor"}</span>}
                    </label>
                    <p className="mt-0.5 text-sm text-slate-500">{item.descricao}</p>
                    <p className="mt-1 text-xs text-slate-400">
                      Exemplo: {number(item.padrao)} {item.unidade}
                      {item.atualizado_por ? ` · alterado por ${item.atualizado_por} em ${dateTimeBr(item.atualizado_em)}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {item.direcao && <span className="w-4 text-right text-sm font-semibold text-slate-500" aria-hidden="true">{item.direcao === "lower" ? "≤" : "≥"}</span>}
                    <input id={`parametro-${item.chave}`} type="number" required min={item.min} max={item.max} step={item.passo}
                      className={`${inputCls} text-right tabular-nums ${dirty ? "border-indigo-400 bg-indigo-50" : ""}`}
                      value={drafts[item.chave] ?? ""} onChange={(event) => setDrafts((previous) => ({ ...previous, [item.chave]: event.target.value }))} />
                    <span className="w-20 shrink-0 text-sm text-slate-500">{item.unidade}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      ))}
    </form>
  );
}
