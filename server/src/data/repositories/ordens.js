// Ordens de manutenção (OM): núcleo do fluxo nota → OM → programação → execução → encerramento.
import { sql } from "../connection.js";

// Lista geral; com `somenteDoResponsavel`, apenas as OMs atribuídas a `usuarioId`.
export const list = ({ somenteDoResponsavel, usuarioId }) => sql(
  `SELECT o.*, e.tag AS equipamento, eq.nome AS equipe, p.descricao AS plano_descricao
          , u.nome AS executante_nome, u.username AS executante_username
          , (SELECT apropriante.nome FROM apontamentos ap JOIN usuarios apropriante ON apropriante.id = ap.usuario_id
             WHERE ap.ordem_id = o.id AND ap.tipo = 'Apropriação' ORDER BY ap.id DESC LIMIT 1) AS apropriado_por
   FROM ordens o LEFT JOIN equipamentos e ON e.id = o.equipamento_id
  LEFT JOIN equipes eq ON eq.id = o.equipe_id
  LEFT JOIN usuarios u ON u.id = o.responsavel_id
  LEFT JOIN planos_preventivos p ON p.id = o.plano_id
   WHERE (? = 0 OR o.responsavel_id = ?) ORDER BY o.id DESC`,
).all(somenteDoResponsavel ? 1 : 0, usuarioId);

export const findDetail = (id) => sql(
  `SELECT o.*, e.tag AS equipamento, eq.nome AS equipe,
          u.nome AS executante_nome, u.username AS executante_username,
          p.descricao AS plano_descricao, p.periodicidade AS plano_periodicidade
   FROM ordens o LEFT JOIN equipamentos e ON e.id = o.equipamento_id
   LEFT JOIN equipes eq ON eq.id = o.equipe_id
   LEFT JOIN usuarios u ON u.id = o.responsavel_id
   LEFT JOIN planos_preventivos p ON p.id = o.plano_id WHERE o.id = ?`,
).get(id);

export const findById = (id) => sql("SELECT * FROM ordens WHERE id = ?").get(id);
export const findSummary = (id) => sql("SELECT id, numero, status FROM ordens WHERE id = ?").get(id);
export const findAccess = (id) => sql("SELECT id, responsavel_id, status FROM ordens WHERE id = ?").get(id);
export const findForForms = (id) => sql("SELECT id, numero, status, responsavel_id, equipamento_id FROM ordens WHERE id = ?").get(id);
export const findForPermit = (id) => sql("SELECT id, numero, status, responsavel_id, equipamento_id, exige_pt FROM ordens WHERE id = ?").get(id);
export const findTypeAndClass = (id) => sql(`
  SELECT o.id, o.tipo, e.classe FROM ordens o LEFT JOIN equipamentos e ON e.id = o.equipamento_id WHERE o.id = ?
`).get(id);

// Maior número numérico já usado (ou null, se não houver OMs).
export const maxNumero = () => sql("SELECT MAX(CAST(numero AS INTEGER)) m FROM ordens").get().m;

export const createFromNote = ({ numero, tipo, equipamentoId, notaId, equipeId }) => sql(
  `INSERT INTO ordens (numero, tipo, status, equipamento_id, nota_id, equipe_id, hh_previsto, data_programada)
   VALUES (?,?, 'Aberta', ?,?,?, 4, NULL)`,
).run(numero, tipo, equipamentoId, notaId, equipeId).lastInsertRowid;

export const createFromPlan = ({ numero, equipamentoId, planoId, equipeId, dataProgramada }) => sql(`
  INSERT INTO ordens (numero, tipo, status, equipamento_id, plano_id, equipe_id, hh_previsto, data_programada)
  VALUES (?, 'Preventiva', 'Programada', ?, ?, ?, 4, ?)
`).run(numero, equipamentoId, planoId, equipeId, dataProgramada).lastInsertRowid;

export const updateSchedule = (id, { inicio, fim, planoId, status }) =>
  sql("UPDATE ordens SET data_programada = ?, data_fim_programada = ?, plano_id = ?, status = ? WHERE id = ?")
    .run(inicio, fim, planoId, status, id);

