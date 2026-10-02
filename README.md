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

## Banco de dados
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
