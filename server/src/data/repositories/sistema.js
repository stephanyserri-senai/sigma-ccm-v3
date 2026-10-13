// Informações do próprio banco.
import { sql } from "../connection.js";

// Data e hora atuais do banco (UTC, "AAAA-MM-DD HH:MM:SS"), referência dos cronômetros.
export const now = () => sql("SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') AS agora").scalar("agora");
