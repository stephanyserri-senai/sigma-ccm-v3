// Trilha de auditoria (governança / LGPD): só inclusão e consulta.
import { sql } from "../connection.js";

export const record = ({ usuarioId, acao, entidade, entidadeId, detalhe }) =>
  sql("INSERT INTO trilha_auditoria (usuario_id, acao, entidade, entidade_id, detalhe) VALUES (?,?,?,?,?)")
    .run(usuarioId, acao, entidade, entidadeId, detalhe);

export const listUsersWithEntries = () => sql(`
  SELECT u.id, u.nome, u.username, u.papel FROM usuarios u
  WHERE EXISTS (SELECT 1 FROM trilha_auditoria t WHERE t.usuario_id = u.id) ORDER BY u.nome
`).all();

export const countByAction = () => sql("SELECT acao, COUNT(*) AS total FROM trilha_auditoria GROUP BY acao ORDER BY acao").all();

// Filtros: { usuario, acao, de, ate } (datas locais AAAA-MM-DD; a trilha grava em UTC).
const WHERE = `
  WHERE (@usuario IS NULL OR t.usuario_id = @usuario)
    AND (@acao IS NULL OR t.acao = @acao)
    AND (@de IS NULL OR date(t.data_hora, 'localtime') >= @de)
    AND (@ate IS NULL OR date(t.data_hora, 'localtime') <= @ate)`;

export const count = (filtros) => sql(`SELECT COUNT(*) AS total FROM trilha_auditoria t ${WHERE}`).get(filtros).total;

export const page = (filtros, { limite, deslocamento }) => sql(`
  SELECT t.id, t.data_hora, t.acao, t.entidade, t.entidade_id, t.detalhe,
         t.usuario_id, u.nome AS usuario_nome, u.username, u.papel
  FROM trilha_auditoria t LEFT JOIN usuarios u ON u.id = t.usuario_id
  ${WHERE}
  ORDER BY t.id DESC LIMIT @limite OFFSET @deslocamento
`).all({ ...filtros, limite, deslocamento });
