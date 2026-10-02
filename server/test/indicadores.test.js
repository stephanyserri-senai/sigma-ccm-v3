import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { todayLocal, weekStart } from "../src/iamot.js";

const serverDir = dirname(dirname(fileURLToPath(import.meta.url)));

function waitForApi(child) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error(`API startup timed out:\n${output}`)), 15000);
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
      if (output.includes("SIGMA-CCM API em")) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.stderr.on("data", (chunk) => { output += chunk.toString(); });
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`API saiu com código ${code}:\n${output}`)); });
  });
}

test("Indicadores: abas por KPI, evolução, detalhamento, filtros e exportação CSV auditada", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "sigma-indicadores-"));
  const dbPath = join(tempDir, "test.db");
  const port = 31475;
  const child = spawn(process.execPath, ["src/index.js"], {
    cwd: serverDir,
    env: { ...process.env, DB_PATH: dbPath, PORT: String(port), JWT_SECRET: "indicators-test-secret" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    await waitForApi(child);
    const api = (token, path, method = "GET", body) => fetch(`http://127.0.0.1:${port}/api${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const login = async (username, senha) => (await (await api("", "/auth/login", "POST", { username, senha })).json());
    const admin = (await login("admin", "admin123")).token;
    const pcm = (await login("pcm", "pcm123")).token;
    const fieldLogin = await login("campo", "campo123");
    const field = fieldLogin.token;

    assert.equal((await api(field, "/indicadores")).status, 403);
    assert.equal((await api(field, "/indicadores/export?kpi=backlog")).status, 403);

    // Gera dados reais: OM corretiva executada com parada e reparo, HH disponível lançado.
    const orders = await (await api(admin, "/ordens")).json();
    const order = orders.find((entry) => entry.numero === "40012352");
    assert.equal((await api(pcm, `/ordens/${order.id}/status`, "PATCH", { status: "Distribuída", responsavel_id: fieldLogin.user.id })).status, 200);
    assert.equal((await api(field, "/apontamentos", "POST", { ordem_id: order.id, tipo: "Apropriação", hh: 8 })).status, 201);
    assert.equal((await api(field, `/ordens/${order.id}/relatorio`, "PUT", {
      atividade_realizada: "Reparo estrutural.", indisponibilidade_horas: 10, tempo_reparo_horas: 3,
    })).status, 200);
    const { equipes } = await (await api(admin, "/cadastros")).json();
    const caldeiraria = equipes.find((team) => team.nome === "Caldeiraria");
    const automacao = equipes.find((team) => team.nome === "Automação");
    assert.equal((await api(pcm, "/mao-de-obra/hh-disponivel", "PUT", { equipe_id: caldeiraria.id, semana: weekStart(todayLocal()), hh_disponivel: 40 })).status, 200);

    const report = await (await api(pcm, "/indicadores?period=30d")).json();
    assert.deepEqual(report.tabs.map((tab) => tab.id), ["disponibilidade", "confiabilidade", "iamot", "aderencia", "backlog"]);
    assert.ok(report.tabs.every((tab) => tab.metrics.every((item) => Number.isFinite(item.target))));
    assert.equal(report.series.length, 5);
    assert.deepEqual(Object.keys(report.breakdown), ["equipe", "area", "equipamento"]);
    assert.equal(report.breakdown.equipe.length, 4);

    // Os números são os mesmos da Visão geral (cálculo compartilhado).
    const dashboard = await (await api(pcm, "/dashboard?period=30d&area=all")).json();
    for (const key of ["availability", "mtbf", "mttr", "iamot", "adherence", "backlog"]) {
      assert.equal(report.kpis[key].value, dashboard.kpis[key].value, key);
    }
    assert.equal(report.kpis.mttr.value, 3);
    assert.equal(report.kpis.iamot.value, 20);
    assert.equal(report.kpis.backlog.value, 4);
    assert.equal(report.kpis.adherence.value, 50);

    // A evolução termina no intervalo atual, que contém os dados lançados.
    const last = report.series.at(-1);
    assert.equal(last.from, weekStart(todayLocal()));
    assert.equal(last.mttr, 3);
    assert.equal(last.iamot, 20);
    assert.equal(last.backlog, 4);
    assert.equal(report.series[0].orders, 0);

    // Detalhamento por equipe, área e equipamento.
    const teamRow = report.breakdown.equipe.find((row) => row.key === caldeiraria.id);
    assert.equal(teamRow.mttr, 3);
    assert.equal(teamRow.iamot, 20);
    assert.equal(teamRow.hh_liquido, 40);
    assert.equal(teamRow.backlog, 1);
    assert.equal(report.breakdown.equipe.find((row) => row.key === automacao.id).iamot, null);
    const areaRow = report.breakdown.area.find((row) => row.label === "Terminal Leste");
    assert.equal(areaRow.orders, 3);
    assert.equal(areaRow.hh_apropriado, 14); // 8 h desta OM + 6 h do apontamento inicial em VT-3330-TR01
    assert.equal(areaRow.iamot, null);
    const equipmentRow = report.breakdown.equipamento.find((row) => row.label === "ESTR-3330");
    assert.equal(equipmentRow.equipamentos, 1);
    assert.equal(equipmentRow.downtime_hours, 10);
    assert.equal(equipmentRow.failures, 1);
    assert.ok(equipmentRow.availability < 100 && equipmentRow.availability > 90);

    // Filtros por área e equipe.
    const filtered = await (await api(pcm, `/indicadores?period=6m&equipe=${caldeiraria.id}&area=${encodeURIComponent("Terminal Leste")}`)).json();
    assert.equal(filtered.series.length, 6);
    assert.deepEqual(filtered.filters.equipe, caldeiraria.id);
    assert.equal(filtered.filters.area, "Terminal Leste");
    assert.equal(filtered.kpis.backlog.value, 1);
    assert.deepEqual(filtered.breakdown.equipe.map((row) => row.label), ["Caldeiraria"]);
    assert.deepEqual(filtered.breakdown.area.map((row) => row.label), ["Terminal Leste"]);
    assert.deepEqual(filtered.breakdown.equipamento.map((row) => row.label), ["ESTR-3330"]);
    const otherArea = await (await api(pcm, `/indicadores?period=6m&area=${encodeURIComponent("Pátio A")}`)).json();
    assert.equal(otherArea.kpis.backlog.value, 1);
    assert.equal(otherArea.kpis.mttr.value, null);
    assert.equal((await (await api(pcm, "/indicadores?period=xyz&area=Inexistente&equipe=999")).json()).filters.period, "6m");

    // Exportação CSV, registrada na trilha de auditoria.
    assert.equal((await api(pcm, "/indicadores/export?kpi=inexistente")).status, 400);
    const exported = await api(pcm, `/indicadores/export?kpi=confiabilidade&period=30d&equipe=${caldeiraria.id}`);
    assert.equal(exported.status, 200);
    assert.match(exported.headers.get("content-type"), /text\/csv/);
    assert.match(exported.headers.get("content-disposition"), /attachment; filename="indicadores-confiabilidade-30d-\d{4}-\d{2}-\d{2}\.csv"/);
    const bytes = new Uint8Array(await exported.arrayBuffer());
    assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf]);
    const lines = new TextDecoder().decode(bytes.slice(3)).trimEnd().split("\r\n");
    assert.equal(lines[0], "Visão;Item;Início;Fim;MTBF (h);MTTR (h);Falhas (OMs corretivas);Horas de reparo (h);Horas de parada (h);Meta MTBF (h);Meta MTTR (h)");
    assert.equal(lines.filter((line) => line.startsWith("Evolução;")).length, 5);
    assert.ok(lines.some((line) => /^Equipe;Caldeiraria;\d{4}-\d{2}-\d{2};\d{4}-\d{2}-\d{2};[\d,]+;3;1;3;10;720;4$/.test(line)), lines.join("\n"));
    assert.ok(lines.some((line) => line.startsWith("Equipamento;ESTR-3330;")));
    assert.equal((await api(admin, "/indicadores/export?kpi=iamot&period=12m")).status, 200);

    const { default: Database } = await import("better-sqlite3");
    const db = new Database(dbPath, { readonly: true });
    try {
      const trail = db.prepare("SELECT usuario_id, entidade, detalhe FROM trilha_auditoria WHERE acao = 'exportar_indicadores' ORDER BY id").all();
      assert.equal(trail.length, 2);
      assert.equal(trail[0].entidade, "indicador");
      assert.match(trail[0].detalhe, /^Confiabilidade · período 30d · Todas as áreas · Caldeiraria · \d+ linhas$/);
      assert.match(trail[1].detalhe, /^IAMOT · período 12m/);
    } finally {
      db.close();
    }
  } finally {
    if (child.exitCode === null) {
      child.kill();
      await new Promise((resolve) => child.once("exit", resolve));
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});
