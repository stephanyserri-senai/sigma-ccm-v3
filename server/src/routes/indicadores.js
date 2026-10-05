import { Router } from "express";
import { addDays, isoDate, summarizeLabor, todayLocal, weekStart } from "../iamot.js";
import { DAY_MS, PERIOD_DAYS, dateSql, metric, orderIndicators } from "../indicadores.js";
import { getTargets } from "../parametros.js";

// Granularidade da evolução por período: [tipo de intervalo, quantidade].
const BUCKETS = { "30d": ["week", 5], "90d": ["week", 13], "6m": ["month", 6], "12m": ["month", 12] };
const DIMENSIONS = [["equipe", "Equipe"], ["area", "Área"], ["equipamento", "Equipamento"]];

const column = (key, label, unit = "", digits = 1) => ({ key, label, unit, digits });
// As metas vêm dos parâmetros dos KPIs (editáveis pelo CCM).
const buildTabs = (TARGETS) => [
  {
    id: "disponibilidade", label: "Disponibilidade",
    description: "Estimativa com a exposição diária por equipamento definida em Metas dos KPIs, descontadas as horas de parada informadas nos relatórios das OMs.",
    metrics: [{ key: "availability", label: "Disponibilidade", unit: "%", target: TARGETS.availability, direction: "higher" }],
    columns: [column("availability", "Disponibilidade", "%"), column("downtime_hours", "Horas de parada", "h"), column("equipamentos", "Equipamentos", "", 0), column("orders", "OMs", "", 0)],
  },
  {
    id: "confiabilidade", label: "Confiabilidade",
    description: "MTBF: horas de frota por falha (exige parada informada em todas as OMs corretivas). MTTR: média das horas de reparo das OMs corretivas.",
    metrics: [
      { key: "mtbf", label: "MTBF", unit: "h", target: TARGETS.mtbf, direction: "higher" },
      { key: "mttr", label: "MTTR", unit: "h", target: TARGETS.mttr, direction: "lower" },
    ],
    columns: [column("mtbf", "MTBF", "h"), column("mttr", "MTTR", "h"), column("failures", "Falhas (OMs corretivas)", "", 0), column("repair_hours", "Horas de reparo", "h"), column("downtime_hours", "Horas de parada", "h")],
  },
  {
    id: "iamot", label: "IAMOT",
    description: "HH apropriado ÷ HH disponível das equipes, descontadas as ocorrências. Considera só as semanas com HH disponível lançado.",
    metrics: [{ key: "iamot", label: "IAMOT", unit: "%", target: TARGETS.iamot, direction: "higher" }],
    columns: [column("iamot", "IAMOT", "%"), column("hh_apropriado", "HH apropriado", "h", 2), column("hh_disponivel", "HH disponível", "h"), column("hh_ocorrencias", "Ocorrências", "h"), column("hh_liquido", "HH líquido", "h")],
    notes: {
      area: "O HH disponível é lançado por equipe, então não há IAMOT por área: a tabela mostra o HH apropriado nas OMs de cada área.",
      equipamento: "O HH disponível é lançado por equipe, então não há IAMOT por equipamento: a tabela mostra o HH apropriado nas OMs de cada equipamento.",
    },
  },
  {
    id: "aderencia", label: "Aderência",
    description: "OMs programadas que foram distribuídas, estão em execução ou foram encerradas.",
    metrics: [{ key: "adherence", label: "Aderência", unit: "%", target: TARGETS.adherence, direction: "higher" }],
    columns: [column("adherence", "Aderência", "%"), column("adherent", "OMs aderentes", "", 0), column("scheduled", "OMs programadas", "", 0)],
  },
  {
    id: "backlog", label: "Backlog",
    description: "OMs criadas no intervalo e ainda abertas (Aberta, Programada, Distribuída ou Em execução).",
    metrics: [{ key: "backlog", label: "Backlog", unit: "OMs", target: TARGETS.backlog, direction: "lower" }],
    columns: [column("backlog", "Backlog", "OMs", 0), column("orders", "OMs criadas", "", 0), column("closed", "OMs encerradas", "", 0)],
  },
];

const mondayOnOrAfter = (iso) => {
  const monday = weekStart(iso);
  return monday === iso ? iso : addDays(monday, 7);
};
const laborFields = (labor) => ({
  iamot: labor.iamot,
  hh_apropriado: labor.apropriado,
  hh_disponivel: labor.lancamentos ? labor.disponivel : null,
  hh_ocorrencias: labor.lancamentos ? labor.ocorrencias : null,
  hh_liquido: labor.liquido,
});

