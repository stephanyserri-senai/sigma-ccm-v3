// Carga inicial: administrador do ambiente (produção), seed de exemplo (desenvolvimento) e
// dados de demonstração. Tudo idempotente: só insere o que ainda não existe.
import bcrypt from "bcryptjs";
import { config } from "../config.js";
import { db } from "./connection.js";
import { runMigration, USER_TEAM_BACKFILL_SQL } from "./migrations.js";
import { USER_COLLABORATOR_SYNC_SQL } from "./repositories/colaboradores.js";
import { seedDemo } from "./seed-demo.js";

// Sem o seed de exemplo (padrão em produção), não há contas com senha conhecida:
// com o banco vazio, o primeiro administrador (CCM) é criado a partir de ADMIN_USUARIO/ADMIN_SENHA.
function bootstrapAdmin() {
  if (db.prepare("SELECT COUNT(*) AS total FROM usuarios").get().total > 0) return;
  const { usuario, senha, nome, email } = config.adminInicial;
  if (!usuario || !senha) {
    console.error("Banco sem usuários e seed de exemplo desligado: defina ADMIN_USUARIO e ADMIN_SENHA (mínimo 10 caracteres) para criar o primeiro administrador.");
    process.exit(1);
  }
  db.prepare("INSERT INTO usuarios (nome, email, username, senha_hash, papel) VALUES (?, ?, ?, ?, 'CCM')")
    .run(nome, email, usuario, bcrypt.hashSync(senha, 12));
  db.exec(USER_COLLABORATOR_SYNC_SQL);
  console.log(`Administrador inicial criado: ${usuario}. Troque a senha de ADMIN_SENHA do ambiente após o primeiro acesso.`);
}

// Dados de demonstração: uma única vez por banco (marcador em schema_migrations), sem duplicar.
// SIGMA_DEMO liga/desliga (padrão: ligado fora de produção; os testes de API usam SIGMA_DEMO=0).
function seedDemoIfEnabled() {
  if (config.demo && runMigration("2026-10-05_demo_data_v1", () => seedDemo(db))) {
    console.log("Dados de demonstração carregados.");
  }
}

