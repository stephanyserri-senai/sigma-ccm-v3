// IAMOT — índice de apropriação de mão de obra.
// HH apropriado ÷ (HH disponível − HH de ocorrências), por equipe e semana (segunda a domingo).

const DAY_MS = 24 * 60 * 60 * 1000;
const WORKDAYS = 5;
const pad = (value) => String(value).padStart(2, "0");

export const isoDate = (date) => `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;

export function parseIsoDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? "").trim());
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return isoDate(date) === match[0] ? date : null;
}

export function addDays(iso, days) {
  return isoDate(new Date(parseIsoDate(iso).getTime() + days * DAY_MS));
}

// Segunda-feira da semana da data informada (ou null, se a data for inválida).
export function weekStart(value) {
  const date = parseIsoDate(value);
  if (!date) return null;
  return isoDate(new Date(date.getTime() - ((date.getUTCDay() + 6) % 7) * DAY_MS));
}

export function todayLocal() {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// Dias úteis (segunda a sexta) de uma ocorrência dentro da semana.
function workdaysInWeek(inicio, fim, semana) {
  const from = inicio > semana ? inicio : semana;
  const friday = addDays(semana, WORKDAYS - 1);
  const to = fim < friday ? fim : friday;
  if (from > to) return 0;
  return Math.round((parseIsoDate(to).getTime() - parseIsoDate(from).getTime()) / DAY_MS) + 1;
}

export function laborIndex(apropriado, disponivel, ocorrencias) {
  if (disponivel == null) return { liquido: null, iamot: null };
  const liquido = Math.max(0, disponivel - ocorrencias);
  return { liquido, iamot: liquido > 0 ? (apropriado / liquido) * 100 : null };
}

// Mapa "equipe|semana" -> { equipe_id, semana, disponivel, ocorrencias, apropriado }
// para as semanas iniciadas em [from, to). `disponivel` é null quando não foi lançado.
export function teamWeekLabor(db, from, to) {
  const cells = new Map();
  const cell = (equipeId, semana) => {
    const key = `${equipeId}|${semana}`;
    if (!cells.has(key)) cells.set(key, { equipe_id: equipeId, semana, disponivel: null, ocorrencias: 0, apropriado: 0 });
    return cells.get(key);
  };

  for (const row of db.prepare(`
    SELECT equipe_id, semana_inicio, hh_disponivel FROM hh_disponivel
    WHERE semana_inicio >= ? AND semana_inicio < ?
  `).all(from, to)) {
    cell(row.equipe_id, row.semana_inicio).disponivel = row.hh_disponivel;
  }

  // O HH pertence à equipe de quem apropriou; sem ela, vale a equipe da OM.
  for (const row of db.prepare(`
    SELECT COALESCE(u.equipe_id, c.equipe_id, o.equipe_id) AS equipe_id,
           date(a.data, 'localtime') AS dia, a.hh_apropriado AS hh
    FROM apontamentos a
    JOIN ordens o ON o.id = a.ordem_id
    LEFT JOIN usuarios u ON u.id = a.usuario_id
    LEFT JOIN colaboradores c ON c.id = a.colaborador_id
    WHERE a.tipo = 'Apropriação' AND date(a.data, 'localtime') >= ? AND date(a.data, 'localtime') < ?
  `).all(from, to)) {
    if (row.equipe_id == null) continue;
    cell(row.equipe_id, weekStart(row.dia)).apropriado += row.hh;
  }

  for (const row of db.prepare(`
    SELECT COALESCE(u.equipe_id, c.equipe_id) AS equipe_id, oc.data_inicio,
           COALESCE(oc.data_fim, oc.data_inicio) AS data_fim, oc.horas_dia
    FROM ocorrencias_hh oc
    JOIN colaboradores c ON c.id = oc.colaborador_id
    LEFT JOIN usuarios u ON u.id = c.usuario_id
    WHERE COALESCE(u.equipe_id, c.equipe_id) IS NOT NULL AND oc.data_inicio < ? AND COALESCE(oc.data_fim, oc.data_inicio) >= ?
  `).all(to, from)) {
    if (!parseIsoDate(row.data_inicio) || !parseIsoDate(row.data_fim)) continue;
    const first = weekStart(row.data_inicio);
    for (let semana = first > from ? first : from; semana < to && semana <= row.data_fim; semana = addDays(semana, 7)) {
      const hours = workdaysInWeek(row.data_inicio, row.data_fim, semana) * row.horas_dia;
      if (hours > 0) cell(row.equipe_id, semana).ocorrencias += hours;
    }
  }

  return cells;
}

// Consolida apenas as semanas/equipes com HH disponível lançado, para que
// apropriações sem base de comparação não inflem o índice. `equipeId` restringe a uma equipe.
export function summarizeLabor(db, from, to, equipeId = null) {
  const total = { apropriado: 0, disponivel: 0, ocorrencias: 0, lancamentos: 0 };
  for (const item of teamWeekLabor(db, from, to).values()) {
    if (item.disponivel == null || (equipeId && item.equipe_id !== equipeId)) continue;
    total.apropriado += item.apropriado;
    total.disponivel += item.disponivel;
    total.ocorrencias += item.ocorrencias;
    total.lancamentos += 1;
  }
  if (!total.lancamentos) return { ...total, liquido: null, iamot: null };
  return { ...total, ...laborIndex(total.apropriado, total.disponivel, total.ocorrencias) };
}
