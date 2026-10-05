import { Router } from "express";
import {
  notificacoesRepo, ocorrenciasRepo, ordensRepo, passagensRepo, permissoesTrabalhoRepo, rondasInspecaoRepo, sinalizacoesRepo, usuariosRepo,
} from "../data/index.js";
import { addDays, parseIsoDate, todayLocal, weekStart } from "../iamot.js";
import { orderForms } from "../formularios.js";
import { generateNotifications } from "../notificacoes.js";
import { validPermit } from "./permissoes.js";

const CLOSED = new Set(["Encerrada", "Cancelada"]);
const isIso = (value) => Boolean(parseIsoDate(value));

// Visão geral do executante: o que fazer agora, hoje e na semana, só com as OMs e
// pendências dele. Um único resumo para a tela abrir rápido (inclusive pelo cache offline).
export default function createFieldRouter({ auth, requireRole }) {
  const router = Router();
  router.use(auth, requireRole("EXECUTANTE"));

  router.get("/resumo", (req, res) => {
    const hoje = todayLocal();
    const inicioSemana = weekStart(hoje);
    const fimSemana = addDays(inicioSemana, 6);
    const usuario = usuariosRepo.findNameAndTeam(req.user.id);

    const ordens = ordensRepo.listAssignedTo(req.user.id).map((order) => {
      const programada = isIso(order.data_programada);
      const fim = programada ? (isIso(order.data_fim_programada) && order.data_fim_programada >= order.data_programada ? order.data_fim_programada : order.data_programada) : null;
      const aberta = !CLOSED.has(order.status);
      const formularios = aberta ? orderForms(order.id) : [];
      return {
        ...order,
        exige_pt: Boolean(order.exige_pt),
        inicio: programada ? order.data_programada : null,
        fim,
        aberta,
        atrasada: aberta && programada && fim < hoje,
        hoje: programada && order.data_programada <= hoje && fim >= hoje,
        em_execucao: Boolean(order.iniciado_em && !order.finalizado_em),
        pt_vigente: aberta && order.exige_pt ? Boolean(validPermit(order.id)) : null,
        checklists_pendentes: formularios.filter((form) => form.obrigatorio && !form.ultima_resposta).length,
        checklists_opcionais: formularios.filter((form) => !form.obrigatorio && !form.ultima_resposta).length,
      };
    });

    const dias = Array.from({ length: 7 }, (_, index) => addDays(inicioSemana, index)).map((data) => ({
      data,
      ordens: ordens.filter((order) => order.inicio && order.inicio <= data && order.fim >= data).map((order) => order.id),
    }));

    generateNotifications();
    const contadores = {
      notificacoes_nao_lidas: notificacoesRepo.countUnreadTotal({ papel: req.user.papel, usuario: req.user.id }),
      passagens_nao_lidas: passagensRepo.countUnread(req.user.id, hoje),
      sinalizacoes_novas: sinalizacoesRepo.countNewForAppointmentsOf(req.user.id),
      rondas_em_andamento: rondasInspecaoRepo.countInProgressBy(req.user.id),
      pts_aguardando: permissoesTrabalhoRepo.countAwaitingRequestedBy(req.user.id),
      ocorrencias_semana: ocorrenciasRepo.countInWeekSentBy(req.user.id, fimSemana, inicioSemana),
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
