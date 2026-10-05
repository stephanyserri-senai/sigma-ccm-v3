-- ============================================================
--  SIGMA·CCM · Esquema completo do banco (SQLite) — REFERÊNCIA
--  Gerado por server/scripts/gerar-doc-banco.js a partir de server/schema.sql
--  + 15 migrações de server/src/data/migrations.js. NÃO edite à mão.
--  A API cria/atualiza o banco pelas migrações idempotentes (o .db existente é preservado);
--  este arquivo serve para consulta, revisão e para recriar o banco em outra ferramenta.
-- ============================================================

PRAGMA foreign_keys = ON;

-- ------------------------------------------------------------
-- Acesso, pessoas e equipes
-- ------------------------------------------------------------

-- Usuários do sistema (login e perfil de acesso). Também são os colaboradores das equipes.
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
, "equipe_id" INTEGER REFERENCES equipes(id));
CREATE INDEX IF NOT EXISTS idx_usuarios_equipe ON usuarios(equipe_id);

-- Equipes de manutenção, próprias ou terceirizadas.
CREATE TABLE IF NOT EXISTS equipes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  nome          TEXT NOT NULL,
  tipo          TEXT NOT NULL DEFAULT 'Própria' CHECK (tipo IN ('Própria','Terceirizada')),
  especialidade TEXT
);

-- Vínculo de pessoa (colaborador = usuário). Ponte para ocorrências de HH e apontamentos antigos; sincronizado a partir de `usuarios`.
CREATE TABLE IF NOT EXISTS colaboradores (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  nome          TEXT NOT NULL,
  matricula     TEXT UNIQUE,
  especialidade TEXT,
  equipe_id     INTEGER REFERENCES equipes(id),
  usuario_id    INTEGER REFERENCES usuarios(id)
);
CREATE INDEX IF NOT EXISTS idx_colaboradores_usuario ON colaboradores(usuario_id);

-- ------------------------------------------------------------
-- Ativos e planos de manutenção
-- ------------------------------------------------------------

