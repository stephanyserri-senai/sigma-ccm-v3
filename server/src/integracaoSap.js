import { config } from "./config.js";
import { createReport } from "./pdf.js";
import { integracaoSapRepo } from "./data/index.js";

const xmlEscape = (value) => String(value ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&apos;");

export const sapOrderNumber = (numero) => String(numero ?? "").replace(/\D/g, "").padStart(12, "0").slice(-12);
export const sapDate = (value) => {
  const text = String(value ?? "");
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  if (br) return `${br[3]}${br[2]}${br[1]}`;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  return iso ? `${iso[1]}${iso[2]}${iso[3]}` : text;
};

function confirmation(data) {
  return {
    AUFNR: sapOrderNumber(data.numero),
    PERNR: String(data.executante_matricula || ""),
    ISMNW: Number(data.hh_apropriado || 0),
    IEDD: data.data_encerramento ? sapDate(data.data_encerramento) : null,
    BUDAT: data.data_encerramento ? sapDate(data.data_encerramento) : null,
    LTXA1: String(data.observacoes || data.apontamentos_observacoes || data.atividade_realizada || "").slice(0, 40),
  };
}

const xmlPayload = ({ confirmation: item, evidence }) => [
  "<SIGMA_SAP_OUTBOUND>",
  "<CONFIRMACAO>",
  ...Object.entries(item).map(([key, value]) => `<${key}>${xmlEscape(value)}</${key}>`),
  "</CONFIRMACAO>",
  "<ANEXOS>",
  ...evidence.map((file) => `<ANEXO><NOME>${xmlEscape(file.nome)}</NOME><MIME>${xmlEscape(file.mime)}</MIME><CONTEUDO_BASE64>${file.base64}</CONTEUDO_BASE64></ANEXO>`),
  "</ANEXOS>",
  "</SIGMA_SAP_OUTBOUND>",
].join("");

export async function buildSapPayload(ordemId) {
  const data = await integracaoSapRepo.findOrderForPayload(ordemId);
  if (!data) return null;
  const evidence = (await integracaoSapRepo.listEvidenceForPayload(ordemId)).map((file) => ({
    id: file.id, nome: file.nome_arquivo, mime: file.tipo_mime, base64: Buffer.from(file.conteudo).toString("base64"),
  }));
  const item = confirmation(data);
  const report = createReport({
    titulo: `Ordem de manutenção ${data.numero}`,
    subtitulo: "Relatório de confirmação SIGMA·CCM para integração SAP",
    linhas: [`Executante: ${data.executante_nome || "—"} · Matrícula: ${item.PERNR || "—"}`, `Encerramento: ${item.IEDD || "—"}`],
  });
  report.table(
    [{ label: "Campo", width: 1.4 }, { label: "Valor", width: 3 }],
    Object.entries(item).map(([key, value]) => [key, value ?? ""]),
  );
  report.section("Observações", "Texto da confirmação de trabalho");
  report.paragraph(data.observacoes || data.apontamentos_observacoes || data.atividade_realizada || "—", { color: "#0F172A" });
  const pdf = await report.finish("SIGMA·CCM · documento gerado para integração SAP");
  const payload = { confirmation: item, evidence: [...evidence, { nome: `OM-${data.numero}.pdf`, mime: "application/pdf", base64: pdf.buffer.toString("base64") }] };
  return { ...payload, format: config.sap.format, serialized: config.sap.format === "xml" ? xmlPayload(payload) : JSON.stringify(payload) };
}

export async function enqueueSapOrder(ordemId) {
  const payload = await buildSapPayload(ordemId);
  if (!payload) return null;
  await integracaoSapRepo.enqueue({ ordemId, payload });
  await integracaoSapRepo.setOrderStatus(ordemId, "PENDENTE");
  return payload;
}

export async function processSapQueueItem(item) {
  const claimed = await integracaoSapRepo.claim(item.id);
  if (!claimed) return null;
  try {
    const result = await sendSapPayload(claimed.payload);
    await integracaoSapRepo.log({
      ordemId: claimed.ordem_id, tentativa: claimed.tentativas, status: result.status,
      codigoHttp: result.statusCode, resposta: result.body,
    });
    const erro = result.status === "ERRO" ? result.body : null;
    await integracaoSapRepo.finish(claimed.id, { status: result.status, erro });
    await integracaoSapRepo.setOrderStatus(claimed.ordem_id, result.status, erro);
    return result;
  } catch (error) {
    const next = new Date(Date.now() + config.sap.retryMinutes * 60000)
      .toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "");
    const message = error.name === "AbortError" ? "Tempo limite do SAP excedido." : error.message;
    await integracaoSapRepo.log({ ordemId: claimed.ordem_id, tentativa: claimed.tentativas, status: "ERRO", resposta: message });
    await integracaoSapRepo.finish(claimed.id, { status: "ERRO", erro: message, proximaTentativa: next });
    await integracaoSapRepo.setOrderStatus(claimed.ordem_id, "ERRO", message);
    return { status: "ERRO", error: message };
  }
}

export function startSapWorker() {
  if (!config.sap.url) return null;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const items = await integracaoSapRepo.list();
      for (const item of items.filter((entry) => ["PENDENTE", "ERRO"].includes(entry.status))) {
        await processSapQueueItem(item);
      }
    } catch (error) {
      console.error("Fila SAP: falha ao processar pendências:", error.message);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, Math.max(config.sap.retryMinutes * 60000, 30000));
  timer.unref?.();
  void tick();
  return timer;
}

export function classifySapResponse(statusCode, body) {
  const text = typeof body === "string" ? body : JSON.stringify(body || {});
  if (statusCode === 404 || /order does not exist|ordem inexistente|order.*not.*exist/i.test(text)) return "ERRO_ORDEM_INEXISTENTE";
  if (/duplicat|already posted|já foi realizada|ja foi realizada|registro existente/i.test(text)) return "REGISTRO_DUPLICADO";
  if (statusCode >= 200 && statusCode < 300) return "ENVIADO_AO_SAP";
  return "ERRO";
}

export async function sendSapPayload(payload) {
  if (!config.sap.url) throw new Error("SAP_OUTBOUND_URL não configurada.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.sap.timeoutMs);
  try {
    const response = await fetch(config.sap.url, {
      method: "POST",
      headers: {
        Accept: config.sap.format === "xml" ? "application/xml" : "application/json",
        "Content-Type": config.sap.format === "xml" ? "application/xml" : "application/json",
        ...(config.sap.token ? { Authorization: `Bearer ${config.sap.token}` } : {}),
      },
      body: payload.serialized,
      signal: controller.signal,
    });
    const body = await response.text();
    return { statusCode: response.status, body, status: classifySapResponse(response.status, body) };
  } finally {
    clearTimeout(timer);
  }
}