export function seed() {
  if (!config.seedExemplo) {
    bootstrapAdmin();
    seedDemoIfEnabled();
    return;
  }
  const hash = (password) => bcrypt.hashSync(password, 10);
  const inserted = db.transaction(() => {
    let changes = 0;

    const getOrCreateId = (lookupSql, lookupParams, insertSql, insertParams) => {
      let row = db.prepare(lookupSql).get(...lookupParams);
      if (!row) {
        db.prepare(insertSql).run(...insertParams());
        changes += 1;
        row = db.prepare(lookupSql).get(...lookupParams);
      }
      if (!row) throw new Error(`Não foi possível recuperar o registro seed: ${lookupSql}`);
      return row.id;
    };
    const insertIfMissing = (lookupSql, lookupParams, insertSql, insertParams) => {
      if (db.prepare(lookupSql).get(...lookupParams)) return;
      db.prepare(insertSql).run(...insertParams);
      changes += 1;
    };

    const userId = (username, nome, email, password, papel) => getOrCreateId(
      "SELECT id FROM usuarios WHERE username = ?", [username],
      "INSERT INTO usuarios (nome, email, username, senha_hash, papel) VALUES (?,?,?,?,?)",
      () => [nome, email, username, hash(password), papel]
    );
    const adminId = userId("admin", "Ana Souza", "ana@empresa.com", "admin123", "CCM");
    const userIdPcm = userId("pcm", "Carlos Lima", "carlos@empresa.com", "pcm123", "PCM");
    const fieldUserId = userId("campo", "João Pereira", "joao@empresa.com", "campo123", "EXECUTANTE");

    const teamNames = ["Elétrica Prev.", "Automação", "Mecânica FM", "Caldeiraria"];
    const teamIds = teamNames.map((name) => getOrCreateId(
      "SELECT id FROM equipes WHERE nome = ?", [name],
      "INSERT INTO equipes (nome, tipo, especialidade) VALUES (?,?,?)",
      () => [name, name === "Caldeiraria" ? "Terceirizada" : "Própria", name]
    ));

    const equipmentRows = [
      ["VT-3330-TR01", "Sistema estrutural TR01", "Terminal Leste", "Estrutura", "Alta"],
      ["TR01-BOMBA-02", "Bomba de recalque 02", "Terminal Leste", "Bomba", "Alta"],
      ["PA-2200-MOT", "Motor de acionamento 2200", "Pátio A", "Motor", "Média"],
      ["ESTR-3330", "Estrutura metálica 3330", "Terminal Leste", "Estrutura", "Média"],
    ];
    const equipmentIds = equipmentRows.map((row) => getOrCreateId(
      "SELECT id FROM equipamentos WHERE tag = ?", [row[0]],
      "INSERT INTO equipamentos (tag, descricao, localizacao, classe, criticidade) VALUES (?,?,?,?,?)",
      () => row
    ));

    const collaboratorRows = [
      ["Marisa A. Rios", "M-1001", "Eletricista", teamIds[0], null],
      ["Flávio H. Ferreira", "M-1002", "Mecânico", teamIds[2], null],
      ["Luiz F. Silva", "M-1003", "Instrumentista", teamIds[1], null],
      ["José M. Alves", "M-1004", "Caldeireiro", teamIds[3], fieldUserId],
    ];
    const collaboratorIds = collaboratorRows.map((row) => getOrCreateId(
      "SELECT id FROM colaboradores WHERE matricula = ?", [row[1]],
      "INSERT INTO colaboradores (nome, matricula, especialidade, equipe_id, usuario_id) VALUES (?,?,?,?,?)",
      () => row
    ));
    db.exec(USER_TEAM_BACKFILL_SQL);
    db.exec(USER_COLLABORATOR_SYNC_SQL);

    const noteRows = [
      ["14137", equipmentIds[0], "Tela de proteção danificada", "Corretiva", "Aberta", adminId],
      ["14205", equipmentIds[1], "Vibração acima do normal", "Inspeção", "Aberta", adminId],
      ["14210", equipmentIds[2], "Ruído intermitente no motor", "Corretiva", "Aberta", adminId],
      ["14233", equipmentIds[3], "Corrosão em estrutura metálica", "Corretiva", "Aberta", adminId],
    ];
    noteRows.forEach((row) => getOrCreateId(
      "SELECT id FROM notas WHERE numero = ?", [row[0]],
      "INSERT INTO notas (numero, equipamento_id, descricao, tipo, status, solicitante_id) VALUES (?,?,?,?,?,?)",
      () => row
    ));

    const orderRows = [
      ["40012345", "Corretiva", "Distribuída", equipmentIds[0], teamIds[0], 6, "09/07"],
      ["40012346", "Inspeção", "Programada", equipmentIds[1], teamIds[2], 3, "09/07"],
      ["40012350", "Corretiva", "Aberta", equipmentIds[2], teamIds[1], 4, "10/07"],
      ["40012352", "Corretiva", "Programada", equipmentIds[3], teamIds[3], 8, "10/07"],
    ];
    const orderIds = orderRows.map((row) => getOrCreateId(
      "SELECT id FROM ordens WHERE numero = ?", [row[0]],
      "INSERT INTO ordens (numero, tipo, status, equipamento_id, equipe_id, hh_previsto, data_programada) VALUES (?,?,?,?,?,?,?)",
      () => row
    ));

    const firstOrderId = orderIds[0];
    const firstCollaboratorId = collaboratorIds[0];
    const insertApontamento = "INSERT INTO apontamentos (ordem_id, colaborador_id, tipo, hh_apropriado) VALUES (?,?,?,?)";
    for (const tipo of ["Apropriação", "Relatório"]) {
      insertIfMissing(
        "SELECT 1 FROM apontamentos WHERE ordem_id = ? AND colaborador_id = ? AND tipo = ?",
        [firstOrderId, firstCollaboratorId, tipo], insertApontamento,
        [firstOrderId, firstCollaboratorId, tipo, 6]
      );
    }

    const fatores = JSON.stringify([
      { t: "HH acima do previsto na OM", v: 0.9 },
      { t: "Divergência com histórico", v: 0.62 },
      { t: "Turno incompatível", v: 0.45 },
    ]);
    insertIfMissing(
      "SELECT 1 FROM sinalizacoes_ia WHERE ordem_numero = ? AND campo = ? AND valor_atual = ? AND tipo = ?",
      ["40012346", "HH apropriado", 13, "HH fora da faixa"],
      "INSERT INTO sinalizacoes_ia (entidade_tipo, ordem_numero, campo, valor_atual, valor_sugerido, tipo, score, explicacao, status) VALUES (?,?,?,?,?,?,?,?,?)",
      ["apontamento", "40012346", "HH apropriado", 13, 3, "HH fora da faixa", 0.88, fatores, "Nova"]
    );

    return changes;
  }).immediate();

  if (inserted > 0) console.log(`Seed idempotente: ${inserted} registros inseridos.`);

  seedDemoIfEnabled();
}
