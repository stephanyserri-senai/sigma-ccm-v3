// Suporte à operação offline-first: momento real do registro e envio idempotente da fila local.
import { idempotenciaRepo } from "./data/index.js";

const MAX_PASSADO_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_FUTURO_MS = 5 * 60 * 1000;

// Converte o instante informado pelo aparelho (ISO) para o formato de texto UTC do banco.
// Aceita até 7 dias no passado e 5 minutos no futuro (diferença de relógio).
export function clientTimestamp(value) {
  if (value === undefined || value === null || value === "") return { value: null };
  const time = Date.parse(String(value));
  if (Number.isNaN(time)) return { error: "Data e hora do registro inválidas." };
  const now = Date.now();
  if (time > now + MAX_FUTURO_MS) return { error: "A data e hora do registro estão no futuro. Confira o relógio do aparelho." };
  if (time < now - MAX_PASSADO_MS) return { error: "Registro offline com mais de 7 dias; lance novamente com a data atual." };
  return { value: new Date(time).toISOString().slice(0, 19).replace("T", " ") };
}

// Reenvios da fila (mesmo X-Idempotency-Key) devolvem a resposta original sem repetir a operação.
export function idempotency({ jwt, secret }) {
  const PURGE_INTERVAL_MS = 60 * 60 * 1000;
  let lastPurge = 0;
  return async (req, res, next) => {
    // Limpeza periódica das chaves expiradas (em vez de a cada inicialização, que em serverless é a cada invocação fria).
    if (Date.now() - lastPurge > PURGE_INTERVAL_MS) {
      lastPurge = Date.now();
      await idempotenciaRepo.purgeExpired();
    }
    const key = req.get("X-Idempotency-Key");
    if (!key || req.method === "GET" || !/^[A-Za-z0-9-]{8,80}$/.test(key)) return next();
    let userId = null;
    try { userId = jwt.verify(String(req.get("Authorization") || "").replace(/^Bearer /, ""), secret).id; } catch { /* a rota responde 401 */ }
    const previous = await idempotenciaRepo.find(key);
    if (previous) {
      if (previous.usuario_id !== userId) return res.status(409).json({ error: "Chave de envio já usada por outro usuário." });
      return res.status(previous.status).set("X-Idempotent-Replay", "1").type("application/json").send(previous.resposta);
    }
    const json = res.json.bind(res);
    res.json = async (body) => {
      if (userId && res.statusCode < 500) {
        try {
          await idempotenciaRepo.save({ chave: key, usuarioId: userId, metodo: req.method, rota: req.originalUrl.slice(0, 200), status: res.statusCode, resposta: JSON.stringify(body ?? null) });
        } catch (error) {
          // Falha ao registrar a chave não invalida a operação já concluída; o reenvio seria reexecutado.
          console.error("Falha ao registrar chave de idempotência:", error.message);
        }
      }
      return json(body);
    };
    next();
  };
}
