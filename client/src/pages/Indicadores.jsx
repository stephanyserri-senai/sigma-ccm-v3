import React, { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, Loader2, Minus, FileText } from "lucide-react";
import {
  Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { useNavigate } from "react-router-dom";
import { api, salvarArquivo } from "../api.js";
import { useAuth } from "../auth.jsx";
import { Btn, Card, Eyebrow, Modal, Spinner, ErrorState } from "../components/ui.jsx";
import { useNoticeToast } from "../components/toast.jsx";

const PERIODS = [["30d", "30 dias"], ["90d", "90 dias"], ["6m", "6 meses"], ["12m", "12 meses"]];
const SERIES_COLOR = "#4f46e5";
const TARGET_COLOR = "#64748b";
const MAX_BARS = 12;
const chartTooltip = { border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 12 };
const selectCls = "mt-1 min-w-36 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-indigo-500 focus:outline-none";

const number = (value, digits = 1) => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: digits }).format(value);
const withUnit = (value, unit, digits = 1) => value == null ? "—" : `${number(value, digits)}${unit === "%" ? "%" : unit ? ` ${unit}` : ""}`;
const dateBr = (iso) => iso.split("-").reverse().join("/");
const digitsOf = (metric) => metric.unit === "OMs" ? 0 : 1;
const onTarget = (metric, value) => metric.direction === "lower" ? value <= metric.target : value >= metric.target;
const targetText = (metric) => `${metric.direction === "lower" ? "≤" : "≥"} ${withUnit(metric.target, metric.unit, digitsOf(metric))}`;

// Topo do eixo: cobre os dados e a meta; percentuais ficam em 0–100 quando cabem.
function axisMax(metric, values) {
  const top = Math.max(metric.target, ...values.filter((value) => value != null));
  if (metric.unit === "%" && top <= 100) return 100;
  const step = 10 ** Math.floor(Math.log10(top || 1));
  return Math.ceil((top * 1.1) / step) * step;
}

function Empty({ children }) {
  return <div className="grid h-full place-items-center px-4 text-center text-sm text-slate-400">{children}</div>;
}

function Headline({ metric, kpi }) {
  const hasValue = kpi.value != null;
  const ok = hasValue && onTarget(metric, kpi.value);
  const Icon = !hasValue ? Minus : ok ? CheckCircle2 : AlertTriangle;
  const improved = kpi.delta != null && kpi.delta !== 0 && (metric.direction === "lower" ? kpi.delta < 0 : kpi.delta > 0);
  return (
    <Card title={kpi.description} className="min-w-0 p-4">
      <Eyebrow>{metric.label}</Eyebrow>
      <div className="mt-2 flex items-baseline gap-1.5">
        <span className="text-3xl font-bold tabular-nums text-slate-900">{hasValue ? number(kpi.value, digitsOf(metric)) : "—"}</span>
        <span className="text-xs font-semibold text-slate-500">{metric.unit}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
        <span className="inline-flex items-center gap-1 font-semibold">
          <Icon className={`h-3.5 w-3.5 ${!hasValue ? "text-slate-400" : ok ? "text-emerald-600" : "text-rose-600"}`} />
          {!hasValue ? "Sem dados no período" : ok ? "Dentro da meta" : "Fora da meta"}
        </span>
        <span>Meta {targetText(metric)}</span>
      </div>
      <div className="mt-1 text-[11px] text-slate-400">
        {kpi.delta == null ? "Sem base comparável no período anterior"
          : kpi.delta === 0 ? "Igual ao período anterior"
          : `${kpi.delta > 0 ? "+" : "−"}${withUnit(Math.abs(kpi.delta), metric.unit === "%" ? "p.p." : metric.unit, digitsOf(metric)).replace("p.p.%", " p.p.")} vs. período anterior (${improved ? "melhorou" : "piorou"})`}
      </div>
    </Card>
  );
}

