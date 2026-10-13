import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import initSqlJs from "sql.js/dist/sql-asm.js";
import test from "node:test";
import { runScript, startPostgres } from "./helpers/postgres.js";

test("Importa o SQLite legado com relações, chaves compostas, auto-referência e sequência", async () => {
  const SQL = await initSqlJs();
  const sqlite = new SQL.Database();
  sqlite.exec(`
    CREATE TABLE schema_migrations (id TEXT PRIMARY KEY, aplicada_em TEXT NOT NULL);
    CREATE TABLE equipes (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, tipo TEXT NOT NULL DEFAULT 'Própria', especialidade TEXT);
    CREATE TABLE usuarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, email TEXT UNIQUE, username TEXT NOT NULL UNIQUE,
      senha_hash TEXT NOT NULL, papel TEXT NOT NULL DEFAULT 'EXECUTANTE', ativo INTEGER NOT NULL DEFAULT 1,
      criado_em TEXT NOT NULL DEFAULT (datetime('now')), equipe_id INTEGER REFERENCES equipes(id)
    );
    CREATE TABLE equipamentos (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tag TEXT NOT NULL UNIQUE, descricao TEXT, localizacao TEXT, classe TEXT,
      criticidade TEXT DEFAULT 'Média', pai_id INTEGER REFERENCES equipamentos(id)
    );
    CREATE TABLE notificacoes (
      id INTEGER PRIMARY KEY AUTOINCREMENT, chave TEXT NOT NULL UNIQUE, tipo TEXT NOT NULL, severidade TEXT NOT NULL,
      titulo TEXT NOT NULL, mensagem TEXT, entidade TEXT, entidade_id INTEGER, link TEXT, papeis TEXT NOT NULL DEFAULT 'CCM,PCM',
      usuario_id INTEGER REFERENCES usuarios(id), status TEXT NOT NULL DEFAULT 'Aberta', criada_em TEXT NOT NULL DEFAULT (datetime('now')),
      atualizada_em TEXT, resolvida_em TEXT, resolvida_por INTEGER REFERENCES usuarios(id), resolucao TEXT
    );
    CREATE TABLE notificacoes_leituras (
      notificacao_id INTEGER NOT NULL REFERENCES notificacoes(id) ON DELETE CASCADE,
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id), lida_em TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (notificacao_id, usuario_id)
    );
    CREATE TABLE formularios_modelos (
      id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL,
      tipo TEXT NOT NULL, descricao TEXT, campos TEXT NOT NULL, regras TEXT NOT NULL DEFAULT '{}',
      versao INTEGER NOT NULL DEFAULT 1, ativo INTEGER NOT NULL DEFAULT 1, criado_por INTEGER REFERENCES usuarios(id),
      criado_em TEXT NOT NULL DEFAULT (datetime('now')), atualizado_por INTEGER REFERENCES usuarios(id), atualizado_em TEXT
    );
    INSERT INTO equipes (id, nome) VALUES (40, 'Equipe importada');
    INSERT INTO schema_migrations (id, aplicada_em) VALUES ('2026-10-05_demo_data_v1', '2026-10-05 00:00:00');
    INSERT INTO usuarios (id, nome, username, senha_hash, papel, equipe_id)
      VALUES (90, 'Usuário importado', 'importado', 'hash-preservado', 'CCM', 40);
    INSERT INTO equipamentos (id, tag, descricao, pai_id) VALUES
      (5, 'FILHO', 'Equipamento filho', 7), (7, 'PAI', 'Equipamento pai', NULL);
    INSERT INTO notificacoes (id, chave, tipo, severidade, titulo, usuario_id)
      VALUES (120, 'notificacao-importada', 'teste', 'Baixa', 'Aviso', 90);
    INSERT INTO notificacoes_leituras (notificacao_id, usuario_id) VALUES (120, 90);
    INSERT INTO formularios_modelos (id, nome, tipo, campos, regras)
      VALUES (130, 'Checklist de segurança e liberação (exemplo)', 'Checklist', '[]', '{}');
  `);
  const directory = mkdtempSync(join(tmpdir(), "sigma-sqlite-import-"));
  const source = join(directory, "origem.db");
  writeFileSync(source, Buffer.from(sqlite.export()));
  sqlite.close();

  const pg = await startPostgres({}, { bootstrap: false });
  try {
    const first = await runScript("db-import-sqlite.js", { ...pg.env, NODE_ENV: "test" }, [source, "--confirm"]);
    assert.equal(first.code, 0, first.output);
    assert.match(first.output, /Importação concluída/);

    assert.deepEqual(await pg.query("SELECT id, equipe_id FROM usuarios"), [{ id: 90, equipe_id: 40 }]);
    assert.deepEqual(await pg.query("SELECT id, pai_id FROM equipamentos ORDER BY id"), [
      { id: 5, pai_id: 7 },
      { id: 7, pai_id: null },
    ]);
    assert.deepEqual(await pg.query("SELECT notificacao_id, usuario_id FROM notificacoes_leituras"), [
      { notificacao_id: 120, usuario_id: 90 },
    ]);
    assert.deepEqual(await pg.query("SELECT id FROM schema_migrations WHERE id = '2026-10-05_demo_data_v1'"), [
      { id: "2026-10-05_demo_data_v1" },
    ]);
    assert.deepEqual(await pg.query("INSERT INTO equipes (nome) VALUES ('Nova') RETURNING id"), [{ id: 41 }]);

    const bootstrap = await runScript("db-bootstrap.js", {
      ...pg.env,
      NODE_ENV: "test",
      SIGMA_SEED_EXEMPLO: "0",
      SIGMA_DEMO: "0",
    });
    assert.equal(bootstrap.code, 0, bootstrap.output);
    assert.deepEqual(await pg.query(
      "SELECT id, COUNT(*) OVER () AS total FROM formularios_modelos WHERE nome = 'Checklist de segurança e liberação (exemplo)' AND tipo = 'Checklist'",
    ), [{ id: 130, total: 1 }]);

    const second = await runScript("db-import-sqlite.js", { ...pg.env, NODE_ENV: "test" }, [source, "--confirm"]);
    assert.notEqual(second.code, 0);
    assert.match(second.output, /banco de destino não está vazio/);
    assert.deepEqual(await pg.query("SELECT COUNT(*) AS total FROM usuarios"), [{ total: 1 }]);
  } finally {
    await pg.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
