import React, { useEffect, useState } from "react";
import { Activity, AlertTriangle, ArrowDownRight, ArrowRight, ArrowUpRight, Gauge, Layers3 } from "lucide-react";
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { api } from "../api.js";
import { Badge, Card, Eyebrow, Spinner, statusTone, ErrorState } from "../components/ui.jsx";
import ThemeIcon from "../components/ThemeIcon.jsx";
import FluxoPcm from "../components/FluxoPcm.jsx";

const PERIODS = [
  ["30d", "30 dias"], ["90d", "90 dias"], ["6m", "6 meses"], ["12m", "12 meses"],
];
const STATUS_COLORS = {
  Aberta: "#d97706", Programada: "#4f46e5", Distribuída: "#0891b2",
  "Em execução": "#0f766e", Encerrada: "#16a34a", Cancelada: "#94a3b8",
};
const CRITICALITY_COLORS = { Alta: "#dc2626", Média: "#d97706", Baixa: "#0284c7", "Sem criticidade": "#94a3b8" };
const chartTooltip = {
  border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 12,
};

function number(value, digits = 1) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: digits }).format(value);
}

function Kpi({ metric, icon, label, secondary }) {
  const hasValue = metric.value != null;
  const value = hasValue ? number(metric.value, metric.unit === "OMs" ? 0 : 1) : "—";
  const hasTrend = metric.delta != null;
  const positiveChange = metric.delta > 0;
  const improved = metric.direction === "lower" ? !positiveChange : positiveChange;
  const TrendIcon = !hasTrend || metric.delta === 0 ? ArrowRight : positiveChange ? ArrowUpRight : ArrowDownRight;
  const trendColor = !hasTrend || metric.delta === 0 ? "text-slate-400" : improved ? "text-emerald-700" : "text-rose-700";
  const noDataText = {
    Disponibilidade: "horas de parada ausentes",
    MTBF: "horas de parada incompletas",
    MTTR: "horas de reparo ausentes",
    IAMOT: "HH disponível não lançado",
  }[label];
  const trendText = !hasValue && noDataText
    ? noDataText
    : !hasTrend
    ? "sem base comparável"
    : metric.percent == null
      ? `${metric.delta > 0 ? "+" : ""}${number(metric.delta, 1)} ${metric.unit} vs. anterior`
      : `${metric.percent > 0 ? "+" : ""}${number(metric.percent, 1)}% vs. anterior`;

  return (
    <Card title={metric.description} className="min-w-0 p-4">
      <div className="flex items-center justify-between gap-2">
        <Eyebrow>{label}</Eyebrow>
        <ThemeIcon name={icon} className="h-5 w-5" />
      </div>
      <div className="mt-3 flex items-baseline gap-1.5">
        <span className="truncate text-2xl font-bold tabular-nums text-slate-900">{value}</span>
        <span className="shrink-0 text-xs font-semibold text-slate-500">{metric.unit}</span>
      </div>
      <div className={`mt-2 flex items-center gap-1 text-xs font-semibold ${trendColor}`}>
        <TrendIcon className="h-3.5 w-3.5" /> <span>{trendText}</span>
      </div>
      {secondary && <div className="mt-1 text-[11px] text-slate-400">{secondary}</div>}
    </Card>
  );
}

function EmptyChart({ children }) {
  return <div className="grid h-full place-items-center text-sm text-slate-400">{children}</div>;
}

