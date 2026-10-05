import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { PARAMETERS } from "./parametros.js";
import { EXAMPLE_FORM, EXAMPLE_INSPECTION, EXAMPLE_PERMIT } from "./formularios-exemplo.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || join(__dirname, "..", "sigma-ccm.db");

export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

const schema = readFileSync(join(__dirname, "..", "schema.sql"), "utf-8");
db.exec(schema);

function quoteIdentifier(identifier) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Identificador SQLite inválido: ${identifier}`);
  }
  return `"${identifier}"`;
}

export function ensureColumn(table, column, defSQL) {
  const tableName = quoteIdentifier(table);
  const columnName = quoteIdentifier(column);
  const definition = String(defSQL).trim();
  const defaultValue = definition.match(/\bDEFAULT\s+('(?:''|[^'])*'|"(?:""|[^"])*"|-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?|NULL|TRUE|FALSE)(?=\s|$)/i);

  if (!definition || definition.includes(";") || /\bDEFAULT\b/i.test(definition) && !defaultValue) {
    throw new Error(`Definição de coluna inválida ou com DEFAULT não constante: ${defSQL}`);
  }
  if (/\bNOT\s+NULL\b/i.test(definition) && !defaultValue) {
    throw new Error(`Coluna NOT NULL precisa de DEFAULT constante: ${table}.${column}`);
  }

  const columns = db.pragma(`table_info(${tableName})`);
  if (columns.some((item) => item.name === column)) return false;

  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  return true;
}

export function runMigration(id, fn) {
  if (typeof id !== "string" || !id.trim() || typeof fn !== "function") {
    throw new TypeError("Migração requer um id não vazio e uma função síncrona.");
  }

  return db.transaction(() => {
    const applied = db.prepare("SELECT 1 FROM schema_migrations WHERE id = ?").get(id);
    if (applied) return false;

    const result = fn();
    if (result && typeof result.then === "function") {
      throw new TypeError(`Migração ${id} deve ser síncrona.`);
    }

    db.prepare("INSERT INTO schema_migrations (id) VALUES (?)").run(id);
    return true;
  }).immediate();
}

// Usuário sem equipe herda a equipe do colaborador ao qual está vinculado.
const USER_TEAM_BACKFILL_SQL = `
  UPDATE usuarios SET equipe_id = (
    SELECT c.equipe_id FROM colaboradores c
    WHERE c.usuario_id = usuarios.id AND c.equipe_id IS NOT NULL ORDER BY c.id LIMIT 1
  ) WHERE equipe_id IS NULL
`;

// Colaborador = usuário: cada usuário tem uma linha em colaboradores (ponte das FKs de ocorrências e apontamentos).
export const USER_COLLABORATOR_SYNC_SQL = `
  INSERT INTO colaboradores (nome, equipe_id, usuario_id)
  SELECT u.nome, u.equipe_id, u.id FROM usuarios u
  WHERE NOT EXISTS (SELECT 1 FROM colaboradores c WHERE c.usuario_id = u.id)
