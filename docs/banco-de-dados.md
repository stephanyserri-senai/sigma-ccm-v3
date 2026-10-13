# Banco de dados do SIGMA·CCM

> Documento gerado por `server/scripts/gerar-doc-banco.js` a partir do esquema real (migrações de `supabase/migrations`).
> Não edite à mão: altere as descrições em `server/scripts/banco-de-dados.descricao.js` e rode o script.

**38 tabelas** em 7 módulos · 81 índices · 4 migrações · PostgreSQL (Supabase), RLS ligado em 38 tabelas.

## Como o banco é criado e evolui

1. As migrações SQL ficam em `supabase/migrations/` e são aplicadas **fora da API**, em ordem: `supabase db push` ou `npm --prefix server run db:migrate` (cada arquivo numa transação, registrado em `schema_migrations`).
2. `npm --prefix server run db:bootstrap` faz a carga inicial, uma única vez e de forma idempotente: parâmetros de KPI, administrador do ambiente (produção) ou contas de exemplo (desenvolvimento) e, se `SIGMA_DEMO` estiver ligado, os dados de demonstração.
3. A API **não** migra nem popula o banco ao iniciar (compatível com funções serverless da Vercel).
4. As tabelas têm RLS ligado e nenhuma policy: o acesso direto pelas chaves `anon`/`authenticated` do Supabase fica bloqueado. Só a API acessa o banco, com a `DATABASE_URL` do servidor.
5. `docs/schema-completo.sql` é a referência histórica do esquema SQLite original (congelada, não é mais gerada).

## Camada de acesso a dados

Nenhuma rota ou serviço escreve SQL. Todo acesso ao banco passa por `server/src/data`, sempre de forma assíncrona (`await`):

| Arquivo | Papel |
|---|---|
| `data/connection.js` | Único módulo que conhece o driver (`pg`): pool (dimensionado para serverless), `sql()`, `transaction()` atômica (com SAVEPOINT em transações aninhadas) e classificação de erros de restrição. |
| `data/bootstrap/*.js` | Carga inicial explícita (`npm run db:bootstrap`): parâmetros, admin, exemplo e demonstração. |
| `data/repositories/*.js` | Um repositório por entidade, com funções de consulta e gravação (abaixo). |
| `data/index.js` | Ponto de entrada: `transaction()`, `closeDatabase()`, classificadores de erro e os repositórios (`ordensRepo`, `usuariosRepo`…). |

O teste `server/test/arquitetura.test.js` impede SQL fora dessa pasta.

## Visão geral das relações

Para legibilidade, este diagrama omite as colunas de autoria que apontam para `usuarios` (`usuario_id`, `criado_por`, `registrado_por`, `responsavel_id`…); elas aparecem nos diagramas de cada módulo.

```mermaid
erDiagram
  ordens ||--o{ apontamentos : "ordem_id"
  colaboradores o|--o{ apontamentos : "colaborador_id"
  equipes o|--o{ colaboradores : "equipe_id"
  historico_prioridade ||--o{ confirmacoes_paralisacao_prioridade : "historico_prioridade_id"
  equipamentos o|--o{ equipamentos : "pai_id"
  ordens ||--o{ evidencias_om : "ordem_id"
  execucoes_om ||--o{ execucao_executantes : "execucao_id"
  ordens ||--o{ execucoes_om : "ordem_id"
  apontamentos o|--o{ execucoes_om : "apontamento_id"
  formularios_respostas ||--o{ formularios_anexos : "resposta_id"
  formularios_modelos ||--o{ formularios_respostas : "modelo_id"
  ordens o|--o{ formularios_respostas : "ordem_id"
  equipamentos o|--o{ formularios_respostas : "equipamento_id"
  equipes ||--o{ hh_disponivel : "equipe_id"
  notas o|--o{ historico_prioridade : "nota_id"
  ordens o|--o{ historico_prioridade : "ordem_id"
  ordens ||--o{ intercorrencias_om : "ordem_id"
  execucoes_om o|--o{ intercorrencias_om : "execucao_id"
  equipamentos o|--o{ notas : "equipamento_id"
  notificacoes ||--o{ notificacoes_acoes : "notificacao_id"
  notificacoes ||--o{ notificacoes_destinatarios : "notificacao_id"
  notificacoes ||--o{ notificacoes_leituras : "notificacao_id"
  colaboradores ||--o{ ocorrencias_hh : "colaborador_id"
  ordens ||--o{ ordem_formularios : "ordem_id"
  formularios_modelos ||--o{ ordem_formularios : "modelo_id"
  equipamentos o|--o{ ordens : "equipamento_id"
  notas o|--o{ ordens : "nota_id"
  planos_preventivos o|--o{ ordens : "plano_id"
  equipes o|--o{ ordens : "equipe_id"
  equipes o|--o{ passagens_turno : "equipe_id"
  passagens_turno ||--o{ passagens_turno_leituras : "passagem_id"
  ordens ||--o{ permissoes_trabalho : "ordem_id"
  formularios_modelos ||--o{ permissoes_trabalho : "modelo_id"
  formularios_respostas ||--o{ permissoes_trabalho : "resposta_id"
  equipamentos ||--o{ planos_preventivos : "equipamento_id"
  equipes o|--o{ planos_preventivos : "equipe_id"
  ordens ||--o{ programacao_atividades : "ordem_id"
  equipes ||--o{ programacao_atividades : "equipe_id"
  ordens ||--o{ relatorios_execucao : "ordem_id"
  rondas_inspecao ||--o{ ronda_pontos : "ronda_id"
  equipamentos o|--o{ ronda_pontos : "equipamento_id"
  formularios_modelos o|--o{ ronda_pontos : "modelo_id"
  formularios_respostas o|--o{ ronda_pontos : "resposta_id"
  rotas_inspecao ||--o{ rondas_inspecao : "rota_id"
  rotas_inspecao ||--o{ rota_pontos : "rota_id"
  equipamentos ||--o{ rota_pontos : "equipamento_id"
  formularios_modelos ||--o{ rota_pontos : "modelo_id"
  equipes o|--o{ usuarios : "equipe_id"
```

Ligações lógicas (sem chave estrangeira no banco):

- `sinalizacoes_ia.ordem_numero` → `ordens.numero`; `sinalizacoes_ia.entidade_id` → `apontamentos.id` quando `entidade_tipo = 'apontamento'`.
- `notificacoes.entidade` + `notificacoes.entidade_id` → registro de origem (`ordem`, `plano_preventivo`, `permissao_trabalho` ou `sinalizacao`).
- `trilha_auditoria.entidade` + `trilha_auditoria.entidade_id` → registro afetado pela ação.
- `rondas_inspecao.rota_nome`, `formularios_respostas.modelo_*` e `formularios_respostas.campos` são cópias congeladas (histórico preservado mesmo se a rota ou o modelo mudar).

## Módulos

### Acesso, pessoas e equipes

Quem usa o sistema e como as pessoas se organizam. Colaborador = usuário: cada usuário tem um vínculo em `colaboradores`, criado automaticamente.

```mermaid
erDiagram
  usuarios {
    INTEGER id PK
    TEXT nome
    TEXT email UK
    TEXT username UK
    TEXT senha_hash
    TEXT papel "CCM | PCM | EXECUTANTE"
    INTEGER ativo
    TEXT criado_em
    INTEGER equipe_id FK
  }
  equipes {
    INTEGER id PK
    TEXT nome
    TEXT tipo "Própria | Terceirizada"
    TEXT especialidade
  }
  colaboradores {
    INTEGER id PK
    TEXT nome
    TEXT matricula UK
    TEXT especialidade
    INTEGER equipe_id FK
    INTEGER usuario_id FK
  }
  equipes o|--o{ usuarios : "equipe_id"
  equipes o|--o{ colaboradores : "equipe_id"
  usuarios o|--o{ colaboradores : "usuario_id"
```

#### `usuarios`

Usuários do sistema (login e perfil de acesso). Também são os colaboradores das equipes.

Repositório: `server/src/data/repositories/usuarios.js`

| Coluna | Tipo | Restrições | Padrão | Descrição |
|---|---|---|---|---|
| `id` | INTEGER | PK | — | Identificador (gerado automaticamente). |
| `nome` | TEXT | NOT NULL | — | Nome completo. |
| `email` | TEXT | UNIQUE | — | E-mail (opcional, único). |
| `username` | TEXT | UNIQUE, NOT NULL | — | Login (único). |
| `senha_hash` | TEXT | NOT NULL | — | Senha com hash bcrypt (nunca em texto). |
| `papel` | TEXT | NOT NULL | `'EXECUTANTE'::text` | Perfil de acesso (RBAC). · Valores: `CCM`, `PCM`, `EXECUTANTE` |
| `ativo` | INTEGER | NOT NULL | `1` | 1 = pode entrar no sistema; 0 = desativado. |
| `criado_em` | TEXT | NOT NULL | `to_char((CURRENT_TIMESTAMP AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD HH24:MI:SS'::text)` | Data/hora de cadastro (UTC). |
| `equipe_id` | INTEGER | FK | — | Equipe da pessoa. · → `equipes.id` |

Índices: `idx_usuarios_equipe`, `usuarios_email_key`, `usuarios_username_key`.

#### `equipes`

Equipes de manutenção, próprias ou terceirizadas.

Repositório: `server/src/data/repositories/equipes.js`

