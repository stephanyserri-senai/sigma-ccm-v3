import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import "dotenv/config";

import { db, seed, USER_COLLABORATOR_SYNC_SQL } from "./db.js";
import { detectar } from "./ia.js";
import { parseIsoDate } from "./iamot.js";
import createCadastrosRouter from "./routes/cadastros.js";
import createEvidenceRouter from "./routes/evidencias.js";
import createDashboardRouter from "./routes/dashboard.js";
import createLaborRouter from "./routes/maoDeObra.js";
import createIndicatorsRouter from "./routes/indicadores.js";
import createExecutionRouter, { loadExecution } from "./routes/execucao.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || "sigma-ccm-dev-secret-change-me";

seed();

const app = express();
app.use(cors());
app.use(express.json());
app.use("/api/dashboard", createDashboardRouter({ db, auth }));
app.use("/api/gestao-cadastros", createCadastrosRouter({ db, auth, requireRole, audit }));
app.use("/api/ordens", createEvidenceRouter({ db, auth, requireRole, audit }));
app.use("/api/ordens", createExecutionRouter({ db, auth, requireRole, audit, registrarApontamento }));
app.use("/api/mao-de-obra", createLaborRouter({ db, auth, requireRole, audit }));
app.use("/api/indicadores", createIndicatorsRouter({ db, auth, requireRole, audit }));

// ---------------------------------------------------------------
// Auth
// ---------------------------------------------------------------
function sign(user) {
  return jwt.sign({ id: user.id, papel: user.papel, nome: user.nome, username: user.username }, JWT_SECRET, { expiresIn: "8h" });
}
function auth(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Não autenticado." });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Sessão inválida ou expirada." });
  }
}
function requireRole(...roles) {
  return (req, res, next) =>
    roles.includes(req.user.papel) ? next() : res.status(403).json({ error: "Acesso não permitido para o seu perfil." });
}
function audit(usuarioId, acao, entidade, entidadeId, detalhe) {
  db.prepare("INSERT INTO trilha_auditoria (usuario_id, acao, entidade, entidade_id, detalhe) VALUES (?,?,?,?,?)")
    .run(usuarioId, acao, entidade || null, entidadeId || null, detalhe || null);
}

app.post("/api/auth/login", (req, res) => {
  const { username, senha } = req.body || {};
  const user = db.prepare("SELECT * FROM usuarios WHERE username = ? AND ativo = 1").get(username || "");
  if (!user || !bcrypt.compareSync(senha || "", user.senha_hash))
    return res.status(401).json({ error: "Usuário ou senha inválidos." });
  audit(user.id, "login", "usuario", user.id, null);
  const equipe = user.equipe_id ? db.prepare("SELECT nome FROM equipes WHERE id = ?").get(user.equipe_id) : null;
  res.json({
    token: sign(user),
    user: { id: user.id, nome: user.nome, papel: user.papel, username: user.username, equipe_id: user.equipe_id, equipe: equipe?.nome || null },
  });
});

app.get("/api/auth/me", auth, (req, res) => {
  const u = db.prepare(`
    SELECT u.id, u.nome, u.papel, u.username, u.email, u.equipe_id, e.nome AS equipe
    FROM usuarios u LEFT JOIN equipes e ON e.id = u.equipe_id WHERE u.id = ?
  `).get(req.user.id);
  res.json(u);
});

// ---------------------------------------------------------------
// Cadastros auxiliares (para selects)
// ---------------------------------------------------------------
app.get("/api/cadastros", auth, (req, res) => {
  res.json({
    equipamentos: db.prepare("SELECT id, tag, descricao FROM equipamentos ORDER BY tag").all(),
    equipes: db.prepare("SELECT id, nome, tipo FROM equipes ORDER BY nome").all(),
    planos: db.prepare(`
      SELECT p.id, p.descricao, p.periodicidade, p.equipamento_id, e.tag AS equipamento
      FROM planos_preventivos p LEFT JOIN equipamentos e ON e.id = p.equipamento_id ORDER BY p.descricao
    `).all(),
    // Colaboradores são os usuários ativos (o id é o do vínculo em colaboradores).
    colaboradores: db.prepare(`
      SELECT MIN(c.id) AS id, u.nome FROM usuarios u JOIN colaboradores c ON c.usuario_id = u.id
      WHERE u.ativo = 1 GROUP BY u.id ORDER BY u.nome
    `).all(),
  });
});

