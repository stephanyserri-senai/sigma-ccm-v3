import { Router } from "express";
import {
  notificacoesRepo, ocorrenciasRepo, ordensRepo, passagensRepo, permissoesTrabalhoRepo, rondasInspecaoRepo, sinalizacoesRepo, usuariosRepo,
} from "../data/index.js";
import { addDays, parseIsoDate, todayLocal, weekStart } from "../iamot.js";
import { generateNotifications } from "../notificacoes.js";
import { validPermit } from "./permissoes.js";
import { priorityLabel } from "../priorizacao.js";

const CLOSED = new Set(["Encerrada", "Cancelada"]);
const isIso = (value) => Boolean(parseIsoDate(value));

// Visão geral do executante: o que fazer agora, hoje e na semana, só com as OMs e
// pendências dele. Um único resumo para a tela abrir rápido (inclusive pelo cache offline).
export default function createFieldRouter({ auth, requireRole }) {
  const router = Router();
  router.use(auth, requireRole("EXECUTANTE"));

  router.get("/resumo", async (req, res) => {
    const hoje = todayLocal();
    const inicioSemana = weekStart(hoje);
    const fimSemana = addDays(inicioSemana, 6);
    const usuario = await usuariosRepo.findNameAndTeam(req.user.id);

    const ordens = await Promise.all((await ordensRepo.listAssignedTo(req.user.id)).map(async (order) => {
      const programada = isIso(order.data_programada);
      const fim = programada ? (isIso(order.data_fim_programada) && order.data_fim_programada >= order.data_programada ? order.data_fim_programada : order.data_programada) : null;
      const aberta = !CLOSED.has(order.status);
      return {
        ...order,
        prioridade_label: priorityLabel(order.prioridade),
        // Atribuída e ainda não aceita: fica fora do plano até o executante aceitar.
        aguardando_aceite: order.status === "Distribuída" && !order.aceita_em,
        exige_pt: Boolean(order.exige_pt),
        inicio: programada ? order.data_programada : null,
        fim,
        aberta,
        atrasada: aberta && programada && fim < hoje,
        hoje: programada && order.data_programada <= hoje && fim >= hoje,
        em_execucao: Boolean(order.iniciado_em && !order.finalizado_em),
        pt_vigente: aberta && order.exige_pt ? Boolean(await validPermit(order.id)) : null,
      };
    }));

    const dias = Array.from({ length: 7 }, (_, index) => addDays(inicioSemana, index)).map((data) => ({
      data,
      ordens: ordens.filter((order) => !order.aguardando_aceite && order.inicio && order.inicio <= data && order.fim >= data).map((order) => order.id),
    }));

    await generateNotifications();
    const contadores = {
      notificacoes_nao_lidas: await notificacoesRepo.countUnreadTotal({ papel: req.user.papel, usuario: req.user.id }),
      passagens_nao_lidas: await passagensRepo.countUnread(req.user.id, hoje),
      sinalizacoes_novas: await sinalizacoesRepo.countNewForAppointmentsOf(req.user.id),
      rondas_em_andamento: await rondasInspecaoRepo.countInProgressBy(req.user.id),
      pts_aguardando: await permissoesTrabalhoRepo.countAwaitingRequestedBy(req.user.id),
      ocorrencias_semana: await ocorrenciasRepo.countInWeekSentBy(req.user.id, fimSemana, inicioSemana),
    };

    res.json({
      hoje,
      usuario: { nome: usuario?.nome || req.user.nome, equipe: usuario?.equipe || null },
      semana: { inicio: inicioSemana, fim: fimSemana, dias },
      ordens,
      contadores,
    });
  });

  return router;
}