-- Equipamentos (ativos) mantidos, com TAG única e hierarquia.
CREATE TABLE IF NOT EXISTS equipamentos (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  tag          TEXT NOT NULL UNIQUE,
  descricao    TEXT,
  localizacao  TEXT,
  classe       TEXT,
  criticidade  TEXT DEFAULT 'Média' CHECK (criticidade IN ('Baixa','Média','Alta')),
  pai_id       INTEGER REFERENCES equipamentos(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_equipamentos_tag_unique ON equipamentos(tag);

-- Planos de manutenção preventiva; geram OMs preventivas e notificações de vencimento.
CREATE TABLE IF NOT EXISTS planos_preventivos (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  equipamento_id INTEGER NOT NULL REFERENCES equipamentos(id),
  descricao      TEXT,
  periodicidade  TEXT,
  proxima_data   TEXT
, "equipe_id" INTEGER REFERENCES equipes(id));

-- ------------------------------------------------------------
-- Notas e ordens de manutenção
-- ------------------------------------------------------------

-- Notas de manutenção (solicitações) que podem ser convertidas em OM.
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
CREATE INDEX IF NOT EXISTS idx_notas_status   ON notas(status);

-- Ordens de manutenção (OM), núcleo do sistema.
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
, "responsavel_id" INTEGER REFERENCES usuarios(id), "data_fim_programada" TEXT, "exige_pt" INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS idx_ordens_status  ON ordens(status);
CREATE INDEX IF NOT EXISTS idx_ordens_responsavel ON ordens(responsavel_id);
CREATE INDEX IF NOT EXISTS idx_ordens_plano ON ordens(plano_id);

-- Registros de execução da OM: as três condições de encerramento (um de cada tipo por OM).
CREATE TABLE IF NOT EXISTS apontamentos (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  ordem_id       INTEGER NOT NULL REFERENCES ordens(id) ON DELETE CASCADE,
  colaborador_id INTEGER REFERENCES colaboradores(id),
  tipo           TEXT NOT NULL CHECK (tipo IN ('Apropriação','Relatório','Validação')),
  hh_apropriado  REAL NOT NULL DEFAULT 0,
  descricao      TEXT,
  data           TEXT NOT NULL DEFAULT (datetime('now'))
, "usuario_id" INTEGER REFERENCES usuarios(id));
CREATE INDEX IF NOT EXISTS idx_apont_ordem    ON apontamentos(ordem_id);

-- Relatório de execução da OM (um por OM), com as durações usadas em disponibilidade, MTBF e MTTR.
CREATE TABLE IF NOT EXISTS relatorios_execucao (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ordem_id INTEGER NOT NULL UNIQUE REFERENCES ordens(id) ON DELETE CASCADE,
          usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
          atividade_realizada TEXT NOT NULL,
          resultado TEXT,
          materiais_utilizados TEXT,
          observacoes TEXT,
          atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
        , "indisponibilidade_horas" REAL, "tempo_reparo_horas" REAL);

-- Imagens de evidência anexadas à OM pelo executante (até 5 MB cada).
CREATE TABLE IF NOT EXISTS evidencias_om (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ordem_id INTEGER NOT NULL REFERENCES ordens(id) ON DELETE CASCADE,
          usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
          nome_arquivo TEXT NOT NULL,
          tipo_mime TEXT NOT NULL,
          conteudo BLOB NOT NULL,
          enviado_em TEXT NOT NULL DEFAULT (datetime('now'))
        );
CREATE INDEX IF NOT EXISTS idx_evidencias_ordem ON evidencias_om(ordem_id);

-- Execução cronometrada da OM (uma por OM). Ao finalizar, gera a Apropriação: HH = duração × executantes.
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

-- Nomes dos executantes informados ao iniciar a execução.
CREATE TABLE IF NOT EXISTS execucao_executantes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          execucao_id INTEGER NOT NULL REFERENCES execucoes_om(id) ON DELETE CASCADE,
          nome TEXT NOT NULL
        );
CREATE INDEX IF NOT EXISTS idx_execucao_executantes ON execucao_executantes(execucao_id);

-- Intercorrências registradas em campo durante a execução (acompanhadas por PCM/CCM).
CREATE TABLE IF NOT EXISTS intercorrencias_om (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ordem_id INTEGER NOT NULL REFERENCES ordens(id) ON DELETE CASCADE,
          execucao_id INTEGER REFERENCES execucoes_om(id) ON DELETE CASCADE,
          usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
          tipo TEXT NOT NULL CHECK (tipo IN ('Desvio','Alteração de rota','Alteração de serviço','Outro')),
          descricao TEXT NOT NULL,
          registrado_em TEXT NOT NULL DEFAULT (datetime('now'))
        );
CREATE INDEX IF NOT EXISTS idx_intercorrencias_ordem ON intercorrencias_om(ordem_id);

-- ------------------------------------------------------------
-- Mão de obra, planejamento e turnos
-- ------------------------------------------------------------

-- HH disponível lançado por equipe e semana (denominador do IAMOT).
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

-- Ausências que reduzem o HH disponível (enviadas pelo executante em campo). Atestado é dado sensível (LGPD): só o CCM vê o tipo.
CREATE TABLE IF NOT EXISTS ocorrencias_hh (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  colaborador_id INTEGER NOT NULL REFERENCES colaboradores(id),
  tipo           TEXT NOT NULL CHECK (tipo IN ('Folga','Férias','Falta','Atestado')),
  data_inicio    TEXT,
  data_fim       TEXT
, "horas_dia" REAL NOT NULL DEFAULT 8, "observacao" TEXT, "registrado_por" INTEGER REFERENCES usuarios(id), "criado_em" TEXT);
CREATE INDEX IF NOT EXISTS idx_ocorrencias_colaborador ON ocorrencias_hh(colaborador_id);

-- Alocação de HH de uma OM a uma equipe em um dia (planejamento semanal). Mantém as datas da OM sincronizadas.
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

-- Passagem de turno estruturada e imutável.
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

-- Confirmação de leitura de cada passagem de turno, por usuário.
CREATE TABLE IF NOT EXISTS passagens_turno_leituras (
          passagem_id INTEGER NOT NULL REFERENCES passagens_turno(id) ON DELETE CASCADE,
          usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
          lido_em TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (passagem_id, usuario_id)
        );

-- ------------------------------------------------------------
-- Formulários, inspeções e permissões de trabalho
-- ------------------------------------------------------------

-- Modelos de formulário criados no construtor No-Code. Cada alteração gera nova versão.
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

-- Respostas preenchidas, com o modelo congelado na versão usada e as não conformidades detectadas.
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
CREATE INDEX IF NOT EXISTS idx_form_respostas_ordem ON formularios_respostas(ordem_id, modelo_id);
CREATE INDEX IF NOT EXISTS idx_form_respostas_equipamento ON formularios_respostas(equipamento_id);

-- Fotos e assinaturas enviadas nas respostas.
CREATE TABLE IF NOT EXISTS formularios_anexos (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          resposta_id INTEGER NOT NULL REFERENCES formularios_respostas(id) ON DELETE CASCADE,
          campo_id TEXT NOT NULL,
          tipo TEXT NOT NULL CHECK (tipo IN ('foto','assinatura')),
          nome_arquivo TEXT NOT NULL,
          tipo_mime TEXT NOT NULL,
          conteudo BLOB NOT NULL
        );
CREATE INDEX IF NOT EXISTS idx_form_anexos_resposta ON formularios_anexos(resposta_id);

-- Formulários vinculados manualmente a uma OM (checklist), obrigatórios ou não.
CREATE TABLE IF NOT EXISTS ordem_formularios (
          ordem_id INTEGER NOT NULL REFERENCES ordens(id) ON DELETE CASCADE,
          modelo_id INTEGER NOT NULL REFERENCES formularios_modelos(id),
          obrigatorio INTEGER NOT NULL DEFAULT 0,
          vinculado_por INTEGER REFERENCES usuarios(id),
          vinculado_em TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (ordem_id, modelo_id)
        );

-- Rotas de inspeção: roteiro de pontos a percorrer.
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

-- Pontos da rota, em sequência: equipamento + formulário + instrução.
CREATE TABLE IF NOT EXISTS rota_pontos (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          rota_id INTEGER NOT NULL REFERENCES rotas_inspecao(id) ON DELETE CASCADE,
          sequencia INTEGER NOT NULL,
          equipamento_id INTEGER NOT NULL REFERENCES equipamentos(id),
          modelo_id INTEGER NOT NULL REFERENCES formularios_modelos(id),
          instrucao TEXT
        );
CREATE INDEX IF NOT EXISTS idx_rota_pontos_rota ON rota_pontos(rota_id, sequencia);

-- Execução de uma rota por um inspetor (ronda).
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
CREATE INDEX IF NOT EXISTS idx_rondas_usuario ON rondas_inspecao(usuario_id, status);

-- Pontos da ronda (copiados da rota ao iniciar) e o resultado de cada um.
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
CREATE INDEX IF NOT EXISTS idx_ronda_pontos_ronda ON ronda_pontos(ronda_id, sequencia);

-- Permissão de Trabalho (APR/PT) da OM, com validade de até 24 h e segregação de funções na aprovação.
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
CREATE INDEX IF NOT EXISTS idx_permissoes_ordem ON permissoes_trabalho(ordem_id, status);

-- ------------------------------------------------------------
-- Qualidade de dados, notificações e governança
-- ------------------------------------------------------------

-- Inconsistências detectadas pela IA com explicação (XAI) e a decisão humana (aceitar/rejeitar).
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
, "valor_aplicado" REAL, "decidido_por" INTEGER REFERENCES usuarios(id), "decidido_em" TEXT, "justificativa" TEXT);
CREATE INDEX IF NOT EXISTS idx_sinais_status  ON sinalizacoes_ia(status);
CREATE INDEX IF NOT EXISTS idx_sinais_entidade ON sinalizacoes_ia(entidade_tipo, entidade_id);

