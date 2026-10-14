// Envio de respostas do motor de formulários, compartilhado por formulários avulsos,
// rondas de inspeção e permissões de trabalho.
import multer from "multer";
import { formulariosRepo, respostasFormularioRepo } from "./data/index.js";
import { ARQUIVO_CAMPOS, evaluateSubmission, parseJson } from "./formularios.js";

export const formUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 20 },
  fileFilter: (_req, file, callback) => {
    if (!/^image\/(jpeg|png|webp|gif)$/i.test(file.mimetype)) {
      callback(new Error("Fotos e assinaturas devem ser imagens JPG, PNG, WEBP ou GIF."));
      return;
    }
    callback(null, true);
  },
});
const FILE_PREFIX = "arquivo:";

export const readModel = (row) => row && ({ ...row, ativo: Boolean(row.ativo), campos: parseJson(row.campos, []), regras: parseJson(row.regras, {}) });
export const activeModel = async (id) => readModel(await formulariosRepo.findActive(Number(id)));

// Aceita multipart ("dados" em JSON + arquivos "arquivo:<campo>") ou JSON simples.
export const submissionData = (req) => (typeof req.body?.dados === "string" ? parseJson(req.body.dados, null) : req.body && Object.keys(req.body).length ? req.body : null);

// Valida respostas e arquivos contra o modelo. Retorna { error } ou o resultado da avaliação.
export function evaluateRequest(model, valores, reqFiles, { exigirFotoDocumento = false } = {}) {
  const files = new Map();
  let fotoDocumento = null;
  for (const file of reqFiles || []) {
    const campo = file.fieldname.startsWith(FILE_PREFIX) ? file.fieldname.slice(FILE_PREFIX.length) : null;
    const field = model.campos.find((item) => item.id === campo);
    if (exigirFotoDocumento && campo === "foto_documento" && !field) {
      if (fotoDocumento) return { error: "Envie apenas uma foto do APR/PT físico." };
      fotoDocumento = file;
      continue;
    }
    if (!field || !ARQUIVO_CAMPOS.has(field.tipo) || files.has(campo)) return { error: "Arquivo enviado para um campo inválido." };
    files.set(campo, file);
  }
  const result = evaluateSubmission(model.campos, valores || {}, files);
  if (result.error || !exigirFotoDocumento) return result;
  if (model.campos.some((item) => item.id === "foto_documento")) {
    return result.anexos.some((item) => item.campo === "foto_documento")
      ? result
      : { error: "Anexe a foto do APR/PT físico preenchido." };
  }
  if (!fotoDocumento) return { error: "Anexe a foto do APR/PT físico preenchido." };
  result.anexos.push({ campo: "foto_documento", tipo: "foto", file: fotoDocumento });
  result.respostas.foto_documento = fotoDocumento.originalname || "foto_documento.png";
  return result;
}

// Grava a resposta (com o modelo congelado na versão) e os anexos. Deve rodar dentro de uma transação.
// `criadoEm` (UTC) registra quando o formulário foi preenchido, inclusive offline.
export async function insertResponse({ model, ordemId = null, equipamentoId = null, result, userId, criadoEm = null }) {
  const respostaId = await respostasFormularioRepo.create({
    modelo: { ...model, campos: JSON.stringify(model.campos) }, ordemId, equipamentoId,
    respostas: JSON.stringify(result.respostas), naoConformidades: JSON.stringify(result.naoConformidades), usuarioId: userId, criadoEm,
  });
  for (const anexo of result.anexos) {
    await respostasFormularioRepo.addAttachment({
      respostaId, campoId: anexo.campo, tipo: anexo.tipo, nomeArquivo: (anexo.file.originalname || `${anexo.tipo}.png`).slice(0, 240),
      tipoMime: anexo.file.mimetype, conteudo: anexo.file.buffer,
    });
  }
  return respostaId;
}

export function uploadErrors(error, _req, res, next) {
  if (error instanceof multer.MulterError) {
    return res.status(400).json({ error: error.code === "LIMIT_FILE_SIZE" ? "Cada imagem pode ter no máximo 5 MB." : "Arquivos demais no envio." });
  }
  if (error) return res.status(400).json({ error: error.message || "Envio inválido." });
  next();
}