// ---------------------------------------------------------------
// Notas
// ---------------------------------------------------------------
app.get("/api/notas", auth, (req, res) => {
  res.json(db.prepare(
    `SELECT n.*, e.tag AS equipamento FROM notas n LEFT JOIN equipamentos e ON e.id = n.equipamento_id ORDER BY n.id DESC`
  ).all());
});

app.post("/api/notas", auth, (req, res) => {
  const { equipamento_id, descricao, tipo } = req.body || {};
  if (!descricao) return res.status(400).json({ error: "Informe a descrição da nota." });
  const max = db.prepare("SELECT MAX(CAST(numero AS INTEGER)) m FROM notas").get().m || 14233;
  const numero = String(max + 1);
  const info = db.prepare(
    "INSERT INTO notas (numero, equipamento_id, descricao, tipo, status, solicitante_id) VALUES (?,?,?,?, 'Aberta', ?)"
  ).run(numero, equipamento_id || null, descricao, tipo || "Corretiva", req.user.id);
  audit(req.user.id, "abrir_nota", "nota", info.lastInsertRowid, numero);
  res.status(201).json({ id: info.lastInsertRowid, numero });
});

app.post("/api/notas/:id/converter", auth, requireRole("CCM", "PCM"), (req, res) => {
  const nota = db.prepare("SELECT * FROM notas WHERE id = ?").get(req.params.id);
  if (!nota) return res.status(404).json({ error: "Nota não encontrada." });
  if (nota.status !== "Aberta") return res.status(400).json({ error: "A nota já foi convertida." });
  const max = db.prepare("SELECT MAX(CAST(numero AS INTEGER)) m FROM ordens").get().m || 40012352;
  const numero = String(max + 1);
  const equipe = db.prepare("SELECT id FROM equipes ORDER BY id LIMIT 1").get();
  const info = db.prepare(
    `INSERT INTO ordens (numero, tipo, status, equipamento_id, nota_id, equipe_id, hh_previsto, data_programada)
     VALUES (?,?, 'Aberta', ?,?,?, 4, NULL)`
  ).run(numero, nota.tipo, nota.equipamento_id, nota.id, equipe ? equipe.id : null);
  db.prepare("UPDATE notas SET status = 'Em OM' WHERE id = ?").run(nota.id);
  audit(req.user.id, "converter_nota", "ordem", info.lastInsertRowid, numero);
  res.status(201).json({ id: info.lastInsertRowid, numero });
});

// ---------------------------------------------------------------
// Ordens
// ---------------------------------------------------------------
const CONDICOES = ["Apropriação", "Relatório", "Validação"];

function closeOrderIfComplete(orderId, userId) {
  const tipos = new Set(db.prepare("SELECT DISTINCT tipo FROM apontamentos WHERE ordem_id = ?").all(orderId).map((row) => row.tipo));
  if (!CONDICOES.every((condition) => tipos.has(condition))) return false;
  const result = db.prepare(`
    UPDATE ordens SET status = 'Encerrada', data_encerramento = strftime('%d/%m/%Y', 'now')
    WHERE id = ? AND status <> 'Encerrada'
  `).run(orderId);
  if (!result.changes) return false;
  audit(userId, "encerrar_auto", "ordem", orderId, String(orderId));
  return true;
}

app.get("/api/ordens", auth, (req, res) => {
  res.json(db.prepare(
    `SELECT o.*, e.tag AS equipamento, eq.nome AS equipe, p.descricao AS plano_descricao
            , u.nome AS executante_nome, u.username AS executante_username
            , (SELECT apropriante.nome FROM apontamentos ap JOIN usuarios apropriante ON apropriante.id = ap.usuario_id
               WHERE ap.ordem_id = o.id AND ap.tipo = 'Apropriação' ORDER BY ap.id DESC LIMIT 1) AS apropriado_por
     FROM ordens o LEFT JOIN equipamentos e ON e.id = o.equipamento_id
    LEFT JOIN equipes eq ON eq.id = o.equipe_id
    LEFT JOIN usuarios u ON u.id = o.responsavel_id
    LEFT JOIN planos_preventivos p ON p.id = o.plano_id
     WHERE (? = 0 OR o.responsavel_id = ?) ORDER BY o.id DESC`
  ).all(req.user.papel === "EXECUTANTE" ? 1 : 0, req.user.id));
});