| Coluna | Tipo | Restrições | Padrão | Descrição |
|---|---|---|---|---|
| `id` | INTEGER | PK | — | Identificador (gerado automaticamente). |
| `nome` | TEXT | NOT NULL | — | Nome da equipe. |
| `tipo` | TEXT | NOT NULL | `'Própria'::text` | Vínculo da equipe. · Valores: `Própria`, `Terceirizada` |
| `especialidade` | TEXT | — | — | Especialidade principal. |

#### `colaboradores`

Vínculo de pessoa (colaborador = usuário). Ponte para ocorrências de HH e apontamentos antigos; sincronizado a partir de `usuarios`.

Repositório: `server/src/data/repositories/colaboradores.js`

| Coluna | Tipo | Restrições | Padrão | Descrição |
|---|---|---|---|---|
| `id` | INTEGER | PK | — | Identificador (gerado automaticamente). |
| `nome` | TEXT | NOT NULL | — | Nome. |
| `matricula` | TEXT | UNIQUE | — | Matrícula (única, opcional). |
| `especialidade` | TEXT | — | — | Especialidade. |
| `equipe_id` | INTEGER | FK | — | Equipe. · → `equipes.id` |
| `usuario_id` | INTEGER | FK | — | Usuário correspondente. · → `usuarios.id` |

Índices: `colaboradores_matricula_key`, `idx_colaboradores_usuario`.

### Ativos e planos de manutenção

Equipamentos (com hierarquia pai/filho e TAG única) e os planos preventivos que geram OMs.

```mermaid
erDiagram
  equipamentos {
    INTEGER id PK
    TEXT tag UK
    TEXT descricao
    TEXT localizacao
    TEXT classe
    TEXT criticidade "Baixa | Média | Alta"
    INTEGER pai_id FK
  }
  planos_preventivos {
    INTEGER id PK
    INTEGER equipamento_id FK
    TEXT descricao
    TEXT periodicidade
    TEXT proxima_data
    INTEGER equipe_id FK
  }
  equipamentos o|--o{ equipamentos : "pai_id"
  equipamentos ||--o{ planos_preventivos : "equipamento_id"
  equipes o|--o{ planos_preventivos : "equipe_id"
```

#### `equipamentos`

Equipamentos (ativos) mantidos, com TAG única e hierarquia.

Repositório: `server/src/data/repositories/equipamentos.js`

| Coluna | Tipo | Restrições | Padrão | Descrição |
|---|---|---|---|---|
| `id` | INTEGER | PK | — | Identificador (gerado automaticamente). |
| `tag` | TEXT | UNIQUE, NOT NULL | — | TAG única (gerada pelo prefixo da classe, ex.: BOM-0001, ou manual). |
| `descricao` | TEXT | — | — | Descrição. |
| `localizacao` | TEXT | — | — | Área/local (filtro de área dos indicadores). |
| `classe` | TEXT | — | — | Classe (bomba, motor, painel…). |
| `criticidade` | TEXT | — | `'Média'::text` | Criticidade operacional. · Valores: `Baixa`, `Média`, `Alta` |
| `pai_id` | INTEGER | FK | — | Equipamento pai (hierarquia). · → `equipamentos.id` |

Índices: `equipamentos_tag_key`, `idx_equipamentos_tag_unique`.

#### `planos_preventivos`

Planos de manutenção preventiva; geram OMs preventivas e notificações de vencimento.

Repositório: `server/src/data/repositories/planos.js`

| Coluna | Tipo | Restrições | Padrão | Descrição |
|---|---|---|---|---|
| `id` | INTEGER | PK | — | Identificador (gerado automaticamente). |
| `equipamento_id` | INTEGER | FK, NOT NULL | — | Equipamento do plano. · → `equipamentos.id` |
| `descricao` | TEXT | — | — | Atividade. |
| `periodicidade` | TEXT | — | — | Periodicidade (texto livre: Mensal, 500 horas…). |
| `proxima_data` | TEXT | — | — | Próxima execução (AAAA-MM-DD). |
| `equipe_id` | INTEGER | FK | — | Equipe responsável. · → `equipes.id` |

### Notas e ordens de manutenção

Fluxo principal: nota → priorização por criticidade e risco → OM → programação → distribuição → execução (cronômetro, intercorrências, evidências, relatório) → encerramento automático quando Apropriação, Relatório, Validação e checklists obrigatórios estão completos.

```mermaid
erDiagram
  notas {
    INTEGER id PK
    TEXT numero UK
    INTEGER equipamento_id FK
    TEXT descricao
    TEXT tipo
    TEXT status "Aberta | Em OM | Cancelada"
    INTEGER solicitante_id FK
    TEXT data_abertura
    BOOLEAN afeta_seguranca_ambiente
    BOOLEAN afeta_custos
    BOOLEAN afeta_producao_qualidade
    BOOLEAN possui_reserva
    BOOLEAN risco_iminente
    BOOLEAN equipamento_monitorado
    BOOLEAN recursos_disponiveis
    BOOLEAN necessita_parada_programada
    TEXT periodicidade_parada
    TEXT criticidade
    TEXT prioridade
    SMALLINT prioridade_nivel
    SMALLINT prazo_dias
    BOOLEAN priorizacao_pendente
    TEXT priorizado_em
  }
  ordens {
    INTEGER id PK
    TEXT numero UK
    TEXT tipo
    TEXT status "Aberta | Programada | Distribuída | Em execução | Encerrada | Cancelada"
    INTEGER equipamento_id FK
    INTEGER nota_id FK
    INTEGER plano_id FK
    INTEGER equipe_id FK
    DOUBLE_PRECISION hh_previsto
    TEXT data_programada
    TEXT data_encerramento
    TEXT criado_em
    INTEGER responsavel_id FK
    TEXT data_fim_programada
    INTEGER exige_pt
    BOOLEAN afeta_seguranca_ambiente
    BOOLEAN afeta_custos
    BOOLEAN afeta_producao_qualidade
    BOOLEAN possui_reserva
    BOOLEAN risco_iminente
    BOOLEAN equipamento_monitorado
    BOOLEAN recursos_disponiveis
    BOOLEAN necessita_parada_programada
    TEXT periodicidade_parada
    TEXT criticidade
    TEXT prioridade
    SMALLINT prioridade_nivel
    SMALLINT prazo_dias
    TEXT priorizado_em
  }
  historico_prioridade {
    INTEGER id PK
    INTEGER nota_id FK
    INTEGER ordem_id FK
    BOOLEAN afeta_seguranca_ambiente
    BOOLEAN afeta_custos
    BOOLEAN afeta_producao_qualidade
    BOOLEAN possui_reserva
    BOOLEAN risco_iminente
    BOOLEAN equipamento_monitorado
    BOOLEAN recursos_disponiveis
    BOOLEAN necessita_parada_programada
    TEXT periodicidade_parada "Trimestral | Semestral | Anual"
    TEXT criticidade "A | B | C"
    TEXT prioridade "IMEDIATO | URGENTE | ALTO | MEDIO | BAIXO | TRIMESTRAL | SEMESTRAL | ANUAL"
    SMALLINT prioridade_nivel
    SMALLINT prazo_dias
    INTEGER priorizado_por FK
    TEXT priorizado_em
  }
  confirmacoes_paralisacao_prioridade {
    INTEGER id PK
    INTEGER historico_prioridade_id FK,UK
    INTEGER confirmado_por FK
    TEXT confirmado_em
  }
  apontamentos {
    INTEGER id PK
    INTEGER ordem_id FK
    INTEGER colaborador_id FK
    TEXT tipo "Apropriação | Relatório | Validação"
    DOUBLE_PRECISION hh_apropriado
    TEXT descricao
    TEXT data
    INTEGER usuario_id FK
  }
  relatorios_execucao {
    INTEGER id PK
    INTEGER ordem_id FK,UK
    INTEGER usuario_id FK
    TEXT atividade_realizada
    TEXT resultado
    TEXT materiais_utilizados
    TEXT observacoes
    TEXT atualizado_em
    DOUBLE_PRECISION indisponibilidade_horas
    DOUBLE_PRECISION tempo_reparo_horas
  }
  evidencias_om {
    INTEGER id PK
    INTEGER ordem_id FK
    INTEGER usuario_id FK
    TEXT nome_arquivo
    TEXT tipo_mime
    BYTEA conteudo
    TEXT enviado_em
  }
  execucoes_om {
    INTEGER id PK
    INTEGER ordem_id FK,UK
    INTEGER usuario_id FK
    INTEGER num_executantes
    TEXT iniciado_em
    TEXT finalizado_em
    DOUBLE_PRECISION duracao_horas
    DOUBLE_PRECISION hh_calculado
    INTEGER apontamento_id FK
  }
  execucao_executantes {
    INTEGER id PK
    INTEGER execucao_id FK
    TEXT nome
  }
  intercorrencias_om {
    INTEGER id PK
    INTEGER ordem_id FK
    INTEGER execucao_id FK
    INTEGER usuario_id FK
    TEXT tipo "Desvio | Alteração de rota | Alteração de serviço | Outro"
    TEXT descricao
    TEXT registrado_em
  }
  equipamentos o|--o{ notas : "equipamento_id"
  usuarios o|--o{ notas : "solicitante_id"
  equipamentos o|--o{ ordens : "equipamento_id"
  notas o|--o{ ordens : "nota_id"
  planos_preventivos o|--o{ ordens : "plano_id"
  equipes o|--o{ ordens : "equipe_id"
  usuarios o|--o{ ordens : "responsavel_id"
  notas o|--o{ historico_prioridade : "nota_id"
  ordens o|--o{ historico_prioridade : "ordem_id"
  usuarios ||--o{ historico_prioridade : "priorizado_por"
  historico_prioridade ||--o{ confirmacoes_paralisacao_prioridade : "historico_prioridade_id"
  usuarios ||--o{ confirmacoes_paralisacao_prioridade : "confirmado_por"
  ordens ||--o{ apontamentos : "ordem_id"
  colaboradores o|--o{ apontamentos : "colaborador_id"
  usuarios o|--o{ apontamentos : "usuario_id"
  ordens ||--o{ relatorios_execucao : "ordem_id"
  usuarios ||--o{ relatorios_execucao : "usuario_id"
  ordens ||--o{ evidencias_om : "ordem_id"
  usuarios ||--o{ evidencias_om : "usuario_id"
  ordens ||--o{ execucoes_om : "ordem_id"
  usuarios ||--o{ execucoes_om : "usuario_id"
  apontamentos o|--o{ execucoes_om : "apontamento_id"
  execucoes_om ||--o{ execucao_executantes : "execucao_id"
  ordens ||--o{ intercorrencias_om : "ordem_id"
  execucoes_om o|--o{ intercorrencias_om : "execucao_id"
  usuarios ||--o{ intercorrencias_om : "usuario_id"
```

