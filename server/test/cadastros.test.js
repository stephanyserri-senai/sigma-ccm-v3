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

test("Cadastros CCM oferecem CRUD auditado e TAG única gerada no servidor", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "sigma-cadastros-"));
  const dbPath = join(tempDir, "test.db");
  const port = 31473;
  const child = spawn(process.execPath, ["src/index.js"], {
    cwd: serverDir,
    env: { ...process.env, DB_PATH: dbPath, PORT: String(port), SIGMA_DEMO: "0", JWT_SECRET: "catalog-test-secret" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const base = `http://127.0.0.1:${port}/api/gestao-cadastros`;

  try {
    await waitForApi(child);
    const login = async (username, senha) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, senha }),
      });
      assert.equal(response.status, 200);
      return (await response.json()).token;
    };
    const adminToken = await login("admin", "admin123");
    const pcmToken = await login("pcm", "pcm123");
    const apiRequest = (token, path, method = "GET", body) => fetch(`http://127.0.0.1:${port}/api${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const request = (token, path, method = "GET", body) => fetch(`${base}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    for (const resource of ["equipamentos", "equipes", "colaboradores", "planos-preventivos"]) {
      assert.equal((await request(adminToken, `/${resource}`)).status, 200);
    }
    assert.equal((await request(pcmToken, "/equipamentos")).status, 403);

    const executantes = await (await apiRequest(adminToken, "/ordens/executantes")).json();
    const fieldUser = executantes.find((person) => person.username === "campo");
    assert.ok(fieldUser);
    const allOrders = await (await apiRequest(adminToken, "/ordens")).json();
    const assignedOrder = allOrders.find((order) => order.numero === "40012350");
    assert.ok(assignedOrder);
    assert.equal((await apiRequest(pcmToken, `/ordens/${assignedOrder.id}/status`, "PATCH", {
      status: "Distribuída", responsavel_id: fieldUser.id,
    })).status, 200);

    const fieldToken = await login("campo", "campo123");
    const fieldOrders = await (await apiRequest(fieldToken, "/ordens")).json();
    assert.deepEqual(fieldOrders.map((order) => order.id), [assignedOrder.id]);
    const unassignedOrder = allOrders.find((order) => order.numero === "40012345");
    assert.equal((await apiRequest(fieldToken, `/ordens/${unassignedOrder.id}`)).status, 404);

    assert.equal((await apiRequest(fieldToken, "/apontamentos", "POST", {
      ordem_id: assignedOrder.id, tipo: "Apropriação", hh: 4,
    })).status, 201);
    assert.equal((await apiRequest(fieldToken, "/apontamentos", "POST", {
      ordem_id: assignedOrder.id, tipo: "Validação", hh: 0,
    })).status, 201);
    assert.equal((await apiRequest(fieldToken, `/ordens/${assignedOrder.id}/relatorio`, "PUT", {
      atividade_realizada: "Inspecionado e substituído o componente danificado.",
      resultado: "Concluído", materiais_utilizados: "1 conjunto de vedação", observacoes: "Teste operacional concluído.",
      indisponibilidade_horas: 5, tempo_reparo_horas: 2,
    })).status, 200);
    const formData = new FormData();
    formData.append("imagens", new Blob([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])], { type: "image/png" }), "execucao.png");
    const imageUpload = await fetch(`http://127.0.0.1:${port}/api/ordens/${assignedOrder.id}/evidencias`, {
      method: "POST", headers: { authorization: `Bearer ${fieldToken}` }, body: formData,
    });
    assert.equal(imageUpload.status, 201, await imageUpload.text());
    const evidence = await (await apiRequest(fieldToken, `/ordens/${assignedOrder.id}/evidencias`)).json();
    assert.equal(evidence.length, 1);
    const imageResponse = await apiRequest(fieldToken, `/ordens/${assignedOrder.id}/evidencias/${evidence[0].id}/arquivo`);
    assert.equal(imageResponse.status, 200);
    assert.equal(imageResponse.headers.get("content-type"), "image/png");

    const completedOrder = await (await apiRequest(adminToken, `/ordens/${assignedOrder.id}`)).json();
    assert.equal(completedOrder.status, "Encerrada");
    assert.equal(completedOrder.executante_username, "campo");
    assert.equal(completedOrder.apontamentos.find((entry) => entry.tipo === "Apropriação").usuario_nome, "João Pereira");
    assert.equal(completedOrder.relatorio.atividade_realizada, "Inspecionado e substituído o componente danificado.");
    assert.equal(completedOrder.relatorio.indisponibilidade_horas, 5);
    assert.equal(completedOrder.relatorio.tempo_reparo_horas, 2);

    const dashboardResponse = await apiRequest(adminToken, "/dashboard?period=6m&area=all");
    assert.equal(dashboardResponse.status, 200);
    const dashboard = await dashboardResponse.json();
    assert.equal(dashboard.trend.length, 6);
    assert.equal(dashboard.kpis.mttr.value, 2);
    assert.ok(dashboard.kpis.availability.value < 100);
    assert.equal(dashboard.kpis.mtbf.value, null);
    assert.ok(dashboard.ordersByStatus.length > 0);
    const areaDashboard = await (await apiRequest(adminToken, "/dashboard?period=30d&area=P%C3%A1tio%20A")).json();
    assert.equal(areaDashboard.filters.area, "Pátio A");
    assert.ok(areaDashboard.ordersByCriticality.every((row) => row.area === "Pátio A"));

    const preview = await request(adminToken, "/equipamentos/tag-preview", "POST", { classe: "Bomba", descricao: "Bomba auxiliar" });
    assert.deepEqual(await preview.json(), { tag: "BOM-0001", prefix: "BOM" });
    const equipmentResponse = await request(adminToken, "/equipamentos", "POST", {
      descricao: "Bomba auxiliar", classe: "Bomba", localizacao: "Pátio A", criticidade: "Alta", tag_mode: "auto",
    });
    assert.equal(equipmentResponse.status, 201);
    const equipment = await equipmentResponse.json();
    assert.equal(equipment.tag, "BOM-0001");

    const nextPreview = await request(adminToken, "/equipamentos/tag-preview", "POST", { classe: "Bomba", descricao: "Bomba reserva" });
    assert.equal((await nextPreview.json()).tag, "BOM-0002");
    const duplicateTag = await request(adminToken, "/equipamentos", "POST", {
      descricao: "Bomba duplicada", classe: "Bomba", tag_mode: "manual", tag: "bom-0001",
    });
    assert.equal(duplicateTag.status, 409);

    const teamResponse = await request(adminToken, "/equipes", "POST", { nome: "Equipe de teste", tipo: "Própria", especialidade: "Bombas" });
    assert.equal(teamResponse.status, 201);
    const team = await teamResponse.json();
    assert.equal((await request(adminToken, `/equipes/${team.id}`, "PUT", { nome: "Equipe de teste editada", tipo: "Terceirizada" })).status, 200);

    const collaboratorResponse = await request(adminToken, "/colaboradores", "POST", {
      nome: "Colaborador teste", matricula: "TEST-9001", especialidade: "Mecânica", equipe_id: String(team.id),
    });
    assert.equal(collaboratorResponse.status, 201);
    const collaborator = await collaboratorResponse.json();
    assert.equal((await request(adminToken, `/colaboradores/${collaborator.id}`, "PUT", {
      nome: "Colaborador atualizado", matricula: "TEST-9001", especialidade: "Mecânica", equipe_id: String(team.id),
    })).status, 200);

    const planResponse = await request(adminToken, "/planos-preventivos", "POST", {
      equipamento_id: String(equipment.id), equipe_id: String(team.id), descricao: "Inspeção da bomba", periodicidade: "Mensal", proxima_data: "2026-11-01",
    });
    assert.equal(planResponse.status, 201);
    const plan = await planResponse.json();
    assert.equal((await request(adminToken, `/planos-preventivos/${plan.id}`, "PUT", {
      equipamento_id: String(equipment.id), equipe_id: String(team.id), descricao: "Inspeção atualizada", periodicidade: "Trimestral", proxima_data: "2027-01-01",
    })).status, 200);
    assert.equal((await request(adminToken, `/planos-preventivos/${plan.id}`, "DELETE")).status, 204);
    assert.equal((await request(adminToken, `/colaboradores/${collaborator.id}`, "DELETE")).status, 204);
    assert.equal((await request(adminToken, `/equipes/${team.id}`, "DELETE")).status, 204);
    assert.equal((await request(adminToken, `/equipamentos/${equipment.id}`, "PUT", {
      descricao: "Bomba editada", classe: "Bomba", tag: "BOM-MANUAL", tag_mode: "manual", criticidade: "Média",
    })).status, 200);
    assert.equal((await request(adminToken, `/equipamentos/${equipment.id}`, "DELETE")).status, 204);

    const existingEquipment = (await (await request(adminToken, "/equipamentos")).json())[0];
    const generatedPlanResponse = await request(adminToken, "/planos-preventivos", "POST", {
      equipamento_id: String(existingEquipment.id), descricao: "Plano com OM gerada", periodicidade: "Semestral", proxima_data: "2026-12-01",
    });
    const generatedPlan = await generatedPlanResponse.json();
    const generatedOrderResponse = await request(adminToken, `/planos-preventivos/${generatedPlan.id}/gerar-om`, "POST");
    assert.equal(generatedOrderResponse.status, 201);
    const generatedOrder = await generatedOrderResponse.json();
    const linkedOrder = await apiRequest(adminToken, `/ordens/${generatedOrder.id}`);
    assert.equal((await linkedOrder.json()).plano_id, generatedPlan.id);

    const { default: Database } = await import("better-sqlite3");
    const db = new Database(dbPath, { readonly: true });
    try {
      const audited = db.prepare("SELECT COUNT(*) AS total FROM trilha_auditoria WHERE acao LIKE '%_equipamento' OR acao LIKE '%_equipe' OR acao LIKE '%_colaborador' OR acao LIKE '%_plano_preventivo'").get().total;
      assert.ok(audited >= 11, `esperadas operações CRUD auditadas, obtido ${audited}`);
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