app.get("/api/ordens/executantes", auth, requireRole("CCM", "PCM"), (_req, res) => {
  res.json(db.prepare("SELECT id, nome, username FROM usuarios WHERE papel = 'EXECUTANTE' AND ativo = 1 ORDER BY nome").all());
});

app.get("/api/ordens/:id", auth, (req, res) => {
  const o = db.prepare(
    `SELECT o.*, e.tag AS equipamento, eq.nome AS equipe,
            u.nome AS executante_nome, u.username AS executante_username,
            p.descricao AS plano_descricao, p.periodicidade AS plano_periodicidade
     FROM ordens o LEFT JOIN equipamentos e ON e.id = o.equipamento_id
     LEFT JOIN equipes eq ON eq.id = o.equipe_id
     LEFT JOIN usuarios u ON u.id = o.responsavel_id
     LEFT JOIN planos_preventivos p ON p.id = o.plano_id WHERE o.id = ?`
  ).get(req.params.id);
  if (!o) return res.status(404).json({ error: "Ordem não encontrada." });
  if (req.user.papel === "EXECUTANTE" && o.responsavel_id !== req.user.id) {
    return res.status(404).json({ error: "OM não encontrada." });
  }
  const aps = db.prepare(`
    SELECT a.id, a.tipo, a.hh_apropriado, a.descricao, a.data,
           COALESCE(u.nome, c.nome) AS usuario_nome
    FROM apontamentos a
    LEFT JOIN usuarios u ON u.id = a.usuario_id
    LEFT JOIN colaboradores c ON c.id = a.colaborador_id
    WHERE a.ordem_id = ? ORDER BY a.id
  `).all(o.id);
  o.apontamentos = aps;
  o.relatorio = db.prepare("SELECT id, usuario_id, atividade_realizada, resultado, materiais_utilizados, observacoes, indisponibilidade_horas, tempo_reparo_horas, atualizado_em FROM relatorios_execucao WHERE ordem_id = ?")
    .get(o.id) || null;
  o.evidencias = db.prepare("SELECT id, nome_arquivo, tipo_mime, enviado_em FROM evidencias_om WHERE ordem_id = ? ORDER BY id").all(o.id);
  Object.assign(o, loadExecution(db, o.id));
  o.servidor_agora = db.prepare("SELECT datetime('now') AS agora").get().agora;
  const tipos = new Set(aps.map((a) => a.tipo));
  o.condicoes = CONDICOES.map((c) => ({ tipo: c, ok: tipos.has(c) }));
  res.json(o);
});

// Programação: datas e vínculo com o plano de manutenção.
app.patch("/api/ordens/:id/programacao", auth, requireRole("CCM", "PCM"), (req, res) => {
  const order = db.prepare("SELECT id, numero, status FROM ordens WHERE id = ?").get(req.params.id);
  if (!order) return res.status(404).json({ error: "Ordem não encontrada." });
  if (order.status === "Encerrada" || order.status === "Cancelada") {
    return res.status(409).json({ error: `A OM está ${order.status.toLowerCase()} e não pode ser reprogramada.` });
  }
  const body = req.body || {};
  const inicio = String(body.data_programada || "").trim();
  const fim = String(body.data_fim_programada || "").trim() || null;
  if (!parseIsoDate(inicio)) return res.status(400).json({ error: "Informe a data programada." });
  if (fim && !parseIsoDate(fim)) return res.status(400).json({ error: "Informe um término previsto válido." });
  if (fim && fim < inicio) return res.status(400).json({ error: "O término previsto não pode ser anterior à data programada." });
  const planoId = body.plano_id === "" || body.plano_id == null ? null : Number(body.plano_id);
  if (planoId !== null && !db.prepare("SELECT 1 FROM planos_preventivos WHERE id = ?").get(planoId)) {
    return res.status(400).json({ error: "Selecione um plano de manutenção cadastrado." });
  }
  // Só a OM aberta muda de status; a reprogramação mantém a distribuição e a execução.
  const status = order.status === "Aberta" ? "Programada" : order.status;
  db.transaction(() => {
    db.prepare("UPDATE ordens SET data_programada = ?, data_fim_programada = ?, plano_id = ?, status = ? WHERE id = ?")
      .run(inicio, fim, planoId, status, order.id);
    audit(req.user.id, "programar_ordem", "ordem", order.id,
      `OM ${order.numero} · ${inicio}${fim ? ` a ${fim}` : ""} · ${planoId ? `plano ${planoId}` : "sem plano"}`);
  }).immediate();
  res.json({ ok: true, status, data_programada: inicio, data_fim_programada: fim, plano_id: planoId });
});