#### `notas`

Notas de manutenção (solicitações) que podem ser convertidas em OM após classificação de criticidade e prioridade.

Repositório: `server/src/data/repositories/notas.js`

| Coluna | Tipo | Restrições | Padrão | Descrição |
|---|---|---|---|---|
| `id` | INTEGER | PK | — | Identificador (gerado automaticamente). |
| `numero` | TEXT | UNIQUE, NOT NULL | — | Número sequencial da nota. |
| `equipamento_id` | INTEGER | FK | — | Equipamento. · → `equipamentos.id` |
| `descricao` | TEXT | NOT NULL | — | Problema relatado. |
| `tipo` | TEXT | NOT NULL | `'Corretiva'::text` | Tipo (Corretiva, Inspeção…). |
| `status` | TEXT | NOT NULL | `'Aberta'::text` | Situação. · Valores: `Aberta`, `Em OM`, `Cancelada` |
| `solicitante_id` | INTEGER | FK | — | Quem abriu. · → `usuarios.id` |
| `data_abertura` | TEXT | NOT NULL | `to_char((CURRENT_TIMESTAMP AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD HH24:MI:SS'::text)` | Data/hora de abertura (UTC). |
| `afeta_seguranca_ambiente` | BOOLEAN | — | — | Impacta segurança pessoal/processual ou meio ambiente. |
| `afeta_custos` | BOOLEAN | — | — | Impacta custos da operação ou manutenção. |
| `afeta_producao_qualidade` | BOOLEAN | — | — | Impacta produção ou qualidade. |
| `possui_reserva` | BOOLEAN | — | — | Existe equipamento sobressalente disponível. |
| `risco_iminente` | BOOLEAN | — | — | O problema ocorreu ou há risco iminente. |
| `equipamento_monitorado` | BOOLEAN | — | — | O equipamento é monitorado. |
| `recursos_disponiveis` | BOOLEAN | — | — | Há recursos disponíveis para atendimento. |
| `necessita_parada_programada` | BOOLEAN | — | — | O serviço depende de parada programada. |
| `periodicidade_parada` | TEXT | — | — | Trimestral, Semestral ou Anual. |
| `criticidade` | TEXT | — | — | Classificação calculada: A, B ou C. |
| `prioridade` | TEXT | — | — | Código de prioridade derivado do fluxograma. |
| `prioridade_nivel` | SMALLINT | — | — | Nível numérico de prioridade (1 a 6). |
| `prazo_dias` | SMALLINT | — | — | Prazo-alvo em dias; NULL para parada programada. |
| `priorizacao_pendente` | BOOLEAN | NOT NULL | `false` | 1 = nota nova aguardando avaliação CCM/PCM; notas antigas preservam a compatibilidade. |
| `priorizado_em` | TEXT | — | — | Data/hora da última classificação (UTC). |

Índices: `idx_notas_status`, `notas_numero_key`.

#### `ordens`

Ordens de manutenção (OM), núcleo do sistema.

Repositório: `server/src/data/repositories/ordens.js`

| Coluna | Tipo | Restrições | Padrão | Descrição |
|---|---|---|---|---|
| `id` | INTEGER | PK | — | Identificador (gerado automaticamente). |
| `numero` | TEXT | UNIQUE, NOT NULL | — | Número sequencial da OM. |
| `tipo` | TEXT | NOT NULL | `'Corretiva'::text` | Corretiva, Preventiva, Inspeção… |
| `status` | TEXT | NOT NULL | `'Aberta'::text` | Etapa do fluxo da OM. · Valores: `Aberta`, `Programada`, `Distribuída`, `Em execução`, `Encerrada`, `Cancelada` |
| `equipamento_id` | INTEGER | FK | — | Equipamento. · → `equipamentos.id` |
| `nota_id` | INTEGER | FK | — | Nota de origem. · → `notas.id` |
| `plano_id` | INTEGER | FK | — | Plano de manutenção vinculado. · → `planos_preventivos.id` |
| `equipe_id` | INTEGER | FK | — | Equipe programada. · → `equipes.id` |
| `hh_previsto` | DOUBLE_PRECISION | NOT NULL | `4` | HH previsto. |
| `data_programada` | TEXT | — | — | Início programado (AAAA-MM-DD). |
| `data_encerramento` | TEXT | — | — | Data de encerramento (DD/MM/AAAA). |
| `criado_em` | TEXT | NOT NULL | `to_char((CURRENT_TIMESTAMP AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD HH24:MI:SS'::text)` | Criação (UTC); base da janela dos indicadores. |
| `responsavel_id` | INTEGER | FK | — | Executante designado (distribuição). · → `usuarios.id` |
| `data_fim_programada` | TEXT | — | — | Término previsto (AAAA-MM-DD), quando a OM ocupa mais de um dia. |
| `exige_pt` | INTEGER | NOT NULL | `0` | 1 = só inicia com Permissão de Trabalho aprovada e vigente. |
| `afeta_seguranca_ambiente` | BOOLEAN | — | — | Impacta segurança pessoal/processual ou meio ambiente. |
| `afeta_custos` | BOOLEAN | — | — | Impacta custos da operação ou manutenção. |
| `afeta_producao_qualidade` | BOOLEAN | — | — | Impacta produção ou qualidade. |
| `possui_reserva` | BOOLEAN | — | — | Existe equipamento sobressalente disponível. |
| `risco_iminente` | BOOLEAN | — | — | O problema ocorreu ou há risco iminente. |
| `equipamento_monitorado` | BOOLEAN | — | — | O equipamento é monitorado. |
| `recursos_disponiveis` | BOOLEAN | — | — | Há recursos disponíveis para atendimento. |
| `necessita_parada_programada` | BOOLEAN | — | — | O serviço depende de parada programada. |
| `periodicidade_parada` | TEXT | — | — | Trimestral, Semestral ou Anual. |
| `criticidade` | TEXT | — | — | Classificação A/B/C copiada da nota de origem. |
| `prioridade` | TEXT | — | — | Prioridade calculada pelo fluxo de decisão. |
| `prioridade_nivel` | SMALLINT | — | — | Nível numérico (1 a 6). |
| `prazo_dias` | SMALLINT | — | — | Prazo-alvo em dias; NULL para parada programada. |
| `priorizado_em` | TEXT | — | — | Data/hora da última classificação (UTC). |

Índices: `idx_ordens_plano`, `idx_ordens_responsavel`, `idx_ordens_status`, `ordens_numero_key`.

#### `historico_prioridade`

Snapshots imutáveis de cada classificação de uma nota, vinculados à OM após a conversão.

Repositório: `server/src/data/repositories/notas.js / ordens.js`

| Coluna | Tipo | Restrições | Padrão | Descrição |
|---|---|---|---|---|
| `id` | INTEGER | PK | — | Identificador (gerado automaticamente). |
| `nota_id` | INTEGER | FK | — | Nota classificada. · → `notas.id` (ao excluir: SET NULL) |
| `ordem_id` | INTEGER | FK | — | OM de destino após conversão. · → `ordens.id` (ao excluir: SET NULL) |
| `afeta_seguranca_ambiente` | BOOLEAN | NOT NULL | — | Impacta segurança pessoal/processual ou meio ambiente. |
| `afeta_custos` | BOOLEAN | NOT NULL | — | Impacta custos da operação ou manutenção. |
| `afeta_producao_qualidade` | BOOLEAN | NOT NULL | — | Impacta produção ou qualidade. |
| `possui_reserva` | BOOLEAN | NOT NULL | — | Existe equipamento sobressalente disponível. |
| `risco_iminente` | BOOLEAN | NOT NULL | — | O problema ocorreu ou há risco iminente. |
| `equipamento_monitorado` | BOOLEAN | NOT NULL | — | O equipamento é monitorado. |
| `recursos_disponiveis` | BOOLEAN | NOT NULL | — | Há recursos disponíveis para atendimento. |
| `necessita_parada_programada` | BOOLEAN | NOT NULL | — | O serviço depende de parada programada. |
| `periodicidade_parada` | TEXT | — | — | Periodicidade de parada escolhida. · Valores: `Trimestral`, `Semestral`, `Anual` |
| `criticidade` | TEXT | NOT NULL | — | Criticidade derivada dos impactos e da existência de reserva. · Valores: `A`, `B`, `C` |
| `prioridade` | TEXT | NOT NULL | — | Código de prioridade resultante. · Valores: `IMEDIATO`, `URGENTE`, `ALTO`, `MEDIO`, `BAIXO`, `TRIMESTRAL`, `SEMESTRAL`, `ANUAL` |
| `prioridade_nivel` | SMALLINT | NOT NULL | — | Nível numérico (1 a 6). |
| `prazo_dias` | SMALLINT | — | — | Prazo-alvo em dias; NULL para parada programada. |
| `priorizado_por` | INTEGER | FK, NOT NULL | — | Usuário CCM/PCM que classificou. · → `usuarios.id` |
| `priorizado_em` | TEXT | NOT NULL | `to_char((CURRENT_TIMESTAMP AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD HH24:MI:SS'::text)` | Data/hora da classificação (UTC). |