-- Eventos críticos (OM atrasada, preventiva, PT pendente, inconsistência), gerados de forma idempotente e resolvidos automaticamente quando a condição some.
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
CREATE INDEX IF NOT EXISTS idx_notificacoes_status ON notificacoes(status, severidade);
CREATE INDEX IF NOT EXISTS idx_notificacoes_usuario ON notificacoes(usuario_id);

-- Leitura de notificação por usuário.
CREATE TABLE IF NOT EXISTS notificacoes_leituras (
          notificacao_id INTEGER NOT NULL REFERENCES notificacoes(id) ON DELETE CASCADE,
          usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
          lida_em TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (notificacao_id, usuario_id)
        );

-- Destinatários incluídos por encaminhamento.
CREATE TABLE IF NOT EXISTS notificacoes_destinatarios (
          notificacao_id INTEGER NOT NULL REFERENCES notificacoes(id) ON DELETE CASCADE,
          usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
          incluido_por INTEGER REFERENCES usuarios(id),
          incluido_em TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (notificacao_id, usuario_id)
        );

-- Histórico de tratamento da notificação (respostas, encaminhamentos e resolução).
CREATE TABLE IF NOT EXISTS notificacoes_acoes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          notificacao_id INTEGER NOT NULL REFERENCES notificacoes(id) ON DELETE CASCADE,
          usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
          tipo TEXT NOT NULL CHECK (tipo IN ('Resposta','Encaminhamento','Resolução')),
          texto TEXT,
          destinatario_id INTEGER REFERENCES usuarios(id),
          criado_em TEXT NOT NULL DEFAULT (datetime('now'))
        );
