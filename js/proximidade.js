/**
 * proximidade.js — distâncias em linha reta até o Senac Barretos e a análise de proximidade dos alunos.
 * Usa só as contagens agregadas já publicadas (k = 3): nada por aluno. Entram na conta apenas os bairros que
 * têm posição no mapa e passam da regra k = 3 (grupos "Outros", cidades de fora, área rural e "Não informado" ficam de fora).
 */

/** Distância em km entre dois pontos [lat, lon] (fórmula de Haversine, raio médio da Terra 6371 km). */
export function haversineKm(a, b) {
  const r = (x) => (x * Math.PI) / 180;
  const h = Math.sin(r(b[0] - a[0]) / 2) ** 2 + Math.cos(r(a[0])) * Math.cos(r(b[0])) * Math.sin(r(b[1] - a[1]) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** Anéis do mapa (km). */
export const ANEIS_KM = [1, 2, 3, 5];

/** Faixas de distância da análise: [mín, máx] (mín exclusivo, máx inclusivo). */
export const FAIXAS = [
  { rot: "Até 1 km", min: 0, max: 1 },
  { rot: "1–2 km", min: 1, max: 2 },
  { rot: "2–3 km", min: 2, max: 3 },
  { rot: "3–5 km", min: 3, max: 5 },
  { rot: "Mais de 5 km", min: 5, max: Infinity },
];

/** "≈ 1,4 km" / "≈ 850 m". */
export function fmtDist(km) {
  return km < 0.95 ? `${Math.round(km * 100) * 10} m` : `${km.toFixed(1).replace(".", ",")} km`;
}

/**
 * Analisa os bairros posicionados (cada um com { nome, total, distSenac }).
 * `totalGeral` = alunos do recorte atual (para dizer quantos entraram na conta).
 * Devolve null se não há ninguém com distância.
 */
export function analisarProximidade(bairros, totalGeral) {
  const lista = bairros.filter((b) => b.distSenac != null && b.total > 0);
  const considerados = lista.reduce((s, b) => s + b.total, 0);
  if (!considerados) return null;
  const faixas = FAIXAS.map((f) => ({ ...f, alunos: 0, bairros: 0 }));
  for (const b of lista) {
    const f = faixas.find((x) => b.distSenac > x.min && b.distSenac <= x.max) || faixas[0];   // distância 0 exata cai na 1ª faixa
    f.alunos += b.total; f.bairros++;
  }
  const ate = (km) => lista.filter((b) => b.distSenac <= km).reduce((s, b) => s + b.total, 0);
  const porDist = [...lista].sort((a, b) => a.distSenac - b.distSenac || b.total - a.total);
  return {
    considerados, totalGeral, bairros: lista.length, faixas,
    pctAte3: (ate(3) / considerados) * 100, pctAte1: (ate(1) / considerados) * 100,
    media: lista.reduce((s, b) => s + b.distSenac * b.total, 0) / considerados,   // média ponderada pelo nº de alunos
    maisPerto: porDist[0], maisLonge: porDist[porDist.length - 1],
    ranking: porDist,
  };
}