Índices: `idx_historico_prioridade_nota`, `idx_historico_prioridade_ordem`.

#### `confirmacoes_paralisacao_prioridade`

Confirmação de CCM/PCM de que as demais atividades em andamento foram paralisadas para uma prioridade Imediato; o sistema não interrompe cronômetros automaticamente.

Repositório: `server/src/data/repositories/notas.js / ordens.js`

| Coluna | Tipo | Restrições | Padrão | Descrição |
|---|---|---|---|---|
| `id` | INTEGER | PK | — | Identificador (gerado automaticamente). |
| `historico_prioridade_id` | INTEGER | FK, UNIQUE, NOT NULL | — | Classificação Imediato que exige confirmação. · → `historico_prioridade.id` (ao excluir: CASCADE) |
| `confirmado_por` | INTEGER | FK, NOT NULL | — | Usuário CCM/PCM que registrou a confirmação. · → `usuarios.id` |
| `confirmado_em` | TEXT | NOT NULL | `to_char((CURRENT_TIMESTAMP AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD HH24:MI:SS'::text)` | Data/hora da confirmação (UTC). |

Índices: `confirmacoes_paralisacao_prioridade_historico_prioridade_id_key`.

#### `apontamentos`

Registros de execução da OM: as três condições de encerramento (um de cada tipo por OM).

Repositório: `server/src/data/repositories/apontamentos.js`

| Coluna | Tipo | Restrições | Padrão | Descrição |
|---|---|---|---|---|
| `id` | INTEGER | PK | — | Identificador (gerado automaticamente). |
| `ordem_id` | INTEGER | FK, NOT NULL | — | OM. · → `ordens.id` (ao excluir: CASCADE) |
| `colaborador_id` | INTEGER | FK | — | Colaborador (registros antigos). · → `colaboradores.id` |
| `tipo` | TEXT | NOT NULL | — | Condição registrada. · Valores: `Apropriação`, `Relatório`, `Validação` |
| `hh_apropriado` | DOUBLE_PRECISION | NOT NULL | `0` | HH apropriado (Apropriação). |
| `descricao` | TEXT | — | — | Detalhe (ex.: cálculo do cronômetro). |
| `data` | TEXT | NOT NULL | `to_char((CURRENT_TIMESTAMP AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD HH24:MI:SS'::text)` | Momento do registro (UTC; pode vir do aparelho, offline). |
| `usuario_id` | INTEGER | FK | — | Quem registrou. · → `usuarios.id` |

Índices: `idx_apont_ordem`.

#### `relatorios_execucao`

Relatório de execução da OM (um por OM), com as durações usadas em disponibilidade, MTBF e MTTR.

Repositório: `server/src/data/repositories/relatoriosExecucao.js`

| Coluna | Tipo | Restrições | Padrão | Descrição |
|---|---|---|---|---|
| `id` | INTEGER | PK | — | Identificador (gerado automaticamente). |
| `ordem_id` | INTEGER | FK, UNIQUE, NOT NULL | — | OM (única). · → `ordens.id` (ao excluir: CASCADE) |
| `usuario_id` | INTEGER | FK, NOT NULL | — | Autor. · → `usuarios.id` |
| `atividade_realizada` | TEXT | NOT NULL | — | O que foi feito. |
| `resultado` | TEXT | — | — | Resultado. |
| `materiais_utilizados` | TEXT | — | — | Materiais. |
| `observacoes` | TEXT | — | — | Observações. |
| `atualizado_em` | TEXT | NOT NULL | `to_char((CURRENT_TIMESTAMP AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD HH24:MI:SS'::text)` | Última gravação (UTC). |
| `indisponibilidade_horas` | DOUBLE_PRECISION | — | — | Horas de parada do equipamento. |
| `tempo_reparo_horas` | DOUBLE_PRECISION | — | — | Horas de reparo (MTTR). |

Índices: `relatorios_execucao_ordem_id_key`.

#### `evidencias_om`

Imagens de evidência anexadas à OM pelo executante (até 5 MB cada).

Repositório: `server/src/data/repositories/evidencias.js`

| Coluna | Tipo | Restrições | Padrão | Descrição |
|---|---|---|---|---|
| `id` | INTEGER | PK | — | Identificador (gerado automaticamente). |
| `ordem_id` | INTEGER | FK, NOT NULL | — | OM. · → `ordens.id` (ao excluir: CASCADE) |
| `usuario_id` | INTEGER | FK, NOT NULL | — | Quem enviou. · → `usuarios.id` |
| `nome_arquivo` | TEXT | NOT NULL | — | Nome original. |
| `tipo_mime` | TEXT | NOT NULL | — | Tipo da imagem. |
| `conteudo` | BYTEA | NOT NULL | — | Arquivo (binário). |
| `enviado_em` | TEXT | NOT NULL | `to_char((CURRENT_TIMESTAMP AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD HH24:MI:SS'::text)` | Envio (UTC). |

Índices: `idx_evidencias_ordem`.

#### `execucoes_om`

Execução cronometrada da OM (uma por OM). Ao finalizar, gera a Apropriação: HH = duração × executantes.

Repositório: `server/src/data/repositories/execucoes.js`

| Coluna | Tipo | Restrições | Padrão | Descrição |
|---|---|---|---|---|
| `id` | INTEGER | PK | — | Identificador (gerado automaticamente). |
| `ordem_id` | INTEGER | FK, UNIQUE, NOT NULL | — | OM (única). · → `ordens.id` (ao excluir: CASCADE) |
| `usuario_id` | INTEGER | FK, NOT NULL | — | Quem iniciou. · → `usuarios.id` |
| `num_executantes` | INTEGER | NOT NULL | — | Quantidade de executantes. |
| `iniciado_em` | TEXT | NOT NULL | `to_char((CURRENT_TIMESTAMP AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD HH24:MI:SS'::text)` | Início (UTC). |
| `finalizado_em` | TEXT | — | — | Fim (UTC); nulo = em andamento. |
| `duracao_horas` | DOUBLE_PRECISION | — | — | Duração cronometrada. |
| `hh_calculado` | DOUBLE_PRECISION | — | — | HH apropriado pela execução. |
| `apontamento_id` | INTEGER | FK | — | Apropriação gerada. · → `apontamentos.id` (ao excluir: SET NULL) |

Índices: `execucoes_om_ordem_id_key`.

#### `execucao_executantes`

Nomes dos executantes informados ao iniciar a execução.

Repositório: `server/src/data/repositories/execucoes.js`

| Coluna | Tipo | Restrições | Padrão | Descrição |
|---|---|---|---|---|
| `id` | INTEGER | PK | — | Identificador (gerado automaticamente). |
| `execucao_id` | INTEGER | FK, NOT NULL | — | Execução. · → `execucoes_om.id` (ao excluir: CASCADE) |
| `nome` | TEXT | NOT NULL | — | Nome do executante. |

Índices: `idx_execucao_executantes`.

#### `intercorrencias_om`

Intercorrências registradas em campo durante a execução (acompanhadas por PCM/CCM).

Repositório: `server/src/data/repositories/execucoes.js`

| Coluna | Tipo | Restrições | Padrão | Descrição |
|---|---|---|---|---|
| `id` | INTEGER | PK | — | Identificador (gerado automaticamente). |
| `ordem_id` | INTEGER | FK, NOT NULL | — | OM. · → `ordens.id` (ao excluir: CASCADE) |
| `execucao_id` | INTEGER | FK | — | Execução em andamento. · → `execucoes_om.id` (ao excluir: CASCADE) |
| `usuario_id` | INTEGER | FK, NOT NULL | — | Quem registrou. · → `usuarios.id` |
| `tipo` | TEXT | NOT NULL | — | Natureza da intercorrência. · Valores: `Desvio`, `Alteração de rota`, `Alteração de serviço`, `Outro` |
| `descricao` | TEXT | NOT NULL | — | Relato. |
| `registrado_em` | TEXT | NOT NULL | `to_char((CURRENT_TIMESTAMP AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD HH24:MI:SS'::text)` | Momento (UTC). |

Índices: `idx_intercorrencias_ordem`.

### Mão de obra, planejamento e turnos

Capacidade das equipes (HH disponível menos ocorrências), alocação semanal das OMs e passagem de turno com confirmação de leitura. Base do IAMOT e da aderência prevista.