export const distribute = (id, { status, responsavelId }) =>
  sql("UPDATE ordens SET status = ?, responsavel_id = ? WHERE id = ?").run(status, responsavelId, id).changes;

export const updateStatus = (id, { status, encerramento }) =>
  sql("UPDATE ordens SET status = ?, data_encerramento = COALESCE(?, data_encerramento) WHERE id = ?").run(status, encerramento, id).changes;

export const markInExecution = (id) => sql("UPDATE ordens SET status = 'Em execução' WHERE id = ?").run(id);

// Encerra com a data de hoje se ainda não estiver encerrada. Devolve as linhas alteradas.
export const closeIfOpen = (id) => sql(`
  UPDATE ordens SET status = 'Encerrada', data_encerramento = strftime('%d/%m/%Y', 'now')
  WHERE id = ? AND status <> 'Encerrada'
`).run(id).changes;

export const setRequiresPermit = (id, exige) => sql("UPDATE ordens SET exige_pt = ? WHERE id = ?").run(exige, id);

// OMs do executante, com equipamento, plano e cronômetro (Início do executante).
export const listAssignedTo = (usuarioId) => sql(`
  SELECT o.id, o.numero, o.tipo, o.status, o.hh_previsto, o.data_programada, o.data_fim_programada, o.exige_pt,
         e.tag AS equipamento, e.descricao AS equipamento_descricao, e.localizacao AS area, e.criticidade,
         p.descricao AS plano,
         x.iniciado_em, x.finalizado_em, x.num_executantes
  FROM ordens o
  LEFT JOIN equipamentos e ON e.id = o.equipamento_id
  LEFT JOIN planos_preventivos p ON p.id = o.plano_id
  LEFT JOIN execucoes_om x ON x.ordem_id = o.id
  WHERE o.responsavel_id = ?
  ORDER BY o.data_programada, o.numero
`).all(usuarioId);

// OMs criadas em [from, to), por área/equipe, com o HH apropriado (relatório em PDF).
export const listForReport = ({ from, to, area, equipeId }) => sql(`
  SELECT o.numero, o.tipo, o.status, e.tag AS equipamento, e.localizacao AS area, eq.nome AS equipe, u.nome AS executante,
         o.data_programada, o.data_fim_programada, o.hh_previsto, o.data_encerramento, o.criado_em,
         (SELECT SUM(a.hh_apropriado) FROM apontamentos a WHERE a.ordem_id = o.id AND a.tipo = 'Apropriação') AS hh_apropriado
  FROM ordens o
  LEFT JOIN equipamentos e ON e.id = o.equipamento_id
  LEFT JOIN equipes eq ON eq.id = o.equipe_id
  LEFT JOIN usuarios u ON u.id = o.responsavel_id
  WHERE o.criado_em >= @from AND o.criado_em < @to
    AND (@area IS NULL OR e.localizacao = @area) AND (@equipe IS NULL OR o.equipe_id = @equipe)
  ORDER BY eq.nome, o.criado_em DESC
`).all({ from, to, area, equipe: equipeId });

// OMs não encerradas cujo prazo (término previsto ou data programada) já passou.
export const listOverdue = (hoje) => sql(`
  SELECT o.id, o.numero, o.responsavel_id, COALESCE(o.data_fim_programada, o.data_programada) AS prazo,
         e.tag, e.criticidade
  FROM ordens o LEFT JOIN equipamentos e ON e.id = o.equipamento_id
  WHERE o.status NOT IN ('Encerrada','Cancelada')
    AND o.data_programada GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
    AND COALESCE(o.data_fim_programada, o.data_programada) < ?
`).all(hoje);

export const countOverdue = (hoje) => sql(`
  SELECT COUNT(*) AS total FROM ordens
  WHERE status NOT IN ('Encerrada','Cancelada') AND data_programada GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
    AND COALESCE(data_fim_programada, data_programada) < ?
`).get(hoje).total;

export const countByStatus = (status) => sql("SELECT COUNT(*) AS total FROM ordens WHERE status = ?").get(status).total;

export const countScheduledWithoutExecutante = () =>
  sql("SELECT COUNT(*) AS total FROM ordens WHERE status = 'Programada' AND responsavel_id IS NULL").get().total;
