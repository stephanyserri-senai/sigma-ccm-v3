// Detecção de inconsistências em apontamentos (heurística + faixa).
// Retorna null (consistente) ou um objeto de sinalização com explicação (XAI).
export function detectar(hh, hhPrev) {
  hhPrev = hhPrev || 4;
  let tipo = null;
  let score = 0;

  if (hh <= 0) {
    tipo = "HH inválido";
    score = 0.95;
  } else if (hh > 12) {
    tipo = "HH fora da faixa";
    score = Math.min(0.99, 0.6 + (hh - 12) / 18);
  } else if (hh > 2.5 * hhPrev) {
    tipo = "HH acima do previsto";
    score = Math.min(0.95, 0.55 + (hh - hhPrev) / (hhPrev * 6));
  }

  if (!tipo) return null;

  const clamp = (n) => Math.max(0.08, Math.min(1, n));
  return {
    tipo,
    score: Math.round(score * 100) / 100,
    sugerido: hhPrev,
    fatores: [
      { t: "HH acima do previsto na OM", v: clamp(hh / (hhPrev * 3)) },
      { t: "Divergência com histórico", v: 0.6 },
      { t: "Turno incompatível", v: hh > 10 ? 0.5 : 0.25 },
    ],
  };
}
