# Histórico de versões

Todas as mudanças relevantes do SIGMA·CCM ficam registradas aqui. O projeto segue o
[Versionamento Semântico](https://semver.org/lang/pt-BR/) (MAIOR.MENOR.CORREÇÃO) e cada
versão tem uma tag anotada no git (`vX.Y.Z`).

- **MAIOR**: mudança incompatível (por exemplo, rota da API removida ou alterada).
- **MENOR**: funcionalidade nova compatível com o que já existe.
- **CORREÇÃO**: ajuste ou correção sem funcionalidade nova.

## [3.12.0] — 2026-10-05
### Adicionado
- Versionamento formal: versão única em `package.json` (raiz, server e client), tags
  anotadas no git para cada versão e este histórico.
- Rota pública `GET /api/versao` e versão exibida no login e no menu lateral.

## [3.11.1] — 2026-10-05
### Alterado
- Assinatura conjunta VLI | SIGMA·CCM no login e no topo do menu, adaptada à paleta de
  cada tela (versão clara e versão para fundo escuro, com a logo VLI em negativo).

## [3.11.0] — 2026-10-05
### Adicionado
- Relatórios em PDF na tela de Indicadores: parcial por aba, ordens por período/equipe,
  IAMOT por equipe e relatório geral. Documento padronizado com a logo da VLI no
  cabeçalho, filtros, data/autor e paginação. Geração registrada na auditoria.

## [3.10.1] — 2026-10-05
### Alterado
- Logo da VLI incorporada à tela de login, com a identidade visual da marca.

## [3.10.0] — 2026-10-05
### Alterado
- Padronização em todas as telas: carregando, vazio com orientação, erro com
  "Tentar novamente", toasts de confirmação, erros da API em português e retorno ao
  login com aviso quando a sessão expira.
- Layout responsivo (menu em gaveta no celular) e acessibilidade básica (foco visível,
  diálogos com Esc e foco preso, "pular para o conteúdo").
### Corrigido
- Ordens com lista vazia ficavam carregando para sempre.
- Erro em uma ação apagava a tela inteira em Ordens, Notas e Usuários.

## [3.9.0] — 2026-10-05
### Adicionado
- Dados de demonstração carregados uma única vez e sem duplicar (`SIGMA_DEMO=0` desativa).

## [3.8.0] — 2026-10-05
### Adicionado
- Tela de Auditoria (somente CCM) com filtros por usuário, ação e período e paginação
  no servidor.

## [3.7.0] — 2026-10-05
### Adicionado
- Tela Qualidade de dados com decisão humana (human-in-the-loop) sobre as sinalizações
  da IA, explicação dos fatores e badge no cabeçalho.
### Corrigido
- Aceitar/rejeitar sinalizações agora é restrito a PCM/CCM, não aceita decisão em
  duplicidade e preserva o valor original.

## [3.6.0] — 2026-10-05
### Adicionado
- Execução de ordens offline-first (PWA): fila local em IndexedDB, sincronização ao
  reconectar, envio idempotente e indicador de conexão e pendências.

## [3.5.0] — 2026-10-05
### Adicionado
- Notificações de eventos críticos (OM atrasada, preventiva, PT pendente,
  inconsistência), com contador no cabeçalho, resposta e encaminhamento.

## [3.4.0] — 2026-10-05
### Adicionado
- Rotas de inspeção com rondas guiadas e registro de desvios.
- Permissão de Trabalho (APR/PT) com fluxo de aprovação vinculado à OM.

## [3.3.0] — 2026-10-05
### Adicionado
- Motor de formulários dinâmicos (No-Code) e checklist inteligente nas OMs.

## [3.2.0] — 2026-10-05
### Adicionado
- Metas e parâmetros dos KPIs editáveis pelo CCM.
- Planejamento semanal por equipe, passagem de turno e consulta rápida do PCM.

## [3.1.0] — 2026-10-02
### Adicionado
- Mão de obra e IAMOT real, apropriação com cronômetro, indicadores com CSV,
  programação de OMs e plano do executante; colaborador passa a ser o próprio usuário.

## [3.0.0] — 2026-10-02
### Adicionado
- Versão inicial do SIGMA·CCM v3: notas, ordens, apropriação, execução com relatório e
  evidências, cadastros, usuários, dashboard e detecção de inconsistências.