```mermaid
erDiagram
  hh_disponivel {
    INTEGER id PK
    INTEGER equipe_id FK
    TEXT semana_inicio
    DOUBLE_PRECISION hh_disponivel
    INTEGER registrado_por FK
    TEXT atualizado_em
  }
  ocorrencias_hh {
    INTEGER id PK
    INTEGER colaborador_id FK
    TEXT tipo "Folga | Férias | Falta | Atestado"
    TEXT data_inicio
    TEXT data_fim
    DOUBLE_PRECISION horas_dia
    TEXT observacao
    INTEGER registrado_por FK
    TEXT criado_em
  }
  programacao_atividades {
    INTEGER id PK
    INTEGER ordem_id FK
    INTEGER equipe_id FK
    TEXT data
    DOUBLE_PRECISION hh_previsto
    TEXT observacao
    INTEGER criado_por FK
    TEXT criado_em
    TEXT atualizado_em
  }
  passagens_turno {
    INTEGER id PK
    TEXT data
    TEXT turno "Manhã | Tarde | Noite"
    INTEGER equipe_id FK
    INTEGER autor_id FK
    TEXT ocorrencias
    TEXT feito
    TEXT pendencias
    TEXT avisos
    TEXT criado_em
  }
  passagens_turno_leituras {
    INTEGER passagem_id PK,FK
    INTEGER usuario_id PK,FK
    TEXT lido_em
  }
  equipes ||--o{ hh_disponivel : "equipe_id"
  usuarios o|--o{ hh_disponivel : "registrado_por"
  colaboradores ||--o{ ocorrencias_hh : "colaborador_id"
  usuarios o|--o{ ocorrencias_hh : "registrado_por"
  ordens ||--o{ programacao_atividades : "ordem_id"
  equipes ||--o{ programacao_atividades : "equipe_id"
  usuarios o|--o{ programacao_atividades : "criado_por"
  equipes o|--o{ passagens_turno : "equipe_id"
  usuarios ||--o{ passagens_turno : "autor_id"
  passagens_turno ||--o{ passagens_turno_leituras : "passagem_id"
  usuarios ||--o{ passagens_turno_leituras : "usuario_id"
```

#### `hh_disponivel`

HH disponível lançado por equipe e semana (denominador do IAMOT).

Repositório: `server/src/data/repositories/hhDisponivel.js`

| Coluna | Tipo | Restrições | Padrão | Descrição |
|---|---|---|---|---|
| `id` | INTEGER | PK | — | Identificador (gerado automaticamente). |
| `equipe_id` | INTEGER | FK, NOT NULL | — | Equipe. · → `equipes.id` |
| `semana_inicio` | TEXT | NOT NULL | — | Segunda-feira da semana (AAAA-MM-DD). |
| `hh_disponivel` | DOUBLE_PRECISION | NOT NULL | — | Horas disponíveis da equipe na semana. |
| `registrado_por` | INTEGER | FK | — | Quem lançou. · → `usuarios.id` |
| `atualizado_em` | TEXT | NOT NULL | `to_char((CURRENT_TIMESTAMP AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD HH24:MI:SS'::text)` | Último lançamento (UTC). |

Chaves compostas: `UNIQUE (equipe_id, semana_inicio)`.
Índices: `hh_disponivel_equipe_id_semana_inicio_key`, `idx_hh_disponivel_semana`.

#### `ocorrencias_hh`

Ausências que reduzem o HH disponível (enviadas pelo executante em campo). Atestado é dado sensível (LGPD): só o CCM vê o tipo.

Repositório: `server/src/data/repositories/ocorrencias.js`

| Coluna | Tipo | Restrições | Padrão | Descrição |
|---|---|---|---|---|
| `id` | INTEGER | PK | — | Identificador (gerado automaticamente). |
| `colaborador_id` | INTEGER | FK, NOT NULL | — | Pessoa ausente. · → `colaboradores.id` |
| `tipo` | TEXT | NOT NULL | — | Tipo de ausência. · Valores: `Folga`, `Férias`, `Falta`, `Atestado` |
| `data_inicio` | TEXT | — | — | Primeiro dia (AAAA-MM-DD). |
| `data_fim` | TEXT | — | — | Último dia (AAAA-MM-DD). |
| `horas_dia` | DOUBLE_PRECISION | NOT NULL | `8` | Horas descontadas por dia útil. |
| `observacao` | TEXT | — | — | Observação. |
| `registrado_por` | INTEGER | FK | — | Quem enviou. · → `usuarios.id` |
| `criado_em` | TEXT | — | — | Envio (UTC). |

Índices: `idx_ocorrencias_colaborador`.

#### `programacao_atividades`

Alocação de HH de uma OM a uma equipe em um dia (planejamento semanal). Mantém as datas da OM sincronizadas.

Repositório: `server/src/data/repositories/programacao.js`

| Coluna | Tipo | Restrições | Padrão | Descrição |
|---|---|---|---|---|
| `id` | INTEGER | PK | — | Identificador (gerado automaticamente). |
| `ordem_id` | INTEGER | FK, NOT NULL | — | OM. · → `ordens.id` (ao excluir: CASCADE) |
| `equipe_id` | INTEGER | FK, NOT NULL | — | Equipe alocada. · → `equipes.id` |
| `data` | TEXT | NOT NULL | — | Dia (AAAA-MM-DD). |
| `hh_previsto` | DOUBLE_PRECISION | NOT NULL | — | HH alocado no dia. |
| `observacao` | TEXT | — | — | Observação. |
| `criado_por` | INTEGER | FK | — | Quem alocou. · → `usuarios.id` |
| `criado_em` | TEXT | NOT NULL | `to_char((CURRENT_TIMESTAMP AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD HH24:MI:SS'::text)` | Criação (UTC). |
| `atualizado_em` | TEXT | — | — | Última alteração (UTC). |

Índices: `idx_programacao_data`, `idx_programacao_ordem`.

#### `passagens_turno`

Passagem de turno estruturada e imutável.

Repositório: `server/src/data/repositories/passagens.js`

| Coluna | Tipo | Restrições | Padrão | Descrição |
|---|---|---|---|---|
| `id` | INTEGER | PK | — | Identificador (gerado automaticamente). |
| `data` | TEXT | NOT NULL | — | Data do turno (AAAA-MM-DD). |
| `turno` | TEXT | NOT NULL | — | Turno. · Valores: `Manhã`, `Tarde`, `Noite` |
| `equipe_id` | INTEGER | FK | — | Equipe. · → `equipes.id` |
| `autor_id` | INTEGER | FK, NOT NULL | — | Quem passou o turno. · → `usuarios.id` |
| `ocorrencias` | TEXT | — | — | Ocorrências do turno. |
| `feito` | TEXT | NOT NULL | — | O que foi feito. |
| `pendencias` | TEXT | — | — | Pendências para o próximo turno. |
| `avisos` | TEXT | — | — | Avisos de segurança/operação. |
| `criado_em` | TEXT | NOT NULL | `to_char((CURRENT_TIMESTAMP AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD HH24:MI:SS'::text)` | Registro (UTC). |

Índices: `idx_passagens_data`.

#### `passagens_turno_leituras`

Confirmação de leitura de cada passagem de turno, por usuário.

Repositório: `server/src/data/repositories/passagens.js`

| Coluna | Tipo | Restrições | Padrão | Descrição |
|---|---|---|---|---|
| `passagem_id` | INTEGER | PK, FK | — | Passagem. · → `passagens_turno.id` (ao excluir: CASCADE) |
| `usuario_id` | INTEGER | PK, FK | — | Leitor. · → `usuarios.id` |
| `lido_em` | TEXT | NOT NULL | `to_char((CURRENT_TIMESTAMP AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD HH24:MI:SS'::text)` | Confirmação (UTC). |

Chaves compostas: `PK (passagem_id, usuario_id)`.

### Formulários, inspeções e permissões de trabalho

Motor No-Code de formulários (checklists, inspeções, APR/PT), rotas e rondas de inspeção e o fluxo de Permissão de Trabalho. As respostas guardam uma cópia do modelo na versão em que foram preenchidas.

