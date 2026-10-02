import { Router } from "express";
import { addDays, laborIndex, parseIsoDate, teamWeekLabor, todayLocal, weekStart } from "../iamot.js";

const TIPOS_OCORRENCIA = ["Folga", "Férias", "Falta", "Atestado"];
// LGPD: atestado é dado de saúde (sensível) — além de quem enviou, só o perfil CCM vê o tipo e a observação.
const TIPO_SENSIVEL = "Atestado";
const TIPO_MASCARADO = "Ausência";

// As ocorrências são enviadas pelo executante em campo; CCM e PCM acompanham.
export default function createLaborRouter({ db, auth, requireRole, audit }) {
  const router = Router();
  router.use(auth);
  const gestao = requireRole("CCM", "PCM");
  const campo = requireRole("EXECUTANTE");

  const canSeeSensitive = (req) => req.user.papel === "CCM";
  const userTeamId = (req) => db.prepare("SELECT equipe_id FROM usuarios WHERE id = ?").get(req.user.id)?.equipe_id ?? null;

  router.get("/", gestao, (req, res) => {
    const semana = weekStart(req.query.semana) || weekStart(todayLocal());
    const proxima = addDays(semana, 7);
    const cells = teamWeekLabor(db, semana, proxima);

    const equipes = db.prepare(`
      SELECT e.id AS equipe_id, e.nome AS equipe, e.tipo,
             (SELECT COUNT(*) FROM usuarios u WHERE u.equipe_id = e.id AND u.ativo = 1) AS colaboradores
      FROM equipes e ORDER BY e.nome
    `).all().map((team) => {
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
    const ocorrencias = db.prepare(`
      SELECT oc.id, oc.colaborador_id, COALESCE(p.nome, c.nome) AS colaborador, e.nome AS equipe,
             oc.tipo, oc.data_inicio, COALESCE(oc.data_fim, oc.data_inicio) AS data_fim,
             oc.horas_dia, oc.observacao, oc.criado_em, u.nome AS enviado_por
      FROM ocorrencias_hh oc
      JOIN colaboradores c ON c.id = oc.colaborador_id
      LEFT JOIN usuarios p ON p.id = c.usuario_id
      LEFT JOIN equipes e ON e.id = COALESCE(p.equipe_id, c.equipe_id)
      LEFT JOIN usuarios u ON u.id = oc.registrado_por
      WHERE oc.data_inicio < ? AND COALESCE(oc.data_fim, oc.data_inicio) >= ?
      ORDER BY oc.data_inicio, colaborador
    `).all(proxima, semana).map((row) => (
      row.tipo === TIPO_SENSIVEL && !sensitive
        ? { ...row, tipo: TIPO_MASCARADO, observacao: null, restrito: true }
        : { ...row, restrito: false }
    ));

    const intercorrencias = db.prepare(`
      SELECT i.id, i.tipo, i.descricao, i.registrado_em, o.id AS ordem_id, o.numero AS ordem_numero,
             eq.tag AS equipamento, e.nome AS equipe, u.nome AS enviado_por
      FROM intercorrencias_om i
      JOIN ordens o ON o.id = i.ordem_id
      LEFT JOIN equipamentos eq ON eq.id = o.equipamento_id
      LEFT JOIN usuarios u ON u.id = i.usuario_id
      LEFT JOIN equipes e ON e.id = COALESCE(u.equipe_id, o.equipe_id)
      WHERE date(i.registrado_em, 'localtime') >= ? AND date(i.registrado_em, 'localtime') < ?
      ORDER BY i.id DESC
    `).all(semana, proxima);

    res.json({
      semana: { inicio: semana, fim: addDays(semana, 6) },
      equipes,
      total: { ...total, hh_liquido: totalIndex.liquido, iamot: totalIndex.iamot },
      ocorrencias,
      intercorrencias,
    });
  });

  router.put("/hh-disponivel", gestao, (req, res) => {
    const body = req.body || {};
    const equipeId = Number(body.equipe_id);
    const semana = weekStart(body.semana);
    const team = db.prepare("SELECT id, nome FROM equipes WHERE id = ?").get(equipeId);
    if (!team) return res.status(400).json({ error: "Selecione uma equipe cadastrada." });
    if (!semana) return res.status(400).json({ error: "Informe a semana (AAAA-MM-DD)." });

    const clear = body.hh_disponivel === "" || body.hh_disponivel == null;
    const horas = Number(body.hh_disponivel);
    if (!clear && (!Number.isFinite(horas) || horas < 0 || horas > 100000)) {
      return res.status(400).json({ error: "Informe um HH disponível válido (zero ou mais)." });
    }

    db.transaction(() => {
      if (clear) {
        db.prepare("DELETE FROM hh_disponivel WHERE equipe_id = ? AND semana_inicio = ?").run(equipeId, semana);
      } else {
        db.prepare(`
          INSERT INTO hh_disponivel (equipe_id, semana_inicio, hh_disponivel, registrado_por, atualizado_em)
          VALUES (?, ?, ?, ?, datetime('now'))
          ON CONFLICT(equipe_id, semana_inicio) DO UPDATE SET
            hh_disponivel = excluded.hh_disponivel,
            registrado_por = excluded.registrado_por,
            atualizado_em = datetime('now')
        `).run(equipeId, semana, horas, req.user.id);
      }
      audit(req.user.id, "lancar_hh_disponivel", "equipe", equipeId, `${semana} · ${clear ? "removido" : `${horas} h`}`);
    }).immediate();

    res.json({ ok: true, equipe_id: equipeId, semana, hh_disponivel: clear ? null : horas });
  });

  // Executante: pessoas (usuários) da própria equipe e as ocorrências que ele mesmo enviou.
  router.get("/minhas-ocorrencias", campo, (req, res) => {
    const equipeId = userTeamId(req);
    const equipe = equipeId ? db.prepare("SELECT id, nome FROM equipes WHERE id = ?").get(equipeId) : null;
    res.json({
      equipe: equipe || null,
      tipos_ocorrencia: TIPOS_OCORRENCIA,
      colaboradores: equipe
        ? db.prepare(`
            SELECT MIN(c.id) AS id, u.nome, u.username
            FROM usuarios u JOIN colaboradores c ON c.usuario_id = u.id
            WHERE u.equipe_id = ? AND u.ativo = 1 GROUP BY u.id ORDER BY u.nome
          `).all(equipe.id)
        : [],
      ocorrencias: db.prepare(`
        SELECT oc.id, COALESCE(p.nome, c.nome) AS colaborador, oc.tipo, oc.data_inicio,
               COALESCE(oc.data_fim, oc.data_inicio) AS data_fim, oc.horas_dia, oc.observacao, oc.criado_em
        FROM ocorrencias_hh oc JOIN colaboradores c ON c.id = oc.colaborador_id
        LEFT JOIN usuarios p ON p.id = c.usuario_id
        WHERE oc.registrado_por = ? ORDER BY oc.id DESC LIMIT 50
      `).all(req.user.id),
    });
  });

  router.post("/ocorrencias", campo, (req, res) => {
    const body = req.body || {};
    const tipo = String(body.tipo || "").trim();
    if (!TIPOS_OCORRENCIA.includes(tipo)) return res.status(400).json({ error: "Tipo de ocorrência inválido." });
    const equipeId = userTeamId(req);
    if (!equipeId) return res.status(400).json({ error: "Seu usuário não está vinculado a uma equipe. Procure o CCM." });
    const colaborador = db.prepare(`
      SELECT c.id, u.equipe_id FROM colaboradores c JOIN usuarios u ON u.id = c.usuario_id WHERE c.id = ?
    `).get(Number(body.colaborador_id));
    if (!colaborador) return res.status(400).json({ error: "Selecione um usuário cadastrado." });
    if (colaborador.equipe_id !== equipeId) return res.status(403).json({ error: "Só é possível enviar ocorrências de pessoas da sua equipe." });
    const inicio = String(body.data_inicio || "").trim();
    const fim = String(body.data_fim || "").trim() || inicio;
    if (!parseIsoDate(inicio) || !parseIsoDate(fim)) return res.status(400).json({ error: "Informe datas válidas para a ocorrência." });
    if (fim < inicio) return res.status(400).json({ error: "A data final não pode ser anterior à inicial." });
    const horasDia = body.horas_dia === "" || body.horas_dia == null ? 8 : Number(body.horas_dia);
    if (!Number.isFinite(horasDia) || horasDia <= 0 || horasDia > 24) {
      return res.status(400).json({ error: "Informe as horas por dia (entre 0 e 24)." });
    }

    const created = db.transaction(() => {
      const info = db.prepare(`
        INSERT INTO ocorrencias_hh (colaborador_id, tipo, data_inicio, data_fim, horas_dia, observacao, registrado_por, criado_em)
        VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(colaborador.id, tipo, inicio, fim, horasDia, String(body.observacao || "").trim().slice(0, 500) || null, req.user.id);
      // O tipo fica fora da trilha de auditoria para não expor o dado sensível.
      audit(req.user.id, "registrar_ocorrencia_hh", "ocorrencia_hh", info.lastInsertRowid, `Colaborador ${colaborador.id} · ${inicio} a ${fim}`);
      return { id: info.lastInsertRowid };
    }).immediate();
    res.status(201).json(created);
  });

  // Exclui quem enviou (correção de engano) ou o CCM.
  router.delete("/ocorrencias/:id", requireRole("EXECUTANTE", "CCM"), (req, res) => {
    const row = db.prepare("SELECT id, colaborador_id, registrado_por FROM ocorrencias_hh WHERE id = ?").get(req.params.id);
    if (!row || (req.user.papel === "EXECUTANTE" && row.registrado_por !== req.user.id)) {
      return res.status(404).json({ error: "Ocorrência não encontrada." });
    }
    db.transaction(() => {
      db.prepare("DELETE FROM ocorrencias_hh WHERE id = ?").run(row.id);
      audit(req.user.id, "excluir_ocorrencia_hh", "ocorrencia_hh", row.id, `Colaborador ${row.colaborador_id}`);
    }).immediate();
    res.status(204).end();
  });

  return router;
}
