import { Router } from "express";
import { colaboradoresRepo, equipesRepo, execucoesRepo, hhDisponivelRepo, ocorrenciasRepo, transaction, usuariosRepo } from "../data/index.js";
import { getParameters } from "../parametros.js";
import { addDays, laborIndex, parseIsoDate, teamWeekLabor, todayLocal, weekStart } from "../iamot.js";

const TIPOS_OCORRENCIA = ["Folga", "Férias", "Falta", "Atestado"];
// LGPD: atestado é dado de saúde (sensível) — além de quem enviou, só o perfil CCM vê o tipo e a observação.
const TIPO_SENSIVEL = "Atestado";
const TIPO_MASCARADO = "Ausência";

// As ocorrências são enviadas pelo executante em campo; CCM e PCM acompanham.
export default function createLaborRouter({ auth, requireRole, audit }) {
  const router = Router();
  router.use(auth);
  const gestao = requireRole("CCM", "PCM");
  const campo = requireRole("EXECUTANTE");

  const canSeeSensitive = (req) => req.user.papel === "CCM";
  const userTeamId = (req) => usuariosRepo.findTeamId(req.user.id);

  router.get("/", gestao, (req, res) => {
    const semana = weekStart(req.query.semana) || weekStart(todayLocal());
    const proxima = addDays(semana, 7);
    const cells = teamWeekLabor(semana, proxima);

    const equipes = equipesRepo.listWithHeadcount().map((team) => {
      const item = cells.get(`${team.equipe_id}|${semana}`) || { disponivel: null, ocorrencias: 0, apropriado: 0 };
      const index = laborIndex(item.apropriado, item.disponivel, item.ocorrencias);
      return {
        ...team,
        hh_disponivel: item.disponivel,
        hh_ocorrencias: item.ocorrencias,
        hh_apropriado: item.apropriado,
        hh_liquido: index.liquido,
        iamot: index.iamot,
      };
    });

    const launched = equipes.filter((team) => team.hh_disponivel != null);
    const sum = (key) => launched.reduce((acc, team) => acc + team[key], 0);
    const total = launched.length
      ? { hh_disponivel: sum("hh_disponivel"), hh_ocorrencias: sum("hh_ocorrencias"), hh_apropriado: sum("hh_apropriado") }
      : { hh_disponivel: null, hh_ocorrencias: 0, hh_apropriado: 0 };
    const totalIndex = laborIndex(total.hh_apropriado, total.hh_disponivel, total.hh_ocorrencias);

    const sensitive = canSeeSensitive(req);
    const ocorrencias = ocorrenciasRepo.listInWeek(semana, proxima).map((row) => (
      row.tipo === TIPO_SENSIVEL && !sensitive
        ? { ...row, tipo: TIPO_MASCARADO, observacao: null, restrito: true }
        : { ...row, restrito: false }
    ));

    const intercorrencias = execucoesRepo.listIncidentsInRange(semana, proxima);

    res.json({
      semana: { inicio: semana, fim: addDays(semana, 6) },
      equipes,
      total: { ...total, hh_liquido: totalIndex.liquido, iamot: totalIndex.iamot },
      ocorrencias,
      intercorrencias,
      hh_semana_pessoa: getParameters().hh_semana_pessoa,
    });
  });

  router.put("/hh-disponivel", gestao, (req, res) => {
    const body = req.body || {};
    const equipeId = Number(body.equipe_id);
    const semana = weekStart(body.semana);
    const team = equipesRepo.findById(equipeId);
    if (!team) return res.status(400).json({ error: "Selecione uma equipe cadastrada." });
    if (!semana) return res.status(400).json({ error: "Informe a semana (AAAA-MM-DD)." });

    const clear = body.hh_disponivel === "" || body.hh_disponivel == null;
    const horas = Number(body.hh_disponivel);
    if (!clear && (!Number.isFinite(horas) || horas < 0 || horas > 100000)) {
      return res.status(400).json({ error: "Informe um HH disponível válido (zero ou mais)." });
    }

    transaction(() => {
      if (clear) hhDisponivelRepo.remove(equipeId, semana);
      else hhDisponivelRepo.upsert({ equipeId, semana, horas, usuarioId: req.user.id });
      audit(req.user.id, "lancar_hh_disponivel", "equipe", equipeId, `${semana} · ${clear ? "removido" : `${horas} h`}`);
    });

    res.json({ ok: true, equipe_id: equipeId, semana, hh_disponivel: clear ? null : horas });
  });

  // Executante: pessoas (usuários) da própria equipe e as ocorrências que ele mesmo enviou.
  router.get("/minhas-ocorrencias", campo, (req, res) => {
    const equipeId = userTeamId(req);
    const equipe = equipeId ? equipesRepo.findById(equipeId) : null;
    res.json({
      equipe: equipe || null,
      tipos_ocorrencia: TIPOS_OCORRENCIA,
      horas_dia_padrao: getParameters().jornada_horas_dia,
      colaboradores: equipe ? colaboradoresRepo.listTeamMembers(equipe.id) : [],
      ocorrencias: ocorrenciasRepo.listSentBy(req.user.id),
    });
  });

  router.post("/ocorrencias", campo, (req, res) => {
    const body = req.body || {};
    const tipo = String(body.tipo || "").trim();
    if (!TIPOS_OCORRENCIA.includes(tipo)) return res.status(400).json({ error: "Tipo de ocorrência inválido." });
    const equipeId = userTeamId(req);
    if (!equipeId) return res.status(400).json({ error: "Seu usuário não está vinculado a uma equipe. Procure o CCM." });
    const colaborador = colaboradoresRepo.findWithUserTeam(Number(body.colaborador_id));
    if (!colaborador) return res.status(400).json({ error: "Selecione um usuário cadastrado." });
    if (colaborador.equipe_id !== equipeId) return res.status(403).json({ error: "Só é possível enviar ocorrências de pessoas da sua equipe." });
    const inicio = String(body.data_inicio || "").trim();
    const fim = String(body.data_fim || "").trim() || inicio;
    if (!parseIsoDate(inicio) || !parseIsoDate(fim)) return res.status(400).json({ error: "Informe datas válidas para a ocorrência." });
    if (fim < inicio) return res.status(400).json({ error: "A data final não pode ser anterior à inicial." });
    const horasDia = body.horas_dia === "" || body.horas_dia == null ? getParameters().jornada_horas_dia : Number(body.horas_dia);
    if (!Number.isFinite(horasDia) || horasDia <= 0 || horasDia > 24) {
      return res.status(400).json({ error: "Informe as horas por dia (entre 0 e 24)." });
    }

    const created = transaction(() => {
      const id = ocorrenciasRepo.create({
        colaboradorId: colaborador.id, tipo, inicio, fim, horasDia,
        observacao: String(body.observacao || "").trim().slice(0, 500) || null, usuarioId: req.user.id,
      });
      // O tipo fica fora da trilha de auditoria para não expor o dado sensível.
      audit(req.user.id, "registrar_ocorrencia_hh", "ocorrencia_hh", id, `Colaborador ${colaborador.id} · ${inicio} a ${fim}`);
      return { id };
    });
    res.status(201).json(created);
  });

  // Exclui quem enviou (correção de engano) ou o CCM.
  router.delete("/ocorrencias/:id", requireRole("EXECUTANTE", "CCM"), (req, res) => {
    const row = ocorrenciasRepo.findById(req.params.id);
    if (!row || (req.user.papel === "EXECUTANTE" && row.registrado_por !== req.user.id)) {
      return res.status(404).json({ error: "Ocorrência não encontrada." });
    }
    transaction(() => {
      ocorrenciasRepo.remove(row.id);
      audit(req.user.id, "excluir_ocorrencia_hh", "ocorrencia_hh", row.id, `Colaborador ${row.colaborador_id}`);
    });
    res.status(204).end();
  });

  return router;
}