```mermaid
erDiagram
  formularios_modelos {
    INTEGER id PK
    TEXT nome
    TEXT tipo "Checklist | Inspeção | Permissão | Formulário livre"
    TEXT descricao
    TEXT campos
    TEXT regras
    INTEGER versao
    INTEGER ativo
    INTEGER criado_por FK
    TEXT criado_em
    INTEGER atualizado_por FK
    TEXT atualizado_em
  }
  formularios_respostas {
    INTEGER id PK
    INTEGER modelo_id FK
    INTEGER modelo_versao
    TEXT modelo_nome
    TEXT modelo_tipo
    TEXT campos
    INTEGER ordem_id FK
    INTEGER equipamento_id FK
    TEXT respostas
    TEXT nao_conformidades
    INTEGER usuario_id FK
    TEXT criado_em
  }
  formularios_anexos {
    INTEGER id PK
    INTEGER resposta_id FK
    TEXT campo_id
    TEXT tipo "foto | assinatura"
    TEXT nome_arquivo
    TEXT tipo_mime
    BYTEA conteudo
  }
  ordem_formularios {
    INTEGER ordem_id PK,FK
    INTEGER modelo_id PK,FK
    INTEGER obrigatorio
    INTEGER vinculado_por FK
    TEXT vinculado_em
  }
  rotas_inspecao {
    INTEGER id PK
    TEXT nome
    TEXT descricao
    TEXT area
    INTEGER ativo
    INTEGER criado_por FK
    TEXT criado_em
    INTEGER atualizado_por FK
    TEXT atualizado_em
  }
  rota_pontos {
    INTEGER id PK
    INTEGER rota_id FK
    INTEGER sequencia
    INTEGER equipamento_id FK
    INTEGER modelo_id FK
    TEXT instrucao
  }
  rondas_inspecao {
    INTEGER id PK
    INTEGER rota_id FK
    TEXT rota_nome
    INTEGER usuario_id FK
    TEXT status "Em andamento | Concluída"
    TEXT iniciada_em
    TEXT concluida_em
    TEXT observacao
  }
  ronda_pontos {
    INTEGER id PK
    INTEGER ronda_id FK
    INTEGER sequencia
    INTEGER equipamento_id FK
    INTEGER modelo_id FK
    TEXT instrucao
    TEXT status "Pendente | Inspecionado | Não inspecionado"
    INTEGER resposta_id FK
    TEXT nao_conformidades
    TEXT motivo
    TEXT registrado_em
  }
  permissoes_trabalho {
    INTEGER id PK
    TEXT numero UK
    INTEGER ordem_id FK
    INTEGER modelo_id FK
    INTEGER resposta_id FK
    TEXT status "Solicitada | Aprovada | Reprovada | Cancelada | Encerrada"
    TEXT validade_inicio
    TEXT validade_fim
    INTEGER solicitante_id FK
    TEXT solicitada_em
    INTEGER aprovador_id FK
    TEXT decidida_em
    TEXT parecer
    INTEGER encerrada_por FK
    TEXT encerrada_em
    TEXT observacao_encerramento
  }
  usuarios o|--o{ formularios_modelos : "criado_por"
  usuarios o|--o{ formularios_modelos : "atualizado_por"
  formularios_modelos ||--o{ formularios_respostas : "modelo_id"
  ordens o|--o{ formularios_respostas : "ordem_id"
  equipamentos o|--o{ formularios_respostas : "equipamento_id"
  usuarios ||--o{ formularios_respostas : "usuario_id"
  formularios_respostas ||--o{ formularios_anexos : "resposta_id"
  ordens ||--o{ ordem_formularios : "ordem_id"
  formularios_modelos ||--o{ ordem_formularios : "modelo_id"
  usuarios o|--o{ ordem_formularios : "vinculado_por"
  usuarios o|--o{ rotas_inspecao : "criado_por"
  usuarios o|--o{ rotas_inspecao : "atualizado_por"
  rotas_inspecao ||--o{ rota_pontos : "rota_id"
  equipamentos ||--o{ rota_pontos : "equipamento_id"
  formularios_modelos ||--o{ rota_pontos : "modelo_id"
  rotas_inspecao ||--o{ rondas_inspecao : "rota_id"
  usuarios ||--o{ rondas_inspecao : "usuario_id"
  rondas_inspecao ||--o{ ronda_pontos : "ronda_id"
  equipamentos o|--o{ ronda_pontos : "equipamento_id"
  formularios_modelos o|--o{ ronda_pontos : "modelo_id"
  formularios_respostas o|--o{ ronda_pontos : "resposta_id"
  ordens ||--o{ permissoes_trabalho : "ordem_id"
  formularios_modelos ||--o{ permissoes_trabalho : "modelo_id"
  formularios_respostas ||--o{ permissoes_trabalho : "resposta_id"
  usuarios ||--o{ permissoes_trabalho : "solicitante_id"
  usuarios o|--o{ permissoes_trabalho : "aprovador_id"
  usuarios o|--o{ permissoes_trabalho : "encerrada_por"
```

#### `formularios_modelos`

Modelos de formulário criados no construtor No-Code. Cada alteração gera nova versão.

Repositório: `server/src/data/repositories/formularios.js`

| Coluna | Tipo | Restrições | Padrão | Descrição |
|---|---|---|---|---|
| `id` | INTEGER | PK | — | Identificador (gerado automaticamente). |
| `nome` | TEXT | NOT NULL | — | Nome. |
| `tipo` | TEXT | NOT NULL | — | Uso do formulário. · Valores: `Checklist`, `Inspeção`, `Permissão`, `Formulário livre` |
| `descricao` | TEXT | — | — | Descrição. |
| `campos` | TEXT | NOT NULL | — | JSON com os campos (tipo, obrigatoriedade, limites, condições). |
| `regras` | TEXT | NOT NULL | `'{}'::text` | JSON com regras de aplicação automática às OMs (tipos de OM, classes de equipamento, obrigatório). |
| `versao` | INTEGER | NOT NULL | `1` | Versão atual. |
| `ativo` | INTEGER | NOT NULL | `1` | 1 = disponível; 0 = desativado (preserva respostas). |
| `criado_por` | INTEGER | FK | — | Autor. · → `usuarios.id` |
| `criado_em` | TEXT | NOT NULL | `to_char((CURRENT_TIMESTAMP AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD HH24:MI:SS'::text)` | Criação (UTC). |
| `atualizado_por` | INTEGER | FK | — | Último editor. · → `usuarios.id` |
| `atualizado_em` | TEXT | — | — | Última edição (UTC). |

#### `formularios_respostas`

Respostas preenchidas, com o modelo congelado na versão usada e as não conformidades detectadas.

Repositório: `server/src/data/repositories/respostasFormulario.js`

| Coluna | Tipo | Restrições | Padrão | Descrição |
|---|---|---|---|---|
| `id` | INTEGER | PK | — | Identificador (gerado automaticamente). |
| `modelo_id` | INTEGER | FK, NOT NULL | — | Modelo. · → `formularios_modelos.id` |
| `modelo_versao` | INTEGER | NOT NULL | — | Versão do modelo no preenchimento. |
| `modelo_nome` | TEXT | NOT NULL | — | Nome do modelo (cópia). |
| `modelo_tipo` | TEXT | NOT NULL | — | Tipo do modelo (cópia). |
| `campos` | TEXT | NOT NULL | — | JSON dos campos (cópia). |
| `ordem_id` | INTEGER | FK | — | OM (opcional). · → `ordens.id` |
| `equipamento_id` | INTEGER | FK | — | Equipamento. · → `equipamentos.id` |
| `respostas` | TEXT | NOT NULL | — | JSON campo → valor. |
| `nao_conformidades` | TEXT | NOT NULL | `'[]'::text` | JSON com as não conformidades. |
| `usuario_id` | INTEGER | FK, NOT NULL | — | Quem preencheu. · → `usuarios.id` |
| `criado_em` | TEXT | NOT NULL | `to_char((CURRENT_TIMESTAMP AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD HH24:MI:SS'::text)` | Preenchimento (UTC; pode vir do aparelho). |

Índices: `idx_form_respostas_equipamento`, `idx_form_respostas_ordem`.

#### `formularios_anexos`

Fotos e assinaturas enviadas nas respostas.

Repositório: `server/src/data/repositories/respostasFormulario.js`

| Coluna | Tipo | Restrições | Padrão | Descrição |
|---|---|---|---|---|
| `id` | INTEGER | PK | — | Identificador (gerado automaticamente). |
| `resposta_id` | INTEGER | FK, NOT NULL | — | Resposta. · → `formularios_respostas.id` (ao excluir: CASCADE) |
| `campo_id` | TEXT | NOT NULL | — | Campo do modelo. |
| `tipo` | TEXT | NOT NULL | — | Tipo do anexo. · Valores: `foto`, `assinatura` |
| `nome_arquivo` | TEXT | NOT NULL | — | Nome original. |
| `tipo_mime` | TEXT | NOT NULL | — | Tipo da imagem. |
| `conteudo` | BYTEA | NOT NULL | — | Arquivo (binário). |

Índices: `idx_form_anexos_resposta`.

#### `ordem_formularios`

Formulários vinculados manualmente a uma OM (checklist), obrigatórios ou não.

Repositório: `server/src/data/repositories/formularios.js`

| Coluna | Tipo | Restrições | Padrão | Descrição |
|---|---|---|---|---|
| `ordem_id` | INTEGER | PK, FK | — | OM. · → `ordens.id` (ao excluir: CASCADE) |
| `modelo_id` | INTEGER | PK, FK | — | Modelo. · → `formularios_modelos.id` |
| `obrigatorio` | INTEGER | NOT NULL | `0` | 1 = a OM só encerra com o formulário respondido. |
| `vinculado_por` | INTEGER | FK | — | Quem vinculou. · → `usuarios.id` |
| `vinculado_em` | TEXT | NOT NULL | `to_char((CURRENT_TIMESTAMP AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD HH24:MI:SS'::text)` | Vínculo (UTC). |

Chaves compostas: `PK (ordem_id, modelo_id)`.

#### `rotas_inspecao`

Rotas de inspeção: roteiro de pontos a percorrer.

Repositório: `server/src/data/repositories/rotasInspecao.js`

| Coluna | Tipo | Restrições | Padrão | Descrição |
|---|---|---|---|---|
| `id` | INTEGER | PK | — | Identificador (gerado automaticamente). |
| `nome` | TEXT | NOT NULL | — | Nome. |
| `descricao` | TEXT | — | — | Descrição. |
| `area` | TEXT | — | — | Área. |
| `ativo` | INTEGER | NOT NULL | `1` | 1 = disponível; 0 = desativada (preserva rondas). |
| `criado_por` | INTEGER | FK | — | Autor. · → `usuarios.id` |
| `criado_em` | TEXT | NOT NULL | `to_char((CURRENT_TIMESTAMP AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD HH24:MI:SS'::text)` | Criação (UTC). |
| `atualizado_por` | INTEGER | FK | — | Último editor. · → `usuarios.id` |
| `atualizado_em` | TEXT | — | — | Última edição (UTC). |

#### `rota_pontos`

Pontos da rota, em sequência: equipamento + formulário + instrução.

Repositório: `server/src/data/repositories/rotasInspecao.js`

