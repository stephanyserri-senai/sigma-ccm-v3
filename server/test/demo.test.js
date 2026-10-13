import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { startPostgres } from "./helpers/postgres.js";

const serverDir = dirname(dirname(fileURLToPath(import.meta.url)));
const TABLES = [
  "usuarios", "equipes", "equipamentos", "colaboradores", "planos_preventivos", "notas", "ordens", "apontamentos",
  "relatorios_execucao", "execucoes_om", "programacao_atividades", "hh_disponivel", "ocorrencias_hh", "sinalizacoes_ia",
  "permissoes_trabalho", "rotas_inspecao", "passagens_turno", "schema_migrations",
];

function waitForApi(child) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error(`API startup timed out:\n${output}`)), 20000);
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
      if (output.includes("SIGMA-CCM API em")) {
        clearTimeout(timer);
        resolve(output);
      }
    });
    child.stderr.on("data", (chunk) => { output += chunk.toString(); });
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`API saiu com código ${code}:\n${output}`)); });
  });
}

async function withApi(pg, port, fn) {
  const child = spawn(process.execPath, ["src/index.js"], {
    cwd: serverDir,
    env: { ...process.env, ...pg.env, PORT: String(port), JWT_SECRET: "demo-test-secret", SIGMA_DEMO: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    const output = await waitForApi(child);
    return await fn(output, (token, path) => fetch(`http://127.0.0.1:${port}/api${path}`, { headers: { authorization: `Bearer ${token}` } }).then((res) => res.json()),
      async (username, senha) => (await (await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, senha }),
      })).json()).token);
  } finally {
    if (child.exitCode === null) {
      child.kill();
      await new Promise((resolve) => child.once("exit", resolve));
    }
  }
}

const counts = async (pg) => Object.fromEntries(await Promise.all(TABLES.map(async (table) => [table, (await pg.query(`SELECT COUNT(*) AS total FROM ${table}`))[0].total])));

test("Seed de demonstração: dados variados, inseridos uma única vez e sem duplicar", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "sigma-demo-"));
  const pg = await startPostgres({}, { bootstrap: false });
  try {
    // O bootstrap é explícito: a API não carrega nada ao subir.
    const boot = await pg.runBootstrap({ SIGMA_DEMO: "1" });
    assert.equal(boot.code, 0, boot.output);
    assert.match(boot.output, /Dados de demonstração carregados/);
    const first = await withApi(pg, 31485, async (output, get, login) => {
      const admin = await login("admin", "admin123");
      const orders = await get(admin, "/ordens");
      const states = new Set(orders.map((order) => order.status));
      for (const status of ["Aberta", "Programada", "Distribuída", "Em execução", "Encerrada", "Cancelada"]) assert.ok(states.has(status), status);

      // Contas de demonstração (colaboradores = usuários, cada um com equipe).
      const paulo = await login("paulo", "demo123");
      assert.ok(paulo);
      assert.ok((await get(paulo, "/ordens")).some((order) => order.numero === "40020009"));

      // Inconsistências da IA ligadas a apontamentos reais, aguardando decisão.
      const signals = await get(admin, "/sinalizacoes?status=Nova");
      assert.ok(signals.filter((item) => item.apontado_por).length >= 3);

      // Alertas gerados automaticamente a partir dos dados.
      const alertTypes = new Set((await get(admin, "/notificacoes")).itens.map((item) => item.tipo));
      for (const tipo of ["OM atrasada", "Preventiva vencida", "Preventiva a vencer", "Permissão pendente", "Inconsistência"]) assert.ok(alertTypes.has(tipo), tipo);

      // Indicadores e planejamento deixam de ficar vazios.
      const dashboard = await get(admin, "/dashboard?period=6m");
      assert.notEqual(dashboard.kpis.availability.value, null);
      assert.notEqual(dashboard.kpis.mttr.value, null);
      assert.notEqual(dashboard.kpis.iamot.value, null);
      const plan = await get(admin, "/planejamento");
      assert.ok(plan.resumo.oms_alocadas >= 1);
      assert.ok(plan.equipes.length >= 5);
      return counts(pg);
    });

    assert.ok(first.equipamentos >= 15);
    assert.ok(first.equipes >= 5);
    assert.ok(first.planos_preventivos >= 5);
    assert.ok(first.hh_disponivel >= 15);
    assert.ok(first.sinalizacoes_ia >= 4);

    // Segunda inicialização: nada é inserido de novo.
    const again = await pg.runBootstrap({ SIGMA_DEMO: "1" });
    assert.equal(again.code, 0, again.output);
    assert.doesNotMatch(again.output, /Dados de demonstração carregados/);
    assert.deepEqual(await counts(pg), first);

    // Mesmo sem o marcador, a carga não duplica (cada item é conferido pela chave natural).
    await pg.query("DELETE FROM schema_migrations WHERE id = '2026-10-05_demo_data_v1'");
    const third = await pg.runBootstrap({ SIGMA_DEMO: "1" });
    assert.equal(third.code, 0, third.output);
    assert.deepEqual(await counts(pg), first);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
    await pg.close();
  }
});
