// Motor de formulários dinâmicos: validação de modelos (No-Code), aplicabilidade às OMs
// (checklist inteligente) e avaliação das respostas (campos condicionais e não conformidades).
import { formulariosRepo, ordensRepo, respostasFormularioRepo } from "./data/index.js";

export const TIPOS_MODELO = ["Checklist", "Inspeção", "Permissão", "Formulário livre"];
export const TIPOS_CAMPO = ["texto", "numero", "simnao", "selecao", "foto", "assinatura"];
export const SIM_NAO = ["Sim", "Não"];
export const ARQUIVO_CAMPOS = new Set(["foto", "assinatura"]);
const MAX_CAMPOS = 100;
const MAX_OPCOES = 50;

const text = (value, max) => String(value ?? "").trim().slice(0, max);
const optionalNumber = (value) => value === "" || value == null ? null : Number(value);
const stringList = (value, max) => (Array.isArray(value) ? value : [])
  .map((item) => text(item, 100)).filter(Boolean).slice(0, max);

export function parseJson(value, fallback) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}

// Valida e normaliza o modelo enviado pelo construtor. Retorna { error } ou o modelo limpo.
export function validateTemplate(body) {
  const nome = text(body.nome, 120);
  if (!nome) return { error: "Informe o nome do formulário." };
  if (!TIPOS_MODELO.includes(body.tipo)) return { error: "Tipo de formulário inválido." };
  if (!Array.isArray(body.campos) || !body.campos.length) return { error: "Adicione pelo menos um campo." };
  if (body.campos.length > MAX_CAMPOS) return { error: `Use no máximo ${MAX_CAMPOS} campos.` };

  const campos = [];
  const seen = new Map();
  for (const [index, raw] of body.campos.entries()) {
    const position = `Campo ${index + 1}`;
    const id = text(raw?.id, 40);
    if (!/^[a-z0-9_-]{1,40}$/i.test(id) || seen.has(id)) return { error: `${position}: identificador inválido ou repetido.` };
    const rotulo = text(raw.rotulo, 200);
    if (!rotulo) return { error: `${position}: informe o rótulo.` };
    if (!TIPOS_CAMPO.includes(raw.tipo)) return { error: `${position}: tipo de campo inválido.` };
    const campo = { id, rotulo, tipo: raw.tipo, obrigatorio: Boolean(raw.obrigatorio) };
    const ajuda = text(raw.ajuda, 300);
    if (ajuda) campo.ajuda = ajuda;

    if (raw.tipo === "selecao") {
      campo.opcoes = [...new Set(stringList(raw.opcoes, MAX_OPCOES))];
      if (!campo.opcoes.length) return { error: `${position} (${rotulo}): informe as opções da seleção.` };
      campo.opcoes_nc = stringList(raw.opcoes_nc, MAX_OPCOES).filter((option) => campo.opcoes.includes(option));
    }
    if (raw.tipo === "simnao" && raw.esperado) {
      if (!SIM_NAO.includes(raw.esperado)) return { error: `${position} (${rotulo}): resposta esperada inválida.` };
      campo.esperado = raw.esperado;
    }
    if (raw.tipo === "numero") {
      const min = optionalNumber(raw.limite_min);
      const max = optionalNumber(raw.limite_max);
      if ([min, max].some((value) => value !== null && !Number.isFinite(value))) return { error: `${position} (${rotulo}): limites inválidos.` };
      if (min !== null && max !== null && min > max) return { error: `${position} (${rotulo}): o limite mínimo é maior que o máximo.` };
      if (min !== null) campo.limite_min = min;
      if (max !== null) campo.limite_max = max;
      const unidade = text(raw.unidade, 20);
      if (unidade) campo.unidade = unidade;
    }
    // Condição: mostrar o campo só quando um campo anterior (sim/não ou seleção) tiver o valor indicado.
    if (raw.condicao?.campo) {
      const source = seen.get(raw.condicao.campo);
      if (!source || !["simnao", "selecao"].includes(source.tipo)) {
        return { error: `${position} (${rotulo}): a condição deve usar um campo sim/não ou seleção anterior.` };
      }
      const allowed = source.tipo === "simnao" ? SIM_NAO : source.opcoes;
      if (!allowed.includes(raw.condicao.valor)) return { error: `${position} (${rotulo}): valor da condição inválido.` };
      campo.condicao = { campo: source.id, valor: raw.condicao.valor };
    }
    seen.set(id, campo);
    campos.push(campo);
  }

  const rawRules = body.regras || {};
  const regras = {
    automatico: Boolean(rawRules.automatico),
    obrigatorio: Boolean(rawRules.obrigatorio),
    tipos_om: stringList(rawRules.tipos_om, 20),
    classes_equipamento: stringList(rawRules.classes_equipamento, 50),
  };
  return { nome, tipo: body.tipo, descricao: text(body.descricao, 1000) || null, campos, regras };
}