| Coluna | Tipo | Restrições | Padrão | Descrição |
|---|---|---|---|---|
| `id` | INTEGER | PK | — | Identificador (gerado automaticamente). |
| `rota_id` | INTEGER | FK, NOT NULL | — | Rota. · → `rotas_inspecao.id` (ao excluir: CASCADE) |
| `sequencia` | INTEGER | NOT NULL | — | Ordem do ponto. |
| `equipamento_id` | INTEGER | FK, NOT NULL | — | Equipamento. · → `equipamentos.id` |
| `modelo_id` | INTEGER | FK, NOT NULL | — | Formulário de inspeção. · → `formularios_modelos.id` |
| `instrucao` | TEXT | — | — | Instrução ao inspetor. |

Índices: `idx_rota_pontos_rota`.

#### `rondas_inspecao`

Execução de uma rota por um inspetor (ronda).

Repositório: `server/src/data/repositories/rondasInspecao.js`

| Coluna | Tipo | Restrições | Padrão | Descrição |
|---|---|---|---|---|
| `id` | INTEGER | PK | — | Identificador (gerado automaticamente). |
| `rota_id` | INTEGER | FK, NOT NULL | — | Rota. · → `rotas_inspecao.id` |
| `rota_nome` | TEXT | NOT NULL | — | Nome da rota (cópia). |
| `usuario_id` | INTEGER | FK, NOT NULL | — | Inspetor. · → `usuarios.id` |
| `status` | TEXT | NOT NULL | `'Em andamento'::text` | Situação. · Valores: `Em andamento`, `Concluída` |
| `iniciada_em` | TEXT | NOT NULL | `to_char((CURRENT_TIMESTAMP AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD HH24:MI:SS'::text)` | Início (UTC). |
| `concluida_em` | TEXT | — | — | Conclusão (UTC). |
| `observacao` | TEXT | — | — | Observação final. |

Índices: `idx_rondas_usuario`.

#### `ronda_pontos`

Pontos da ronda (copiados da rota ao iniciar) e o resultado de cada um.

Repositório: `server/src/data/repositories/rondasInspecao.js`

| Coluna | Tipo | Restrições | Padrão | Descrição |
|---|---|---|---|---|
| `id` | INTEGER | PK | — | Identificador (gerado automaticamente). |
| `ronda_id` | INTEGER | FK, NOT NULL | — | Ronda. · → `rondas_inspecao.id` (ao excluir: CASCADE) |
| `sequencia` | INTEGER | NOT NULL | — | Ordem. |
| `equipamento_id` | INTEGER | FK | — | Equipamento. · → `equipamentos.id` |
| `modelo_id` | INTEGER | FK | — | Formulário. · → `formularios_modelos.id` |
| `instrucao` | TEXT | — | — | Instrução. |
| `status` | TEXT | NOT NULL | `'Pendente'::text` | Resultado do ponto. · Valores: `Pendente`, `Inspecionado`, `Não inspecionado` |
| `resposta_id` | INTEGER | FK | — | Resposta do formulário. · → `formularios_respostas.id` |
| `nao_conformidades` | TEXT | NOT NULL | `'[]'::text` | JSON com os desvios. |
| `motivo` | TEXT | — | — | Por que não foi inspecionado. |
| `registrado_em` | TEXT | — | — | Registro (UTC). |

Índices: `idx_ronda_pontos_ronda`.

#### `permissoes_trabalho`

Permissão de Trabalho (APR/PT) da OM, com validade de até 24 h e segregação de funções na aprovação.

Repositório: `server/src/data/repositories/permissoesTrabalho.js`

| Coluna | Tipo | Restrições | Padrão | Descrição |
|---|---|---|---|---|
| `id` | INTEGER | PK | — | Identificador (gerado automaticamente). |
| `numero` | TEXT | UNIQUE, NOT NULL | — | Número (PT-00001). |
| `ordem_id` | INTEGER | FK, NOT NULL | — | OM. · → `ordens.id` |
| `modelo_id` | INTEGER | FK, NOT NULL | — | Modelo da APR. · → `formularios_modelos.id` |
| `resposta_id` | INTEGER | FK, NOT NULL | — | APR preenchida. · → `formularios_respostas.id` |
| `status` | TEXT | NOT NULL | `'Solicitada'::text` | Situação. · Valores: `Solicitada`, `Aprovada`, `Reprovada`, `Cancelada`, `Encerrada` |
| `validade_inicio` | TEXT | NOT NULL | — | Início da validade (AAAA-MM-DDTHH:MM, local). |
| `validade_fim` | TEXT | NOT NULL | — | Fim da validade. |
| `solicitante_id` | INTEGER | FK, NOT NULL | — | Quem solicitou. · → `usuarios.id` |
| `solicitada_em` | TEXT | NOT NULL | `to_char((CURRENT_TIMESTAMP AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD HH24:MI:SS'::text)` | Solicitação (UTC). |
| `aprovador_id` | INTEGER | FK | — | Quem aprovou/reprovou. · → `usuarios.id` |
| `decidida_em` | TEXT | — | — | Decisão (UTC). |
| `parecer` | TEXT | — | — | Parecer/motivo. |
| `encerrada_por` | INTEGER | FK | — | Quem encerrou. · → `usuarios.id` |
| `encerrada_em` | TEXT | — | — | Encerramento (UTC). |
| `observacao_encerramento` | TEXT | — | — | Observação do encerramento. |

Índices: `idx_permissoes_ordem`, `permissoes_trabalho_numero_key`.

### Qualidade de dados, notificações e governança

Sinalizações da IA com decisão humana, notificações de eventos críticos, metas dos KPIs e a trilha de auditoria (LGPD).

```mermaid
erDiagram
  sinalizacoes_ia {
    INTEGER id PK
    TEXT entidade_tipo
    INTEGER entidade_id
    TEXT ordem_numero
    TEXT campo
    DOUBLE_PRECISION valor_atual
    DOUBLE_PRECISION valor_sugerido
    TEXT tipo
    DOUBLE_PRECISION score
    TEXT explicacao
    TEXT status "Nova | Aceita | Rejeitada"
    TEXT criado_em
    DOUBLE_PRECISION valor_aplicado
    INTEGER decidido_por FK
    TEXT decidido_em
    TEXT justificativa
  }
  notificacoes {
    INTEGER id PK
    TEXT chave UK
    TEXT tipo
    TEXT severidade "Crítica | Alta | Média | Baixa"
    TEXT titulo
    TEXT mensagem
    TEXT entidade
    INTEGER entidade_id
    TEXT link
    TEXT papeis
    INTEGER usuario_id FK
    TEXT status "Aberta | Em tratamento | Resolvida"
    TEXT criada_em
    TEXT atualizada_em
    TEXT resolvida_em
    INTEGER resolvida_por FK
    TEXT resolucao
  }
  notificacoes_leituras {
    INTEGER notificacao_id PK,FK
    INTEGER usuario_id PK,FK
    TEXT lida_em
  }
  notificacoes_destinatarios {
    INTEGER notificacao_id PK,FK
    INTEGER usuario_id PK,FK
    INTEGER incluido_por FK
    TEXT incluido_em
  }
  notificacoes_acoes {
    INTEGER id PK
    INTEGER notificacao_id FK
    INTEGER usuario_id FK
    TEXT tipo "Resposta | Encaminhamento | Resolução"
    TEXT texto
    INTEGER destinatario_id FK
    TEXT criado_em
  }
  parametros_kpi {
    TEXT chave PK
    DOUBLE_PRECISION valor
    INTEGER atualizado_por FK
    TEXT atualizado_em
  }
  trilha_auditoria {
    INTEGER id PK
    INTEGER usuario_id FK
    TEXT acao
    TEXT entidade
    INTEGER entidade_id
    TEXT detalhe
    TEXT data_hora
  }
  usuarios o|--o{ sinalizacoes_ia : "decidido_por"
  usuarios o|--o{ notificacoes : "usuario_id"
  usuarios o|--o{ notificacoes : "resolvida_por"
  notificacoes ||--o{ notificacoes_leituras : "notificacao_id"
  usuarios ||--o{ notificacoes_leituras : "usuario_id"
  notificacoes ||--o{ notificacoes_destinatarios : "notificacao_id"
  usuarios ||--o{ notificacoes_destinatarios : "usuario_id"
  usuarios o|--o{ notificacoes_destinatarios : "incluido_por"
  notificacoes ||--o{ notificacoes_acoes : "notificacao_id"
  usuarios ||--o{ notificacoes_acoes : "usuario_id"
  usuarios o|--o{ notificacoes_acoes : "destinatario_id"
  usuarios o|--o{ parametros_kpi : "atualizado_por"
  usuarios o|--o{ trilha_auditoria : "usuario_id"
```

#### `sinalizacoes_ia`

Inconsistências detectadas pela IA com explicação (XAI) e a decisão humana (aceitar/rejeitar).

Repositório: `server/src/data/repositories/sinalizacoes.js`

| Coluna | Tipo | Restrições | Padrão | Descrição |
|---|---|---|---|---|
| `id` | INTEGER | PK | — | Identificador (gerado automaticamente). |
| `entidade_tipo` | TEXT | NOT NULL | `'apontamento'::text` | Tipo do registro sinalizado. |
| `entidade_id` | INTEGER | — | — | Registro sinalizado. |
| `ordem_numero` | TEXT | — | — | Número da OM. |
| `campo` | TEXT | — | — | Campo avaliado. |
| `valor_atual` | DOUBLE_PRECISION | — | — | Valor registrado. |
| `valor_sugerido` | DOUBLE_PRECISION | — | — | Valor sugerido pela IA. |
| `tipo` | TEXT | — | — | Tipo de inconsistência. |
| `score` | DOUBLE_PRECISION | — | — | Confiança (0 a 1). |
| `explicacao` | TEXT | — | — | JSON com os fatores da decisão. |
| `status` | TEXT | NOT NULL | `'Nova'::text` | Situação. · Valores: `Nova`, `Aceita`, `Rejeitada` |
| `criado_em` | TEXT | NOT NULL | `to_char((CURRENT_TIMESTAMP AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD HH24:MI:SS'::text)` | Detecção (UTC). |
| `valor_aplicado` | DOUBLE_PRECISION | — | — | Valor gravado ao aceitar. |
| `decidido_por` | INTEGER | FK | — | Quem decidiu. · → `usuarios.id` |
| `decidido_em` | TEXT | — | — | Decisão (UTC). |
| `justificativa` | TEXT | — | — | Justificativa da decisão. |

