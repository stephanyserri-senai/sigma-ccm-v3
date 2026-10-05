import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import Database from "better-sqlite3";

const serverDir = dirname(dirname(fileURLToPath(import.meta.url)));

function waitForApi(child) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error(`API startup timed out:\n${output}`)), 20000);
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

// Conta páginas e imagens pelos objetos do PDF (não comprimidos pelo pdfkit).
const pdfInfo = (buffer) => {
  const text = buffer.toString("latin1");
  return { pages: (text.match(/\/Type \/Page\b/g) || []).length, images: (text.match(/\/Subtype \/Image/g) || []).length };
};

test("Relatórios em PDF: parciais, ordens, IAMOT e geral, com logo, paginação e auditoria", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "sigma-relatorios-"));
  const dbPath = join(tempDir, "test.db");
  const port = 31488;
  // Com os dados de demonstração, os relatórios têm conteúdo em todas as seções.
  const child = spawn(process.execPath, ["src/index.js"], {
    cwd: serverDir,
    env: { ...process.env, DB_PATH: dbPath, PORT: String(port), JWT_SECRET: "reports-test-secret", SIGMA_DEMO: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    await waitForApi(child);
    const login = async (username, senha) => (await (await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, senha }),
    })).json()).token;
    const get = (token, query) => fetch(`http://127.0.0.1:${port}/api/relatorios/pdf?${query}`, { headers: { authorization: `Bearer ${token}` } });
    const admin = await login("admin", "admin123");
    const pcm = await login("pcm", "pcm123");
    const field = await login("campo", "campo123");

    assert.equal((await get(field, "tipo=geral")).status, 403);
    assert.equal((await get(pcm, "tipo=inexistente")).status, 400);

    const sizes = {};
    for (const tipo of ["disponibilidade", "confiabilidade", "iamot", "aderencia", "backlog", "ordens", "geral"]) {
      const response = await get(pcm, `tipo=${tipo}&period=6m`);
      assert.equal(response.status, 200, tipo);
      assert.equal(response.headers.get("content-type"), "application/pdf");
      assert.match(response.headers.get("content-disposition"), new RegExp(`attachment; filename="relatorio-${tipo}-6m-\\d{4}-\\d{2}-\\d{2}\\.pdf"`));
      const buffer = Buffer.from(await response.arrayBuffer());
      assert.equal(buffer.subarray(0, 5).toString(), "%PDF-");
      const info = pdfInfo(buffer);
      assert.ok(info.pages >= 1, tipo);
      assert.ok(info.images >= 1, `${tipo}: logo no cabeçalho`);
      sizes[tipo] = info.pages;
    }
    // O relatório geral reúne todas as seções.
    assert.ok(sizes.geral > sizes.ordens);
    assert.ok(sizes.geral > sizes.disponibilidade);

    // Filtros por equipe e área também geram o documento.
    const { equipes } = await (await fetch(`http://127.0.0.1:${port}/api/cadastros`, { headers: { authorization: `Bearer ${admin}` } })).json();
    const filtered = await get(admin, `tipo=ordens&period=12m&equipe=${equipes[0].id}&area=${encodeURIComponent("Pátio B")}`);
    assert.equal(filtered.status, 200);

    const db = new Database(dbPath, { readonly: true });
    try {
      const trail = db.prepare("SELECT detalhe FROM trilha_auditoria WHERE acao = 'gerar_relatorio_pdf' ORDER BY id").all().map((row) => row.detalhe);
      assert.equal(trail.length, 8);
      assert.match(trail[5], /^Relatório de ordens por período e equipe · período 6m · Todas as áreas · Todas as equipes · \d+ página\(s\)$/);
      assert.match(trail[7], /Pátio B/);
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
