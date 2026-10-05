# SIGMA-CCM — Portal de Gestão da Manutenção

Aplicação full-stack para o Centro de Controle de Manutenção: notas, ordens,
apropriação de mão de obra, indicadores e verificação automática da qualidade
dos dados. Front-end em React (Vite), back-end em Node/Express e banco de dados
SQLite (arquivo, sem servidor externo).

## Requisitos
- Node.js 18 ou superior (testado no Node 22).

## Instalação
```bash
npm run setup
```
Isso instala as dependências da raiz, do `server` e do `client`.

## Como executar

### Desenvolvimento (recarregamento automático)
```bash
npm run dev
```
- API:  http://localhost:3001
- Web:  http://localhost:5173  (as chamadas `/api` são redirecionadas para a API)

### Produção (um único endereço)
```bash
npm run build   # gera client/dist
npm start       # a API passa a servir o front-end
```
Acesse http://localhost:3001

## Acesso
O banco é criado e populado automaticamente na primeira execução. Contas iniciais:

| Usuário | Senha     | Perfil     | Abre em            |
|---------|-----------|------------|--------------------|
| admin   | admin123  | CCM        | Visão geral        |
| pcm     | pcm123    | PCM        | Visão geral        |
| campo   | campo123  | EXECUTANTE | Início (visão de campo)|

### Dados de demonstração
Na primeira execução também é carregado um conjunto de demonstração (uma única vez,
sem duplicar; `SIGMA_DEMO=0` desativa): 15 equipamentos, 5 equipes, planos
preventivos, OMs em todos os estados com apontamentos e relatórios, HH disponível
das últimas semanas, planejamento da semana, inconsistências de IA, permissão de
trabalho pendente, rota de inspeção e passagem de turno. As datas são relativas ao
dia da carga. Contas extras (senha `demo123`):

| Usuário  | Nome              | Perfil     | Equipe         |
|----------|-------------------|------------|----------------|
| fernanda | Fernanda Lopes    | PCM        | Mecânica FM    |
| paulo    | Paulo R. Teixeira | EXECUTANTE | Mecânica FM    |
| diego    | Diego M. Rocha    | EXECUTANTE | Elétrica Prev. |
| marisa   | Marisa A. Rios    | EXECUTANTE | Elétrica Prev. |
| luiz     | Luiz F. Silva     | EXECUTANTE | Automação      |
| bruno    | Bruno C. Lima     | EXECUTANTE | Caldeiraria    |
| renata   | Renata C. Souza   | EXECUTANTE | Lubrificação   |

O perfil do usuário define a página inicial e os menus disponíveis (RBAC).
Novos usuários podem ser criados na tela **Usuários** (perfil CCM).

Todo usuário é vinculado a uma equipe cadastrada (obrigatório na criação).
Os colaboradores são os próprios usuários: não há cadastro separado de pessoas.

## Indicadores (perfis CCM e PCM)
- Uma aba por KPI: Disponibilidade, Confiabilidade (MTBF/MTTR), IAMOT, Aderência e
  Backlog. Cada aba traz a evolução no tempo com linha de meta e o detalhamento por
  equipe, área e equipamento (gráfico + tabela), com filtros de período/área/equipe.
- Os cálculos são os mesmos da Visão geral (`server/src/indicadores.js` e
  `server/src/iamot.js`).
- **Metas dos KPIs** (perfil CCM): metas de cada indicador e parâmetros de cálculo
  (exposição diária dos equipamentos, jornada padrão das ocorrências e HH semanal de
  referência por pessoa). Os valores iniciais são exemplos; cada alteração é auditada.
  A lista de parâmetros fica em `server/src/parametros.js`.
- A exportação em CSV (separador `;`, vírgula decimal) é gerada no servidor e
  registrada na trilha de auditoria (`exportar_indicadores`).
