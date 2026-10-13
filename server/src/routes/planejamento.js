import { Router } from "express";
import {
  equipesRepo, notasRepo, ocorrenciasRepo, ordensRepo, passagensRepo, permissoesTrabalhoRepo, programacaoRepo,
  rondasInspecaoRepo, sinalizacoesRepo, transaction,
} from "../data/index.js";
import { dataBr, parseIsoDate, todayLocal, weekStart } from "../iamot.js";
import { syncOrderSchedule, weekPlan } from "../planejamento.js";

const CLOSED = ["Encerrada", "Cancelada"];

export default function createPlanningRouter({ auth, requireRole, audit }) {
  const router = Router();
  router.use(auth, requireRole("CCM", "PCM"));

  router.get("/", async (req, res) => {
    const semana = weekStart(req.query.semana) || weekStart(todayLocal());
    const plan = await weekPlan(semana);
    // OMs ainda não totalmente alocadas (HH alocado em todas as semanas < HH previsto).
    plan.pendentes = await programacaoRepo.listOrdersPendingAllocation();
    plan.ordens = await programacaoRepo.listOpenOrdersWithAllocation();
    res.json(plan);
  });

  async function validate(body) {
    const ordem = await ordensRepo.findSummary(Number(body.ordem_id));
    if (!ordem) return { status: 400, error: "Selecione uma OM." };
    if (CLOSED.includes(ordem.status)) return { status: 409, error: `A OM ${ordem.numero} está ${ordem.status.toLowerCase()}.` };
    const equipe = await equipesRepo.findById(Number(body.equipe_id));
    if (!equipe) return { status: 400, error: "Selecione uma equipe cadastrada." };
    const data = String(body.data || "").trim();
    if (!parseIsoDate(data)) return { status: 400, error: "Informe a data da atividade." };
    const hh = Number(body.hh_previsto);
    if (!Number.isFinite(hh) || hh <= 0 || hh > 1000) return { status: 400, error: "Informe o HH previsto (maior que zero)." };
    return { ordem, equipe, data, hh, observacao: String(body.observacao || "").trim().slice(0, 500) || null };
  }

  router.post("/alocacoes", async (req, res) => {
    const valid = await validate(req.body || {});
    if (valid.error) return res.status(valid.status).json({ error: valid.error });
    const created = await transaction(async () => {
      const id = await programacaoRepo.create({
        ordemId: valid.ordem.id, equipeId: valid.equipe.id, data: valid.data, hh: valid.hh, observacao: valid.observacao, usuarioId: req.user.id,
      });
      syncOrderSchedule(valid.ordem.id);
      await audit(req.user.id, "alocar_atividade", "ordem", valid.ordem.id, `OM ${valid.ordem.numero} · ${valid.equipe.nome} · ${dataBr(valid.data)} · ${valid.hh} HH`);
      return { id };
    });
    res.status(201).json(created);
  });

  router.put("/alocacoes/:id", async (req, res) => {
    const current = await programacaoRepo.findById(req.params.id);
    if (!current) return res.status(404).json({ error: "Alocação não encontrada." });
    const valid = await validate({ ...req.body, ordem_id: current.ordem_id });
    if (valid.error) return res.status(valid.status).json({ error: valid.error });
    await transaction(async () => {
      await programacaoRepo.update(current.id, { equipeId: valid.equipe.id, data: valid.data, hh: valid.hh, observacao: valid.observacao });
      syncOrderSchedule(current.ordem_id);
      await audit(req.user.id, "editar_alocacao", "ordem", current.ordem_id, `OM ${valid.ordem.numero} · ${valid.equipe.nome} · ${dataBr(valid.data)} · ${valid.hh} HH`);
    });
    res.json({ ok: true });
  });

  router.delete("/alocacoes/:id", async (req, res) => {
    const current = await programacaoRepo.findWithOrder(req.params.id);
    if (!current) return res.status(404).json({ error: "Alocação não encontrada." });
    await transaction(async () => {
      await programacaoRepo.remove(current.id);
      syncOrderSchedule(current.ordem_id);
      await audit(req.user.id, "remover_alocacao", "ordem", current.ordem_id, `OM ${current.numero} · ${dataBr(current.data)}`);
    });
    res.status(204).end();
  });

  // Consulta rápida do PCM: etapas do fluxo, alertas e a semana atual.
  router.get("/resumo", async (req, res) => {
    const hoje = todayLocal();
    const plan = await weekPlan(weekStart(hoje));
    res.json({
      hoje,
      fluxo: {
        notas_abertas: await notasRepo.countOpen(),
        oms_abertas: await ordensRepo.countByStatus("Aberta"),
        oms_sem_executante: await ordensRepo.countScheduledWithoutExecutante(),
        oms_distribuidas: await ordensRepo.countByStatus("Distribuída"),
        oms_em_execucao: await ordensRepo.countByStatus("Em execução"),
      },
      alertas: {
        oms_atrasadas: await ordensRepo.countOverdue(hoje),
        oms_sem_alocacao: await programacaoRepo.countOpenOrdersWithoutAllocation(),
        sinalizacoes_novas: await sinalizacoesRepo.countNew(),
        passagens_nao_lidas: await passagensRepo.countUnread(req.user.id, hoje),
        pts_aguardando: await permissoesTrabalhoRepo.countAwaiting(),
        rondas_em_andamento: await rondasInspecaoRepo.countInProgress(),
        ocorrencias_semana: await ocorrenciasRepo.countInWeek(plan.semana.fim, plan.semana.inicio),
      },
      semana: plan.resumo,
    });
  });

  return router;
}