app.patch("/api/ordens/:id/status", auth, requireRole("CCM", "PCM"), (req, res) => {
  const { status } = req.body || {};
  const valid = ["Aberta", "Programada", "Distribuída", "Em execução", "Encerrada", "Cancelada"];
  if (!valid.includes(status)) return res.status(400).json({ error: "Status inválido." });
  if (status === "Distribuída") {
    const responsavelId = Number(req.body.responsavel_id);
    const executante = db.prepare("SELECT id FROM usuarios WHERE id = ? AND papel = 'EXECUTANTE' AND ativo = 1").get(responsavelId);
    if (!executante) return res.status(400).json({ error: "Selecione um usuário ativo com acesso EXECUTANTE." });
    const info = db.prepare("UPDATE ordens SET status = ?, responsavel_id = ? WHERE id = ?")
      .run(status, responsavelId, req.params.id);
    if (!info.changes) return res.status(404).json({ error: "Ordem não encontrada." });
    audit(req.user.id, "distribuir_ordem", "ordem", Number(req.params.id), `Executante ${responsavelId}`);
    return res.json({ ok: true, responsavel_id: responsavelId });
  }
  const enc = status === "Encerrada" ? "10/07" : null;
  const info = db.prepare("UPDATE ordens SET status = ?, data_encerramento = COALESCE(?, data_encerramento) WHERE id = ?")
    .run(status, enc, req.params.id);
  if (!info.changes) return res.status(404).json({ error: "Ordem não encontrada." });
  audit(req.user.id, "status_ordem", "ordem", Number(req.params.id), status);
  res.json({ ok: true });
});

// ---------------------------------------------------------------
// Apontamentos (detecção IA + encerramento automático)
// ---------------------------------------------------------------
// Deve ser chamada dentro de uma transação.
function registrarApontamento(om, user, tipo, horas, descricao = null) {
  const duplicate = db.prepare("SELECT id FROM apontamentos WHERE ordem_id = ? AND tipo = ?").get(om.id, tipo);
  if (duplicate) throw Object.assign(new Error("Este registro já existe para a OM."), { code: "DUPLICATE_APONTAMENTO" });
  const info = db.prepare(`
    INSERT INTO apontamentos (ordem_id, usuario_id, tipo, hh_apropriado, descricao)
    VALUES (?, ?, ?, ?, ?)
  `).run(om.id, user.id, tipo, horas, descricao);
  audit(user.id, "apontar", "apontamento", info.lastInsertRowid, `OM ${om.numero} · ${tipo}`);

  let sinal = null;
  if (tipo === "Apropriação") {
    const flag = detectar(horas, om.hh_previsto);
    if (flag) {
      const signal = db.prepare(`
        INSERT INTO sinalizacoes_ia (entidade_tipo, entidade_id, ordem_numero, campo, valor_atual, valor_sugerido, tipo, score, explicacao, status)
        VALUES ('apontamento', ?, ?, 'HH apropriado', ?, ?, ?, ?, ?, 'Nova')
      `).run(info.lastInsertRowid, om.numero, horas, flag.sugerido, flag.tipo, flag.score, JSON.stringify(flag.fatores));
      sinal = { id: signal.lastInsertRowid, tipo: flag.tipo, score: flag.score };
    }
  }
  if (om.status !== "Em execução" && om.status !== "Encerrada") {
    db.prepare("UPDATE ordens SET status = 'Em execução' WHERE id = ?").run(om.id);
  }
  const encerrada = closeOrderIfComplete(om.id, user.id);
  return { id: info.lastInsertRowid, sinal, encerrada, ordem_numero: om.numero, usuario_nome: user.nome };
}