export default function Dashboard() {
  const [period, setPeriod] = useState("6m");
  const [area, setArea] = useState("all");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    api.dashboard({ period, area })
      .then((result) => { if (active) setData(result); })
      .catch((e) => { if (active) setError(e.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [period, area]);

  if (loading && !data) return <Spinner />;
  if (error && !data) return <ErrorState message={error} />;
  if (!data) return <Spinner />;

  const periodLabel = PERIODS.find(([value]) => value === period)?.[1] || period;
  const allStatusCount = data.ordersByStatus.reduce((sum, item) => sum + item.total, 0);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <div className="flex items-center gap-2"><Activity className="h-5 w-5 text-indigo-600" /><Eyebrow>Indicadores de manutenção</Eyebrow></div>
          <p className="mt-1 text-sm text-slate-500">Base {data.period.from.slice(0, 10)} a {data.period.to.slice(0, 10)} · atualizada com dados do banco</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Período</span>
            <select value={period} onChange={(event) => setPeriod(event.target.value)} className="mt-1 min-w-32 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-indigo-500 focus:outline-none">
              {PERIODS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Área</span>
            <select value={area} onChange={(event) => setArea(event.target.value)} className="mt-1 min-w-40 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-indigo-500 focus:outline-none">
              <option value="all">Todas as áreas</option>
              {data.filters.areas.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
        </div>
      </header>

      <FluxoPcm />

      {error && <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">Não foi possível atualizar os filtros: {error}</div>}

      <section aria-label="Indicadores-chave" className="grid grid-cols-2 gap-3 sm:grid-cols-3 2xl:grid-cols-6">
        <Kpi label="Disponibilidade" icon="shield-check" metric={data.kpis.availability} />
        <Kpi label="MTBF" icon="gears" metric={data.kpis.mtbf} />
        <Kpi label="MTTR" icon="wrench" metric={data.kpis.mttr} />
        <Kpi label="IAMOT" icon="chart" metric={data.kpis.iamot}
          secondary={data.labor?.liquido != null ? `${number(data.labor.apropriado)} h apropriadas ÷ ${number(data.labor.liquido)} h líquidas` : "Lance o HH em Mão de obra"} />
        <Kpi label="Aderência" icon="calendar" metric={data.kpis.adherence} />
        <Kpi label="Backlog" icon="checklist" metric={data.kpis.backlog} secondary={`${data.backlog.totalOpen} OM(s) abertas no total`} />
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <Card className="p-4 xl:col-span-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <Eyebrow>Tendência · 6 meses</Eyebrow>
              <h2 className="mt-1 text-sm font-semibold text-slate-800">Disponibilidade e aderência</h2>
            </div>
            <div className="flex flex-wrap gap-2 text-[11px] text-slate-500">
              <span>Meta disponibilidade {data.targets.availability}%</span>
              <span>Meta aderência {data.targets.adherence}%</span>
            </div>
          </div>
          <div className="mt-3 h-64">
            {data.trend.some((point) => point.availability != null || point.adherence != null) ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.trend} margin={{ top: 12, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
                  <YAxis domain={[0, 100]} tickFormatter={(value) => `${value}%`} tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} width={42} />
                  <Tooltip contentStyle={chartTooltip} formatter={(value) => value == null ? ["Sem dados", ""] : [`${number(value)}%`]} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <ReferenceLine y={data.targets.availability} stroke="#0f766e" strokeDasharray="4 4" />
                  <ReferenceLine y={data.targets.adherence} stroke="#d97706" strokeDasharray="4 4" />
                  <Line type="monotone" dataKey="availability" name="Disponibilidade" stroke="#0f766e" strokeWidth={2.5} dot={{ r: 3 }} connectNulls />
                  <Line type="monotone" dataKey="adherence" name="Aderência" stroke="#4f46e5" strokeWidth={2.5} dot={{ r: 3 }} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            ) : <EmptyChart>Sem histórico de disponibilidade ou aderência para esta seleção.</EmptyChart>}
          </div>
          <p className="mt-1 text-[11px] text-slate-400">Disponibilidade estimada com a exposição diária por equipamento definida em Metas dos KPIs; MTBF exige parada registrada em cada OM corretiva.</p>
        </Card>

        <Card className="p-4 xl:col-span-2">
          <div className="flex items-start justify-between gap-2">
            <div><Eyebrow>Ordens · {periodLabel}</Eyebrow><h2 className="mt-1 text-sm font-semibold text-slate-800">Distribuição por status</h2></div>
            <Badge tone="indigo">{allStatusCount} OMs</Badge>
          </div>
          <div className="mt-2 grid h-64 grid-cols-1 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_120px]">
            {data.ordersByStatus.length ? <>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={data.ordersByStatus} dataKey="total" nameKey="status" innerRadius={54} outerRadius={84} paddingAngle={2} stroke="none">
                    {data.ordersByStatus.map((entry) => <Cell key={entry.status} fill={STATUS_COLORS[entry.status] || "#94a3b8"} />)}
                  </Pie>
                  <Tooltip contentStyle={chartTooltip} formatter={(value, name) => [value, name]} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap content-center gap-x-3 gap-y-2 py-3 text-xs sm:flex-col sm:gap-2">
                {data.ordersByStatus.map((entry) => <div key={entry.status} className="flex items-center gap-2 text-slate-600"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: STATUS_COLORS[entry.status] || "#94a3b8" }} />{entry.status}<span className="ml-auto font-semibold tabular-nums">{entry.total}</span></div>)}
              </div>
            </> : <div className="col-span-full grid place-items-center text-sm text-slate-400">Sem ordens no período selecionado.</div>}
          </div>
        </Card>
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card className="p-4">
          <div className="flex items-center justify-between gap-2">
            <div><Eyebrow>Concentração de OMs</Eyebrow><h2 className="mt-1 text-sm font-semibold text-slate-800">Criticidade por área</h2></div>
            <Layers3 className="h-5 w-5 text-slate-400" />
          </div>
          <div className="mt-3 h-72">
            {data.ordersByCriticality.length ? <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.ordersByCriticality} layout="vertical" margin={{ top: 4, right: 20, left: 8, bottom: 4 }}>
                <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="label" width={150} tick={{ fontSize: 10, fill: "#64748b" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={chartTooltip} formatter={(value) => [value, "Ordens"]} />
                <Bar dataKey="total" name="Ordens" radius={[0, 4, 4, 0]}>
                  {data.ordersByCriticality.map((entry) => <Cell key={entry.label} fill={CRITICALITY_COLORS[entry.criticidade] || "#64748b"} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer> : <EmptyChart>Sem ordens classificadas nesta área/período.</EmptyChart>}
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between gap-2">
            <div><Eyebrow>Confiabilidade · {periodLabel}</Eyebrow><h2 className="mt-1 text-sm font-semibold text-slate-800">Top equipamentos por falhas / menor MTBF</h2></div>
            <Gauge className="h-5 w-5 text-slate-400" />
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead><tr className="border-y border-slate-100 bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-400"><th className="px-3 py-2">Equipamento</th><th className="px-3 py-2">Área</th><th className="px-3 py-2 text-right">Falhas</th><th className="px-3 py-2 text-right">MTBF (h)</th></tr></thead>
              <tbody>
                {data.topEquipment.map((item) => <tr key={item.id} className="border-b border-slate-50 last:border-0"><td className="px-3 py-2.5"><div className="font-mono text-xs font-semibold text-slate-800">{item.tag}</div><div className="max-w-44 truncate text-xs text-slate-500">{item.descricao}</div></td><td className="px-3 py-2.5 text-xs text-slate-600">{item.area || "—"}</td><td className="px-3 py-2.5 text-right font-semibold tabular-nums text-rose-700">{item.falhas}</td><td className="px-3 py-2.5 text-right font-mono tabular-nums text-slate-700">{item.mtbf == null ? "—" : number(item.mtbf)}</td></tr>)}
                {!data.topEquipment.length && <tr><td colSpan={4} className="px-3 py-8 text-center text-sm text-slate-400">Sem falhas corretivas no período.</td></tr>}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-slate-400">MTBF por equipamento só aparece quando todas as falhas da janela têm horas de parada registradas.</p>
        </Card>
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <Card className="p-4 xl:col-span-3">
          <div className="flex items-center justify-between gap-2">
            <div><Eyebrow>Estoque aberto · área {area === "all" ? "total" : area}</Eyebrow><h2 className="mt-1 text-sm font-semibold text-slate-800">Backlog atual</h2></div>
            <Badge tone="amber">{data.backlog.totalOpen} abertas</Badge>
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[620px] text-sm">
              <thead><tr className="border-y border-slate-100 bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-400"><th className="px-3 py-2">OM</th><th className="px-3 py-2">Equipamento</th><th className="px-3 py-2">Área / equipe</th><th className="px-3 py-2">Executante</th><th className="px-3 py-2">Status</th></tr></thead>
              <tbody>{data.backlog.orders.map((order) => <tr key={order.id} className="border-b border-slate-50 last:border-0"><td className="px-3 py-2.5 font-mono font-semibold text-slate-700">{order.numero}</td><td className="px-3 py-2.5 font-mono text-xs text-slate-600">{order.equipamento || "—"}</td><td className="px-3 py-2.5 text-xs text-slate-600">{order.area || "—"} · {order.equipe || "sem equipe"}</td><td className="px-3 py-2.5 text-xs text-slate-600">{order.executante || "Não distribuída"}</td><td className="px-3 py-2.5"><Badge tone={statusTone(order.status)}>{order.status}</Badge></td></tr>)}
                {!data.backlog.orders.length && <tr><td colSpan={5} className="px-3 py-8 text-center text-sm text-slate-400">Nenhuma ordem em aberto nesta área.</td></tr>}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-slate-400">O KPI compara OMs da janela selecionada que continuam abertas; esta lista mostra todo o estoque atual.</p>
        </Card>

        <Card className="p-4 xl:col-span-2">
          <div className="flex items-center justify-between gap-2">
            <div><Eyebrow>Qualidade de dados · {periodLabel}</Eyebrow><h2 className="mt-1 text-sm font-semibold text-slate-800">Alertas recentes</h2></div>
            <AlertTriangle className="h-5 w-5 text-amber-600" />
          </div>
          <div className="mt-3 divide-y divide-slate-100">
            {data.alerts.map((alert) => <div key={alert.id} className="flex items-start justify-between gap-3 py-3 first:pt-0">
              <div className="min-w-0"><div className="truncate text-sm font-semibold text-slate-700">{alert.tipo || "Inconsistência"}</div><div className="mt-0.5 text-xs text-slate-500">OM {alert.ordem_numero || "—"} · {alert.equipamento || "sem equipamento"}</div><div className="text-[11px] text-slate-400">{alert.area || "Sem área"} · {alert.criado_em}</div></div>
              <div className="shrink-0 text-right"><Badge tone={statusTone(alert.status)}>{alert.status}</Badge><div className="mt-1 text-xs tabular-nums text-slate-400">score {alert.score == null ? "—" : number(alert.score, 2)}</div></div>
            </div>)}
            {!data.alerts.length && <div className="py-8 text-center text-sm text-slate-400">Nenhum alerta recente nesta seleção.</div>}
          </div>
        </Card>
      </section>
    </div>
  );
}