Índices: `idx_sinais_entidade`, `idx_sinais_status`.

#### `notificacoes`

Eventos críticos (OM atrasada, preventiva, PT pendente, inconsistência), gerados de forma idempotente e resolvidos automaticamente quando a condição some.

Repositório: `server/src/data/repositories/notificacoes.js`

| Coluna | Tipo | Restrições | Padrão | Descrição |
|---|---|---|---|---|
| `id` | INTEGER | PK | — | Identificador (gerado automaticamente). |
| `chave` | TEXT | UNIQUE, NOT NULL | — | Chave única do evento (evita duplicidade). |
| `tipo` | TEXT | NOT NULL | — | Tipo do evento. |
| `severidade` | TEXT | NOT NULL | — | Severidade. · Valores: `Crítica`, `Alta`, `Média`, `Baixa` |
| `titulo` | TEXT | NOT NULL | — | Título. |
| `mensagem` | TEXT | — | — | Mensagem. |
| `entidade` | TEXT | — | — | Tipo do registro de origem. |
| `entidade_id` | INTEGER | — | — | Registro de origem. |
| `link` | TEXT | — | — | Tela do sistema. |
| `papeis` | TEXT | NOT NULL | `'CCM,PCM'::text` | Perfis que veem (lista separada por vírgula). |
| `usuario_id` | INTEGER | FK | — | Destinatário direto. · → `usuarios.id` |
| `status` | TEXT | NOT NULL | `'Aberta'::text` | Situação. · Valores: `Aberta`, `Em tratamento`, `Resolvida` |
| `criada_em` | TEXT | NOT NULL | `to_char((CURRENT_TIMESTAMP AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD HH24:MI:SS'::text)` | Criação (UTC). |
| `atualizada_em` | TEXT | — | — | Última atualização (UTC). |
| `resolvida_em` | TEXT | — | — | Resolução (UTC). |
| `resolvida_por` | INTEGER | FK | — | Quem resolveu. · → `usuarios.id` |
| `resolucao` | TEXT | — | — | Como foi resolvida. |

Índices: `idx_notificacoes_status`, `idx_notificacoes_usuario`, `notificacoes_chave_key`.

#### `notificacoes_leituras`

Leitura de notificação por usuário.

Repositório: `server/src/data/repositories/notificacoes.js`

| Coluna | Tipo | Restrições | Padrão | Descrição |
|---|---|---|---|---|
| `notificacao_id` | INTEGER | PK, FK | — | Notificação. · → `notificacoes.id` (ao excluir: CASCADE) |
| `usuario_id` | INTEGER | PK, FK | — | Leitor. · → `usuarios.id` |
| `lida_em` | TEXT | NOT NULL | `to_char((CURRENT_TIMESTAMP AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD HH24:MI:SS'::text)` | Leitura (UTC). |

Chaves compostas: `PK (notificacao_id, usuario_id)`.

#### `notificacoes_destinatarios`

Destinatários incluídos por encaminhamento.

Repositório: `server/src/data/repositories/notificacoes.js`

| Coluna | Tipo | Restrições | Padrão | Descrição |
|---|---|---|---|---|
| `notificacao_id` | INTEGER | PK, FK | — | Notificação. · → `notificacoes.id` (ao excluir: CASCADE) |
| `usuario_id` | INTEGER | PK, FK | — | Destinatário. · → `usuarios.id` |
| `incluido_por` | INTEGER | FK | — | Quem encaminhou. · → `usuarios.id` |
| `incluido_em` | TEXT | NOT NULL | `to_char((CURRENT_TIMESTAMP AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD HH24:MI:SS'::text)` | Encaminhamento (UTC). |

Chaves compostas: `PK (notificacao_id, usuario_id)`.

#### `notificacoes_acoes`

Histórico de tratamento da notificação (respostas, encaminhamentos e resolução).

Repositório: `server/src/data/repositories/notificacoes.js`

| Coluna | Tipo | Restrições | Padrão | Descrição |
|---|---|---|---|---|
| `id` | INTEGER | PK | — | Identificador (gerado automaticamente). |
| `notificacao_id` | INTEGER | FK, NOT NULL | — | Notificação. · → `notificacoes.id` (ao excluir: CASCADE) |
| `usuario_id` | INTEGER | FK, NOT NULL | — | Autor. · → `usuarios.id` |
| `tipo` | TEXT | NOT NULL | — | Ação. · Valores: `Resposta`, `Encaminhamento`, `Resolução` |
| `texto` | TEXT | — | — | Texto. |
| `destinatario_id` | INTEGER | FK | — | Destinatário do encaminhamento. · → `usuarios.id` |
| `criado_em` | TEXT | NOT NULL | `to_char((CURRENT_TIMESTAMP AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD HH24:MI:SS'::text)` | Registro (UTC). |

Índices: `idx_notificacoes_acoes`.

#### `parametros_kpi`

Metas e parâmetros de cálculo dos KPIs, editáveis pelo CCM (lista e limites em server/src/parametros.js).

Repositório: `server/src/data/repositories/parametros.js`

| Coluna | Tipo | Restrições | Padrão | Descrição |
|---|---|---|---|---|
| `chave` | TEXT | PK | — | Parâmetro (ex.: meta_disponibilidade). |
| `valor` | DOUBLE_PRECISION | NOT NULL | — | Valor em vigor. |
| `atualizado_por` | INTEGER | FK | — | Quem alterou. · → `usuarios.id` |
| `atualizado_em` | TEXT | NOT NULL | `to_char((CURRENT_TIMESTAMP AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD HH24:MI:SS'::text)` | Alteração (UTC). |

#### `trilha_auditoria`

Trilha de auditoria (governança/LGPD): toda ação relevante, somente inclusão.

Repositório: `server/src/data/repositories/auditoria.js`

| Coluna | Tipo | Restrições | Padrão | Descrição |
|---|---|---|---|---|
| `id` | INTEGER | PK | — | Identificador (gerado automaticamente). |
| `usuario_id` | INTEGER | FK | — | Quem fez. · → `usuarios.id` |
| `acao` | TEXT | NOT NULL | — | Ação (ex.: criar_usuario, encerrar_auto). |
| `entidade` | TEXT | — | — | Tipo do registro afetado. |
| `entidade_id` | INTEGER | — | — | Registro afetado. |
| `detalhe` | TEXT | — | — | Resumo legível (sem dado sensível). |
| `data_hora` | TEXT | NOT NULL | `to_char((CURRENT_TIMESTAMP AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD HH24:MI:SS'::text)` | Momento (UTC). |

### Infraestrutura

Controle de versão do banco e suporte à operação offline.

```mermaid
erDiagram
  schema_migrations {
    TEXT id PK
    TEXT aplicada_em
  }
  requisicoes_idempotentes {
    TEXT chave PK
    INTEGER usuario_id FK
    TEXT metodo
    TEXT rota
    INTEGER status
    TEXT resposta
    TEXT criado_em
  }
  usuarios o|--o{ requisicoes_idempotentes : "usuario_id"
```

#### `schema_migrations`

Migrações já aplicadas (e o marcador da carga de demonstração).

| Coluna | Tipo | Restrições | Padrão | Descrição |
|---|---|---|---|---|
| `id` | TEXT | PK | — | Id da migração. |
| `aplicada_em` | TEXT | NOT NULL | `to_char((CURRENT_TIMESTAMP AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD HH24:MI:SS'::text)` | Aplicação (UTC). |

#### `requisicoes_idempotentes`

Respostas dos envios da fila offline (X-Idempotency-Key), guardadas por 30 dias para que reenvios não repitam a operação.

Repositório: `server/src/data/repositories/idempotencia.js`

| Coluna | Tipo | Restrições | Padrão | Descrição |
|---|---|---|---|---|
| `chave` | TEXT | PK | — | Chave enviada pelo aparelho. |
| `usuario_id` | INTEGER | FK | — | Dono da chave. · → `usuarios.id` |
| `metodo` | TEXT | NOT NULL | — | Método HTTP. |
| `rota` | TEXT | NOT NULL | — | Rota chamada. |
| `status` | INTEGER | NOT NULL | — | Código HTTP da resposta original. |
| `resposta` | TEXT | — | — | Corpo JSON da resposta original. |
| `criado_em` | TEXT | NOT NULL | `to_char((CURRENT_TIMESTAMP AT TIME ZONE 'UTC'::text), 'YYYY-MM-DD HH24:MI:SS'::text)` | Primeiro envio (UTC). |

Índices: `idx_requisicoes_idempotentes_data`.

## Migrações

| # | Id |
|---|---|
| 1 | `20261013000000_initial_schema` |
| 2 | `20261013000100_double_precision_hours` |
| 3 | `20261013000200_work_order_priority_flow` |
| 4 | `20261013000300_priority_shutdown_confirmation` |