function EvolutionChart({ metric, series, bucket }) {
  const values = series.map((point) => point[metric.key]);
  const hasData = values.some((value) => value != null);
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <Eyebrow>Evolução {bucket === "week" ? "semanal" : "mensal"}</Eyebrow>
          <h3 className="mt-1 text-sm font-semibold text-slate-800">{metric.label}{metric.unit ? ` (${metric.unit})` : ""}</h3>
        </div>
        <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-500">
          <svg width="18" height="4" aria-hidden="true"><line x1="0" y1="2" x2="18" y2="2" stroke={TARGET_COLOR} strokeWidth="1.5" strokeDasharray="4 3" /></svg>
          Meta {targetText(metric)}
        </span>
      </div>
      <div className="mt-3 h-64">
        {hasData ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series} margin={{ top: 12, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
              <YAxis domain={[0, axisMax(metric, values)]} allowDecimals={metric.unit !== "OMs"} tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} width={44}
                tickFormatter={(value) => metric.unit === "%" ? `${number(value, 0)}%` : number(value, 0)} />
              <Tooltip contentStyle={chartTooltip} cursor={{ stroke: "#cbd5e1" }}
                labelFormatter={(label, payload) => payload?.[0] ? `${dateBr(payload[0].payload.from)} a ${dateBr(payload[0].payload.to)}` : label}
                formatter={(value) => [withUnit(value, metric.unit, digitsOf(metric)), metric.label]} />
              <ReferenceLine y={metric.target} stroke={TARGET_COLOR} strokeWidth={1.5} strokeDasharray="4 3" />
              <Line type="linear" dataKey={metric.key} name={metric.label} stroke={SERIES_COLOR} strokeWidth={2}
                dot={{ r: 4, fill: SERIES_COLOR, stroke: "#fff", strokeWidth: 2 }} activeDot={{ r: 5 }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        ) : <Empty>Sem dados de {metric.label} para esta seleção.</Empty>}
      </div>
    </Card>
  );
}

function BreakdownChart({ metric, rows, dimension }) {
  const data = rows.filter((row) => row[metric.key] != null)
    .sort((left, right) => right[metric.key] - left[metric.key]).slice(0, MAX_BARS);
  // A meta de contagem (OMs) vale para o total, não para cada item do detalhamento.
  const showTarget = metric.unit !== "OMs";
  const values = data.map((row) => row[metric.key]);
  const max = showTarget ? axisMax(metric, values) : Math.max(1, ...values);
  const hidden = rows.filter((row) => row[metric.key] != null).length - data.length;
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-slate-800">{metric.label} por {dimension.label.toLowerCase()}{metric.unit ? ` (${metric.unit})` : ""}</h4>
        {showTarget && <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-500">
          <svg width="4" height="14" aria-hidden="true"><line x1="2" y1="0" x2="2" y2="14" stroke={TARGET_COLOR} strokeWidth="1.5" strokeDasharray="4 3" /></svg>
          Meta {targetText(metric)}
        </span>}
      </div>
      <div className="mt-2" style={{ height: data.length ? Math.max(120, data.length * 30 + 36) : 120 }}>
        {data.length ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 4 }} barCategoryGap={8}>
              <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" domain={[0, max]} allowDecimals={metric.unit !== "OMs"} tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false}
                tickFormatter={(value) => metric.unit === "%" ? `${number(value, 0)}%` : number(value, 0)} />
              <YAxis type="category" dataKey="label" width={132} tick={{ fontSize: 11, fill: "#475569" }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={chartTooltip} cursor={{ fill: "#f1f5f9" }} formatter={(value) => [withUnit(value, metric.unit, digitsOf(metric)), metric.label]} />
              {showTarget && <ReferenceLine x={metric.target} stroke={TARGET_COLOR} strokeWidth={1.5} strokeDasharray="4 3" />}
              <Bar dataKey={metric.key} name={metric.label} fill={SERIES_COLOR} radius={[0, 4, 4, 0]} barSize={14} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        ) : <Empty>Sem {metric.label} por {dimension.label.toLowerCase()} nesta seleção.</Empty>}
      </div>
      {hidden > 0 && <p className="text-[11px] text-slate-400">Gráfico com os {MAX_BARS} maiores valores; a tabela lista todos.</p>}
    </div>
  );
}

