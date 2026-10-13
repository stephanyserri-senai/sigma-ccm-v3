// Carga inicial explícita: parâmetros de KPI, modelos de exemplo, administrador inicial e seeds opcionais.
// Uso: npm run db:bootstrap (com DATABASE_URL apontando para o banco já migrado).
import { bootstrap } from "../src/data/bootstrap/index.js";
import { closeDatabase } from "../src/data/index.js";

try {
  await bootstrap();
  console.log("Bootstrap concluído.");
} catch (error) {
  console.error(`Bootstrap falhou: ${error.message}`);
  process.exitCode = 1;
} finally {
  await closeDatabase();
}