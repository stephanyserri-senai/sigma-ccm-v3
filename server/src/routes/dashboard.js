import { Router } from "express";
import { equipamentosRepo, indicadoresRepo, sinalizacoesRepo } from "../data/index.js";
import { addDays, summarizeLabor, weekStart } from "../iamot.js";
import { DAY_MS, PERIOD_DAYS, dateSql, metric, orderIndicators } from "../indicadores.js";
import { exposureHours, getParameters, getTargets } from "../parametros.js";

export default function createDashboardRouter({ auth }) {
  const router = Router();

  router.get("/", auth, (req, res) => {
    const period = PERIOD_DAYS[req.query.period] ? req.query.period : "6m";
    const days = PERIOD_DAYS[period];
    const areaValues = equipamentosRepo.listAreas();
    const requestedArea = String(req.query.area || "all");
    const area = requestedArea === "all" || areaValues.includes(requestedArea) ? requestedArea : "all";
    const areaFilter = area === "all" ? null : area;
    const end = new Date();
    const start = new Date(end.getTime() - days * DAY_MS);
    const previousStart = new Date(start.getTime() - days * DAY_MS);
    const periodStart = dateSql(start);
    // Limite superior exclusivo: avança 1 s para incluir registros criados no segundo atual.
    const periodEnd = dateSql(new Date(end.getTime() + 1000));
    const previousFrom = dateSql(previousStart);
    const periodHours = Math.max(1, (end.getTime() - start.getTime()) / 3600000);

    const summarize = (from, to, hours) => orderIndicators({ from, to, hours, area: areaFilter });

    const current = summarize(periodStart, periodEnd, periodHours);
    const previous = summarize(previousFrom, periodStart, periodHours);

    // IAMOT: semanas com HH disponível lançado; equipes não têm área, então o filtro de área não se aplica.
    const laborFrom = weekStart(periodStart.slice(0, 10));
    const labor = summarizeLabor(laborFrom, addDays(weekStart(periodEnd.slice(0, 10)), 7));
    const previousLabor = summarizeLabor(weekStart(previousFrom.slice(0, 10)), laborFrom);

    const totalBacklog = indicadoresRepo.countOpenOrders(areaFilter);
    const statusRows = indicadoresRepo.countByStatus(periodStart, periodEnd, areaFilter);
    const criticalityRows = indicadoresRepo.countByCriticalityAndArea(periodStart, periodEnd, areaFilter)
      .map((row) => ({ ...row, label: `${row.criticidade} · ${row.area}` }));
    const alertRows = sinalizacoesRepo.listRecent(periodStart, periodEnd, areaFilter);

    const topRows = indicadoresRepo.listFailuresByEquipment(periodStart, periodEnd, areaFilter).map((row) => ({
      ...row,
      mtbf: row.falhas > 0 && row.falhas_com_duracao === row.falhas
        ? Math.max(0, (exposureHours(periodHours) - row.indisponibilidade_horas) / row.falhas)
        : null,
    })).sort((left, right) => {
      if (right.falhas !== left.falhas) return right.falhas - left.falhas;
      if (left.mtbf == null) return 1;
      if (right.mtbf == null) return -1;
      return left.mtbf - right.mtbf;
    }).slice(0, 5);

    const openOrders = indicadoresRepo.listOpenOrders(areaFilter);

    const monthlyTrend = [];
    const now = new Date();
    for (let offset = 5; offset >= 0; offset -= 1) {
      const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
      const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset + 1, 1));
      const monthHours = (monthEnd.getTime() - monthStart.getTime()) / 3600000;
      const stats = summarize(dateSql(monthStart), dateSql(monthEnd), monthHours);
      monthlyTrend.push({
        month: new Intl.DateTimeFormat("pt-BR", { month: "short", timeZone: "UTC" }).format(monthStart).replace(".", ""),
        availability: stats.availability == null ? null : Number(stats.availability.toFixed(1)),
        adherence: stats.adherence == null ? null : Number(stats.adherence.toFixed(1)),
      });
    }

    res.json({
      filters: { period, area, areas: areaValues },
      period: { from: periodStart, to: periodEnd, days },
      targets: (({ availability, adherence }) => ({ availability, adherence }))(getTargets()),
      kpis: {
        availability: metric(current.availability, previous.availability, "%", `Estimativa; exposição de ${getParameters().exposicao_horas_dia} h/dia por equipamento.`),
        mtbf: metric(current.mtbf, previous.mtbf, "h", "Horas de frota por falha; requer parada informada em todas as OMs corretivas."),
        mttr: metric(current.mttr, previous.mttr, "h", "Média das horas de reparo informadas nas OMs corretivas.", "lower"),
        iamot: metric(labor.iamot, previousLabor.iamot, "%", "HH apropriado ÷ HH disponível das equipes, descontadas as ocorrências (folga, férias, falta, atestado). Não varia com o filtro de área."),
        adherence: metric(current.adherence, previous.adherence, "%", "OMs programadas distribuídas, em execução ou encerradas."),
        backlog: metric(current.backlog, previous.backlog, "OMs", "OMs criadas na janela e ainda abertas.", "lower"),
      },
      trend: monthlyTrend,
      ordersByStatus: statusRows,
      ordersByCriticality: criticalityRows,
      topEquipment: topRows,
      alerts: alertRows,
      backlog: { periodOpen: current.backlog, previousPeriodOpen: previous.backlog, totalOpen: totalBacklog, orders: openOrders },
      coverage: { scheduledOrders: current.scheduled, adherentOrders: current.adherent, failures: current.failures },
      labor: { apropriado: labor.apropriado, disponivel: labor.disponivel, ocorrencias: labor.ocorrencias, liquido: labor.liquido, lancamentos: labor.lancamentos },
    });
  });

  return router;
}