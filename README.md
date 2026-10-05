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
| campo   | campo123  | EXECUTANTE | Apropriação (campo)|

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
- Alterações de estrutura são feitas somente por migrações idempotentes em
  `server/src/db.js` (aplicadas ao iniciar a API, sem apagar o arquivo `.db`).
- Arquivo: `server/sigma-ccm.db` (SQLite, criado automaticamente).
- Esquema documentado: `server/schema.sql`.
- Para reiniciar os dados, apague o arquivo `.db` e execute novamente.

## Estrutura
```
sigma-ccm/
├─ server/                API Express + SQLite
│  ├─ schema.sql          esquema do banco
│  └─ src/
│     ├─ db.js            conexão, criação do schema e seed
│     ├─ ia.js            detecção de inconsistências
│     └─ index.js         rotas da API e regras de negócio
└─ client/                aplicação React (Vite)
   └─ src/
      ├─ api.js           cliente HTTP
      ├─ auth.jsx         autenticação e permissões
      ├─ components/      layout e componentes de UI
      └─ pages/           telas do sistema
```

## Configuração (opcional)
Copie `server/.env.example` para `server/.env` para ajustar `PORT`, `JWT_SECRET`
e o caminho do banco (`DB_PATH`).