`;

export const migrations = [
  {
    id: "2026-10-02_additive_compatibility_columns",
    fn: () => {
      ensureColumn("usuarios", "email", "TEXT");
      ensureColumn("usuarios", "ativo", "INTEGER NOT NULL DEFAULT 1");
      ensureColumn("ordens", "data_encerramento", "TEXT");
      ensureColumn("sinalizacoes_ia", "explicacao", "TEXT");
      ensureColumn("trilha_auditoria", "detalhe", "TEXT");
    },
  },
  {
    id: "2026-10-02_equipment_tag_unique_index",
    fn: () => {
      db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_equipamentos_tag_unique ON equipamentos(tag)");
    },
  },
  {
    id: "2026-10-02_om_execution_and_evidence",
    fn: () => {
      ensureColumn("ordens", "responsavel_id", "INTEGER REFERENCES usuarios(id)");
      ensureColumn("apontamentos", "usuario_id", "INTEGER REFERENCES usuarios(id)");
      ensureColumn("planos_preventivos", "equipe_id", "INTEGER REFERENCES equipes(id)");
      db.exec(`
        CREATE TABLE IF NOT EXISTS relatorios_execucao (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ordem_id INTEGER NOT NULL UNIQUE REFERENCES ordens(id) ON DELETE CASCADE,
          usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
          atividade_realizada TEXT NOT NULL,
          resultado TEXT,
          materiais_utilizados TEXT,
          observacoes TEXT,
          atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS evidencias_om (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ordem_id INTEGER NOT NULL REFERENCES ordens(id) ON DELETE CASCADE,
          usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
          nome_arquivo TEXT NOT NULL,
          tipo_mime TEXT NOT NULL,
          conteudo BLOB NOT NULL,
          enviado_em TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_ordens_responsavel ON ordens(responsavel_id);
        CREATE INDEX IF NOT EXISTS idx_evidencias_ordem ON evidencias_om(ordem_id);
      `);
    },
  },
  {
    id: "2026-10-02_reliability_duration_fields",
    fn: () => {
      ensureColumn("relatorios_execucao", "indisponibilidade_horas", "REAL");
      ensureColumn("relatorios_execucao", "tempo_reparo_horas", "REAL");
    },
  },
  {
    id: "2026-10-02_labor_availability_and_user_team",
    fn: () => {
      ensureColumn("usuarios", "equipe_id", "INTEGER REFERENCES equipes(id)");
      ensureColumn("ocorrencias_hh", "horas_dia", "REAL NOT NULL DEFAULT 8");
      ensureColumn("ocorrencias_hh", "observacao", "TEXT");
      ensureColumn("ocorrencias_hh", "registrado_por", "INTEGER REFERENCES usuarios(id)");
      ensureColumn("ocorrencias_hh", "criado_em", "TEXT");
      db.exec(`
        CREATE TABLE IF NOT EXISTS hh_disponivel (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          equipe_id INTEGER NOT NULL REFERENCES equipes(id),
          semana_inicio TEXT NOT NULL,
          hh_disponivel REAL NOT NULL,
          registrado_por INTEGER REFERENCES usuarios(id),
          atualizado_em TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE (equipe_id, semana_inicio)
        );
        CREATE INDEX IF NOT EXISTS idx_hh_disponivel_semana ON hh_disponivel(semana_inicio);
        CREATE INDEX IF NOT EXISTS idx_ocorrencias_colaborador ON ocorrencias_hh(colaborador_id);
        CREATE INDEX IF NOT EXISTS idx_usuarios_equipe ON usuarios(equipe_id);
      `);
      db.exec(USER_TEAM_BACKFILL_SQL);
    },
  },
  {
    id: "2026-10-02_om_execution_timer",
    fn: () => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS execucoes_om (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ordem_id INTEGER NOT NULL UNIQUE REFERENCES ordens(id) ON DELETE CASCADE,
          usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
          num_executantes INTEGER NOT NULL,
          iniciado_em TEXT NOT NULL DEFAULT (datetime('now')),
          finalizado_em TEXT,
          duracao_horas REAL,
          hh_calculado REAL,
          apontamento_id INTEGER REFERENCES apontamentos(id) ON DELETE SET NULL
        );
        CREATE TABLE IF NOT EXISTS execucao_executantes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          execucao_id INTEGER NOT NULL REFERENCES execucoes_om(id) ON DELETE CASCADE,
          nome TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS intercorrencias_om (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ordem_id INTEGER NOT NULL REFERENCES ordens(id) ON DELETE CASCADE,
          execucao_id INTEGER REFERENCES execucoes_om(id) ON DELETE CASCADE,
          usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
          tipo TEXT NOT NULL CHECK (tipo IN ('Desvio','Alteração de rota','Alteração de serviço','Outro')),
          descricao TEXT NOT NULL,
          registrado_em TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_execucao_executantes ON execucao_executantes(execucao_id);
        CREATE INDEX IF NOT EXISTS idx_intercorrencias_ordem ON intercorrencias_om(ordem_id);
      `);
    },
  },
  {
    id: "2026-10-02_users_as_collaborators",
    fn: () => {
      db.exec("CREATE INDEX IF NOT EXISTS idx_colaboradores_usuario ON colaboradores(usuario_id)");
      db.exec(USER_COLLABORATOR_SYNC_SQL);
    },
  },
  {
    id: "2026-10-02_order_schedule_end_date",
    fn: () => {
      ensureColumn("ordens", "data_fim_programada", "TEXT");
      db.exec("CREATE INDEX IF NOT EXISTS idx_ordens_plano ON ordens(plano_id)");
    },
  },
  {
    id: "2026-10-05_kpi_reference_parameters",
    fn: () => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS parametros_kpi (
          chave TEXT PRIMARY KEY,
          valor REAL NOT NULL,
          atualizado_por INTEGER REFERENCES usuarios(id),
          atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
      // Valores de exemplo; o perfil CCM ajusta em "Metas dos KPIs".
      const insert = db.prepare("INSERT OR IGNORE INTO parametros_kpi (chave, valor) VALUES (?, ?)");
      PARAMETERS.forEach((item) => insert.run(item.chave, item.padrao));
    },
  },
  {
    id: "2026-10-05_planning_and_shift_handover",
    fn: () => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS programacao_atividades (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ordem_id INTEGER NOT NULL REFERENCES ordens(id) ON DELETE CASCADE,
          equipe_id INTEGER NOT NULL REFERENCES equipes(id),
          data TEXT NOT NULL,
          hh_previsto REAL NOT NULL,
          observacao TEXT,
          criado_por INTEGER REFERENCES usuarios(id),
          criado_em TEXT NOT NULL DEFAULT (datetime('now')),
          atualizado_em TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_programacao_data ON programacao_atividades(data);
        CREATE INDEX IF NOT EXISTS idx_programacao_ordem ON programacao_atividades(ordem_id);
        CREATE TABLE IF NOT EXISTS passagens_turno (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          data TEXT NOT NULL,
          turno TEXT NOT NULL CHECK (turno IN ('Manhã','Tarde','Noite')),
          equipe_id INTEGER REFERENCES equipes(id),
          autor_id INTEGER NOT NULL REFERENCES usuarios(id),
          ocorrencias TEXT,
          feito TEXT NOT NULL,
          pendencias TEXT,
          avisos TEXT,
          criado_em TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_passagens_data ON passagens_turno(data);
        CREATE TABLE IF NOT EXISTS passagens_turno_leituras (
          passagem_id INTEGER NOT NULL REFERENCES passagens_turno(id) ON DELETE CASCADE,
          usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
          lido_em TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (passagem_id, usuario_id)
        );
      `);
      // Parâmetros novos (ex.: carga máxima) recebem o valor de exemplo; os já existentes não mudam.
      const insert = db.prepare("INSERT OR IGNORE INTO parametros_kpi (chave, valor) VALUES (?, ?)");
      PARAMETERS.forEach((item) => insert.run(item.chave, item.padrao));
    },
  },
  {
    id: "2026-10-05_dynamic_forms",
    fn: () => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS formularios_modelos (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          nome TEXT NOT NULL,
          tipo TEXT NOT NULL CHECK (tipo IN ('Checklist','Inspeção','Permissão','Formulário livre')),
          descricao TEXT,
          campos TEXT NOT NULL,
          regras TEXT NOT NULL DEFAULT '{}',
          versao INTEGER NOT NULL DEFAULT 1,
          ativo INTEGER NOT NULL DEFAULT 1,
          criado_por INTEGER REFERENCES usuarios(id),
          criado_em TEXT NOT NULL DEFAULT (datetime('now')),
          atualizado_por INTEGER REFERENCES usuarios(id),
          atualizado_em TEXT
        );
        CREATE TABLE IF NOT EXISTS formularios_respostas (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          modelo_id INTEGER NOT NULL REFERENCES formularios_modelos(id),
          modelo_versao INTEGER NOT NULL,
          modelo_nome TEXT NOT NULL,
          modelo_tipo TEXT NOT NULL,
          campos TEXT NOT NULL,
          ordem_id INTEGER REFERENCES ordens(id),
          equipamento_id INTEGER REFERENCES equipamentos(id),
          respostas TEXT NOT NULL,
          nao_conformidades TEXT NOT NULL DEFAULT '[]',
          usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
          criado_em TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS formularios_anexos (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          resposta_id INTEGER NOT NULL REFERENCES formularios_respostas(id) ON DELETE CASCADE,
          campo_id TEXT NOT NULL,
          tipo TEXT NOT NULL CHECK (tipo IN ('foto','assinatura')),
          nome_arquivo TEXT NOT NULL,
          tipo_mime TEXT NOT NULL,
          conteudo BLOB NOT NULL
        );
        CREATE TABLE IF NOT EXISTS ordem_formularios (
          ordem_id INTEGER NOT NULL REFERENCES ordens(id) ON DELETE CASCADE,
          modelo_id INTEGER NOT NULL REFERENCES formularios_modelos(id),
          obrigatorio INTEGER NOT NULL DEFAULT 0,
          vinculado_por INTEGER REFERENCES usuarios(id),
          vinculado_em TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (ordem_id, modelo_id)
        );
        CREATE INDEX IF NOT EXISTS idx_form_respostas_ordem ON formularios_respostas(ordem_id, modelo_id);
        CREATE INDEX IF NOT EXISTS idx_form_respostas_equipamento ON formularios_respostas(equipamento_id);
        CREATE INDEX IF NOT EXISTS idx_form_anexos_resposta ON formularios_anexos(resposta_id);
      `);
      // Um modelo de exemplo, criado uma única vez; o CCM pode editá-lo ou desativá-lo.
      db.prepare("INSERT INTO formularios_modelos (nome, tipo, descricao, campos, regras, atualizado_em) VALUES (?, ?, ?, ?, ?, datetime('now'))")
        .run(EXAMPLE_FORM.nome, EXAMPLE_FORM.tipo, EXAMPLE_FORM.descricao, JSON.stringify(EXAMPLE_FORM.campos), JSON.stringify(EXAMPLE_FORM.regras));
    },
  },
  {
    id: "2026-10-05_inspection_routes_and_work_permits",
    fn: () => {
      ensureColumn("ordens", "exige_pt", "INTEGER NOT NULL DEFAULT 0");
      db.exec(`
        CREATE TABLE IF NOT EXISTS rotas_inspecao (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          nome TEXT NOT NULL,
          descricao TEXT,
          area TEXT,
          ativo INTEGER NOT NULL DEFAULT 1,
          criado_por INTEGER REFERENCES usuarios(id),
          criado_em TEXT NOT NULL DEFAULT (datetime('now')),
          atualizado_por INTEGER REFERENCES usuarios(id),
          atualizado_em TEXT
        );
        CREATE TABLE IF NOT EXISTS rota_pontos (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          rota_id INTEGER NOT NULL REFERENCES rotas_inspecao(id) ON DELETE CASCADE,
          sequencia INTEGER NOT NULL,
          equipamento_id INTEGER NOT NULL REFERENCES equipamentos(id),
          modelo_id INTEGER NOT NULL REFERENCES formularios_modelos(id),
          instrucao TEXT
        );
        CREATE TABLE IF NOT EXISTS rondas_inspecao (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          rota_id INTEGER NOT NULL REFERENCES rotas_inspecao(id),
          rota_nome TEXT NOT NULL,
          usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
          status TEXT NOT NULL DEFAULT 'Em andamento' CHECK (status IN ('Em andamento','Concluída')),
          iniciada_em TEXT NOT NULL DEFAULT (datetime('now')),
          concluida_em TEXT,
          observacao TEXT
        );
        CREATE TABLE IF NOT EXISTS ronda_pontos (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ronda_id INTEGER NOT NULL REFERENCES rondas_inspecao(id) ON DELETE CASCADE,
          sequencia INTEGER NOT NULL,
          equipamento_id INTEGER REFERENCES equipamentos(id),
          modelo_id INTEGER REFERENCES formularios_modelos(id),
          instrucao TEXT,
          status TEXT NOT NULL DEFAULT 'Pendente' CHECK (status IN ('Pendente','Inspecionado','Não inspecionado')),
          resposta_id INTEGER REFERENCES formularios_respostas(id),
          nao_conformidades TEXT NOT NULL DEFAULT '[]',
          motivo TEXT,
          registrado_em TEXT
        );
        CREATE TABLE IF NOT EXISTS permissoes_trabalho (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          numero TEXT NOT NULL UNIQUE,
          ordem_id INTEGER NOT NULL REFERENCES ordens(id),
          modelo_id INTEGER NOT NULL REFERENCES formularios_modelos(id),
          resposta_id INTEGER NOT NULL REFERENCES formularios_respostas(id),
          status TEXT NOT NULL DEFAULT 'Solicitada' CHECK (status IN ('Solicitada','Aprovada','Reprovada','Cancelada','Encerrada')),
          validade_inicio TEXT NOT NULL,
          validade_fim TEXT NOT NULL,
          solicitante_id INTEGER NOT NULL REFERENCES usuarios(id),
          solicitada_em TEXT NOT NULL DEFAULT (datetime('now')),
          aprovador_id INTEGER REFERENCES usuarios(id),
          decidida_em TEXT,
          parecer TEXT,
          encerrada_por INTEGER REFERENCES usuarios(id),
          encerrada_em TEXT,
          observacao_encerramento TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_rota_pontos_rota ON rota_pontos(rota_id, sequencia);
        CREATE INDEX IF NOT EXISTS idx_rondas_usuario ON rondas_inspecao(usuario_id, status);
        CREATE INDEX IF NOT EXISTS idx_ronda_pontos_ronda ON ronda_pontos(ronda_id, sequencia);
        CREATE INDEX IF NOT EXISTS idx_permissoes_ordem ON permissoes_trabalho(ordem_id, status);
      `);
      // Modelos de exemplo (inspeção de rota e APR/PT), criados uma única vez.
      const insert = db.prepare("INSERT INTO formularios_modelos (nome, tipo, descricao, campos, regras, atualizado_em) VALUES (?, ?, ?, ?, ?, datetime('now'))");
      for (const model of [EXAMPLE_INSPECTION, EXAMPLE_PERMIT]) {
        insert.run(model.nome, model.tipo, model.descricao, JSON.stringify(model.campos), JSON.stringify(model.regras));
      }
    },
  },
  {
    id: "2026-10-05_notifications",
    fn: () => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS notificacoes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          chave TEXT NOT NULL UNIQUE,
          tipo TEXT NOT NULL,
          severidade TEXT NOT NULL CHECK (severidade IN ('Crítica','Alta','Média','Baixa')),
          titulo TEXT NOT NULL,
          mensagem TEXT,
          entidade TEXT,
          entidade_id INTEGER,
          link TEXT,
          papeis TEXT NOT NULL DEFAULT 'CCM,PCM',
          usuario_id INTEGER REFERENCES usuarios(id),
          status TEXT NOT NULL DEFAULT 'Aberta' CHECK (status IN ('Aberta','Em tratamento','Resolvida')),
          criada_em TEXT NOT NULL DEFAULT (datetime('now')),
          atualizada_em TEXT,
          resolvida_em TEXT,
          resolvida_por INTEGER REFERENCES usuarios(id),
          resolucao TEXT
        );
        CREATE TABLE IF NOT EXISTS notificacoes_leituras (
          notificacao_id INTEGER NOT NULL REFERENCES notificacoes(id) ON DELETE CASCADE,
          usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
          lida_em TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (notificacao_id, usuario_id)
        );
        CREATE TABLE IF NOT EXISTS notificacoes_destinatarios (
          notificacao_id INTEGER NOT NULL REFERENCES notificacoes(id) ON DELETE CASCADE,
          usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
          incluido_por INTEGER REFERENCES usuarios(id),
          incluido_em TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (notificacao_id, usuario_id)
        );
        CREATE TABLE IF NOT EXISTS notificacoes_acoes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          notificacao_id INTEGER NOT NULL REFERENCES notificacoes(id) ON DELETE CASCADE,
          usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
          tipo TEXT NOT NULL CHECK (tipo IN ('Resposta','Encaminhamento','Resolução')),
          texto TEXT,
          destinatario_id INTEGER REFERENCES usuarios(id),
          criado_em TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_notificacoes_status ON notificacoes(status, severidade);
        CREATE INDEX IF NOT EXISTS idx_notificacoes_usuario ON notificacoes(usuario_id);
        CREATE INDEX IF NOT EXISTS idx_notificacoes_acoes ON notificacoes_acoes(notificacao_id);
      `);
      // Parâmetro novo (antecedência da preventiva) recebe o valor de exemplo.
      const insert = db.prepare("INSERT OR IGNORE INTO parametros_kpi (chave, valor) VALUES (?, ?)");
      PARAMETERS.forEach((item) => insert.run(item.chave, item.padrao));
    },
  },
];

const migrationIds = new Set();
for (const migration of migrations) {
  if (migrationIds.has(migration.id)) throw new Error(`Id de migração duplicado: ${migration.id}`);
  migrationIds.add(migration.id);
  runMigration(migration.id, migration.fn);
}

export function seed() {
  const hash = (password) => bcrypt.hashSync(password, 10);
  const inserted = db.transaction(() => {
    let changes = 0;

    const getOrCreateId = (lookupSql, lookupParams, insertSql, insertParams) => {
      let row = db.prepare(lookupSql).get(...lookupParams);
      if (!row) {
        db.prepare(insertSql).run(...insertParams());
        changes += 1;
        row = db.prepare(lookupSql).get(...lookupParams);
      }
      if (!row) throw new Error(`Não foi possível recuperar o registro seed: ${lookupSql}`);
      return row.id;
    };
    const insertIfMissing = (lookupSql, lookupParams, insertSql, insertParams) => {
      if (db.prepare(lookupSql).get(...lookupParams)) return;
      db.prepare(insertSql).run(...insertParams);
      changes += 1;
    };

    const userId = (username, nome, email, password, papel) => getOrCreateId(
      "SELECT id FROM usuarios WHERE username = ?", [username],
      "INSERT INTO usuarios (nome, email, username, senha_hash, papel) VALUES (?,?,?,?,?)",
      () => [nome, email, username, hash(password), papel]
    );
    const adminId = userId("admin", "Ana Souza", "ana@empresa.com", "admin123", "CCM");
    const userIdPcm = userId("pcm", "Carlos Lima", "carlos@empresa.com", "pcm123", "PCM");
    const fieldUserId = userId("campo", "João Pereira", "joao@empresa.com", "campo123", "EXECUTANTE");

    const teamNames = ["Elétrica Prev.", "Automação", "Mecânica FM", "Caldeiraria"];
    const teamIds = teamNames.map((name) => getOrCreateId(
      "SELECT id FROM equipes WHERE nome = ?", [name],
      "INSERT INTO equipes (nome, tipo, especialidade) VALUES (?,?,?)",
      () => [name, name === "Caldeiraria" ? "Terceirizada" : "Própria", name]
    ));

    const equipmentRows = [
      ["VT-3330-TR01", "Sistema estrutural TR01", "Terminal Leste", "Estrutura", "Alta"],
      ["TR01-BOMBA-02", "Bomba de recalque 02", "Terminal Leste", "Bomba", "Alta"],
      ["PA-2200-MOT", "Motor de acionamento 2200", "Pátio A", "Motor", "Média"],
      ["ESTR-3330", "Estrutura metálica 3330", "Terminal Leste", "Estrutura", "Média"],
    ];
    const equipmentIds = equipmentRows.map((row) => getOrCreateId(
      "SELECT id FROM equipamentos WHERE tag = ?", [row[0]],
      "INSERT INTO equipamentos (tag, descricao, localizacao, classe, criticidade) VALUES (?,?,?,?,?)",
      () => row
    ));

    const collaboratorRows = [
      ["Marisa A. Rios", "M-1001", "Eletricista", teamIds[0], null],
      ["Flávio H. Ferreira", "M-1002", "Mecânico", teamIds[2], null],
      ["Luiz F. Silva", "M-1003", "Instrumentista", teamIds[1], null],
      ["José M. Alves", "M-1004", "Caldeireiro", teamIds[3], fieldUserId],
    ];
    const collaboratorIds = collaboratorRows.map((row) => getOrCreateId(
      "SELECT id FROM colaboradores WHERE matricula = ?", [row[1]],
      "INSERT INTO colaboradores (nome, matricula, especialidade, equipe_id, usuario_id) VALUES (?,?,?,?,?)",
      () => row
    ));
    db.exec(USER_TEAM_BACKFILL_SQL);
    db.exec(USER_COLLABORATOR_SYNC_SQL);

    const noteRows = [
      ["14137", equipmentIds[0], "Tela de proteção danificada", "Corretiva", "Aberta", adminId],
      ["14205", equipmentIds[1], "Vibração acima do normal", "Inspeção", "Aberta", adminId],
      ["14210", equipmentIds[2], "Ruído intermitente no motor", "Corretiva", "Aberta", adminId],
      ["14233", equipmentIds[3], "Corrosão em estrutura metálica", "Corretiva", "Aberta", adminId],
    ];
    noteRows.forEach((row) => getOrCreateId(
      "SELECT id FROM notas WHERE numero = ?", [row[0]],
      "INSERT INTO notas (numero, equipamento_id, descricao, tipo, status, solicitante_id) VALUES (?,?,?,?,?,?)",
      () => row
    ));

    const orderRows = [
      ["40012345", "Corretiva", "Distribuída", equipmentIds[0], teamIds[0], 6, "09/07"],
      ["40012346", "Inspeção", "Programada", equipmentIds[1], teamIds[2], 3, "09/07"],
      ["40012350", "Corretiva", "Aberta", equipmentIds[2], teamIds[1], 4, "10/07"],
      ["40012352", "Corretiva", "Programada", equipmentIds[3], teamIds[3], 8, "10/07"],
    ];
    const orderIds = orderRows.map((row) => getOrCreateId(
      "SELECT id FROM ordens WHERE numero = ?", [row[0]],
      "INSERT INTO ordens (numero, tipo, status, equipamento_id, equipe_id, hh_previsto, data_programada) VALUES (?,?,?,?,?,?,?)",
      () => row
    ));

    const firstOrderId = orderIds[0];
    const firstCollaboratorId = collaboratorIds[0];
    const insertApontamento = "INSERT INTO apontamentos (ordem_id, colaborador_id, tipo, hh_apropriado) VALUES (?,?,?,?)";
    for (const tipo of ["Apropriação", "Relatório"]) {
      insertIfMissing(
        "SELECT 1 FROM apontamentos WHERE ordem_id = ? AND colaborador_id = ? AND tipo = ?",
        [firstOrderId, firstCollaboratorId, tipo], insertApontamento,
        [firstOrderId, firstCollaboratorId, tipo, 6]
      );
    }

    const fatores = JSON.stringify([
      { t: "HH acima do previsto na OM", v: 0.9 },
      { t: "Divergência com histórico", v: 0.62 },
      { t: "Turno incompatível", v: 0.45 },
    ]);
    insertIfMissing(
      "SELECT 1 FROM sinalizacoes_ia WHERE ordem_numero = ? AND campo = ? AND valor_atual = ? AND tipo = ?",
      ["40012346", "HH apropriado", 13, "HH fora da faixa"],
      "INSERT INTO sinalizacoes_ia (entidade_tipo, ordem_numero, campo, valor_atual, valor_sugerido, tipo, score, explicacao, status) VALUES (?,?,?,?,?,?,?,?,?)",
      ["apontamento", "40012346", "HH apropriado", 13, 3, "HH fora da faixa", 0.88, fatores, "Nova"]
    );

    return changes;
  }).immediate();

  if (inserted > 0) console.log(`Seed idempotente: ${inserted} registros inseridos.`);
}
