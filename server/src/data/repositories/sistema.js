// Informações do próprio banco.
import { sql } from "../connection.js";

// Data e hora atuais do banco (UTC, "AAAA-MM-DD HH:MM:SS"), referência dos cronômetros.
export const now = () => sql("SELECT datetime('now') AS agora").get().agora;
