// Dicionário de dados do SIGMA·CCM: módulos, descrição de cada tabela e das colunas de negócio.
// Chaves estrangeiras e valores permitidos (CHECK) são lidos do banco pelo gerador; aqui fica o significado.
// Ao criar uma tabela nova (migração), descreva-a aqui e rode: node scripts/gerar-doc-banco.js

export const MODULES = [
  {
    nome: "Acesso, pessoas e equipes",
    descricao: "Quem usa o sistema e como as pessoas se organizam. Colaborador = usuário: cada usuário tem um vínculo em `colaboradores`, criado automaticamente.",
    tabelas: ["usuarios", "equipes", "colaboradores"],
  },
  {
    nome: "Ativos e planos de manutenção",
    descricao: "Equipamentos (com hierarquia pai/filho e TAG única) e os planos preventivos que geram OMs.",
    tabelas: ["equipamentos", "planos_preventivos"],
  },
  {
    nome: "Notas e ordens de manutenção",
    descricao: "Fluxo principal: nota → OM → programação → distribuição → execução (cronômetro, intercorrências, evidências, relatório) → encerramento automático quando Apropriação, Relatório, Validação e checklists obrigatórios estão completos.",
    tabelas: ["notas", "ordens", "apontamentos", "relatorios_execucao", "evidencias_om", "execucoes_om", "execucao_executantes", "intercorrencias_om"],
  },
  {
    nome: "Mão de obra, planejamento e turnos",
    descricao: "Capacidade das equipes (HH disponível menos ocorrências), alocação semanal das OMs e passagem de turno com confirmação de leitura. Base do IAMOT e da aderência prevista.",
    tabelas: ["hh_disponivel", "ocorrencias_hh", "programacao_atividades", "passagens_turno", "passagens_turno_leituras"],
  },
  {
    nome: "Formulários, inspeções e permissões de trabalho",
    descricao: "Motor No-Code de formulários (checklists, inspeções, APR/PT), rotas e rondas de inspeção e o fluxo de Permissão de Trabalho. As respostas guardam uma cópia do modelo na versão em que foram preenchidas.",
    tabelas: ["formularios_modelos", "formularios_respostas", "formularios_anexos", "ordem_formularios", "rotas_inspecao", "rota_pontos", "rondas_inspecao", "ronda_pontos", "permissoes_trabalho"],
  },
  {
    nome: "Qualidade de dados, notificações e governança",
    descricao: "Sinalizações da IA com decisão humana, notificações de eventos críticos, metas dos KPIs e a trilha de auditoria (LGPD).",
    tabelas: ["sinalizacoes_ia", "notificacoes", "notificacoes_leituras", "notificacoes_destinatarios", "notificacoes_acoes", "parametros_kpi", "trilha_auditoria"],
  },
  {
    nome: "Infraestrutura",
    descricao: "Controle de versão do banco e suporte à operação offline.",
    tabelas: ["schema_migrations", "requisicoes_idempotentes"],
  },
];

// Ligações por valor (sem chave estrangeira declarada).
export const LOGICAL_LINKS = [
  "`sinalizacoes_ia.ordem_numero` → `ordens.numero`; `sinalizacoes_ia.entidade_id` → `apontamentos.id` quando `entidade_tipo = 'apontamento'`.",
  "`notificacoes.entidade` + `notificacoes.entidade_id` → registro de origem (`ordem`, `plano_preventivo`, `permissao_trabalho` ou `sinalizacao`).",
  "`trilha_auditoria.entidade` + `trilha_auditoria.entidade_id` → registro afetado pela ação.",
  "`rondas_inspecao.rota_nome`, `formularios_respostas.modelo_*` e `formularios_respostas.campos` são cópias congeladas (histórico preservado mesmo se a rota ou o modelo mudar).",
];

const ID = "Identificador (gerado automaticamente).";

