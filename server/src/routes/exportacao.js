import { Router } from "express";
import { exportacaoRepo, integracaoSapRepo } from "../data/index.js";
import { createZip, toCsv } from "../exportacao.js";
import { todayLocal } from "../iamot.js";
import { buildReport, reportCsv } from "./indicadores.js";
import { buildSapPayload, enqueueSapOrder, processSapQueueItem } from "../integracaoSap.js";

const dateIso = () => new Date().toISOString();

export default function createExportRouter({ auth, requireRole, audit }) {
  const router = Router();
  router.use(auth, requireRole("CCM"));

  router.get("/sap", async (req, res) => {
    const files = [];
    const counts = [];
    for (const dataset of exportacaoRepo.SAP_DATASETS) {
      const rows = await dataset.buscar();
      files.push({ name: dataset.arquivo, content: toCsv(rows, dataset.colunas) });
      counts.push(`${dataset.arquivo}: ${rows.length}`);
    }

    const report = await buildReport({ period: "12m" });
    for (const tab of report.tabs) {
      const csv = reportCsv(report, tab);
      files.push({ name: `indicadores_${tab.id}.csv`, content: csv.text });
      counts.push(`indicadores_${tab.id}.csv: ${csv.rows}`);
    }
    const metricRows = report.tabs.flatMap((tab) => tab.metrics.map((metric) => ({
      indicador: metric.label,
      valor_atual: report.kpis[metric.key].value,
      valor_anterior: report.kpis[metric.key].previous,
      variacao: report.kpis[metric.key].delta,
      unidade: metric.unit,
      meta: metric.target,
      periodo_inicio: report.period.from,
      periodo_fim: report.period.to,
      area: report.scope.area,
      equipe: report.scope.equipe,
    })));
    files.push({
      name: "indicadores_resumo.csv",
      content: toCsv(metricRows, ["indicador", "valor_atual", "valor_anterior", "variacao", "unidade", "meta", "periodo_inicio", "periodo_fim", "area", "equipe"]),
    });

    router.get("/sap/fila", async (_req, res) => {
      res.json(await integracaoSapRepo.list());
    });

    router.get("/sap/confirmacoes", async (req, res) => {
      const files = [{ name: "LEIA-ME.txt", content: "\uFEFFPayloads de confirmação SAP gerados pelo SIGMA·CCM. Os anexos estão em Base64 dentro de cada JSON.\r\n" }];
      const counts = [];
      for (const order of await integracaoSapRepo.listClosedOrders()) {
        const payload = await buildSapPayload(order.id);
        if (!payload) continue;
        const base = String(order.numero).replace(/[^A-Za-z0-9_-]+/g, "_");
        files.push({ name: `ordens/${base}.json`, content: `\uFEFF${JSON.stringify(payload, null, 2)}\r\n` });
        if (payload.format === "xml") files.push({ name: `ordens/${base}.xml`, content: payload.serialized });
        counts.push(order.numero);
      }
      await audit(req.user.id, "exportar_confirmacoes_sap", "exportacao", null, `${counts.length} OM(s)`);
      res.set({
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="sigma-ccm-confirmacoes-sap-${todayLocal()}.zip"`,
        "Cache-Control": "no-store",
      }).send(createZip(files));
    });

    router.get("/sap/ordens/:id/payload", async (req, res) => {
      const payload = await buildSapPayload(Number(req.params.id));
      if (!payload) return res.status(404).json({ error: "Ordem não encontrada." });
      res.json(payload);
    });

    router.post("/sap/ordens/:id/enviar", async (req, res) => {
      const ordemId = Number(req.params.id);
      const payload = await enqueueSapOrder(ordemId);
      if (!payload) return res.status(404).json({ error: "Ordem não encontrada." });
      const item = await integracaoSapRepo.findByOrder(ordemId);
      const result = await processSapQueueItem(item);
      await audit(req.user.id, "enviar_ordem_sap", "ordem", ordemId, result?.status || "PENDENTE");
      res.json({ ordem_id: ordemId, status: result?.status || "PENDENTE", erro: result?.error || null });
    });

    router.post("/sap/fila/processar", async (req, res) => {
      const items = await integracaoSapRepo.list();
      const results = [];
      for (const item of items.filter((entry) => ["PENDENTE", "ERRO"].includes(entry.status))) {
        const result = await processSapQueueItem(item);
        if (result) results.push({ ordem_id: item.ordem_id, status: result.status, erro: result.error || null });
      }
      res.json({ processados: results.length, resultados: results });
    });

    const generatedAt = dateIso();
    const readme = [
      "SIGMA·CCM — pacote de dados operacionais para preparação de carga no SAP",
      `Gerado em (UTC): ${generatedAt}`,
      "Formato dos CSVs: UTF-8 com BOM, separador ponto e vírgula; campos entre aspas quando necessário.",
      "Este pacote contém dados genéricos para conferência e mapeamento. Não é um template de importação SAP: ajuste nomes, códigos e regras ao layout aprovado pela equipe SAP.",
      "",
      ...exportacaoRepo.SAP_DATASETS.map((dataset) => `${dataset.arquivo}: ${dataset.descricao}.`),
      "indicadores_resumo.csv: resumo atual e comparação com o período anterior para os KPIs, metas e janela de 12 meses.",
      "indicadores_<kpi>.csv: evolução de 12 meses e detalhamento dos KPIs por equipe, área e equipamento.",
      "",
      "Privacidade e conteúdo omitido:",
      "- Senhas, hashes, tokens e identificadores de autenticação não são exportados.",
      "- Arquivos binários (fotos, assinaturas e evidências) não são incluídos; há CSVs com metadados e referências.",
      "- Ocorrências individuais de ausência/atestado não são exportadas por conterem dados pessoais sensíveis.",
      "- Tabelas de infraestrutura, fila offline/idempotência e cache interno não são exportadas.",
      "",
      "Arquivos e registros:",
      ...counts,
    ].join("\r\n");
    files.unshift({ name: "LEIA-ME.txt", content: `\uFEFF${readme}\r\n` });

    await audit(req.user.id, "exportar_pacote_sap", "exportacao", null, counts.join(" · "));
    res.set({
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="sigma-ccm-sap-${todayLocal()}.zip"`,
      "Cache-Control": "no-store",
    }).send(createZip(files));
  });

  return router;
}
