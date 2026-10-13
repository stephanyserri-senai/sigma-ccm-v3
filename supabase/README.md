# Supabase + Vercel — publicação do SIGMA-CCM

A API usa PostgreSQL (driver `pg`, async) e o esquema vive em `supabase/migrations`
(36 tabelas, RLS ativo e sem políticas: só o papel `postgres` usado pela API acessa os dados).
O front-end **nunca** recebe `DATABASE_URL` nem a chave `service_role`: não crie variáveis
`VITE_*` com segredos.

## 1. Criar o projeto no Supabase
1. Acesse https://supabase.com/dashboard → **New project** e guarde a senha do banco.
2. Em **Project Settings → Database → Connection string**, copie:
   - **Direct connection** (porta `5432`), para os comandos de migração e bootstrap executados no seu computador.
   - **Transaction pooler** (porta `6543`), para a variável da API hospedada na Vercel.
3. Se a senha tiver caracteres especiais, codifique-os na URI (`@` → `%40`).

## 2. Aplicar o esquema (uma vez por versão, fora da API)

No PowerShell, a partir da pasta `sigma-ccm`:

```powershell
npm run setup
$env:DATABASE_URL = Read-Host "URI Direct connection do Supabase (porta 5432)"
$env:DATABASE_SSL = "no-verify"
npm --prefix server run db:migrate
if ($LASTEXITCODE -ne 0) { throw "A aplicação das migrações falhou." }
```

Esse script aplica todos os arquivos em `supabase/migrations`, em ordem, e pode
ser executado de novo sem reaplicar migrações já registradas. Não aplique também
os mesmos arquivos pelo SQL Editor ou pela Supabase CLI.

Confira no **Table Editor** se as 36 tabelas existem. No **SQL Editor**, execute:

```sql
SELECT count(*) AS tabelas
FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE';

SELECT count(*) AS tabelas_com_rls
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity;
```

As duas consultas devem retornar `36`.

## 3. Importar os dados SQLite existentes

Faça esta etapa **antes do bootstrap** e somente se quiser preservar os dados
locais. Encerre o SIGMA-CCM local primeiro para não copiar o banco enquanto ele
estiver sendo alterado. O importador valida a integridade, as relações, os nomes
das tabelas/colunas e executa a importação em uma única transação. Ele recusa
destinos que já contenham dados.

No mesmo PowerShell, a partir de `sigma-ccm`:

```powershell
$source = (Resolve-Path ".\server\sigma-ccm.db").Path
$backup = Join-Path (Split-Path $source) ("sigma-ccm-antes-supabase-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".db")
Copy-Item -LiteralPath $source -Destination $backup
npm --prefix server run db:import-sqlite -- "$backup" --confirm
if ($LASTEXITCODE -ne 0) { throw "A importação falhou; não prossiga para o deploy." }
```

Guarde o backup em local seguro e não o publique no Git. O comando imprime a
quantidade importada de cada tabela; em caso de erro, a transação é desfeita e
nenhuma tabela fica parcialmente carregada. Não execute o importador novamente
no mesmo banco.

Se preferir começar sem dados antigos, pule esta etapa.

## 4. Completar a carga inicial

Se importou o SQLite, os usuários, senhas (hashes), cadastros e registros antigos
foram preservados. Use as mesmas credenciais de acesso que usava localmente.
Execute o bootstrap para inserir apenas os parâmetros/modelos de referência que
faltarem; deixe as cargas de exemplo e demonstração desligadas:

```powershell
$env:NODE_ENV = "development"
$env:DATABASE_URL = Read-Host "URI Direct connection do Supabase (porta 5432)"
$env:DATABASE_SSL = "no-verify"
$env:SIGMA_SEED_EXEMPLO = "0"
$env:SIGMA_DEMO = "0"
npm --prefix server run db:bootstrap
if ($LASTEXITCODE -ne 0) { throw "O bootstrap falhou." }
```

Se pulou a importação e o banco está vazio, configure `NODE_ENV=production`,
`PORT=3001`, `JWT_SECRET`, `JWT_EXPIRES_IN=8h`, `CORS_ORIGIN` e os campos
`ADMIN_*` conforme o exemplo a seguir. O bootstrap cria então o administrador.

```powershell
$env:NODE_ENV = "production"
$env:PORT = "3001"
$env:DATABASE_URL = Read-Host "URI Direct connection do Supabase (porta 5432)"
$env:DATABASE_SSL = "no-verify"
$env:JWT_SECRET = node -e "process.stdout.write(require('node:crypto').randomBytes(48).toString('base64url'))"
$env:JWT_EXPIRES_IN = "8h"
$env:CORS_ORIGIN = "https://SEU-PROJETO.vercel.app"
$env:ADMIN_USUARIO = Read-Host "Usuário do administrador"
$env:ADMIN_NOME = Read-Host "Nome do administrador"
$securePassword = Read-Host "Senha inicial (mínimo 10 caracteres)" -AsSecureString
$env:ADMIN_SENHA = [System.Net.NetworkCredential]::new("", $securePassword).Password
npm --prefix server run db:bootstrap
if ($LASTEXITCODE -ne 0) { throw "O bootstrap falhou." }
Remove-Item Env:ADMIN_SENHA -ErrorAction SilentlyContinue
$securePassword = $null
```