app.post("/api/apontamentos", auth, requireRole("EXECUTANTE"), (req, res) => {
  const { ordem_id, tipo, hh } = req.body || {};
  const om = db.prepare("SELECT * FROM ordens WHERE id = ?").get(ordem_id);
  if (!om) return res.status(404).json({ error: "Ordem não encontrada." });
  if (om.responsavel_id !== req.user.id) return res.status(403).json({ error: "Esta OM não está atribuída a você." });
  if (om.status === "Encerrada") return res.status(409).json({ error: "A OM já está encerrada." });
  if (!CONDICOES.includes(tipo) || tipo === "Relatório") return res.status(400).json({ error: "Tipo de registro inválido. O relatório deve ser enviado pelo formulário da OM." });
  const horas = Number(hh);
  if (!Number.isFinite(horas) || horas < 0 || (tipo === "Apropriação" && horas === 0)) {
    return res.status(400).json({ error: "Informe uma quantidade válida de horas." });
  }

  try {
    const result = db.transaction(() => {
      // Com o cronômetro em andamento, o HH vem da finalização da execução, não de digitação.
      if (tipo === "Apropriação" && db.prepare("SELECT 1 FROM execucoes_om WHERE ordem_id = ? AND finalizado_em IS NULL").get(om.id)) {
        throw Object.assign(new Error("A OM está em andamento: finalize a execução para apropriar o HH."), { code: "DUPLICATE_APONTAMENTO" });
      }
      return registrarApontamento(om, req.user, tipo, horas);
    }).immediate();
    res.status(201).json(result);
  } catch (error) {
    if (error.code === "DUPLICATE_APONTAMENTO") return res.status(409).json({ error: error.message });
    throw error;
  }
});

app.put("/api/ordens/:id/relatorio", auth, requireRole("EXECUTANTE"), (req, res) => {
  const order = db.prepare("SELECT * FROM ordens WHERE id = ?").get(req.params.id);
  if (!order || order.responsavel_id !== req.user.id) return res.status(404).json({ error: "OM não encontrada ou não atribuída a você." });
  if (order.status === "Encerrada") return res.status(409).json({ error: "A OM já está encerrada." });
  const body = req.body || {};
  const atividade = String(body.atividade_realizada || "").trim();
  if (!atividade) return res.status(400).json({ error: "Descreva a atividade realizada." });
  const downtime = body.indisponibilidade_horas === "" || body.indisponibilidade_horas == null ? null : Number(body.indisponibilidade_horas);
  const repairTime = body.tempo_reparo_horas === "" || body.tempo_reparo_horas == null ? null : Number(body.tempo_reparo_horas);
  if ([downtime, repairTime].some((value) => value !== null && (!Number.isFinite(value) || value < 0))) {
    return res.status(400).json({ error: "Informe durações válidas em horas (zero ou mais)." });
  }

  const report = db.transaction(() => {
    const saved = db.prepare(`
      INSERT INTO relatorios_execucao
        (ordem_id, usuario_id, atividade_realizada, resultado, materiais_utilizados, observacoes, indisponibilidade_horas, tempo_reparo_horas, atualizado_em)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(ordem_id) DO UPDATE SET
        usuario_id = excluded.usuario_id,
        atividade_realizada = excluded.atividade_realizada,
        resultado = excluded.resultado,
        materiais_utilizados = excluded.materiais_utilizados,
        observacoes = excluded.observacoes,
        indisponibilidade_horas = excluded.indisponibilidade_horas,
        tempo_reparo_horas = excluded.tempo_reparo_horas,
        atualizado_em = datetime('now')
    `).run(order.id, req.user.id, atividade, body.resultado || null, body.materiais_utilizados || null,
      body.observacoes || null, downtime, repairTime);
    db.prepare(`
      INSERT INTO apontamentos (ordem_id, usuario_id, tipo, hh_apropriado, descricao)
      SELECT ?, ?, 'Relatório', 0, ?
      WHERE NOT EXISTS (SELECT 1 FROM apontamentos WHERE ordem_id = ? AND tipo = 'Relatório')
    `).run(order.id, req.user.id, atividade, order.id);
    if (order.status !== "Em execução" && order.status !== "Encerrada") {
      db.prepare("UPDATE ordens SET status = 'Em execução' WHERE id = ?").run(order.id);
    }
    audit(req.user.id, "salvar_relatorio_om", "ordem", order.id, `Relatório ${saved.lastInsertRowid}`);
    const encerrada = closeOrderIfComplete(order.id, req.user.id);
    return { id: saved.lastInsertRowid, encerrada };
  }).immediate();

  res.json(report);
});

// ---------------------------------------------------------------
// Sinalizações IA
// ---------------------------------------------------------------
app.get("/api/sinalizacoes", auth, (req, res) => {
  const rows = db.prepare("SELECT * FROM sinalizacoes_ia ORDER BY id DESC").all();
  rows.forEach((r) => { try { r.fatores = JSON.parse(r.explicacao || "[]"); } catch { r.fatores = []; } });
  res.json(rows);
});

