import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

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

test("Programação da OM: datas, vínculo com plano de manutenção e plano individual do executante", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "sigma-programacao-"));
  const dbPath = join(tempDir, "test.db");
  const port = 31476;
  const child = spawn(process.execPath, ["src/index.js"], {
    cwd: serverDir,
    env: { ...process.env, DB_PATH: dbPath, PORT: String(port), SIGMA_DEMO: "0", JWT_SECRET: "schedule-test-secret" },
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

    // OM criada a partir da nota nasce aberta e sem data: a programação define as datas.
    const note = (await (await api(admin, "/notas")).json()).find((entry) => entry.numero === "14210");
    const converted = await api(pcm, `/notas/${note.id}/converter`, "POST");
    assert.equal(converted.status, 201);
    const orderId = (await converted.json()).id;
    const created = await (await api(pcm, `/ordens/${orderId}`)).json();
    assert.equal(created.status, "Aberta");
    assert.equal(created.data_programada, null);
    assert.equal(created.plano_id, null);

    // O PCM enxerga os planos cadastrados pelo CCM.
    const planResponse = await api(admin, "/gestao-cadastros/planos-preventivos", "POST", {
      equipamento_id: String(created.equipamento_id), descricao: "Inspeção do motor 2200", periodicidade: "Mensal",
    });
    assert.equal(planResponse.status, 201);
    const planId = (await planResponse.json()).id;
    const { planos } = await (await api(pcm, "/cadastros")).json();
    assert.deepEqual(planos.map((plan) => [plan.id, plan.descricao, plan.equipamento]), [[planId, "Inspeção do motor 2200", "PA-2200-MOT"]]);

    const path = `/ordens/${orderId}/programacao`;
    assert.equal((await api(field, path, "PATCH", { data_programada: "2026-10-05" })).status, 403);
    assert.equal((await api(pcm, path, "PATCH", {})).status, 400);
    assert.equal((await api(pcm, path, "PATCH", { data_programada: "05/10/2026" })).status, 400);
    assert.equal((await api(pcm, path, "PATCH", { data_programada: "2026-10-05", data_fim_programada: "2026-10-04" })).status, 400);
    assert.equal((await api(pcm, path, "PATCH", { data_programada: "2026-10-05", plano_id: 99999 })).status, 400);
    assert.equal((await api(pcm, "/ordens/99999/programacao", "PATCH", { data_programada: "2026-10-05" })).status, 404);

    const scheduled = await api(pcm, path, "PATCH", { data_programada: "2026-10-05", data_fim_programada: "2026-10-07", plano_id: String(planId) });
    assert.equal(scheduled.status, 200);
    assert.equal((await scheduled.json()).status, "Programada");
    const programmed = await (await api(admin, `/ordens/${orderId}`)).json();
    assert.equal(programmed.status, "Programada");
    assert.equal(programmed.data_programada, "2026-10-05");
    assert.equal(programmed.data_fim_programada, "2026-10-07");
    assert.equal(programmed.plano_id, planId);
    assert.equal(programmed.plano_descricao, "Inspeção do motor 2200");
    assert.equal(programmed.plano_periodicidade, "Mensal");

    // Reprogramar depois de distribuir altera as datas sem desfazer a distribuição.
    assert.equal((await api(pcm, `/ordens/${orderId}/status`, "PATCH", { status: "Distribuída", responsavel_id: fieldLogin.user.id })).status, 200);
    const rescheduled = await api(admin, path, "PATCH", { data_programada: "2026-10-08", plano_id: planId });
    assert.equal((await rescheduled.json()).status, "Distribuída");

    // Plano individual do executante: só as OMs dele, com datas e plano.
    const mine = await (await api(field, "/ordens")).json();
    assert.equal(mine.length, 1);
    assert.equal(mine[0].id, orderId);
    assert.equal(mine[0].data_programada, "2026-10-08");
    assert.equal(mine[0].data_fim_programada, null);
    assert.equal(mine[0].plano_descricao, "Inspeção do motor 2200");
    assert.equal(mine[0].status, "Distribuída");

    // Desvincular o plano e bloquear a reprogramação de OM encerrada.
    assert.equal((await api(pcm, path, "PATCH", { data_programada: "2026-10-08", plano_id: "" })).status, 200);
    assert.equal((await (await api(pcm, `/ordens/${orderId}`)).json()).plano_id, null);
    assert.equal((await api(pcm, `/ordens/${orderId}/status`, "PATCH", { status: "Encerrada" })).status, 200);
    assert.equal((await api(pcm, path, "PATCH", { data_programada: "2026-10-09" })).status, 409);

    const { default: Database } = await import("better-sqlite3");
    const db = new Database(dbPath, { readonly: true });
    try {
      const trail = db.prepare("SELECT detalhe FROM trilha_auditoria WHERE acao = 'programar_ordem' ORDER BY id").all();
      assert.equal(trail.length, 3);
      assert.match(trail[0].detalhe, new RegExp(`^OM \\d+ · 05/10/2026 a 07/10/2026 · plano ${planId}$`));
      assert.match(trail[2].detalhe, /sem plano$/);
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