// Avalia uma resposta contra os campos do modelo. `files` mapeia campo -> arquivo enviado.
export function evaluateSubmission(campos, valores, files) {
  const respostas = {};
  const anexos = [];
  const naoConformidades = [];
  const visible = new Set();
  for (const campo of campos) {
    if (campo.condicao && (!visible.has(campo.condicao.campo) || respostas[campo.condicao.campo] !== campo.condicao.valor)) continue;
    visible.add(campo.id);
    const raw = valores?.[campo.id];
    const empty = raw === undefined || raw === null || (typeof raw === "string" && !raw.trim());

    if (ARQUIVO_CAMPOS.has(campo.tipo)) {
      const file = files.get(campo.id);
      if (!file) {
        if (campo.obrigatorio) return { error: `Preencha "${campo.rotulo}".` };
        continue;
      }
      anexos.push({ campo: campo.id, tipo: campo.tipo, file });
      respostas[campo.id] = file.originalname || `${campo.tipo}.png`;
      continue;
    }
    if (empty) {
      if (campo.obrigatorio) return { error: `Preencha "${campo.rotulo}".` };
      continue;
    }
    if (campo.tipo === "texto") respostas[campo.id] = String(raw).trim().slice(0, 2000);
    if (campo.tipo === "numero") {
      const value = Number(raw);
      if (!Number.isFinite(value)) return { error: `"${campo.rotulo}" deve ser um número.` };
      respostas[campo.id] = value;
      if ((campo.limite_min != null && value < campo.limite_min) || (campo.limite_max != null && value > campo.limite_max)) {
        naoConformidades.push({ campo: campo.id, rotulo: campo.rotulo, valor: value,
          motivo: `Fora da faixa ${campo.limite_min ?? "−∞"} a ${campo.limite_max ?? "+∞"}${campo.unidade ? ` ${campo.unidade}` : ""}` });
      }
    }
    if (campo.tipo === "simnao") {
      if (!SIM_NAO.includes(raw)) return { error: `"${campo.rotulo}": responda Sim ou Não.` };
      respostas[campo.id] = raw;
      if (campo.esperado && raw !== campo.esperado) {
        naoConformidades.push({ campo: campo.id, rotulo: campo.rotulo, valor: raw, motivo: `Esperado: ${campo.esperado}` });
      }
    }
    if (campo.tipo === "selecao") {
      if (!campo.opcoes.includes(raw)) return { error: `"${campo.rotulo}": opção inválida.` };
      respostas[campo.id] = raw;
      if (campo.opcoes_nc?.includes(raw)) naoConformidades.push({ campo: campo.id, rotulo: campo.rotulo, valor: raw, motivo: "Opção marcada como não conforme" });
    }
  }
  return { respostas, anexos, naoConformidades };
}

const ruleMatches = (regras, order) => regras.automatico
  && (!regras.tipos_om.length || regras.tipos_om.includes(order.tipo))
  && (!regras.classes_equipamento.length || regras.classes_equipamento.includes(order.classe));

// Formulários aplicáveis a uma OM: vínculos manuais + regras automáticas, com a situação de cada um.
export function orderForms(orderId) {
  const order = ordensRepo.findTypeAndClass(orderId);
  if (!order) return [];
  const links = new Map(formulariosRepo.listOrderLinks(orderId).map((row) => [row.modelo_id, row]));
  return formulariosRepo.listActiveForOrders()
    .map((model) => ({ ...model, regras: parseJson(model.regras, {}) }))
    .filter((model) => links.has(model.id) || ruleMatches({ automatico: false, tipos_om: [], classes_equipamento: [], ...model.regras }, order))
    .map((model) => {
      const link = links.get(model.id);
      const response = respostasFormularioRepo.findLatestForOrder(orderId, model.id);
      return {
        modelo_id: model.id, nome: model.nome, tipo: model.tipo, descricao: model.descricao, versao: model.versao,
        origem: link ? "manual" : "regra",
        obrigatorio: link ? Boolean(link.obrigatorio) : Boolean(model.regras.obrigatorio),
        ultima_resposta: response ? { ...response, nao_conformidades: parseJson(response.nao_conformidades, []).length } : null,
      };
    });
}

export const pendingRequiredForms = (orderId) => orderForms(orderId)
  .filter((form) => form.obrigatorio && !form.ultima_resposta).length;
