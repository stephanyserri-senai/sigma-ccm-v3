import { app, VERSAO } from "./app.js";
import { config } from "./config.js";
import { closeDatabase } from "./data/index.js";
import { startSapWorker } from "./integracaoSap.js";

// Servidor local/tradicional. Na Vercel a aplicação é importada por api/index.js, sem listen.
const server = app.listen(config.port, () => {
  console.log(`SIGMA-CCM API em http://localhost:${config.port} (versão ${VERSAO}, ambiente ${config.env})`);
  console.log(`Banco: ${new URL(config.database.url).host} · CORS: ${config.corsOrigins.join(", ")} · validade do token: ${config.jwtExpiresIn}`);
});
const sapWorker = startSapWorker();

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    if (sapWorker) clearInterval(sapWorker);
    server.close(() => closeDatabase().finally(() => process.exit(0)));
  });
}