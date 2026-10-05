// Camada de acesso a dados do SIGMA·CCM. Ponto de entrada único para rotas e serviços:
//   import { ordensRepo, transaction } from "../data/index.js";
// Toda instrução SQL fica em src/data (conexão, migrações, seeds e repositórios por entidade).
// Para trocar de banco, basta reimplementar esta pasta mantendo as mesmas funções.
import { migrate } from "./migrations.js";
import { seed } from "./seed.js";

// Cria/atualiza a estrutura (migrações idempotentes) e faz a carga inicial.
export function initDatabase() {
  migrate();
  seed();
}

export { transaction, uniqueViolation, isUniqueViolation, isForeignKeyViolation } from "./connection.js";

export * as usuariosRepo from "./repositories/usuarios.js";
export * as equipesRepo from "./repositories/equipes.js";
export * as equipamentosRepo from "./repositories/equipamentos.js";
export * as colaboradoresRepo from "./repositories/colaboradores.js";
export * as planosRepo from "./repositories/planos.js";
export * as notasRepo from "./repositories/notas.js";
export * as ordensRepo from "./repositories/ordens.js";
export * as apontamentosRepo from "./repositories/apontamentos.js";
export * as relatoriosExecucaoRepo from "./repositories/relatoriosExecucao.js";
export * as evidenciasRepo from "./repositories/evidencias.js";
export * as execucoesRepo from "./repositories/execucoes.js";
export * as hhDisponivelRepo from "./repositories/hhDisponivel.js";
export * as ocorrenciasRepo from "./repositories/ocorrencias.js";
export * as sinalizacoesRepo from "./repositories/sinalizacoes.js";
export * as auditoriaRepo from "./repositories/auditoria.js";
export * as parametrosRepo from "./repositories/parametros.js";
export * as passagensRepo from "./repositories/passagens.js";
export * as formulariosRepo from "./repositories/formularios.js";
export * as respostasFormularioRepo from "./repositories/respostasFormulario.js";
export * as rotasInspecaoRepo from "./repositories/rotasInspecao.js";
export * as rondasInspecaoRepo from "./repositories/rondasInspecao.js";
export * as permissoesTrabalhoRepo from "./repositories/permissoesTrabalho.js";
export * as notificacoesRepo from "./repositories/notificacoes.js";
export * as idempotenciaRepo from "./repositories/idempotencia.js";
export * as programacaoRepo from "./repositories/programacao.js";
export * as indicadoresRepo from "./repositories/indicadores.js";
export * as sistemaRepo from "./repositories/sistema.js";