export const TABLE_DOCS = {
  // ------------------------------------------------------------ Acesso, pessoas e equipes
  usuarios: {
    repositorio: "usuarios.js",
    descricao: "Usuários do sistema (login e perfil de acesso). Também são os colaboradores das equipes.",
    colunas: {
      id: ID, nome: "Nome completo.", email: "E-mail (opcional, único).", username: "Login (único).",
      senha_hash: "Senha com hash bcrypt (nunca em texto).", papel: "Perfil de acesso (RBAC).",
      ativo: "1 = pode entrar no sistema; 0 = desativado.", criado_em: "Data/hora de cadastro (UTC).", equipe_id: "Equipe da pessoa.",
    },
  },
  equipes: {
    repositorio: "equipes.js",
    descricao: "Equipes de manutenção, próprias ou terceirizadas.",
    colunas: { id: ID, nome: "Nome da equipe.", tipo: "Vínculo da equipe.", especialidade: "Especialidade principal." },
  },
  colaboradores: {
    repositorio: "colaboradores.js",
    descricao: "Vínculo de pessoa (colaborador = usuário). Ponte para ocorrências de HH e apontamentos antigos; sincronizado a partir de `usuarios`.",
    colunas: { id: ID, nome: "Nome.", matricula: "Matrícula (única, opcional).", especialidade: "Especialidade.", equipe_id: "Equipe.", usuario_id: "Usuário correspondente." },
  },
  // ------------------------------------------------------------ Ativos e planos
  equipamentos: {
    repositorio: "equipamentos.js",
    descricao: "Equipamentos (ativos) mantidos, com TAG única e hierarquia.",
    colunas: {
      id: ID, tag: "TAG única (gerada pelo prefixo da classe, ex.: BOM-0001, ou manual).", descricao: "Descrição.",
      localizacao: "Área/local (filtro de área dos indicadores).", classe: "Classe (bomba, motor, painel…).",
      criticidade: "Criticidade operacional.", pai_id: "Equipamento pai (hierarquia).",
    },
  },
  planos_preventivos: {
    repositorio: "planos.js",
    descricao: "Planos de manutenção preventiva; geram OMs preventivas e notificações de vencimento.",
    colunas: { id: ID, equipamento_id: "Equipamento do plano.", descricao: "Atividade.", periodicidade: "Periodicidade (texto livre: Mensal, 500 horas…).", proxima_data: "Próxima execução (AAAA-MM-DD).", equipe_id: "Equipe responsável." },
  },
  // ------------------------------------------------------------ Notas e ordens
  notas: {
    repositorio: "notas.js",
    descricao: "Notas de manutenção (solicitações) que podem ser convertidas em OM.",
    colunas: { id: ID, numero: "Número sequencial da nota.", equipamento_id: "Equipamento.", descricao: "Problema relatado.", tipo: "Tipo (Corretiva, Inspeção…).", status: "Situação.", solicitante_id: "Quem abriu.", data_abertura: "Data/hora de abertura (UTC)." },
  },
  ordens: {
    repositorio: "ordens.js",
    descricao: "Ordens de manutenção (OM), núcleo do sistema.",
    colunas: {
      id: ID, numero: "Número sequencial da OM.", tipo: "Corretiva, Preventiva, Inspeção…", status: "Etapa do fluxo da OM.",
      equipamento_id: "Equipamento.", nota_id: "Nota de origem.", plano_id: "Plano de manutenção vinculado.", equipe_id: "Equipe programada.",
      hh_previsto: "HH previsto.", data_programada: "Início programado (AAAA-MM-DD).", data_encerramento: "Data de encerramento (DD/MM/AAAA).",
      criado_em: "Criação (UTC); base da janela dos indicadores.", responsavel_id: "Executante designado (distribuição).",
      data_fim_programada: "Término previsto (AAAA-MM-DD), quando a OM ocupa mais de um dia.", exige_pt: "1 = só inicia com Permissão de Trabalho aprovada e vigente.",
    },
  },
  apontamentos: {
    repositorio: "apontamentos.js",
    descricao: "Registros de execução da OM: as três condições de encerramento (um de cada tipo por OM).",
    colunas: { id: ID, ordem_id: "OM.", colaborador_id: "Colaborador (registros antigos).", tipo: "Condição registrada.", hh_apropriado: "HH apropriado (Apropriação).", descricao: "Detalhe (ex.: cálculo do cronômetro).", data: "Momento do registro (UTC; pode vir do aparelho, offline).", usuario_id: "Quem registrou." },
  },
  relatorios_execucao: {
    repositorio: "relatoriosExecucao.js",
    descricao: "Relatório de execução da OM (um por OM), com as durações usadas em disponibilidade, MTBF e MTTR.",
    colunas: {
      id: ID, ordem_id: "OM (única).", usuario_id: "Autor.", atividade_realizada: "O que foi feito.", resultado: "Resultado.", materiais_utilizados: "Materiais.",
      observacoes: "Observações.", atualizado_em: "Última gravação (UTC).", indisponibilidade_horas: "Horas de parada do equipamento.", tempo_reparo_horas: "Horas de reparo (MTTR).",
    },
  },
  evidencias_om: {
    repositorio: "evidencias.js",
    descricao: "Imagens de evidência anexadas à OM pelo executante (até 5 MB cada).",
    colunas: { id: ID, ordem_id: "OM.", usuario_id: "Quem enviou.", nome_arquivo: "Nome original.", tipo_mime: "Tipo da imagem.", conteudo: "Arquivo (binário).", enviado_em: "Envio (UTC)." },
  },
  execucoes_om: {
    repositorio: "execucoes.js",
    descricao: "Execução cronometrada da OM (uma por OM). Ao finalizar, gera a Apropriação: HH = duração × executantes.",
    colunas: { id: ID, ordem_id: "OM (única).", usuario_id: "Quem iniciou.", num_executantes: "Quantidade de executantes.", iniciado_em: "Início (UTC).", finalizado_em: "Fim (UTC); nulo = em andamento.", duracao_horas: "Duração cronometrada.", hh_calculado: "HH apropriado pela execução.", apontamento_id: "Apropriação gerada." },
  },
  execucao_executantes: {
    repositorio: "execucoes.js",
    descricao: "Nomes dos executantes informados ao iniciar a execução.",
    colunas: { id: ID, execucao_id: "Execução.", nome: "Nome do executante." },
  },
  intercorrencias_om: {
    repositorio: "execucoes.js",
    descricao: "Intercorrências registradas em campo durante a execução (acompanhadas por PCM/CCM).",
    colunas: { id: ID, ordem_id: "OM.", execucao_id: "Execução em andamento.", usuario_id: "Quem registrou.", tipo: "Natureza da intercorrência.", descricao: "Relato.", registrado_em: "Momento (UTC)." },
  },
  // ------------------------------------------------------------ Mão de obra, planejamento e turnos
  hh_disponivel: {
    repositorio: "hhDisponivel.js",
    descricao: "HH disponível lançado por equipe e semana (denominador do IAMOT).",
    colunas: { id: ID, equipe_id: "Equipe.", semana_inicio: "Segunda-feira da semana (AAAA-MM-DD).", hh_disponivel: "Horas disponíveis da equipe na semana.", registrado_por: "Quem lançou.", atualizado_em: "Último lançamento (UTC)." },
  },
  ocorrencias_hh: {
    repositorio: "ocorrencias.js",
    descricao: "Ausências que reduzem o HH disponível (enviadas pelo executante em campo). Atestado é dado sensível (LGPD): só o CCM vê o tipo.",
    colunas: { id: ID, colaborador_id: "Pessoa ausente.", tipo: "Tipo de ausência.", data_inicio: "Primeiro dia (AAAA-MM-DD).", data_fim: "Último dia (AAAA-MM-DD).", horas_dia: "Horas descontadas por dia útil.", observacao: "Observação.", registrado_por: "Quem enviou.", criado_em: "Envio (UTC)." },
  },
  programacao_atividades: {
    repositorio: "programacao.js",
    descricao: "Alocação de HH de uma OM a uma equipe em um dia (planejamento semanal). Mantém as datas da OM sincronizadas.",
    colunas: { id: ID, ordem_id: "OM.", equipe_id: "Equipe alocada.", data: "Dia (AAAA-MM-DD).", hh_previsto: "HH alocado no dia.", observacao: "Observação.", criado_por: "Quem alocou.", criado_em: "Criação (UTC).", atualizado_em: "Última alteração (UTC)." },
  },
  passagens_turno: {
    repositorio: "passagens.js",
    descricao: "Passagem de turno estruturada e imutável.",
    colunas: { id: ID, data: "Data do turno (AAAA-MM-DD).", turno: "Turno.", equipe_id: "Equipe.", autor_id: "Quem passou o turno.", ocorrencias: "Ocorrências do turno.", feito: "O que foi feito.", pendencias: "Pendências para o próximo turno.", avisos: "Avisos de segurança/operação.", criado_em: "Registro (UTC)." },
  },
  passagens_turno_leituras: {
    repositorio: "passagens.js",
    descricao: "Confirmação de leitura de cada passagem de turno, por usuário.",
    colunas: { passagem_id: "Passagem.", usuario_id: "Leitor.", lido_em: "Confirmação (UTC)." },
  },
  // ------------------------------------------------------------ Formulários, inspeções e PT
  formularios_modelos: {
    repositorio: "formularios.js",
    descricao: "Modelos de formulário criados no construtor No-Code. Cada alteração gera nova versão.",
    colunas: { id: ID, nome: "Nome.", tipo: "Uso do formulário.", descricao: "Descrição.", campos: "JSON com os campos (tipo, obrigatoriedade, limites, condições).", regras: "JSON com regras de aplicação automática às OMs (tipos de OM, classes de equipamento, obrigatório).", versao: "Versão atual.", ativo: "1 = disponível; 0 = desativado (preserva respostas).", criado_por: "Autor.", criado_em: "Criação (UTC).", atualizado_por: "Último editor.", atualizado_em: "Última edição (UTC)." },
  },
  formularios_respostas: {
    repositorio: "respostasFormulario.js",
    descricao: "Respostas preenchidas, com o modelo congelado na versão usada e as não conformidades detectadas.",
    colunas: { id: ID, modelo_id: "Modelo.", modelo_versao: "Versão do modelo no preenchimento.", modelo_nome: "Nome do modelo (cópia).", modelo_tipo: "Tipo do modelo (cópia).", campos: "JSON dos campos (cópia).", ordem_id: "OM (opcional).", equipamento_id: "Equipamento.", respostas: "JSON campo → valor.", nao_conformidades: "JSON com as não conformidades.", usuario_id: "Quem preencheu.", criado_em: "Preenchimento (UTC; pode vir do aparelho)." },
  },
  formularios_anexos: {
    repositorio: "respostasFormulario.js",
    descricao: "Fotos e assinaturas enviadas nas respostas.",
    colunas: { id: ID, resposta_id: "Resposta.", campo_id: "Campo do modelo.", tipo: "Tipo do anexo.", nome_arquivo: "Nome original.", tipo_mime: "Tipo da imagem.", conteudo: "Arquivo (binário)." },
  },
  ordem_formularios: {
    repositorio: "formularios.js",
    descricao: "Formulários vinculados manualmente a uma OM (checklist), obrigatórios ou não.",
    colunas: { ordem_id: "OM.", modelo_id: "Modelo.", obrigatorio: "1 = a OM só encerra com o formulário respondido.", vinculado_por: "Quem vinculou.", vinculado_em: "Vínculo (UTC)." },
  },
  rotas_inspecao: {
    repositorio: "rotasInspecao.js",
    descricao: "Rotas de inspeção: roteiro de pontos a percorrer.",
    colunas: { id: ID, nome: "Nome.", descricao: "Descrição.", area: "Área.", ativo: "1 = disponível; 0 = desativada (preserva rondas).", criado_por: "Autor.", criado_em: "Criação (UTC).", atualizado_por: "Último editor.", atualizado_em: "Última edição (UTC)." },
  },
  rota_pontos: {
    repositorio: "rotasInspecao.js",
    descricao: "Pontos da rota, em sequência: equipamento + formulário + instrução.",
    colunas: { id: ID, rota_id: "Rota.", sequencia: "Ordem do ponto.", equipamento_id: "Equipamento.", modelo_id: "Formulário de inspeção.", instrucao: "Instrução ao inspetor." },
  },
  rondas_inspecao: {
    repositorio: "rondasInspecao.js",
    descricao: "Execução de uma rota por um inspetor (ronda).",
    colunas: { id: ID, rota_id: "Rota.", rota_nome: "Nome da rota (cópia).", usuario_id: "Inspetor.", status: "Situação.", iniciada_em: "Início (UTC).", concluida_em: "Conclusão (UTC).", observacao: "Observação final." },
  },
  ronda_pontos: {
    repositorio: "rondasInspecao.js",
    descricao: "Pontos da ronda (copiados da rota ao iniciar) e o resultado de cada um.",
    colunas: { id: ID, ronda_id: "Ronda.", sequencia: "Ordem.", equipamento_id: "Equipamento.", modelo_id: "Formulário.", instrucao: "Instrução.", status: "Resultado do ponto.", resposta_id: "Resposta do formulário.", nao_conformidades: "JSON com os desvios.", motivo: "Por que não foi inspecionado.", registrado_em: "Registro (UTC)." },
  },
  permissoes_trabalho: {
    repositorio: "permissoesTrabalho.js",
    descricao: "Permissão de Trabalho (APR/PT) da OM, com validade de até 24 h e segregação de funções na aprovação.",
    colunas: { id: ID, numero: "Número (PT-00001).", ordem_id: "OM.", modelo_id: "Modelo da APR.", resposta_id: "APR preenchida.", status: "Situação.", validade_inicio: "Início da validade (AAAA-MM-DDTHH:MM, local).", validade_fim: "Fim da validade.", solicitante_id: "Quem solicitou.", solicitada_em: "Solicitação (UTC).", aprovador_id: "Quem aprovou/reprovou.", decidida_em: "Decisão (UTC).", parecer: "Parecer/motivo.", encerrada_por: "Quem encerrou.", encerrada_em: "Encerramento (UTC).", observacao_encerramento: "Observação do encerramento." },
  },
  // ------------------------------------------------------------ Qualidade, notificações e governança
  sinalizacoes_ia: {
    repositorio: "sinalizacoes.js",
    descricao: "Inconsistências detectadas pela IA com explicação (XAI) e a decisão humana (aceitar/rejeitar).",
    colunas: { id: ID, entidade_tipo: "Tipo do registro sinalizado.", entidade_id: "Registro sinalizado.", ordem_numero: "Número da OM.", campo: "Campo avaliado.", valor_atual: "Valor registrado.", valor_sugerido: "Valor sugerido pela IA.", tipo: "Tipo de inconsistência.", score: "Confiança (0 a 1).", explicacao: "JSON com os fatores da decisão.", status: "Situação.", criado_em: "Detecção (UTC).", valor_aplicado: "Valor gravado ao aceitar.", decidido_por: "Quem decidiu.", decidido_em: "Decisão (UTC).", justificativa: "Justificativa da decisão." },
  },
  notificacoes: {
    repositorio: "notificacoes.js",
    descricao: "Eventos críticos (OM atrasada, preventiva, PT pendente, inconsistência), gerados de forma idempotente e resolvidos automaticamente quando a condição some.",
    colunas: { id: ID, chave: "Chave única do evento (evita duplicidade).", tipo: "Tipo do evento.", severidade: "Severidade.", titulo: "Título.", mensagem: "Mensagem.", entidade: "Tipo do registro de origem.", entidade_id: "Registro de origem.", link: "Tela do sistema.", papeis: "Perfis que veem (lista separada por vírgula).", usuario_id: "Destinatário direto.", status: "Situação.", criada_em: "Criação (UTC).", atualizada_em: "Última atualização (UTC).", resolvida_em: "Resolução (UTC).", resolvida_por: "Quem resolveu.", resolucao: "Como foi resolvida." },
  },
  notificacoes_leituras: {
    repositorio: "notificacoes.js",
    descricao: "Leitura de notificação por usuário.",
    colunas: { notificacao_id: "Notificação.", usuario_id: "Leitor.", lida_em: "Leitura (UTC)." },
  },
  notificacoes_destinatarios: {
    repositorio: "notificacoes.js",
    descricao: "Destinatários incluídos por encaminhamento.",
    colunas: { notificacao_id: "Notificação.", usuario_id: "Destinatário.", incluido_por: "Quem encaminhou.", incluido_em: "Encaminhamento (UTC)." },
  },
  notificacoes_acoes: {
    repositorio: "notificacoes.js",
    descricao: "Histórico de tratamento da notificação (respostas, encaminhamentos e resolução).",
    colunas: { id: ID, notificacao_id: "Notificação.", usuario_id: "Autor.", tipo: "Ação.", texto: "Texto.", destinatario_id: "Destinatário do encaminhamento.", criado_em: "Registro (UTC)." },
  },
  parametros_kpi: {
    repositorio: "parametros.js",
    descricao: "Metas e parâmetros de cálculo dos KPIs, editáveis pelo CCM (lista e limites em server/src/parametros.js).",
    colunas: { chave: "Parâmetro (ex.: meta_disponibilidade).", valor: "Valor em vigor.", atualizado_por: "Quem alterou.", atualizado_em: "Alteração (UTC)." },
  },
  trilha_auditoria: {
    repositorio: "auditoria.js",
    descricao: "Trilha de auditoria (governança/LGPD): toda ação relevante, somente inclusão.",
    colunas: { id: ID, usuario_id: "Quem fez.", acao: "Ação (ex.: criar_usuario, encerrar_auto).", entidade: "Tipo do registro afetado.", entidade_id: "Registro afetado.", detalhe: "Resumo legível (sem dado sensível).", data_hora: "Momento (UTC)." },
  },
  // ------------------------------------------------------------ Infraestrutura
  schema_migrations: {
    descricao: "Migrações já aplicadas (e o marcador da carga de demonstração).",
    colunas: { id: "Id da migração.", aplicada_em: "Aplicação (UTC)." },
  },
  requisicoes_idempotentes: {
    repositorio: "idempotencia.js",
    descricao: "Respostas dos envios da fila offline (X-Idempotency-Key), guardadas por 30 dias para que reenvios não repitam a operação.",
    colunas: { chave: "Chave enviada pelo aparelho.", usuario_id: "Dono da chave.", metodo: "Método HTTP.", rota: "Rota chamada.", status: "Código HTTP da resposta original.", resposta: "Corpo JSON da resposta original.", criado_em: "Primeiro envio (UTC)." },
  },
};
