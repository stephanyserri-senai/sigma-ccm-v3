// Envio de respostas do motor de formulários, compartilhado por formulários avulsos,
// rondas de inspeção e permissões de trabalho.
import multer from "multer";
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
export const activeModel = (db, id) => readModel(db.prepare("SELECT * FROM formularios_modelos WHERE id = ? AND ativo = 1").get(Number(id)));

// Aceita multipart ("dados" em JSON + arquivos "arquivo:<campo>") ou JSON simples.
export const submissionData = (req) => (typeof req.body?.dados === "string" ? parseJson(req.body.dados, null) : req.body && Object.keys(req.body).length ? req.body : null);

// Valida respostas e arquivos contra o modelo. Retorna { error } ou o resultado da avaliação.
export function evaluateRequest(model, valores, reqFiles) {
  const files = new Map();
  for (const file of reqFiles || []) {
    const campo = file.fieldname.startsWith(FILE_PREFIX) ? file.fieldname.slice(FILE_PREFIX.length) : null;
    const field = model.campos.find((item) => item.id === campo);
    if (!field || !ARQUIVO_CAMPOS.has(field.tipo) || files.has(campo)) return { error: "Arquivo enviado para um campo inválido." };
    files.set(campo, file);
  }
  return evaluateSubmission(model.campos, valores || {}, files);
}

// Grava a resposta (com o modelo congelado na versão) e os anexos. Deve rodar dentro de uma transação.
export function insertResponse(db, { model, ordemId = null, equipamentoId = null, result, userId }) {
  const info = db.prepare(`
    INSERT INTO formularios_respostas (modelo_id, modelo_versao, modelo_nome, modelo_tipo, campos, ordem_id, equipamento_id, respostas, nao_conformidades, usuario_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(model.id, model.versao, model.nome, model.tipo, JSON.stringify(model.campos), ordemId, equipamentoId,
    JSON.stringify(result.respostas), JSON.stringify(result.naoConformidades), userId);
  const insert = db.prepare("INSERT INTO formularios_anexos (resposta_id, campo_id, tipo, nome_arquivo, tipo_mime, conteudo) VALUES (?, ?, ?, ?, ?, ?)");
  for (const anexo of result.anexos) {
    insert.run(info.lastInsertRowid, anexo.campo, anexo.tipo, (anexo.file.originalname || `${anexo.tipo}.png`).slice(0, 240), anexo.file.mimetype, anexo.file.buffer);
  }
  return Number(info.lastInsertRowid);
}

export function uploadErrors(error, _req, res, next) {
  if (error instanceof multer.MulterError) {
    return res.status(400).json({ error: error.code === "LIMIT_FILE_SIZE" ? "Cada imagem pode ter no máximo 5 MB." : "Arquivos demais no envio." });
  }
  if (error) return res.status(400).json({ error: error.message || "Envio inválido." });
  next();
}