export default function Indicadores() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [filters, setFilters] = useState({ period: "6m", area: "all", equipe: "all" });
  const [tabId, setTabId] = useState("disponibilidade");
  const [dimensionId, setDimensionId] = useState("equipe");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const setNotice = useNoticeToast();
  const [pdfOpen, setPdfOpen] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    api.indicadores(filters)
      .then((result) => { if (active) setData(result); })
      .catch((e) => { if (active) setError(e.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [filters]);

  if (!data) return error ? <ErrorState message={error} /> : <Spinner />;

  const tab = data.tabs.find((item) => item.id === tabId) || data.tabs[0];
  const dimension = data.dimensions.find((item) => item.id === dimensionId) || data.dimensions[0];
  const rows = data.breakdown[dimension.id];
  const setFilter = (key) => (event) => setFilters((previous) => ({ ...previous, [key]: event.target.value }));

  const exportCsv = async () => {
    setExporting(true); setError(""); setNotice("");
    try {
      const file = await api.exportarIndicadores({ ...filters, kpi: tab.id });
      salvarArquivo(file);
      setNotice(`Exportado: ${file.name}. A exportação foi registrada na trilha de auditoria.`);
    } catch (e) {
      setError(e.message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Período</span>
            <select value={filters.period} onChange={setFilter("period")} className={selectCls}>
              {PERIODS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Área</span>
            <select value={filters.area} onChange={setFilter("area")} className={selectCls}>
              <option value="all">Todas as áreas</option>
              {data.filters.areas.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Equipe</span>
            <select value={filters.equipe} onChange={setFilter("equipe")} className={selectCls}>
              <option value="all">Todas as equipes</option>
              {data.filters.equipes.map((option) => <option key={option.id} value={option.id}>{option.nome}</option>)}
            </select>
          </label>
          {loading && <Loader2 className="mb-2.5 h-4 w-4 animate-spin text-slate-400" aria-label="Atualizando" />}
        </div>
        <div className="flex flex-wrap gap-2">
          {user.papel === "CCM" && <Btn variant="ghost" onClick={() => navigate("/metas")}>Ajustar metas</Btn>}
          <Btn onClick={() => setPdfOpen(true)}><FileText className="h-4 w-4" /> Relatórios em PDF</Btn>
          <Btn variant="ghost" onClick={exportCsv} disabled={exporting}><Download className="h-4 w-4" /> {exporting ? "Exportando…" : `Exportar CSV · ${tab.label}`}</Btn>
        </div>
      </header>

      <div className="flex gap-1 overflow-x-auto border-b border-slate-200" role="tablist" aria-label="Indicadores">
        {data.tabs.map((item) => (
          <button key={item.id} type="button" role="tab" aria-selected={tab.id === item.id} onClick={() => { setTabId(item.id); setNotice(""); }}
            className={`shrink-0 border-b-2 px-3 py-2.5 text-sm font-semibold transition-colors ${tab.id === item.id ? "border-indigo-600 text-indigo-700" : "border-transparent text-slate-500 hover:text-slate-800"}`}>
            {item.label}
          </button>
        ))}
      </div>

      {error && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

      <p className="text-sm text-slate-500">
        {tab.description} <span className="text-slate-400">Base {dateBr(data.period.from)} a {dateBr(data.period.to)} · {data.scope.area} · {data.scope.equipe}.</span>
      </p>

      <section aria-label="Resultado no período" className={`grid grid-cols-1 gap-4 ${tab.metrics.length > 1 ? "sm:grid-cols-2" : "sm:max-w-sm"}`}>
        {tab.metrics.map((metric) => <Headline key={metric.key} metric={metric} kpi={data.kpis[metric.key]} />)}
      </section>

      <section aria-label="Evolução no tempo" className={`grid grid-cols-1 gap-4 ${tab.metrics.length > 1 ? "xl:grid-cols-2" : ""}`}>
        {tab.metrics.map((metric) => <EvolutionChart key={metric.key} metric={metric} series={data.series} bucket={data.period.bucket} />)}
      </section>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
          <div><Eyebrow>Detalhamento</Eyebrow><h3 className="mt-0.5 font-semibold text-slate-800">{tab.label} por {dimension.label.toLowerCase()}</h3></div>
          <div className="inline-flex rounded-lg border border-slate-200 p-0.5" role="group" aria-label="Detalhar por">
            {data.dimensions.map((item) => (
              <button key={item.id} type="button" aria-pressed={dimension.id === item.id} onClick={() => setDimensionId(item.id)}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${dimension.id === item.id ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-50"}`}>
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {tab.notes?.[dimension.id]
          ? <p className="border-b border-slate-100 px-5 py-3 text-sm text-slate-500">{tab.notes[dimension.id]}</p>
          : <div className={`grid grid-cols-1 gap-6 border-b border-slate-100 p-5 ${tab.metrics.length > 1 ? "xl:grid-cols-2" : ""}`}>
            {tab.metrics.map((metric) => <BreakdownChart key={metric.key} metric={metric} rows={rows} dimension={dimension} />)}
          </div>}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-xs uppercase tracking-wide text-slate-400">
                <th className="px-5 py-3 text-left font-semibold">{dimension.label}</th>
                {tab.columns.map((item) => <th key={item.key} className="px-5 py-3 text-right font-semibold">{item.label}{item.unit ? ` (${item.unit})` : ""}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className="border-b border-slate-50 last:border-0">
                  <td className="px-5 py-3">
                    <div className={`font-semibold text-slate-800 ${dimension.id === "equipamento" ? "font-mono text-xs" : ""}`}>{row.label}</div>
                    {row.detail && <div className="max-w-64 truncate text-xs text-slate-500">{row.detail}</div>}
                  </td>
                  {tab.columns.map((item) => (
                    <td key={item.key} className="px-5 py-3 text-right tabular-nums text-slate-600">{row[item.key] == null ? "—" : number(row[item.key], item.digits)}</td>
                  ))}
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={tab.columns.length + 1} className="px-5 py-12 text-center text-sm text-slate-400">Sem registros para esta seleção.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      {pdfOpen && <RelatorioPdf tab={tab} filters={filters} data={data} onClose={() => setPdfOpen(false)}
        onDone={(name) => { setPdfOpen(false); setNotice(`Relatório gerado: ${name}. A geração foi registrada na trilha de auditoria.`); }} />}
    </div>
  );
}

// Escolha do relatório em PDF: parcial (aba atual), ordens, IAMOT por equipe ou geral.
function RelatorioPdf({ tab, filters, data, onClose, onDone }) {
  const options = [
    { id: tab.id, label: `Somente esta aba: ${tab.label}`, description: "Resultado, evolução no tempo e detalhamento por equipe, área e equipamento deste indicador." },
    { id: "ordens", label: "Ordens por período e equipe", description: "Resumo por status e por equipe e a lista completa das OMs do período, com programação e HH previsto × apropriado." },
    { id: "iamot", label: "IAMOT por equipe", description: "HH disponível, ocorrências, HH líquido e apropriado por equipe, com o detalhe semana a semana." },
    { id: "geral", label: "Relatório geral (todas as informações)", description: "Todos os indicadores com evolução e detalhamentos, IAMOT por equipe e a lista completa de ordens." },
  ].filter((option, index, list) => list.findIndex((item) => item.id === option.id) === index);
  const [tipo, setTipo] = useState("geral");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const periodLabel = PERIODS.find(([value]) => value === filters.period)?.[1] || filters.period;
  const areaLabel = filters.area === "all" ? "Todas as áreas" : filters.area;
  const equipeLabel = filters.equipe === "all" ? "Todas as equipes" : data.filters.equipes.find((item) => String(item.id) === String(filters.equipe))?.nome || "—";

  const gerar = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const file = await api.relatorioPdf({ ...filters, tipo });
      salvarArquivo(file);
      onDone(file.name);
    } catch (e) {
      setError(e.message);
      setSaving(false);
    }
  };

  return (
    <Modal title="Relatórios em PDF" subtitle={`Filtros atuais: ${periodLabel} · ${areaLabel} · ${equipeLabel}`} onClose={onClose} className="max-w-xl">
      <form onSubmit={gerar} className="space-y-4">
        <fieldset className="space-y-2">
          <legend className="text-xs font-semibold text-slate-500">Qual relatório?</legend>
          {options.map((option) => (
            <label key={option.id} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors ${tipo === option.id ? "border-indigo-400 bg-indigo-50" : "border-slate-200 hover:bg-slate-50"}`}>
              <input type="radio" name="tipo-relatorio" value={option.id} checked={tipo === option.id} onChange={() => setTipo(option.id)} className="mt-1" />
              <span>
                <span className="block text-sm font-semibold text-slate-800">{option.label}</span>
                <span className="block text-xs text-slate-500">{option.description}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <p className="text-xs text-slate-500">O documento sai com a identidade VLI no cabeçalho, filtros, data e autor da geração e numeração de páginas. Cada geração fica registrada na auditoria.</p>
        {error && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
        <div className="flex flex-wrap justify-end gap-2">
          <Btn type="button" variant="ghost" onClick={onClose}>Cancelar</Btn>
          <Btn type="submit" disabled={saving}>{saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Gerando PDF…</> : <><Download className="h-4 w-4" /> Gerar PDF</>}</Btn>
        </div>
      </form>
    </Modal>
  );
}
