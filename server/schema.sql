-- ============================================================
--  SIGMA-CCM · Estrutura do banco de dados (SQLite)
--  Portal de gestão da manutenção — usuários e entidades de back
-- ============================================================

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  id          TEXT PRIMARY KEY,
  aplicada_em TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ----------------------------------------------------------------
-- Usuários e acesso (autenticação por usuário/senha + papel/RBAC)
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS usuarios (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  nome         TEXT    NOT NULL,
  email        TEXT    UNIQUE,
  username     TEXT    NOT NULL UNIQUE,
  senha_hash   TEXT    NOT NULL,
  papel        TEXT    NOT NULL DEFAULT 'EXECUTANTE'
                       CHECK (papel IN ('CCM','PCM','EXECUTANTE')),
  ativo        INTEGER NOT NULL DEFAULT 1,
  criado_em    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ----------------------------------------------------------------
-- Ativos, equipes e pessoas
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS equipes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  nome          TEXT NOT NULL,
  tipo          TEXT NOT NULL DEFAULT 'Própria' CHECK (tipo IN ('Própria','Terceirizada')),
  especialidade TEXT
);

CREATE TABLE IF NOT EXISTS equipamentos (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  tag          TEXT NOT NULL UNIQUE,
  descricao    TEXT,
  localizacao  TEXT,
  classe       TEXT,
  criticidade  TEXT DEFAULT 'Média' CHECK (criticidade IN ('Baixa','Média','Alta')),
  pai_id       INTEGER REFERENCES equipamentos(id)
);

CREATE TABLE IF NOT EXISTS colaboradores (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  nome          TEXT NOT NULL,
  matricula     TEXT UNIQUE,
  especialidade TEXT,
  equipe_id     INTEGER REFERENCES equipes(id),
  usuario_id    INTEGER REFERENCES usuarios(id)
);

CREATE TABLE IF NOT EXISTS planos_preventivos (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  equipamento_id INTEGER NOT NULL REFERENCES equipamentos(id),
  descricao      TEXT,
  periodicidade  TEXT,
  proxima_data   TEXT
);

-- ----------------------------------------------------------------
-- Notas de manutenção
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notas (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  numero         TEXT NOT NULL UNIQUE,
  equipamento_id INTEGER REFERENCES equipamentos(id),
  descricao      TEXT NOT NULL,
  tipo           TEXT NOT NULL DEFAULT 'Corretiva',
  status         TEXT NOT NULL DEFAULT 'Aberta' CHECK (status IN ('Aberta','Em OM','Cancelada')),
  solicitante_id INTEGER REFERENCES usuarios(id),
  data_abertura  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ----------------------------------------------------------------
-- Ordens de manutenção (núcleo)
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ordens (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  numero            TEXT NOT NULL UNIQUE,
  tipo              TEXT NOT NULL DEFAULT 'Corretiva',
  status            TEXT NOT NULL DEFAULT 'Aberta'
                    CHECK (status IN ('Aberta','Programada','Distribuída','Em execução','Encerrada','Cancelada')),
  equipamento_id    INTEGER REFERENCES equipamentos(id),
  nota_id           INTEGER REFERENCES notas(id),
  plano_id          INTEGER REFERENCES planos_preventivos(id),
  equipe_id         INTEGER REFERENCES equipes(id),
  hh_previsto       REAL NOT NULL DEFAULT 4,
  data_programada   TEXT,
  data_encerramento TEXT,
  criado_em         TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ----------------------------------------------------------------
-- Apontamentos (execução) — as 3 condições de encerramento
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS apontamentos (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  ordem_id       INTEGER NOT NULL REFERENCES ordens(id) ON DELETE CASCADE,
  colaborador_id INTEGER REFERENCES colaboradores(id),
  tipo           TEXT NOT NULL CHECK (tipo IN ('Apropriação','Relatório','Validação')),
  hh_apropriado  REAL NOT NULL DEFAULT 0,
  descricao      TEXT,
  data           TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ----------------------------------------------------------------
-- Ocorrências de HH (folga, férias, falta, atestado)
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ocorrencias_hh (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  colaborador_id INTEGER NOT NULL REFERENCES colaboradores(id),
  tipo           TEXT NOT NULL CHECK (tipo IN ('Folga','Férias','Falta','Atestado')),
  data_inicio    TEXT,
  data_fim       TEXT
);

-- ----------------------------------------------------------------
-- Sinalizações de inconsistência (IA / qualidade de dados)
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sinalizacoes_ia (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  entidade_tipo   TEXT NOT NULL DEFAULT 'apontamento',
  entidade_id     INTEGER,
  ordem_numero    TEXT,
  campo           TEXT,
  valor_atual     REAL,
  valor_sugerido  REAL,
  tipo            TEXT,
  score           REAL,
  explicacao      TEXT,               -- JSON com os fatores (XAI)
  status          TEXT NOT NULL DEFAULT 'Nova' CHECK (status IN ('Nova','Aceita','Rejeitada')),
  criado_em       TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ----------------------------------------------------------------
-- Trilha de auditoria (governança / LGPD)
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trilha_auditoria (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id   INTEGER REFERENCES usuarios(id),
  acao         TEXT NOT NULL,
  entidade     TEXT,
  entidade_id  INTEGER,
  detalhe      TEXT,
  data_hora    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Índices úteis
CREATE INDEX IF NOT EXISTS idx_ordens_status  ON ordens(status);
CREATE INDEX IF NOT EXISTS idx_apont_ordem    ON apontamentos(ordem_id);
CREATE INDEX IF NOT EXISTS idx_sinais_status  ON sinalizacoes_ia(status);
CREATE INDEX IF NOT EXISTS idx_notas_status   ON notas(status);