CREATE INDEX IF NOT EXISTS idx_notificacoes_acoes ON notificacoes_acoes(notificacao_id);

-- Metas e parâmetros de cálculo dos KPIs, editáveis pelo CCM (lista e limites em server/src/parametros.js).
CREATE TABLE IF NOT EXISTS parametros_kpi (
          chave TEXT PRIMARY KEY,
          valor REAL NOT NULL,
          atualizado_por INTEGER REFERENCES usuarios(id),
          atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
        );

-- Trilha de auditoria (governança/LGPD): toda ação relevante, somente inclusão.
CREATE TABLE IF NOT EXISTS trilha_auditoria (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id   INTEGER REFERENCES usuarios(id),
  acao         TEXT NOT NULL,
  entidade     TEXT,
  entidade_id  INTEGER,
  detalhe      TEXT,
  data_hora    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ------------------------------------------------------------
-- Infraestrutura
-- ------------------------------------------------------------

-- Migrações já aplicadas (e o marcador da carga de demonstração).
CREATE TABLE IF NOT EXISTS schema_migrations (
  id          TEXT PRIMARY KEY,
  aplicada_em TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Respostas dos envios da fila offline (X-Idempotency-Key), guardadas por 30 dias para que reenvios não repitam a operação.
CREATE TABLE IF NOT EXISTS requisicoes_idempotentes (
          chave TEXT PRIMARY KEY,
          usuario_id INTEGER REFERENCES usuarios(id),
          metodo TEXT NOT NULL,
          rota TEXT NOT NULL,
          status INTEGER NOT NULL,
          resposta TEXT,
          criado_em TEXT NOT NULL DEFAULT (datetime('now'))
        );
CREATE INDEX IF NOT EXISTS idx_requisicoes_idempotentes_data ON requisicoes_idempotentes(criado_em);

-- Migrações aplicadas (registradas em schema_migrations):
--   2026-10-02_additive_compatibility_columns
--   2026-10-02_equipment_tag_unique_index
--   2026-10-02_om_execution_and_evidence
--   2026-10-02_reliability_duration_fields
--   2026-10-02_labor_availability_and_user_team
--   2026-10-02_om_execution_timer
--   2026-10-02_users_as_collaborators
--   2026-10-02_order_schedule_end_date
--   2026-10-05_kpi_reference_parameters
--   2026-10-05_planning_and_shift_handover
--   2026-10-05_dynamic_forms
--   2026-10-05_inspection_routes_and_work_permits
--   2026-10-05_notifications
--   2026-10-05_offline_idempotency_keys
--   2026-10-05_data_quality_human_decision