app.post("/api/sinalizacoes/:id/aceitar", auth, (req, res) => {
  const s = db.prepare("SELECT * FROM sinalizacoes_ia WHERE id = ?").get(req.params.id);
  if (!s) return res.status(404).json({ error: "Sinalização não encontrada." });
  if (s.entidade_tipo === "apontamento" && s.entidade_id)
    db.prepare("UPDATE apontamentos SET hh_apropriado = ? WHERE id = ?").run(s.valor_sugerido, s.entidade_id);
  db.prepare("UPDATE sinalizacoes_ia SET status = 'Aceita', valor_atual = valor_sugerido WHERE id = ?").run(s.id);
  audit(req.user.id, "aceitar_sinal", "sinalizacao", s.id, s.tipo);
  res.json({ ok: true });
});

app.post("/api/sinalizacoes/:id/rejeitar", auth, (req, res) => {
  db.prepare("UPDATE sinalizacoes_ia SET status = 'Rejeitada' WHERE id = ?").run(req.params.id);
  audit(req.user.id, "rejeitar_sinal", "sinalizacao", Number(req.params.id), null);
  res.json({ ok: true });
});

// ---------------------------------------------------------------
// Usuários (cadastro — restrito ao papel CCM)
// ---------------------------------------------------------------
app.get("/api/usuarios", auth, requireRole("CCM"), (req, res) => {
  res.json(db.prepare(`
    SELECT u.id, u.nome, u.email, u.username, u.papel, u.ativo, u.criado_em, u.equipe_id, e.nome AS equipe
    FROM usuarios u LEFT JOIN equipes e ON e.id = u.equipe_id ORDER BY u.id
  `).all());
});

const findTeam = (id) => db.prepare("SELECT id, nome FROM equipes WHERE id = ?").get(Number(id));

app.post("/api/usuarios", auth, requireRole("CCM"), (req, res) => {
  const { nome, username, senha, papel, email, equipe_id } = req.body || {};
  if (!nome || !username || !senha) return res.status(400).json({ error: "Nome, usuário e senha são obrigatórios." });
  if (!["CCM", "PCM", "EXECUTANTE"].includes(papel)) return res.status(400).json({ error: "Papel inválido." });
  const equipe = findTeam(equipe_id);
  if (!equipe) return res.status(400).json({ error: "Selecione uma equipe cadastrada para o usuário." });
  const existe = db.prepare("SELECT id FROM usuarios WHERE username = ?").get(username);
  if (existe) return res.status(409).json({ error: "Este usuário já existe." });
  try {
    const info = db.prepare(
      "INSERT INTO usuarios (nome, email, username, senha_hash, papel, equipe_id) VALUES (?,?,?,?,?,?)"
    ).run(nome, email || null, username, bcrypt.hashSync(senha, 10), papel, equipe.id);
    db.exec(USER_COLLABORATOR_SYNC_SQL);
    audit(req.user.id, "criar_usuario", "usuario", info.lastInsertRowid, `${username} · ${equipe.nome}`);
    res.status(201).json({ id: info.lastInsertRowid });
  } catch (e) {
    res.status(400).json({ error: "Não foi possível criar o usuário." });
  }
});

app.patch("/api/usuarios/:id/equipe", auth, requireRole("CCM"), (req, res) => {
  const equipe = findTeam((req.body || {}).equipe_id);
  if (!equipe) return res.status(400).json({ error: "Selecione uma equipe cadastrada para o usuário." });
  const info = db.prepare("UPDATE usuarios SET equipe_id = ? WHERE id = ?").run(equipe.id, req.params.id);
  if (!info.changes) return res.status(404).json({ error: "Usuário não encontrado." });
  db.prepare("UPDATE colaboradores SET equipe_id = ? WHERE id = (SELECT MIN(id) FROM colaboradores WHERE usuario_id = ?)")
    .run(equipe.id, req.params.id);
  audit(req.user.id, "vincular_equipe_usuario", "usuario", Number(req.params.id), equipe.nome);
  res.json({ ok: true, equipe_id: equipe.id, equipe: equipe.nome });
});

// ---------------------------------------------------------------
// Servir o frontend buildado (produção)
// ---------------------------------------------------------------
const clientDist = join(__dirname, "..", "..", "client", "dist");
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get(/^(?!\/api).*/, (req, res) => res.sendFile(join(clientDist, "index.html")));
}

app.listen(PORT, () => console.log(`SIGMA-CCM API em http://localhost:${PORT}`));
