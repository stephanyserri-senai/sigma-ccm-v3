// Suporte à operação offline-first: momento real do registro e envio idempotente da fila local.

const MAX_PASSADO_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_FUTURO_MS = 5 * 60 * 1000;

// Converte o instante informado pelo aparelho (ISO) para o formato do SQLite em UTC.
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
export function idempotency({ db, jwt, secret }) {
  db.prepare("DELETE FROM requisicoes_idempotentes WHERE criado_em < datetime('now', '-30 days')").run();
  const find = db.prepare("SELECT usuario_id, status, resposta FROM requisicoes_idempotentes WHERE chave = ?");
  const save = db.prepare(`
    INSERT OR IGNORE INTO requisicoes_idempotentes (chave, usuario_id, metodo, rota, status, resposta) VALUES (?, ?, ?, ?, ?, ?)
  `);
  return (req, res, next) => {
    const key = req.get("X-Idempotency-Key");
    if (!key || req.method === "GET" || !/^[A-Za-z0-9-]{8,80}$/.test(key)) return next();
    let userId = null;
    try { userId = jwt.verify(String(req.get("Authorization") || "").replace(/^Bearer /, ""), secret).id; } catch { /* a rota responde 401 */ }
    const previous = find.get(key);
    if (previous) {
      if (previous.usuario_id !== userId) return res.status(409).json({ error: "Chave de envio já usada por outro usuário." });
      return res.status(previous.status).set("X-Idempotent-Replay", "1").type("application/json").send(previous.resposta);
    }
    const json = res.json.bind(res);
    res.json = (body) => {
      if (userId && res.statusCode < 500) {
        try { save.run(key, userId, req.method, req.originalUrl.slice(0, 200), res.statusCode, JSON.stringify(body ?? null)); } catch { /* não bloqueia a resposta */ }
      }
      return json(body);
    };
    next();
  };
}