- **Relatórios em PDF** (botão "Relatórios em PDF", com os filtros atuais): parcial
  por aba de indicador, ordens por período/equipe, IAMOT por equipe ou relatório
  geral com todas as informações. Documento padronizado (A4 deitado) com a logo da
  VLI e o SIGMA·CCM no cabeçalho de todas as páginas, filtros, data/autor da geração
  e "Página x de y". Gerado no servidor (`GET /api/relatorios/pdf?tipo=`, `pdfkit`) e
  registrado na auditoria (`gerar_relatorio_pdf`).

## Formulários dinâmicos e checklist inteligente
- **Modelos (No-Code, perfil CCM):** nome, tipo (Checklist, Inspeção, Permissão,
  Formulário livre) e campos configuráveis — texto, número, sim/não, seleção, foto e
  assinatura —, com campo obrigatório, ajuda, condição de exibição ("mostrar só
  quando…") e regras de não conformidade (resposta esperada, opções não conformes,
  faixa numérica). Pré-visualização ao vivo; cada alteração gera nova versão.
- **Respostas:** vinculadas a uma OM e/ou equipamento, com quem preencheu e quando;
  fotos e assinaturas ficam no banco. A resposta guarda o modelo da versão usada.
- **Checklist inteligente nas OMs:** o modelo pode ser aplicado automaticamente por
  tipo de OM e classe de equipamento, ou vinculado manualmente (PCM/CCM). Se
  obrigatório, a OM só é encerrada depois de respondido.
- Rotas em `/api/formularios` (CRUD de modelos, vínculos com OMs e submissão), todas
  autenticadas e auditadas.

## Auditoria (perfil CCM)
- Tela "Auditoria" com a `trilha_auditoria`: quando, quem (nome, usuário e perfil),
  ação, registro afetado e detalhe; filtros por usuário, ação e período (datas locais)
  e paginação no servidor (`GET /api/auditoria?pagina=&tamanho=`). Somente leitura.

## Qualidade de dados (IA com decisão humana)
- O apontamento de HH passa pela detecção (`server/src/ia.js`); se houver
  inconsistência, a tela de Campo avisa e oferece o atalho para a sinalização.
- Tela "Qualidade de dados": lista (OM, tipo, score, status), detalhe com valor
  registrado × sugerido e os fatores da explicação (XAI) em barras.
- Human-in-the-loop: só PCM/CCM decidem. Aceitar corrige o apontamento (com o valor
  sugerido ou ajustado pela pessoa); rejeitar exige justificativa e mantém o valor.
  O valor original é preservado e a decisão (quem, quando, por quê) vai para a
  auditoria. O executante acompanha as sinalizações dos próprios apontamentos.
- Badge no cabeçalho com as sinalizações aguardando decisão.

## Offline-first (PWA)
- Aplicativo instalável (manifest + service worker via `vite-plugin-pwa`). A interface
  fica em cache e as consultas da API usam "rede primeiro, última resposta guardada
  sem conexão".
- Sem conexão, os registros de execução vão para uma fila local (IndexedDB): início,
  intercorrências e fim do cronômetro, apontamentos (validação), relatório, fotos,
  checklists/formulários e pontos de ronda. A fila é enviada sozinha ao reconectar
  (e a cada 30 s), na ordem em que foi feita.
- Cada envio leva uma chave de idempotência (`X-Idempotency-Key`): reenviar não
  duplica. O servidor aceita o momento real do registro feito offline (até 7 dias
  antes e 5 min depois do relógio do servidor), então HH e "preenchido em" ficam certos.
- Cabeçalho: indicador Online/Offline com o número de pendências; registros recusados
  pelo servidor ficam marcados para tentar de novo ou descartar.
- Para usar offline, abra o app conectado ao menos uma vez (login e OMs ficam em cache).
  Ao sair, o cache de consultas do aparelho é apagado. O modo completo (interface em
  cache) vale no build de produção (`npm run build` + `npm start`).

## Notificações
- Geradas automaticamente (a cada consulta, sem duplicar): OM atrasada, preventiva
  vencida ou a vencer (antecedência em Metas dos KPIs), permissão de trabalho
  pendente e inconsistência de dados. Cada evento tem severidade (Crítica, Alta,
  Média, Baixa) e é resolvido sozinho quando a condição deixa de existir.
