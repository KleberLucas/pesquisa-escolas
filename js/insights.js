/**
 * insights.js — textos automáticos em português, gerados só a partir dos dados agregados
 * (já filtrados). Cada insight vira um card { icone, titulo, texto }.
 */
import { consultar, ranking1 } from "./data.js";

const fmt = (n) => n.toLocaleString("pt-BR");
const pct = (a, b) => ((a / b) * 100).toFixed(0).replace(".", ",") + "%";
const lista = (arr) => (arr.length <= 1 ? arr.join("") : arr.slice(0, -1).join(", ") + " e " + arr[arr.length - 1]);
const listaComOutros = (arr, max, total) => (total > max ? arr.slice(0, max).join(", ") + " e outros" : lista(arr));
const DIAS_SEMANA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

/** Distância em km entre dois pontos (fórmula de haversine). */
function km(a, b) {
  const r = (x) => (x * Math.PI) / 180, R = 6371;
  const dLat = r(b[0] - a[0]), dLon = r(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a[0])) * Math.cos(r(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Centro aproximado de um bairro: ponto, ou média dos vértices do polígono. */
function centroDe(b, geo) {
  if (b.lat != null) return [b.lat, b.lon];
  const f = geo.poligonos.get(b.id);
  if (!f) return null;
  const anel = (f.geometry.type === "Polygon" ? f.geometry.coordinates[0] : f.geometry.coordinates[0][0]);
  return [anel.reduce((s, p) => s + p[1], 0) / anel.length, anel.reduce((s, p) => s + p[0], 0) / anel.length];
}

export function gerarInsights({ dados, agg, geo }) {
  const out = [];
  const total = agg.total;
  if (!total) return out;
  const bairros = [...agg.porBairro.values()].filter((b) => b.tipo === "bairro" || b.tipo === "distrito").sort((a, b) => b.total - a.total);

  // 1) concentração nos 5 maiores bairros
  if (bairros.length >= 5) {
    const s = bairros.slice(0, 5).reduce((t, b) => t + b.total, 0);
    out.push({ icone: "📍", titulo: "Concentração geográfica", texto: `Os 5 maiores bairros (${lista(bairros.slice(0, 5).map((b) => b.nome))}) somam ${pct(s, total)} dos alunos.` });
  }

  // 2) bairro que mais concentra cada um dos cursos principais.
  //    Usa o total REAL do curso (tabela por curso): como bairros pequenos viram "Outros", só vale se a
  //    parte com bairro identificado cobre a maior parte do curso.
  const totaisCurso = new Map(ranking1(dados, "c", agg.fi));
  let n2 = 0;
  for (const [curso, tc] of [...totaisCurso].filter(([c]) => c !== "Outros" && c !== "Não informado").slice(0, 4)) {
    const cand = bairros.map((b) => [b, b.cursos.get(curso) || 0]).sort((a, b) => b[1] - a[1])[0];
    const identificados = bairros.reduce((s, b) => s + (b.cursos.get(curso) || 0), 0);
    if (cand && cand[1] >= 3 && tc >= 8 && cand[1] / tc >= 0.18 && identificados / tc >= 0.5) {
      out.push({ icone: "🎓", titulo: `Onde está ${curso}`, texto: `O bairro ${cand[0].nome} concentra ${pct(cand[1], tc)} dos alunos de ${curso} (${cand[1]} de ${tc}).` });
      if (++n2 >= 2) break;
    }
  }

  // 3) escola que mais envia alunos para um curso
  let par = null;
  for (const [k, n] of consultar(dados, "ce", agg.fi)) {
    const [c, e] = k.split("|").map(Number);
    if (dados.nomes.c[c] === "Outros" || dados.nomes.e[e] === "Outros" || dados.idxConcluiu.has(e)) continue;
    if (!par || n > par.n) par = { n, curso: dados.nomes.c[c], escola: dados.nomes.e[e] };
  }
  if (par && par.n >= 3) out.push({ icone: "🏫", titulo: "Escola e curso", texto: `A escola ${par.escola} é a que mais envia alunos para ${par.curso} (${par.n} alunos).` });

  // 4) ensino médio concluído × ainda na escola
  const esc = ranking1(dados, "e", agg.fi);
  const concl = esc.filter(([n]) => dados.idxConcluiu.has(dados.indice.e.get(n))).reduce((s, [, n]) => s + n, 0);
  const tEsc = esc.reduce((s, [, n]) => s + n, 0);
  if (concl && tEsc) {
    const topEsc = esc.find(([n]) => !dados.idxConcluiu.has(dados.indice.e.get(n)) && n !== "Outros");
    out.push({ icone: "📚", titulo: "Perfil escolar", texto: `${pct(concl, tEsc)} dos alunos já concluíram o ensino médio.` + (topEsc ? ` Entre os que ainda estudam, a escola mais presente é ${topEsc[0]} (${topEsc[1]}).` : "") });
  }

  // 5) baixa presença = oportunidade de divulgação
  const baixos = bairros.filter((b) => b.total <= 5);
  const outrosAlunos = [...agg.porBairro.values()].filter((b) => b.tipo === "outros").reduce((s, b) => s + b.total, 0);
  if (baixos.length || outrosAlunos) {
    out.push({
      icone: "📣", titulo: "Oportunidade de divulgação",
      texto: (baixos.length ? `${baixos.length} bairros aparecem com só 3 a 5 alunos (${listaComOutros(baixos.map((b) => b.nome), 5, baixos.length)}). ` : "") +
        (outrosAlunos ? `Mais ${fmt(outrosAlunos)} alunos vêm de bairros com menos de 3 alunos cada (agrupados em "Outros"). ` : "") + "São bons candidatos para ações de divulgação.",
    });
  }

  // 6) centro × periferia (só bairros já posicionados no mapa)
  const centro = geo.porNome.get("Centro");
  if (centro && centro.lat != null) {
    let perto = 0, longe = 0;
    for (const b of bairros) {
      const info = geo.porNome.get(b.nome);
      const c = centroDe({ id: b.id, lat: info?.lat, lon: info?.lon }, geo);
      if (!c) continue;
      if (km([centro.lat, centro.lon], c) <= 2) perto += b.total; else longe += b.total;
    }
    const cobertos = perto + longe;
    if (cobertos / total >= 0.3 && cobertos > 0) {
      out.push({ icone: "🧭", titulo: "Centro × periferia", texto: `Entre os bairros já posicionados no mapa (${pct(cobertos, total)} dos alunos), ${pct(perto, cobertos)} ficam a até 2 km do Centro e ${pct(longe, cobertos)} mais longe.` });
    }
  }

  // 7) fora de Barretos
  const fora = [...agg.porBairro.values()].filter((b) => b.tipo === "fora");
  const nFora = fora.reduce((s, b) => s + b.total, 0);
  if (nFora) out.push({ icone: "🚌", titulo: "Alunos de outras cidades", texto: `${fmt(nFora)} alunos (${pct(nFora, total)}) vêm de fora de Barretos: ${lista(fora.sort((a, b) => b.total - a.total).map((b) => `${b.nome} (${b.total})`))}.` });

  // 8) dias de pico (série do ano inteiro, não depende dos filtros)
  const dias = dados.dias;
  if (dias.length) {
    const soma = dias.reduce((s, [, n]) => s + n, 0);
    const [dia, n] = [...dias].sort((a, b) => b[1] - a[1])[0];
    const d = new Date(dia + "T12:00:00");
    const primeiros = dias.slice(0, 2).reduce((s, [, x]) => s + x, 0);
    out.push({
      icone: "📈", titulo: "Pico de inscrições",
      texto: `O dia de maior procura foi ${dia.slice(8, 10)}/${dia.slice(5, 7)} (${DIAS_SEMANA[d.getDay()]}), com ${fmt(n)} inscrições (${pct(n, soma)} do ano)` +
        (dias.length > 2 ? `. Os 2 primeiros dias concentraram ${pct(primeiros, soma)}.` : "."),
    });
  }
  return out;
}
