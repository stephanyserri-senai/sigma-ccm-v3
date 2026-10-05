import { Router } from "express";
import { equipesRepo, ordensRepo, usuariosRepo } from "../data/index.js";
import { laborIndex, teamWeekLabor, todayLocal } from "../iamot.js";
import { createReport } from "../pdf.js";
import { buildReport } from "./indicadores.js";

const KPI_TABS = ["disponibilidade", "confiabilidade", "iamot", "aderencia", "backlog"];
export const TIPOS = {
  geral: "Relatório geral de manutenção",
  ordens: "Relatório de ordens por período e equipe",
  iamot: "Relatório de IAMOT por equipe",
  disponibilidade: "Relatório de disponibilidade",
  confiabilidade: "Relatório de confiabilidade (MTBF/MTTR)",
  aderencia: "Relatório de aderência à programação",
  backlog: "Relatório de backlog",
};
const PERIOD_LABEL = { "30d": "últimos 30 dias", "90d": "últimos 90 dias", "6m": "últimos 6 meses", "12m": "últimos 12 meses" };

const num = (value, digits = 1) => (value == null || !Number.isFinite(value) ? "—" : new Intl.NumberFormat("pt-BR", { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(value));
const withUnit = (value, unit, digits = 1) => (value == null ? "—" : `${num(value, digits)}${unit === "%" ? "%" : unit ? ` ${unit}` : ""}`);
const dateBr = (iso) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10).split("-").reverse().join("/") : iso || "—");
const dateTimeBr = (sql) => (sql ? new Date(`${sql.replace(" ", "T")}Z`).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—");
const onTarget = (metric, value) => (value == null ? null : metric.direction === "lower" ? value <= metric.target : value >= metric.target);
const targetText = (metric) => `${metric.direction === "lower" ? "máx." : "mín."} ${withUnit(metric.target, metric.unit, metric.unit === "OMs" ? 0 : 1)}`;

// Relatórios em PDF (CCM/PCM): parciais por aba de indicador, ordens, IAMOT e geral. Auditados.
export default function createReportsRouter({ auth, requireRole, audit }) {
  const router = Router();
  router.use(auth, requireRole("CCM", "PCM"));

  const metricCard = (report, metric) => {
    const kpi = report.kpis[metric.key];
    const ok = onTarget(metric, kpi.value);
    return {
      label: metric.label,
      value: withUnit(kpi.value, metric.unit, metric.unit === "OMs" ? 0 : 1),
      detail: `Meta ${targetText(metric)} · ${ok == null ? "sem dados" : ok ? "dentro da meta" : "fora da meta"}`,
      ok,
    };
  };

  // Seção de uma aba de indicador: resultado, evolução e detalhamento por equipe, área e equipamento.
  const kpiSection = (pdf, report, tab) => {
    pdf.section(tab.label, tab.description);
    pdf.cards(tab.metrics.map((metric) => metricCard(report, metric)));
    const valueColumns = tab.columns.map((column) => ({ label: column.unit ? `${column.label} (${column.unit})` : column.label, align: "right" }));
    const values = (row) => tab.columns.map((column) => num(row[column.key], column.digits));
    pdf.subtitle(`Evolução ${report.period.bucket === "week" ? "semanal" : "mensal"}`);
    pdf.table([{ label: "Intervalo", width: 1 }, { label: "Início", width: 1 }, { label: "Fim", width: 1 }, ...valueColumns],
      report.series.map((row) => [row.label, dateBr(row.from), dateBr(row.to), ...values(row)]));
    for (const dimension of report.dimensions) {
      pdf.subtitle(`Detalhamento por ${dimension.label.toLowerCase()}`);
      if (tab.notes?.[dimension.id]) pdf.paragraph(tab.notes[dimension.id]);
      pdf.table([{ label: dimension.label, width: 2 }, ...valueColumns],
        report.breakdown[dimension.id].map((row) => [row.detail ? `${row.label} · ${row.detail}` : row.label, ...values(row)]));
    }
  };

  const ordersSection = (pdf, report) => {
    const { from, to, area, equipeId } = report.janela;
    const orders = ordensRepo.listForReport({ from, to, area, equipeId });
    pdf.section("Ordens por período e equipe", `${orders.length} OM(s) criadas no período, com status, programação e HH previsto × apropriado.`);

    const byStatus = new Map();
    for (const order of orders) byStatus.set(order.status, (byStatus.get(order.status) || 0) + 1);
    pdf.cards([
      { label: "OMs no período", value: num(orders.length, 0) },
      { label: "Abertas (backlog)", value: num(orders.filter((order) => ["Aberta", "Programada", "Distribuída", "Em execução"].includes(order.status)).length, 0) },
      { label: "Encerradas", value: num(byStatus.get("Encerrada") || 0, 0) },
      { label: "HH apropriado", value: withUnit(orders.reduce((sum, order) => sum + (order.hh_apropriado || 0), 0), "h"), detail: `previsto ${withUnit(orders.reduce((sum, order) => sum + (order.hh_previsto || 0), 0), "h")}` },
    ]);

    pdf.subtitle("Resumo por status");
    pdf.table([{ label: "Status", width: 2 }, { label: "OMs", align: "right" }, { label: "% do total", align: "right" }],
      [...byStatus.entries()].sort((a, b) => b[1] - a[1]).map(([status, total]) => [status, num(total, 0), withUnit((total / orders.length) * 100, "%")]));

    const teams = new Map();
    for (const order of orders) {
      const key = order.equipe || "Sem equipe";
      const item = teams.get(key) || { total: 0, abertas: 0, encerradas: 0, previsto: 0, apropriado: 0 };
      item.total += 1;
      if (order.status === "Encerrada") item.encerradas += 1;
      else if (order.status !== "Cancelada") item.abertas += 1;
      item.previsto += order.hh_previsto || 0;
      item.apropriado += order.hh_apropriado || 0;
      teams.set(key, item);
    }
    pdf.subtitle("Resumo por equipe");
    pdf.table([{ label: "Equipe", width: 2 }, { label: "OMs", align: "right" }, { label: "Em aberto", align: "right" }, { label: "Encerradas", align: "right" },
      { label: "HH previsto", align: "right" }, { label: "HH apropriado", align: "right" }],
    [...teams.entries()].map(([team, item]) => [team, num(item.total, 0), num(item.abertas, 0), num(item.encerradas, 0), withUnit(item.previsto, "h"), withUnit(item.apropriado, "h")]));

    pdf.subtitle("Lista completa de ordens");
    pdf.table([
      { label: "OM", width: 1.1 }, { label: "Tipo", width: 1 }, { label: "Status", width: 1.1 }, { label: "Equipamento", width: 1.3 },
      { label: "Área", width: 1.2 }, { label: "Equipe", width: 1.3 }, { label: "Executante", width: 1.4 }, { label: "Criada em", width: 1.1 },
      { label: "Programada", width: 1.3 }, { label: "Encerrada", width: 1 }, { label: "HH prev.", width: 0.8, align: "right" }, { label: "HH aprop.", width: 0.8, align: "right" },
    ], orders.map((order) => [
      order.numero, order.tipo, order.status, order.equipamento, order.area, order.equipe, order.executante, dateTimeBr(order.criado_em),
      `${dateBr(order.data_programada)}${order.data_fim_programada ? ` a ${dateBr(order.data_fim_programada)}` : ""}`,
      order.data_encerramento || "—", num(order.hh_previsto), num(order.hh_apropriado, 2),
    ]));
  };

  const iamotSection = (pdf, report) => {
    const { laborFrom, laborTo, equipeId } = report.janela;
    const teams = equipesRepo.listNames().filter((team) => !equipeId || team.id === equipeId);
    const cells = [...teamWeekLabor(laborFrom, laborTo).values()];
    const target = report.tabs.find((tab) => tab.id === "iamot").metrics[0];
    pdf.section("IAMOT por equipe", `HH apropriado ÷ HH disponível líquido (descontadas folgas, férias, faltas e atestados), semanas de ${dateBr(laborFrom)} até antes de ${dateBr(laborTo)}. Meta ${targetText(target)}.`);
    const rows = teams.map((team) => {
      const mine = cells.filter((cell) => cell.equipe_id === team.id);
      const launched = mine.filter((cell) => cell.disponivel != null);
      const sum = (list, key) => list.reduce((total, cell) => total + (cell[key] || 0), 0);
      const index = launched.length ? laborIndex(sum(launched, "apropriado"), sum(launched, "disponivel"), sum(launched, "ocorrencias")) : { liquido: null, iamot: null };
      const ok = onTarget(target, index.iamot);
      return [team.nome, num(launched.length, 0), launched.length ? withUnit(sum(launched, "disponivel"), "h") : "—", launched.length ? withUnit(sum(launched, "ocorrencias"), "h") : "—",
        withUnit(index.liquido, "h"), withUnit(sum(launched, "apropriado"), "h", 2), withUnit(index.iamot, "%"),
        withUnit(sum(mine.filter((cell) => cell.disponivel == null), "apropriado"), "h", 2), ok == null ? "Sem HH lançado" : ok ? "Dentro da meta" : "Fora da meta"];
    });
    pdf.table([{ label: "Equipe", width: 1.6 }, { label: "Semanas com HH", align: "right" }, { label: "HH disponível", align: "right" }, { label: "Ocorrências", align: "right" },
      { label: "HH líquido", align: "right" }, { label: "HH apropriado", align: "right" }, { label: "IAMOT", align: "right" },
      { label: "HH apropriado sem HH lançado", align: "right", width: 1.3 }, { label: "Situação", width: 1.2 }], rows);
    pdf.subtitle("Detalhe por semana e equipe");
    const names = new Map(teams.map((team) => [team.id, team.nome]));
    pdf.table([{ label: "Semana (início)", width: 1.2 }, { label: "Equipe", width: 1.6 }, { label: "HH disponível", align: "right" }, { label: "Ocorrências", align: "right" },
      { label: "HH líquido", align: "right" }, { label: "HH apropriado", align: "right" }, { label: "IAMOT", align: "right" }],
    cells.filter((cell) => names.has(cell.equipe_id)).sort((a, b) => (a.semana === b.semana ? names.get(a.equipe_id).localeCompare(names.get(b.equipe_id)) : a.semana < b.semana ? -1 : 1))
      .map((cell) => {
        const index = laborIndex(cell.apropriado, cell.disponivel, cell.ocorrencias);
        return [dateBr(cell.semana), names.get(cell.equipe_id), cell.disponivel == null ? "não lançado" : withUnit(cell.disponivel, "h"), withUnit(cell.ocorrencias, "h"),
          withUnit(index.liquido, "h"), withUnit(cell.apropriado, "h", 2), withUnit(index.iamot, "%")];
      }));
  };

  router.get("/pdf", async (req, res, next) => {
    try {
      const tipo = String(req.query.tipo || "");
      if (!TIPOS[tipo]) return res.status(400).json({ error: "Tipo de relatório inválido." });
      const report = buildReport(req.query);
      const user = usuariosRepo.findNameAndRole(req.user.id);
      const geradoEm = new Date().toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
      const pdf = createReport({
        titulo: TIPOS[tipo],
        subtitulo: `Período: ${PERIOD_LABEL[report.filters.period]} (${dateBr(report.period.from)} a ${dateBr(report.period.to)}) · Área: ${report.scope.area} · Equipe: ${report.scope.equipe}`,
        linhas: [`Gerado em ${geradoEm} por ${user?.nome || req.user.nome} (${req.user.papel}).`],
      });

      if (tipo === "geral") {
        pdf.section("Resumo dos indicadores", "Resultado no período em relação às metas definidas em Metas dos KPIs.");
        pdf.cards(report.tabs.flatMap((tab) => tab.metrics.map((metric) => metricCard(report, metric))), 3);
        for (const tab of report.tabs) kpiSection(pdf, report, tab);
        iamotSection(pdf, report);
        ordersSection(pdf, report);
      } else if (tipo === "ordens") {
        ordersSection(pdf, report);
      } else if (tipo === "iamot") {
        iamotSection(pdf, report);
        kpiSection(pdf, report, report.tabs.find((tab) => tab.id === "iamot"));
      } else {
        kpiSection(pdf, report, report.tabs.find((tab) => tab.id === tipo));
      }

      const { buffer, pages } = await pdf.finish(`SIGMA·CCM · ${TIPOS[tipo]} · gerado em ${geradoEm} · uso interno`);
      audit(req.user.id, "gerar_relatorio_pdf", "relatorio", null,
        `${TIPOS[tipo]} · período ${report.filters.period} · ${report.scope.area} · ${report.scope.equipe} · ${pages} página(s)`);
      res.set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="relatorio-${tipo}-${report.filters.period}-${todayLocal()}.pdf"`,
        "Cache-Control": "no-store",
      }).send(buffer);
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export { KPI_TABS };