- Destinatários: PCM e CCM; a OM atrasada também vai para o executante responsável.
  A leitura é registrada por usuário; o sino no cabeçalho mostra as não lidas.
- Página "Notificações" por severidade: responder (ação tomada), resolver (PCM/CCM)
  e encaminhar para outro usuário — tudo registrado na auditoria.

## Rotas de inspeção
- **Rotas** (PCM/CCM): sequência de pontos — equipamento + formulário (checklist) +
  instrução. Alterar a rota não muda rondas já iniciadas.
- **Rondas** (todos os perfis): o executor percorre os pontos em sequência; cada ponto
  abre o checklist do motor de formulários. Ponto não inspecionado exige motivo.
- **Desvios:** não conformidades das respostas e pontos não inspecionados; de cada
  desvio é possível abrir uma nota de manutenção.

## Permissão de Trabalho (APR/PT)
- Formulário do tipo "Permissão" (APR) preenchido na solicitação, vinculado à OM, com
  validade de até 24 h. Respostas fora do esperado viram alertas de risco.
- Fluxo: Solicitada → Aprovada/Reprovada (PCM/CCM; quem solicitou não aprova a própria
  PT; reprovação exige parecer) → Encerrada; a solicitação pode ser cancelada.
- Redução de risco: a OM com PT solicitada (ou marcada como "exige PT") só inicia a
  execução com PT aprovada e dentro da validade.
- Rotas em `/api/inspecoes` e `/api/permissoes`; todas as ações entram na auditoria.

## Início do executante (visão de campo)
- Página inicial do perfil EXECUTANTE, pensada para o celular: o que está em execução
  agora (com o tempo decorrido), o que precisa de atenção (OMs atrasadas, PT pendente,
  checklists obrigatórios, passagens de turno, notificações, sinalizações e registros
  offline aguardando envio), as tarefas de hoje (incluindo o que ficou para trás) e o
  plano da semana, com atalhos para as ações de campo.
- Dados em um único resumo da API: `GET /api/campo/resumo`, só com as OMs do usuário.

## Planejamento e Programação (perfis CCM e PCM)
- Calendário semanal por equipe: alocar OM, equipe, data e HH previsto (uma OM pode
  ter várias alocações). A OM recebe as datas da primeira/última alocação.
- Carga por equipe/dia = HH alocado ÷ capacidade (HH disponível da semana ÷ 5 dias
  úteis, menos ocorrências; sem lançamento, pessoas × HH semanal de referência).
  Acima da "carga máxima" (Metas dos KPIs) o dia fica em sobrecarga.
- Aderência prevista = OMs da semana sem alocação em dia de sobrecarga.
- **Fluxo do PCM** na Visão geral: etapas da nota à execução com contadores e
  alertas (atrasos, OMs sem alocação, carga, passagens não lidas…).
- **Passagem de turno** (todos os perfis): ocorrências, o que foi feito, pendências
  e avisos ao próximo turno; o registro é imutável e cada leitor confirma a leitura.
  Todas as gravações entram na trilha de auditoria.

## Programação das OMs e plano do executante
- **Ordens** (perfis CCM e PCM): o botão "Programar" define a data programada, o
  término previsto e o plano de manutenção vinculado; pode ser refeito até a OM
  ser encerrada. A OM criada a partir de uma nota nasce sem data.
- **Meu plano** (perfil EXECUTANTE): plano semanal (segunda a domingo) e a lista de
  todas as OMs atribuídas, com datas e plano; cada OM abre direto na Apropriação.

## Mão de obra e IAMOT
- **Ocorrências** (perfil EXECUTANTE): o executante em campo envia folga, férias,
  falta ou atestado das pessoas (usuários) da própria equipe.
- **Mão de obra** (perfis CCM e PCM): lançamento do HH disponível por equipe/semana,
  IAMOT por equipe e acompanhamento das ocorrências e das intercorrências das OMs.
- IAMOT = HH apropriado ÷ (HH disponível − HH das ocorrências em dias úteis). O
  indicador da Visão geral usa o mesmo cálculo e considera apenas equipes/semanas
  com HH disponível lançado.