function buckets(period) {
  const [kind, count] = BUCKETS[period];
  const list = [];
  if (kind === "month") {
    const now = new Date();
    for (let offset = count - 1; offset >= 0; offset -= 1) {
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
      const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset + 1, 1));
      const month = new Intl.DateTimeFormat("pt-BR", { month: "short", timeZone: "UTC" }).format(start).replace(".", "");
      list.push({
        label: `${month}/${String(start.getUTCFullYear()).slice(2)}`,
        from: dateSql(start), to: dateSql(end), hours: (end.getTime() - start.getTime()) / 3600000,
        // IAMOT do mês: semanas cuja segunda-feira cai no mês.
        laborFrom: mondayOnOrAfter(isoDate(start)), laborTo: mondayOnOrAfter(isoDate(end)),
      });
    }
    return list;
  }
  const currentMonday = weekStart(todayLocal());
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const monday = addDays(currentMonday, -7 * offset);
    const next = addDays(monday, 7);
    list.push({
      label: `${monday.slice(8, 10)}/${monday.slice(5, 7)}`,
      from: `${monday} 00:00:00`, to: `${next} 00:00:00`, hours: 7 * 24, laborFrom: monday, laborTo: next,
    });
  }
  return list;
}

export function buildReport(db, query) {
  const TABS = buildTabs(getTargets(db));
  const period = PERIOD_DAYS[query.period] ? query.period : "6m";
  const days = PERIOD_DAYS[period];
  const areas = db.prepare("SELECT DISTINCT localizacao FROM equipamentos WHERE localizacao IS NOT NULL AND trim(localizacao) <> '' ORDER BY localizacao")
    .all().map((row) => row.localizacao);
  const area = areas.includes(String(query.area)) ? String(query.area) : null;
  const equipes = db.prepare("SELECT id, nome FROM equipes ORDER BY nome").all();
  const equipe = equipes.find((team) => team.id === Number(query.equipe)) || null;
  const equipeId = equipe?.id ?? null;

  // Mesma janela móvel da Visão geral, para que os números coincidam.
  const end = new Date();
  const start = new Date(end.getTime() - days * DAY_MS);
  const periodStart = dateSql(start);
  const periodEnd = dateSql(new Date(end.getTime() + 1000));
  const previousFrom = dateSql(new Date(start.getTime() - days * DAY_MS));
  const hours = Math.max(1, (end.getTime() - start.getTime()) / 3600000);
  const laborFrom = weekStart(periodStart.slice(0, 10));
  const laborTo = addDays(weekStart(periodEnd.slice(0, 10)), 7);

  const window = { from: periodStart, to: periodEnd, hours };
  const current = orderIndicators(db, { ...window, area, equipeId });
  const previous = orderIndicators(db, { from: previousFrom, to: periodStart, hours, area, equipeId });
  const labor = summarizeLabor(db, laborFrom, laborTo, equipeId);
  const previousLabor = summarizeLabor(db, weekStart(previousFrom.slice(0, 10)), laborFrom, equipeId);

  const series = buckets(period).map((bucket) => ({
    label: bucket.label,
    from: bucket.from.slice(0, 10),
    to: addDays(bucket.to.slice(0, 10), -1),
    ...orderIndicators(db, { from: bucket.from, to: bucket.to, hours: bucket.hours, area, equipeId }),
    ...laborFields(summarizeLabor(db, bucket.laborFrom, bucket.laborTo, equipeId)),
  }));

  // HH apropriado por equipamento/área (o HH disponível só existe por equipe).
  const appropriated = db.prepare(`
    SELECT o.equipamento_id, e.localizacao AS area, SUM(a.hh_apropriado) AS hh
    FROM apontamentos a
    JOIN ordens o ON o.id = a.ordem_id
    LEFT JOIN equipamentos e ON e.id = o.equipamento_id
    LEFT JOIN usuarios u ON u.id = a.usuario_id
    LEFT JOIN colaboradores c ON c.id = a.colaborador_id
    WHERE a.tipo = 'Apropriação' AND date(a.data, 'localtime') >= ? AND date(a.data, 'localtime') < ?
      AND (? IS NULL OR COALESCE(u.equipe_id, c.equipe_id, o.equipe_id) = ?)
    GROUP BY o.equipamento_id
  `).all(laborFrom, laborTo, equipeId, equipeId);
  const hhByArea = new Map();
  const hhByEquipment = new Map();
  for (const row of appropriated) {
    if (row.equipamento_id != null) hhByEquipment.set(row.equipamento_id, row.hh);
    if (row.area) hhByArea.set(row.area, (hhByArea.get(row.area) || 0) + row.hh);
  }
  const noLabor = (hh) => ({ iamot: null, hh_apropriado: hh || 0, hh_disponivel: null, hh_ocorrencias: null, hh_liquido: null });

  const breakdown = {
    equipe: (equipe ? [equipe] : equipes).map((team) => ({
      key: team.id, label: team.nome,
      ...orderIndicators(db, { ...window, area, equipeId: team.id }),
      ...laborFields(summarizeLabor(db, laborFrom, laborTo, team.id)),
    })),
    area: (area ? [area] : areas).map((name) => ({
      key: name, label: name,
      ...orderIndicators(db, { ...window, area: name, equipeId }),
      ...noLabor(hhByArea.get(name)),
    })),
    equipamento: db.prepare("SELECT id, tag, descricao FROM equipamentos e WHERE (? IS NULL OR e.localizacao = ?) ORDER BY tag")
      .all(area, area).map((item) => ({
        key: item.id, label: item.tag, detail: item.descricao,
        ...orderIndicators(db, { ...window, area, equipeId, equipamentoId: item.id }),
        ...noLabor(hhByEquipment.get(item.id)),
      })).filter((row) => row.orders > 0 || row.hh_apropriado > 0),
  };

  return {
    filters: { period, area: area || "all", equipe: equipeId || "all", areas, equipes },
    period: { from: periodStart.slice(0, 10), to: isoDate(end), days, bucket: BUCKETS[period][0] },
    tabs: TABS,
    dimensions: DIMENSIONS.map(([id, label]) => ({ id, label })),
    kpis: {
      availability: metric(current.availability, previous.availability, "%", TABS[0].description),
      mtbf: metric(current.mtbf, previous.mtbf, "h", TABS[1].description),
      mttr: metric(current.mttr, previous.mttr, "h", TABS[1].description, "lower"),
      iamot: metric(labor.iamot, previousLabor.iamot, "%", TABS[2].description),
      adherence: metric(current.adherence, previous.adherence, "%", TABS[3].description),
      backlog: metric(current.backlog, previous.backlog, "OMs", TABS[4].description, "lower"),
    },
    series,
    breakdown,
    scope: { area: area || "Todas as áreas", equipe: equipe?.nome || "Todas as equipes" },
  };
}

