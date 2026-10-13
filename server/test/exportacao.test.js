import assert from "node:assert/strict";
import { inflateRawSync } from "node:zlib";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { startPostgres } from "./helpers/postgres.js";

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

function unzipLocalEntries(zip) {
  const files = new Map();
  let offset = 0;
  while (zip.readUInt32LE(offset) === 0x04034B50) {
    const compressedSize = zip.readUInt32LE(offset + 18);
    const nameLength = zip.readUInt16LE(offset + 26);
    const extraLength = zip.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const name = zip.toString("utf8", nameStart, nameStart + nameLength);
    const data = inflateRawSync(zip.subarray(dataStart, dataStart + compressedSize));
    files.set(name, data.toString("utf8"));
    offset = dataStart + compressedSize;
  }
  return files;
}

test("Exportação SAP: ZIP CSV autenticado só para CCM, com KPIs e sem campos de credenciais", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "sigma-exportacao-"));
  const pg = await startPostgres({ SIGMA_DEMO: "0" });
  const port = 31481;
  const child = spawn(process.execPath, ["src/index.js"], {
    cwd: serverDir,
    env: { ...process.env, ...pg.env, PORT: String(port), SIGMA_DEMO: "0", JWT_SECRET: "export-test-secret" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    await waitForApi(child);
    const api = (token, path, method = "GET", body) => fetch(`http://127.0.0.1:${port}/api${path}`, {
      method,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const login = async (username, senha) => (await (await api("", "/auth/login", "POST", { username, senha })).json());
    const admin = (await login("admin", "admin123")).token;
    const pcm = (await login("pcm", "pcm123")).token;

    assert.equal((await api("", "/exportacao/sap")).status, 401);
    assert.equal((await api(pcm, "/exportacao/sap")).status, 403);
    const response = await api(admin, "/exportacao/sap");
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /application\/zip/);
    assert.match(response.headers.get("content-disposition"), /sigma-ccm-sap-.*\.zip/);
    const files = unzipLocalEntries(Buffer.from(await response.arrayBuffer()));

    assert.ok(files.has("LEIA-ME.txt"));
    assert.ok(files.has("ordens.csv"));
    assert.ok(files.has("notas.csv"));
    assert.ok(files.has("relatorios_execucao.csv"));
    assert.ok(files.has("indicadores_resumo.csv"));
    assert.ok(files.has("indicadores_iamot.csv"));
    assert.match(files.get("LEIA-ME.txt"), /não é um template de importação SAP/i);
    assert.match(files.get("LEIA-ME.txt"), /atestado/i);
    assert.match(files.get("ordens.csv"), /^\uFEFFid;numero;tipo;status/);
    assert.doesNotMatch(files.get("usuarios.csv"), /senha_hash|username|email/);
    assert.equal((await pg.query("SELECT COUNT(*) AS total FROM trilha_auditoria WHERE acao = 'exportar_pacote_sap'"))[0].total, 1);
  } finally {
    if (child.exitCode === null) {
      child.kill();
      await new Promise((resolve) => child.once("exit", resolve));
    }
    rmSync(tempDir, { recursive: true, force: true });
    await pg.close();
  }
});