- LGPD: atestado é dado sensível. Além de quem enviou, só o perfil CCM vê o tipo e
  a observação; para o PCM a ocorrência aparece como "Ausência".
- **Apropriação** (perfil EXECUTANTE): informa o número de executantes e os nomes,
  inicia a OM (cronômetro no servidor), registra intercorrências (desvio, alteração
  de rota ou de serviço) e finaliza — HH = tempo cronometrado × nº de executantes.

## Banco de dados
- **Modelo completo documentado** em [`docs/banco-de-dados.md`](docs/banco-de-dados.md):
  36 tabelas em 7 módulos, diagramas ER (Mermaid), dicionário de dados (cada coluna,
  tipo, restrições, valores permitidos e relações) e a lista de migrações.
- **DDL consolidado** em [`docs/schema-completo.sql`](docs/schema-completo.sql), para
  consulta ou para recriar o banco em outra ferramenta.
- Os dois arquivos são gerados do esquema real (`cd server && npm run doc:banco`); o
  teste `server/test/arquitetura.test.js` falha se estiverem desatualizados.
- Alterações de estrutura são feitas somente por migrações idempotentes em
  `server/src/data/migrations.js` (aplicadas ao iniciar a API, sem apagar o arquivo `.db`).
- Arquivo: `server/sigma-ccm.db` (SQLite, criado automaticamente; caminho em `DB_PATH`).
- Para reiniciar os dados, apague o arquivo `.db` e execute novamente.

### Camada de acesso a dados
Todas as queries ficam em `server/src/data`, separadas das rotas. Rotas e serviços só
chamam funções dos repositórios (um por entidade), por exemplo
`ordensRepo.findById(id)` ou `transaction(() => ...)`:

| Pasta/arquivo | Conteúdo |
|---|---|
| `data/connection.js` | único ponto que conhece o driver (better-sqlite3): conexão, transações e erros de restrição |
| `data/migrations.js` | `schema.sql` + migrações idempotentes |
| `data/seed.js`, `data/seed-demo.js` | administrador inicial, contas de exemplo e dados de demonstração |
| `data/repositories/` | `usuarios`, `equipes`, `equipamentos`, `colaboradores`, `planos`, `notas`, `ordens`, `apontamentos`, `relatoriosExecucao`, `evidencias`, `execucoes`, `hhDisponivel`, `ocorrencias`, `programacao`, `passagens`, `formularios`, `respostasFormulario`, `rotasInspecao`, `rondasInspecao`, `permissoesTrabalho`, `sinalizacoes`, `notificacoes`, `parametros`, `auditoria`, `idempotencia`, `indicadores` (consultas analíticas) e `sistema` |
| `data/index.js` | ponto de entrada: `initDatabase()`, `transaction()` e os repositórios |

Para trocar de banco no futuro, reimplemente apenas `server/src/data` mantendo os nomes
e retornos das funções. O teste de arquitetura impede SQL ou acesso ao driver fora dessa pasta.

## Estrutura
```
sigma-ccm/
├─ docs/                  modelo do banco (dicionário, diagramas ER e DDL completo)
├─ server/                API Express + SQLite
│  ├─ schema.sql          tabelas base (as demais vêm das migrações)
│  ├─ scripts/            gerador da documentação do banco
│  └─ src/
│     ├─ data/            camada de acesso a dados (conexão, migrações, seeds, repositórios)
│     ├─ routes/          rotas da API por módulo
│     ├─ ia.js            detecção de inconsistências
│     └─ index.js         inicialização, autenticação e rotas principais
└─ client/                aplicação React (Vite)
   └─ src/
      ├─ api.js           cliente HTTP
      ├─ auth.jsx         autenticação e permissões
      ├─ components/      layout e componentes de UI
      └─ pages/           telas do sistema
```

## Versionamento
- O projeto segue o Versionamento Semântico (MAIOR.MENOR.CORREÇÃO). A versão atual é a
  mesma em `package.json`, `server/package.json` e `client/package.json`, aparece no
  login e no menu e é devolvida por `GET /api/versao`.