// CSV para Excel em pt-BR: separador ";", vírgula decimal e BOM.
function csvText(value) {
  let text = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`; // evita execução de fórmulas
  return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
const csvNumber = (value, digits) => value == null ? "" : String(Number(value.toFixed(digits))).replace(".", ",");
const withUnit = (item) => item.unit ? `${item.label} (${item.unit})` : item.label;

export function reportCsv(report, tab) {
  const header = ["Visão", "Item", "Início", "Fim", ...tab.columns.map(withUnit), ...tab.metrics.map((item) => `Meta ${withUnit(item)}`)];
  const line = (view, row, from, to) => [
    csvText(view), csvText(row.label), from, to,
    ...tab.columns.map((item) => csvNumber(row[item.key], item.digits)),
    ...tab.metrics.map((item) => csvNumber(item.target, 1)),
  ].join(";");
  const lines = [
    header.map(csvText).join(";"),
    ...report.series.map((row) => line("Evolução", row, row.from, row.to)),
    ...DIMENSIONS.flatMap(([id, label]) => report.breakdown[id].map((row) => line(label, row, report.period.from, report.period.to))),
  ];
  return { text: `﻿${lines.join("\r\n")}\r\n`, rows: lines.length - 1 };
}

export default function createIndicatorsRouter({ db, auth, requireRole, audit }) {
  const router = Router();
  router.use(auth, requireRole("CCM", "PCM"));

  router.get("/", (req, res) => {
    res.json(buildReport(db, req.query));
  });

  router.get("/export", (req, res) => {
    const tab = buildTabs(getTargets(db)).find((item) => item.id === req.query.kpi);
    if (!tab) return res.status(400).json({ error: "Indicador inválido para exportação." });
    const report = buildReport(db, req.query);
    const csv = reportCsv(report, tab);
    audit(req.user.id, "exportar_indicadores", "indicador", null,
      `${tab.label} · período ${report.filters.period} · ${report.scope.area} · ${report.scope.equipe} · ${csv.rows} linhas`);
    res.set({
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="indicadores-${tab.id}-${report.filters.period}-${todayLocal()}.csv"`,
      "Cache-Control": "no-store",
    }).send(csv.text);
  });

  return router;
}
