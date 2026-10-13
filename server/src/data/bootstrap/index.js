// Carga inicial do banco. Roda sob demanda (`npm run db:bootstrap`), nunca na inicialização da API.
// A estrutura (tabelas, RLS) vem de supabase/migrations; aqui entram apenas dados de referência
// e, conforme o ambiente, o administrador inicial, o seed de exemplo e os dados de demonstração.
import bcrypt from "bcryptjs";
import { config } from "../../config.js";
import { PARAMETERS } from "../../parametros.js";
import { EXAMPLE_FORM, EXAMPLE_INSPECTION, EXAMPLE_PERMIT } from "../../formularios-exemplo.js";
import { sql, transaction } from "../connection.js";
import { USER_COLLABORATOR_SYNC_SQL } from "../repositories/colaboradores.js";
import * as formulariosRepo from "../repositories/formularios.js";
import * as parametrosRepo from "../repositories/parametros.js";
import { seedExample } from "./seed.js";
import { seedDemo } from "./seed-demo.js";

// Executa `fn` uma única vez por banco (marcador em schema_migrations), de forma atômica.
export async function runOnce(id, fn) {
  return transaction(async () => {
    const claimed = await sql("INSERT INTO schema_migrations (id) VALUES (?) ON CONFLICT (id) DO NOTHING").affected(id);
    if (!claimed) return false;
    await fn();
    return true;
  });
}

const insertModel = async (model) => {
  if (await sql("SELECT id FROM formularios_modelos WHERE nome = ? AND tipo = ?").exists(model.nome, model.tipo)) return false;
  await formulariosRepo.create({
    nome: model.nome, tipo: model.tipo, descricao: model.descricao,
    campos: JSON.stringify(model.campos), regras: JSON.stringify(model.regras), usuarioId: null,
  });
  return true;
};

// Sem o seed de exemplo (padrão em produção), não há contas com senha conhecida:
// com o banco vazio, o primeiro administrador (CCM) vem de ADMIN_USUARIO/ADMIN_SENHA.
export async function bootstrapAdmin() {
  return transaction(async () => {
    if (await sql("SELECT COUNT(*) AS total FROM usuarios").scalar("total") > 0) return null;
    const { usuario, senha, nome, email } = config.adminInicial;
    if (!usuario || !senha) {
      throw new Error("Banco sem usuários e seed de exemplo desligado: defina ADMIN_USUARIO e ADMIN_SENHA (mínimo 10 caracteres) para criar o primeiro administrador.");
    }
    await sql("INSERT INTO usuarios (nome, email, username, senha_hash, papel) VALUES (?, ?, ?, ?, 'CCM')")
      .run(nome, email, usuario, await bcrypt.hash(senha, 12));
    await sql(USER_COLLABORATOR_SYNC_SQL).run();
    return usuario;
  });
}

export async function bootstrap({ log = console.log } = {}) {
  await parametrosRepo.insertMissing(PARAMETERS);

  if (await runOnce("2026-10-05_dynamic_forms_example", () => insertModel(EXAMPLE_FORM))) log("Modelo de formulário de exemplo verificado.");
  if (await runOnce("2026-10-05_inspection_and_permit_examples", async () => {
    for (const model of [EXAMPLE_INSPECTION, EXAMPLE_PERMIT]) await insertModel(model);
  })) log("Modelos de inspeção e APR/PT de exemplo verificados.");

  if (config.seedExemplo) {
    const inserted = await seedExample();
    if (inserted > 0) log(`Seed idempotente: ${inserted} registros inseridos.`);
  } else {
    const admin = await bootstrapAdmin();
    if (admin) log(`Administrador inicial criado: ${admin}. Troque a senha de ADMIN_SENHA do ambiente após o primeiro acesso.`);
  }

  if (config.demo && await runOnce("2026-10-05_demo_data_v1", () => seedDemo())) log("Dados de demonstração carregados.");
}