- Cada versão tem uma tag anotada no git (`v3.0.0`, `v3.1.0`, …) e uma entrada em
  [`CHANGELOG.md`](CHANGELOG.md).
- Para publicar uma nova versão:
  ```bash
  # 1. ajustar a versão nos três pacotes (ex.: 3.13.0)
  npm version 3.13.0 --no-git-tag-version
  npm --prefix server version 3.13.0 --no-git-tag-version
  npm --prefix client version 3.13.0 --no-git-tag-version
  # 2. registrar as mudanças no CHANGELOG.md, testar e fazer o commit
  # 3. criar a tag anotada e enviar código e tags
  git tag -a v3.13.0 -m "SIGMA·CCM 3.13.0"
  git push origin main --follow-tags
  ```
- Para voltar a uma versão: `git checkout v3.11.0` (somente leitura) ou criar um ramo a
  partir da tag.

## Configuração (variáveis de ambiente)
Toda a configuração da API vem de variáveis de ambiente, lidas em
`server/src/config.js` a partir do arquivo `server/.env` (ou do ambiente do sistema,
que tem prioridade). O `.env` não vai para o git; o modelo comentado está em
`server/.env.example`.

```bash
cp server/.env.example server/.env
# gere o segredo dos tokens e cole em JWT_SECRET:
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

| Variável | Para que serve | Desenvolvimento (padrão) | Produção |
|---|---|---|---|
| `NODE_ENV` | `development` ou `production` | `development` | `production` |
| `PORT` | Porta HTTP da API | `3001` | obrigatória |
| `JWT_SECRET` | Segredo de assinatura dos tokens de sessão | segredo de desenvolvimento | obrigatória, ≥ 32 caracteres aleatórios, não pode ser valor de exemplo |
| `JWT_EXPIRES_IN` | Validade da sessão (`8h`, `30m`, `1d` ou segundos) | `8h` | obrigatória |
| `DB_PATH` | Arquivo do banco SQLite (relativo a `server/` ou absoluto) | `./sigma-ccm.db` | obrigatória |
| `CORS_ORIGIN` | Origens permitidas, separadas por vírgula | `http://localhost:5173,http://127.0.0.1:5173` | obrigatória; `*` não é aceito |
| `SIGMA_SEED_EXEMPLO` | Contas e dados de exemplo (`admin`/`pcm`/`campo`) | ligado | desligado |
| `SIGMA_DEMO` | Dados de demonstração (carga única) | ligado | desligado |
| `ADMIN_USUARIO`, `ADMIN_SENHA`, `ADMIN_NOME`, `ADMIN_EMAIL` | Primeiro administrador (CCM) quando o banco está vazio e sem seed de exemplo | — | obrigatórias na primeira subida (senha ≥ 10 caracteres) |
| `ENV_FILE` | Outro caminho para o arquivo `.env` | `server/.env` | opcional |

- **Produção sem valores fixos:** com `NODE_ENV=production` não existe valor padrão no
  código. Se faltar alguma variável obrigatória, ou se ela for insegura (segredo curto
  ou de exemplo, CORS `*`), a API não inicia e mostra a lista do que corrigir.
- **Sem senhas conhecidas em produção:** o seed de exemplo fica desligado; com o banco
  vazio, a API cria apenas o administrador definido em `ADMIN_USUARIO`/`ADMIN_SENHA`
  (troque a senha depois do primeiro acesso e retire-a do ambiente).
- **Banco:** o SQLite não tem usuário e senha; proteja o arquivo de `DB_PATH` com as
  permissões do sistema operacional e mantenha backups.
- **CORS:** quando a API serve o próprio front-end (`npm run build` + `npm start`),
  informe em `CORS_ORIGIN` o endereço público pelo qual o sistema é acessado.
- **Segredo:** trocar `JWT_SECRET` encerra todas as sessões abertas.
- **Front-end em desenvolvimento:** o Vite encaminha `/api` para `SIGMA_API_URL`
  (padrão `http://localhost:3001`); em produção não há proxy.
- Os testes de API rodam com variáveis próprias (banco temporário, `SIGMA_DEMO=0`).