O bootstrap pode ser repetido: não recria administrador quando já há usuários,
nem reaplica cargas únicas. Nunca use contas/senhas de demonstração em produção.
Troque a senha inicial depois de entrar no sistema.

## 5. Vercel
1. Crie um projeto em **Add New → Project** e deixe **Root Directory** na raiz do
   repositório (`./`), onde estão `vercel.json`, `client/` e `server/`. O projeto
   usa Vercel Services: o serviço `client` (Vite) atende o restante do domínio e
   `server` (Express) atende `/api/*`.
2. O backend recebe os caminhos `/api/...` sem remover o prefixo, que corresponde
   às rotas existentes da API. O frontend chama `/api` na mesma origem; essa
   comunicação do navegador usa o rewrite público e não exige binding entre serviços.
   Ambos são públicos nos caminhos descritos; nenhum serviço fica somente interno.
3. **Settings → Environment Variables** (Production):

| Variável | Valor |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | URI do **Transaction pooler**, porta `6543` |
| `DATABASE_SSL` | `no-verify` |
| `DATABASE_POOL_MAX` | `1` |
| `JWT_SECRET` | Segredo exclusivo, gerado com o comando abaixo |
| `JWT_EXPIRES_IN` | `8h` |
| `CORS_ORIGIN` | `https://SEU-PROJETO.vercel.app`, sem barra final |
| `APP_TIMEZONE` | `America/Sao_Paulo` |

   Gere o segredo no PowerShell e copie a saída para `JWT_SECRET`:

   ```powershell
   node -e "process.stdout.write(require('node:crypto').randomBytes(48).toString('base64url'))"
   ```

   `PORT` não é necessária na Vercel. Não adicione `ADMIN_*` em produção; essas
   variáveis só são usadas na carga inicial do passo 4. Nunca coloque credenciais em `VITE_*`.
4. Na configuração dos serviços, confirme as raízes e frameworks: `client` usa
   `client/` com Vite; `server` usa `server/` com Express e entrypoint `src/app.js`.
   A saída estática do frontend é `client/dist`; os assets da API são incluídos de
   `server/assets/`.
5. Faça **Deploy**. Confirme a API em
   `https://SEU-PROJETO.vercel.app/api/versao` e entre com o usuário importado
   do SQLite ou criado na carga inicial.

Para publicar a pasta local no Windows pela CLI oficial da Vercel, execute em
`sigma-ccm`:

```powershell
npx vercel
npx vercel --prod
```

Na primeira execução, entre na conta e vincule/crie o projeto usando a raiz do
repositório (não selecione somente `client/` ou `server/`). Configure as
variáveis de ambiente na Vercel antes do deploy de produção. Para deploys
automáticos em cada alteração, conecte o projeto a um repositório Git.

## Rodar localmente depois da configuração

Isto conecta o SIGMA-CCM local ao mesmo banco Supabase; use com cuidado, pois
alterações feitas localmente afetam os dados hospedados.

Use a URI **Direct connection (5432)** e execute no PowerShell:

```powershell
$env:NODE_ENV = "development"
$env:PORT = "3001"
$env:DATABASE_URL = Read-Host "URI Direct connection do Supabase (porta 5432)"
$env:DATABASE_SSL = "no-verify"
$env:CORS_ORIGIN = "http://localhost:5173,http://127.0.0.1:5173"
$env:SIGMA_SEED_EXEMPLO = "0"
$env:SIGMA_DEMO = "0"
Remove-Item Env:JWT_SECRET -ErrorAction SilentlyContinue
npm run dev
```

Quando terminar, feche essa janela do PowerShell para descartar as credenciais.

## Observações
- A API não migra nem popula o banco ao iniciar; cada nova migration exige repetir o passo 2.
- O importador preserva dados do SQLite somente quando executado explicitamente
  antes do bootstrap; a API nunca importa nem altera esquema ao iniciar.
- Com o pooler em modo Transaction a API não usa recursos de sessão; se aparecer erro de
  *prepared statement*, mantenha `DATABASE_POOL_MAX` baixo e confirme a porta 6543.
- Rollback: reimplante o deploy anterior na Vercel; migrations são aditivas — reverta o banco
  somente com migration corretiva.
- Para novos arquivos de migração, aplique `npm --prefix server run db:migrate` antes de publicar o novo deploy.