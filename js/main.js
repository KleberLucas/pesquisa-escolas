/**
 * main.js — ponto de entrada: liga dados, filtros, mapa, gráficos, insights, apresentação e exportação.
 * Todo o estado fica em `estado` (nada de variáveis globais soltas).
 */
import { carregarAnos, carregarAno, carregarGeografia, carregarRegioes, totaisRegioes, montarAgregado, classificar, ranking, ranking1, filtrosParaIndices, MIN_EXIBIR } from "./data.js";
import { filtrosVazios, qtdAtivos, alternar, criarInterface } from "./filters.js";
import { criarMapa, atualizarPaleta, criarFaixas } from "./map.js";
import { criarGraficos } from "./charts.js";
import { gerarInsights } from "./insights.js";
import { criarApresentacao } from "./presentation.js";
import { exportarCSV, exportarPNG } from "./exportar.js";
import { criarPainelSemPosicao } from "./sempos.js";

const $ = (s) => document.querySelector(s);
const fmt = (n) => n.toLocaleString("pt-BR");
const pct = (a, b) => ((a / b) * 100).toFixed(1).replace(".", ",") + "%";

const estado = {
  anos: [], ano: null, dados: null, geo: null,
  anoB: "", dadosB: null,                           // comparação
  regioes: [], fundo: "estilizado", visual: "minimalista", top5: false,
  filtros: filtrosVazios(),
  camadas: { bairros: false, areas: true, semposicao: false },   // padrão: só Áreas
  regiaoSel: null,                                              // id da região selecionada (clique)
  aba: "resumo", agg: null,
};
let mapa = null, graficos = null, ui = null, apresentacao = null, semPos = null;

/** O link "Posicionar no mapa" abre o editor, que só funciona localmente: no site público ele nem aparece. */
const ehLocal = ["localhost", "127.0.0.1", "[::1]", ""].includes(location.hostname);

/* ------------------------------------------------------------ utilidades */
function aviso(msg) {
  const t = $("#toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(aviso.t);
  aviso.t = setTimeout(() => { t.hidden = true; }, 3500);
}

/* ------------------------------------------------------------ tema */
function temaInicial() {
  let salvo = null;
  try { salvo = localStorage.getItem("tema"); } catch { /* sem armazenamento: ok */ }
  return salvo || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
}
function aplicarTema(t) {
  document.documentElement.dataset.theme = t;
  atualizarPaleta();   // a escala de calor vem das variáveis CSS (mudam com tema e visual)
  $("#btn-tema").textContent = t === "dark" ? "☀️" : "🌙";
  $("#btn-tema").setAttribute("aria-label", t === "dark" ? "Mudar para tema claro" : "Mudar para tema escuro");
  try { localStorage.setItem("tema", t); } catch { /* ignora */ }
  mapa?.setTema(t);
  if (estado.agg) { graficos.tema(); renderizar(); }
}

/* ------------------------------------------------------------ fontes */
/** As fontes web (Alfa Slab One / Lora) chegam depois do 1º desenho: redesenha quando prontas, para as medidas ficarem certas. */
function aoCarregarFontes() {
  if (!document.fonts) return;
  Promise.all([document.fonts.load('1em "Alfa Slab One"'), document.fonts.load("1em Lora"), document.fonts.load('1em Inter')])
    .then(() => document.fonts.ready).then(() => { if (estado.agg) { graficos.tema(); renderizar(); } }).catch(() => {});
}

/* ------------------------------------------------------------ visual */
/** Aplica o visual ao <html> (data-visual) e sincroniza o seletor "Fundo". */
function aplicarVisual() {
  document.documentElement.dataset.visual = estado.visual;
  $("#sel-fundo").value = estado.fundo === "estilizado" ? estado.visual : estado.fundo;
  atualizarPaleta();
  mapa?.setTema(document.documentElement.dataset.theme || "light");
}

/* ------------------------------------------------------------ abas */
function abrirAba(nome) {
  estado.aba = nome;
  for (const b of document.querySelectorAll("[data-aba]")) b.setAttribute("aria-selected", String(b.dataset.aba === nome));
  for (const s of document.querySelectorAll(".aba")) s.hidden = s.id !== "aba-" + nome;
  document.querySelector(`[data-aba="${nome}"]`)?.scrollIntoView?.({ inline: "nearest", block: "nearest" });   // abas rolam na horizontal no celular
  if (nome === "graficos") requestAnimationFrame(() => graficos.redimensionar());
}

/* ------------------------------------------------------------ KPIs */
function animarNumero(el, alvo) {
  const ini = performance.now(), dur = 700, de = Number(el.dataset.v || 0);
  el.dataset.v = alvo;
  const passo = (agora) => {
    const k = Math.min(1, (agora - ini) / dur);
    el.textContent = fmt(Math.round(de + (alvo - de) * (1 - Math.pow(1 - k, 3))));
    if (k < 1) requestAnimationFrame(passo);
  };
  requestAnimationFrame(passo);
}

function atualizarKPIs(agg) {
  const { dados } = estado;
  const nomeados = [...agg.porBairro.values()].filter((b) => b.tipo === "bairro" || b.tipo === "distrito").sort((a, b) => b.total - a.total);
  const cursos = ranking1(dados, "c", agg.fi).filter(([n]) => n !== "Outros" && n !== "Não informado");
  const escolas = ranking1(dados, "e", agg.fi).filter(([n]) => n !== "Outros" && !dados.idxConcluiu.has(dados.indice.e.get(n)));
  animarNumero($("#kpi-total"), agg.total);
  animarNumero($("#kpi-bairros"), nomeados.length);
  $("#kpi-curso").textContent = cursos[0] ? `${cursos[0][0]} (${pct(cursos[0][1], agg.total)})` : "—";
  $("#kpi-bairro").textContent = nomeados[0] ? `${nomeados[0].nome} (${nomeados[0].total})` : "—";
  $("#kpi-escola").textContent = escolas[0] ? `${escolas[0][0]} (${escolas[0][1]})` : "—";
}

/* ------------------------------------------------------------ legenda e avisos */
/** Blocos da legenda por faixas (Ilustrado): cor + intervalo real de alunos ("21–30"). */
function legendaFaixas(ol, fx) {
  ol.replaceChildren();
  if (!fx) return;
  for (const f of fx.faixas) {
    const li = document.createElement("li");
    const rot = f.min === f.max ? fmt(f.min) : `${fmt(f.min)}–${fmt(f.max)}`;
    li.setAttribute("aria-label", `${rot} alunos`);
    const i = document.createElement("i"); i.style.background = f.cor; i.setAttribute("aria-hidden", "true");
    const t = document.createElement("span"); t.textContent = rot;
    li.append(i, t); ol.append(li);
  }
}

function atualizarLegenda(grupos, agg, max, diff, faixasB) {
  $("#leg-normal").hidden = diff;
  $("#leg-diff").hidden = !diff;
  if (diff) $("#leg-a").textContent = estado.ano;
  if (!faixasB) {
    $("#leg-min").textContent = String(MIN_EXIBIR);
    $("#leg-max").textContent = fmt(max) + " alunos";   // rótulos "Baixo"/"Alto" ficam no HTML
  }

  const faltam = grupos.semPosicao.reduce((s, b) => s + b.total, 0);
  const lista = $("#lista-sem-posicao");
  lista.replaceChildren();
  $("#aviso-sem-posicao").hidden = faltam === 0;
  $("#aviso-curto").hidden = faltam === 0;
  if (faltam) {
    const txt = `${fmt(faltam)} alunos (${pct(faltam, agg.total || 1)}) moram em ${grupos.semPosicao.length} ${grupos.semPosicao.length === 1 ? "bairro" : "bairros"} ainda sem posição no mapa.`;
    $("#txt-sem-posicao").textContent = txt;
    $("#aviso-curto").textContent = "⚠ " + txt + " Toque para ver.";
    for (const b of grupos.semPosicao) { const li = document.createElement("li"); li.textContent = `${b.nome}: ${b.total}`; lista.append(li); }
  }
  const notas = [];
  if (grupos.pequenos.alunos) notas.push(`${fmt(grupos.pequenos.alunos)} alunos em bairros com menos de ${MIN_EXIBIR} alunos (agrupados como "Outros")`);
  if (grupos.foraMapa.alunos) notas.push(`${fmt(grupos.foraMapa.alunos)} alunos de outras cidades, área rural ou sem bairro informado`);
  $("#nota-fora").textContent = notas.length ? "Não aparecem no mapa: " + notas.join("; ") + "." : "";
}

/* ------------------------------------------------------------ aba Bairro */
function barras(ul, pares, total) {
  ul.replaceChildren();
  const maxN = Math.max(1, ...pares.map(([, n]) => n));
  for (const [nome, n] of pares) {
    const li = document.createElement("li");
    const a = document.createElement("span"); a.textContent = nome;
    const b = document.createElement("span"); b.textContent = `${n} · ${pct(n, total)}`;
    const t = document.createElement("span"); t.className = "trilho";
    const p = document.createElement("span"); p.className = "preench";
    t.append(p); li.append(a, b, t); ul.append(li);
    requestAnimationFrame(() => { p.style.width = (n / maxN) * 100 + "%"; });
  }
}

function atualizarBairro(agg, grupos) {
  const nomes = [...estado.filtros.bairros];
  const b = nomes.length === 1 ? [...agg.porBairro.values()].find((x) => x.nome === nomes[0]) : null;
  $("#tab-bairro").hidden = !b;
  if (!b) { if (estado.aba === "bairro") abrirAba("resumo"); return; }
  $("#g-nome").textContent = b.nome;
  const pendente = grupos.semPosicao.find((x) => x.nome === b.nome);
  $("#g-posicionar").hidden = !(ehLocal && pendente);
  if (pendente && ehLocal) $("#g-posicionar").href = `editor.html?bairro=${encodeURIComponent(pendente.id)}`;
  $("#g-total").textContent = fmt(b.total);
  $("#g-pct").textContent = `${pct(b.total, estado.dados.total)} do total de alunos`;
  $("#g-aprox").hidden = true;
  barras($("#b-cursos"), ranking(b.cursos), b.total);
  barras($("#b-escolas"), ranking(b.escolas), b.total);
}

/* ------------------------------------------------------------ aba Região */
function atualizarRegiao(regioes, totalGeral) {
  const r = regioes.find((x) => x.id === estado.regiaoSel);
  $("#tab-regiao").hidden = !r;
  if (!r) { if (estado.aba === "regiao") abrirAba("resumo"); return; }
  $("#r-nome").textContent = r.nome;
  $("#r-total").textContent = fmt(r.total);
  $("#r-pct").textContent = r.apagada ? "sem alunos neste recorte" : `${pct(r.total, totalGeral || 1)} do total · ${r.membros} bairros na região`;
  const ul = $("#r-bairros");
  ul.replaceChildren();
  for (const b of r.bairros) {   // clicar num bairro da lista abre o painel daquele bairro
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    const n = document.createElement("span"); n.textContent = b.nome;
    const q = document.createElement("small"); q.textContent = `${b.total} · ${pct(b.total, r.total)}`;
    btn.append(n, q);
    btn.addEventListener("click", () => selecionarBairro(b.nome));
    li.append(btn); ul.append(li);
  }
  if (!r.bairros.length) { const li = document.createElement("li"); li.className = "vazio-msg"; li.textContent = "Nenhum bairro com alunos neste recorte."; ul.append(li); }
  barras($("#r-cursos"), ranking(r.cursos), r.total || 1);
  barras($("#r-escolas"), ranking(r.escolas), r.total || 1);
}

/* ------------------------------------------------------------ aba Escola (escola → mapa) */
/** Escolas que entram na lista: sem "Já concluiu o ensino médio", "Outros" e "Não informado". */
function escolasListadas() {
  const { dados } = estado;
  return ranking1(dados, "e", filtrosParaIndices(dados, filtrosVazios()))
    .filter(([n]) => n !== "Outros" && n !== "Não informado" && !dados.idxConcluiu.has(dados.indice.e.get(n)));
}
/** A escola em foco = exatamente uma escola marcada no filtro (e que é uma escola de verdade). */
function escolaEmFoco() {
  const f = estado.filtros;
  if (f.escolas.size !== 1) return null;
  const nome = [...f.escolas][0];
  return escolasListadas().some(([n]) => n === nome) ? nome : null;
}

function atualizarEscola(aggMapa, regioes) {
  const { dados, filtros: f } = estado;
  const sel = $("#esc-sel");
  const lista = escolasListadas();
  const foco = escolaEmFoco();
  sel.replaceChildren(new Option("Escolha uma escola…", ""));
  for (const [n, q] of lista) sel.add(new Option(`${n} (${q})`, n));
  sel.value = foco || "";
  const vazio = $("#esc-vazio"), perfil = $("#esc-perfil");
  vazio.hidden = !!foco; perfil.hidden = !foco;
  if (!foco) {
    vazio.textContent = f.escolas.size > 1 ? `Há ${f.escolas.size} escolas marcadas nos filtros. Escolha uma para ver o perfil dela.` : "Nenhuma escola escolhida.";
    return;
  }
  // total da escola (tabela "e", respeita os outros filtros) x alunos que aparecem no mapa (bairros com 3+ alunos da escola)
  const total = ranking1(dados, "e", aggMapa.fi).find(([n]) => n === foco)?.[1] ?? aggMapa.total;
  const noMapa = aggMapa.total;
  $("#esc-nome").textContent = foco;
  animarNumero($("#esc-total"), total);
  $("#esc-pct").textContent = `${pct(total, dados.total || 1)} dos ${fmt(dados.total)} alunos de ${estado.ano}` +
    (noMapa < total ? ` · ${fmt(noMapa)} com bairro exibível no mapa` : "");
  const poucos = $("#esc-poucos");
  const mapeados = regioes.filter((r) => !r.apagada).length;
  poucos.hidden = !(total < 10 || mapeados === 0);
  poucos.textContent = mapeados === 0
    ? "⚠ Poucos alunos: nenhum bairro tem 3 ou mais alunos desta escola, então o mapa fica vazio (privacidade)."
    : `⚠ Poucos alunos (${total}): o mapa mostra só os bairros com 3 ou mais alunos desta escola.`;
  const ul = $("#esc-regioes");
  ul.replaceChildren();
  for (const r of regioes.filter((x) => !x.apagada).sort((a, b) => b.total - a.total).slice(0, 4)) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    const n = document.createElement("span"); n.textContent = r.nome;
    const q = document.createElement("small"); q.textContent = `${r.total} · ${pct(r.total, noMapa || 1)}`;
    btn.append(n, q);
    btn.addEventListener("click", () => selecionarRegiao(r));
    li.append(btn); ul.append(li);
  }
  if (!ul.children.length) { const li = document.createElement("li"); li.className = "vazio-msg"; li.textContent = "Nenhuma região com alunos suficientes."; ul.append(li); }
  const bairros = [...aggMapa.porBairro.values()].filter((b) => b.tipo === "bairro" || b.tipo === "distrito").sort((a, b) => b.total - a.total).slice(0, 5).map((b) => [b.nome, b.total]);
  barras($("#esc-bairros"), bairros, noMapa || 1);
  const todosCursos = ranking1(dados, "c", aggMapa.fi);
  const cursos = todosCursos.filter(([n]) => n !== "Outros" && n !== "Não informado").slice(0, 5);
  barras($("#esc-cursos"), cursos, todosCursos.reduce((s, [, n]) => s + n, 0) || 1);
}

/* ------------------------------------------------------------ insights */
function renderInsights(lista) {
  const raiz = $("#lista-insights");
  raiz.replaceChildren();
  if (!lista.length) { const p = document.createElement("p"); p.className = "vazio-msg"; p.textContent = "Sem dados suficientes neste recorte. Tente limpar os filtros."; raiz.append(p); return; }
  for (const ins of lista) {
    const c = document.createElement("article"); c.className = "insight";
    const i = document.createElement("div"); i.className = "ico"; i.textContent = ins.icone; i.setAttribute("aria-hidden", "true");
    const d = document.createElement("div");
    const h = document.createElement("h3"); h.textContent = ins.titulo;
    const p = document.createElement("p"); p.textContent = ins.texto;
    d.append(h, p); c.append(i, d); raiz.append(c);
  }
}

/* ------------------------------------------------------------ renderização principal */
function itensComparacao(aggA, aggB, geo) {
  const mapaB = new Map([...aggB.porBairro.values()].map((b) => [b.nome, b.total]));
  const mapaA = new Map([...aggA.porBairro.values()].map((b) => [b.nome, b.total]));
  const nomes = new Set([...mapaA.keys(), ...mapaB.keys()]);
  const itens = [];
  for (const nome of nomes) {
    const info = geo.porNome.get(nome);
    if (!info || (info.tipo !== "bairro" && info.tipo !== "distrito")) continue;
    const poligono = geo.poligonos.get(info.id) || null;   // só para achar o centroide do marcador
    if (!poligono && info.lat == null) continue;
    const a = mapaA.get(nome) || 0, b = mapaB.get(nome) || 0;
    if (a === b) continue;
    itens.push({ nome, id: info.id, lat: info.lat, lon: info.lon, fonte: info.fonte, poligono, totalA: a, totalB: b, diff: a - b, total: a, cursos: new Map(), escolas: new Map() });
  }
  return itens;
}

/* ------------------------------------------------------------ Top 5 */
/**
 * Os 5 maiores: regiões (se "Áreas" estiver ligado) ou bairros. Só entram itens com ≥ 3 alunos
 * (nunca "Outros", cidades de fora etc.) e tudo respeita os filtros ativos.
 */
function calcularTop5(regioes, aggMapa, emDiff) {
  const modo = estado.camadas.areas ? "regioes" : "bairros";
  let lista = [];
  if (modo === "regioes") lista = regioes.filter((r) => !r.apagada && r.total >= MIN_EXIBIR).map((r) => ({ chave: r.id, nome: r.nome, total: r.total, r }));
  else lista = [...aggMapa.porBairro.values()].filter((b) => (b.tipo === "bairro" || b.tipo === "distrito") && b.total >= MIN_EXIBIR).map((b) => ({ chave: b.nome, nome: b.nome, total: b.total }));
  const itens = emDiff ? [] : lista.sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome, "pt-BR")).slice(0, 5);
  return { modo, itens, ranks: new Map(itens.map((x, i) => [x.chave, i + 1])) };
}

function atualizarTop5(top, totalGeral) {
  const secao = $("#top5");
  secao.hidden = top.itens.length === 0;
  if (secao.hidden) return;
  const n = top.itens.length;
  $("#top5-titulo").textContent = `Top ${n === 5 ? "5" : n} ${top.modo === "regioes" ? "regiões" : "bairros"} em destaque`;
  const ol = $("#top5-lista");
  ol.replaceChildren();
  top.itens.forEach((it, i) => {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.type = "button";
    const selo = document.createElement("span"); selo.className = "selo-top"; selo.style.setProperty("--cor", `var(--top-${i + 1})`); selo.textContent = String(i + 1);
    const nome = document.createElement("span"); nome.className = "nome"; nome.textContent = it.nome;
    const qtd = document.createElement("span"); qtd.className = "qtd"; qtd.textContent = `${fmt(it.total)} alunos`;
    b.append(selo, nome, qtd);
    b.addEventListener("click", () => (it.r ? selecionarRegiao(it.r) : selecionarBairro(it.nome)));
    li.append(b); ol.append(li);
  });
  const soma = top.itens.reduce((s, x) => s + x.total, 0);
  $("#top5-frase").innerHTML = `Os ${n === 5 ? "5" : n} maiores concentram <b></b> dos alunos.`;
  $("#top5-frase b").textContent = pct(soma, totalGeral || 1);
  const btn = $("#btn-top5");
  btn.setAttribute("aria-pressed", String(estado.top5));
  btn.textContent = estado.top5 ? "Destacar Top 5 no mapa: ligado" : "Destacar Top 5 no mapa";
}

/** Regiões com totais sob os filtros; no modo diferença, compara com o outro ano. */
function itensRegioes(aggA, aggB) {
  const A = totaisRegioes(estado.regioes, aggA).map((r) => ({ ...r, selecionada: r.id === estado.regiaoSel }));
  if (!aggB) return A;
  const B = new Map(totaisRegioes(estado.regioes, aggB).map((r) => [r.id, r.total]));
  return A.map((r) => ({ ...r, totalA: r.total, totalB: B.get(r.id) || 0, diff: r.total - (B.get(r.id) || 0), apagada: r.total === 0 && !(B.get(r.id) || 0) }));
}

function renderizar() {
  const { dados, geo, filtros: f } = estado;
  const agg = montarAgregado(dados, geo, f);                          // KPIs, insights, aba Bairro
  const aggMapa = montarAgregado(dados, geo, f, new Set(["bairros"])); // mapa e ranking: sem a seleção por clique
  estado.agg = agg;
  const grupos = classificar(aggMapa, geo);
  const emDiff = !!estado.dadosB;

  let itens, max, aggB = null;
  if (emDiff) {
    aggB = montarAgregado(estado.dadosB, geo, f, new Set(["bairros"]));
    itens = itensComparacao(aggMapa, aggB, geo);
    max = Math.max(1, ...itens.map((i) => Math.abs(i.diff)));
    const dif = aggMapa.total - aggB.total;
    const k = $("#kpi-comp");
    k.textContent = `${dif > 0 ? "+" : ""}${fmt(dif)} vs ${estado.anoB}`;
    k.className = dif >= 0 ? "mais" : "menos";
  } else {
    itens = grupos.noMapa.map((b) => ({ ...b, selecionado: f.bairros.has(b.nome), dim: f.bairros.size > 0 && !f.bairros.has(b.nome) }));
    // mesma escala no mapa e no painel "sem posição": o máximo considera os dois quando o painel está aberto
    if (escolaEmFoco()) {   // escola → mapa: os demais bairros ficam esmaecidos, só como contexto
      const todos = classificar(montarAgregado(dados, geo, { ...f, escolas: new Set(), ocultarConcluiu: false }, new Set(["bairros"])), geo).noMapa;
      const tem = new Set(itens.map((b) => b.nome));
      for (const b of todos) if (!tem.has(b.nome)) itens.push({ ...b, total: 0, cursos: new Map(), escolas: new Map(), dim: true, contexto: true });
    }
    max = Math.max(1, ...itens.map((b) => b.total), ...(estado.camadas.semposicao ? grupos.semPosicao.map((b) => b.total) : []));
    $("#kpi-comp").textContent = "";
  }
  const regioes = itensRegioes(aggMapa, aggB);
  const top = calcularTop5(regioes, aggMapa, emDiff);
  // Ilustrado: faixas por quantis calculadas só sobre o que está exibido (Áreas: regiões; Bairros: bairros), com os filtros atuais
  const faixas = emDiff ? {} : {
    areas: estado.camadas.areas ? criarFaixas(regioes.filter((r) => !r.apagada).map((r) => r.total)) : null,
    bairros: estado.camadas.bairros || estado.camadas.semposicao
      ? criarFaixas([...itens.filter((b) => !b.contexto).map((b) => b.total), ...(estado.camadas.semposicao ? grupos.semPosicao.map((b) => b.total) : [])]) : null,
  };
  const desenhado = mapa.atualizar(itens, {
    modo: emDiff ? "diff" : "normal", max, totalGeral: aggMapa.total || 1,
    mostrarBairros: estado.camadas.bairros, mostrarAreas: estado.camadas.areas, regioes, faixas, rotuloA: estado.ano, rotuloB: estado.anoB,
    top5: { ativo: estado.top5 && !emDiff && top.itens.length > 0, modo: top.modo, ranks: top.ranks },
  });

  // legenda: uma escala para cada camada ligada (Bairros / Áreas)
  const maxAreas = Math.max(1, ...regioes.map((r) => r.total));
  $("#leg-linha-bairros").hidden = !estado.camadas.bairros;
  $("#leg-linha-areas").hidden = !estado.camadas.areas;
  $("#leg-max-areas").textContent = fmt(maxAreas) + " alunos";
  legendaFaixas($("#faixas-areas"), faixas.areas);
  legendaFaixas($("#faixas-bairros"), faixas.bairros);
  if (faixas.areas) { $("#leg-min-areas").textContent = fmt(faixas.areas.faixas[0].min); $("#leg-max-areas").textContent = fmt(faixas.areas.faixas.at(-1).max) + " alunos"; }
  else $("#leg-min-areas").textContent = "0";
  if (faixas.bairros) { $("#leg-min").textContent = fmt(faixas.bairros.faixas[0].min); $("#leg-max").textContent = fmt(faixas.bairros.faixas.at(-1).max) + " alunos"; }
  $("#leg-explica").hidden = !estado.camadas.areas;

  // dica pequena quando as opções atuais não desenham nada (nunca deixa o mapa "em branco" sem explicar)
  const nada = desenhado.areas + desenhado.bolhas === 0;
  const dica = $("#dica-mapa");
  dica.hidden = !nada;
  if (nada) dica.textContent = !estado.camadas.bairros && !estado.camadas.areas ? "Ative Bairros ou Áreas para ver os dados" : "Nada para mostrar com estas opções. Ative Bairros ou Áreas.";
  document.body.dataset.mapa = `areas:${desenhado.areas},bairros:${desenhado.bolhas}`;
  document.body.dataset.regioes = regioes.map((r) => r.total).join(",");   // (usado nos testes automatizados)
  // painel "Bairros sem posição" (respeita os mesmos filtros, pois vem do mesmo agregado)
  $("#painel-sempos").hidden = !estado.camadas.semposicao;
  if (estado.camadas.semposicao) {
    semPos.atualizar(
      grupos.semPosicao.map((b) => ({ ...b, selecionado: f.bairros.has(b.nome), dim: f.bairros.size > 0 && !f.bairros.has(b.nome) })),
      { max: emDiff ? Math.max(1, ...grupos.semPosicao.map((b) => b.total), ...grupos.noMapa.map((b) => b.total)) : max, totalGeral: aggMapa.total, faixas: faixas.bairros },
    );
  }
  atualizarKPIs(agg);
  atualizarLegenda(grupos, aggMapa, max, emDiff, faixas.bairros);
  atualizarBairro(agg, grupos);
  atualizarTop5(top, aggMapa.total);
  atualizarRegiao(regioes, aggMapa.total);
  atualizarEscola(aggMapa, regioes);

  // gráficos: cada um ignora o filtro da própria dimensão (para continuar mostrando as opções)
  const topBairros = [...aggMapa.porBairro.values()].filter((b) => b.tipo === "bairro" || b.tipo === "distrito").sort((a, b) => b.total - a.total).map((b) => [b.nome, b.total]);
  graficos.atualizar({
    topBairros, selBairros: f.bairros,
    cursos: ranking1(dados, "c", filtrosParaIndices(dados, f, new Set(["cursos"]))), selCursos: f.cursos,
    escolas: ranking1(dados, "e", filtrosParaIndices(dados, f, new Set(["escolas"]))), selEscolas: f.escolas,
    dias: dados.dias,
  });

  renderInsights(gerarInsights({ dados, agg, geo }));
  ui.sincronizar(dados);
  const n = qtdAtivos(f);
  $("#n-filtros").hidden = n === 0;
  $("#n-filtros").textContent = n;
  document.body.dataset.pronto = "1";
}

/* ------------------------------------------------------------ interações */
function selecionarRegiao(r) {
  const f = estado.filtros;
  if (estado.regiaoSel === r.id) { estado.regiaoSel = null; renderizar(); mapa.reenquadrar(); return; }
  estado.regiaoSel = r.id;
  f.bairros.clear();          // uma seleção por vez: região OU bairro
  renderizar();
  abrirAba("regiao");
  $("#dock").classList.remove("recolhido");
  mapa.irPara(r);
}

function selecionarBairro(b) {
  const f = estado.filtros;
  const nome = b.nome ?? b;
  estado.regiaoSel = null;
  if (f.bairros.size === 1 && f.bairros.has(nome)) { f.bairros.clear(); renderizar(); mapa.reenquadrar(); return; }
  f.bairros = new Set([nome]);
  renderizar();
  abrirAba("bairro");
  $("#dock").classList.remove("recolhido");
  const item = classificar(montarAgregado(estado.dados, estado.geo, f, new Set(["bairros"])), estado.geo).noMapa.find((x) => x.nome === nome);
  if (item) mapa.irPara(item);
}

const clicarCurso = (n) => { if (n === "Demais" || n === "Outros") return; alternar(estado.filtros.cursos, n); renderizar(); };
const clicarEscola = (n) => { if (n === "Outros") return; alternar(estado.filtros.escolas, n); renderizar(); };

/* ------------------------------------------------------------ modo apresentação */
function montarPassos() {
  const { dados, geo } = estado;
  estado.salvo = { filtros: { ...estado.filtros, cursos: new Set(estado.filtros.cursos), escolas: new Set(estado.filtros.escolas), bairros: new Set(estado.filtros.bairros) }, aba: estado.aba };
  const vazio = filtrosVazios();
  const fi = filtrosParaIndices(dados, vazio);
  const cursos = ranking1(dados, "c", fi).filter(([n]) => n !== "Outros" && n !== "Não informado").slice(0, 3);
  const escolas = ranking1(dados, "e", fi).filter(([n]) => n !== "Outros" && !dados.idxConcluiu.has(dados.indice.e.get(n))).slice(0, 2);
  const insights = gerarInsights({ dados, agg: montarAgregado(dados, geo, vazio), geo });
  const aplicar = (filtros, aba, foco) => () => {
    Object.assign(estado.filtros, filtrosVazios(), filtros); // muta o mesmo objeto (a interface de filtros o referencia)
    renderizar();
    mapa.reenquadrar();
    abrirAba(aba);
    document.querySelectorAll(".insight").forEach((el, i) => el.classList.toggle("foco", i === foco));
    if (foco != null) document.querySelectorAll(".insight")[foco]?.scrollIntoView({ block: "center", behavior: "smooth" });
  };
  return [
    { titulo: `Visão geral ${estado.ano}`, aplicar: aplicar({}, "resumo"), duracao: 9000 },
    ...cursos.map(([c]) => ({ titulo: `Curso: ${c}`, aplicar: aplicar({ cursos: new Set([c]) }, "resumo"), duracao: 8000 })),
    ...escolas.map(([e]) => ({ titulo: `Escola: ${e}`, aplicar: aplicar({ escolas: new Set([e]) }, "resumo"), duracao: 8000 })),
    { titulo: "Gráficos", aplicar: aplicar({}, "graficos"), duracao: 12000 },
    ...insights.map((ins, i) => ({ titulo: `${ins.icone} ${ins.titulo}`, aplicar: aplicar({}, "insights", i), duracao: 7000 })),
  ];
}

function restaurarAposApresentacao() {
  if (estado.salvo) { Object.assign(estado.filtros, estado.salvo.filtros); renderizar(); abrirAba(estado.salvo.aba === "bairro" && !estado.filtros.bairros.size ? "resumo" : estado.salvo.aba); }
  document.querySelectorAll(".insight.foco").forEach((e) => e.classList.remove("foco"));
  setTimeout(() => mapa.invalidar(), 150);
}

/* ------------------------------------------------------------ ano / comparação */
async function trocarAno(ano) {
  estado.ano = ano;
  $("#subtitulo").textContent = `Alunos do Senac em Barretos · ${ano}`;
  estado.dados = await carregarAno(ano);
  estado.filtros.bairros.clear();
  if (estado.anoB === ano) { estado.anoB = ""; estado.dadosB = null; $("#sel-comparar").value = ""; }
  renderizar();
}

async function trocarComparacao(ano) {
  estado.anoB = ano;
  estado.dadosB = ano ? await carregarAno(ano) : null;
  renderizar();
}

function mostrarErro(e) {
  console.error(e);
  const div = document.createElement("div");
  div.className = "cartao erro";
  const dica = location.protocol === "file:" ? " Abra o site por um servidor local (python -m http.server) em vez de clicar duas vezes no arquivo." : "";
  div.innerHTML = "<h2>Não foi possível carregar os dados</h2><p></p>";
  div.querySelector("p").textContent = (e.message || String(e)) + dica;
  document.body.append(div);
}

/* ------------------------------------------------------------ início */
async function iniciar() {
  $("#btn-tema").addEventListener("click", () => aplicarTema(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));
  for (const b of document.querySelectorAll("[data-aba]")) b.addEventListener("click", () => abrirAba(b.dataset.aba));
  $("#g-fechar").addEventListener("click", () => { estado.filtros.bairros.clear(); renderizar(); mapa.reenquadrar(); });
  $("#aviso-curto").addEventListener("click", () => { abrirAba("resumo"); $("#dock").classList.remove("recolhido"); });
  // celular: a legenda começa recolhida (só escalas e botões de camada), para não cobrir o mapa
  const legenda = $("#legenda");
  if (matchMedia("(max-width: 900px)").matches) legenda.classList.add("recolhida");
  $("#leg-toggle").addEventListener("click", () => {
    const r = legenda.classList.toggle("recolhida");
    $("#leg-toggle").setAttribute("aria-expanded", String(!r));
    $("#leg-toggle").textContent = r ? "Legenda e fundo ▾" : "Legenda e fundo ▴";
  });
  $("#dock-alca").addEventListener("click", () => {
    const r = $("#dock").classList.toggle("recolhido");
    $("#dock-alca").setAttribute("aria-expanded", String(!r));
  });
  // Padrão de toda abertura: Áreas ligado, Bairros desligado. Esses botões NÃO são salvos no navegador
  // (só tema e fundo são); o estado é imposto aqui porque o navegador pode "lembrar" caixas marcadas ao recarregar.
  for (const cb of document.querySelectorAll("[data-camada]")) cb.checked = !!estado.camadas[cb.dataset.camada];
  for (const cb of document.querySelectorAll("[data-camada]")) cb.addEventListener("change", () => { estado.camadas[cb.dataset.camada] = cb.checked; renderizar(); });
  addEventListener("resize", () => mapa.invalidar());

  mapa = criarMapa($("#mapa"), { aoSelecionar: selecionarBairro, aoSelecionarRegiao: selecionarRegiao, aoSelecionarBairroNome: selecionarBairro });
  $("#esc-sel").addEventListener("change", (e) => {
    estado.filtros.escolas.clear();
    if (e.target.value) estado.filtros.escolas.add(e.target.value);
    estado.regiaoSel = null;
    renderizar();
    mapa.reenquadrar();
  });
  $("#esc-limpar").addEventListener("click", () => { estado.filtros.escolas.clear(); renderizar(); mapa.reenquadrar(); });
  $("#r-fechar").addEventListener("click", () => { estado.regiaoSel = null; renderizar(); mapa.reenquadrar(); });
  semPos = criarPainelSemPosicao($("#painel-sempos"), { aoSelecionar: selecionarBairro, local: ehLocal });
  $("#sp-fechar").addEventListener("click", () => { estado.camadas.semposicao = false; $("#chk-sempos").checked = false; renderizar(); });
  graficos = criarGraficos({ bairros: $("#g-bairros"), cursos: $("#g-cursos"), escolas: $("#g-escolas"), dias: $("#g-dias") },
    { bairro: (n) => selecionarBairro(n), curso: clicarCurso, escola: clicarEscola });
  ui = criarInterface($("#aba-filtros"), estado.filtros, renderizar);
  apresentacao = criarApresentacao({ montarPassos, aoSair: restaurarAposApresentacao });
  $("#btn-apresentar").addEventListener("click", () => apresentacao.iniciar());
  $("#btn-csv").addEventListener("click", () => { const n = exportarCSV(estado.dados, estado.agg.fi, estado.ano); aviso(`CSV gerado (${n} linhas, só dados agregados).`); });
  $("#btn-png").addEventListener("click", async () => {
    aviso("Gerando imagem…");
    try { await exportarPNG(estado.ano); aviso("Imagem baixada."); } catch (e) { aviso("Não foi possível gerar a imagem: " + e.message); }
  });
  // Visual (Minimalista | Ilustrado) e fundo do mapa (liso | ruas | satélite) são escolhas separadas, lembradas neste navegador.
  // O seletor "Fundo" tem 4 opções: Minimalista e Ilustrado trocam o visual (fundo liso); Ruas e Satélite só trocam o fundo.
  try { estado.visual = localStorage.getItem("visual-v1") || "minimalista"; estado.fundo = localStorage.getItem("fundo") || "estilizado"; } catch { /* ignora */ }
  if (!["minimalista", "ilustrado"].includes(estado.visual)) estado.visual = "minimalista";
  if (!["estilizado", "ruas", "satelite"].includes(estado.fundo)) estado.fundo = "estilizado";
  estado.top5 = false;   // o destaque do Top 5 sempre começa desligado (não é salvo no navegador)
  aplicarVisual();
  mapa.setFundo(estado.fundo);
  $("#sel-fundo").addEventListener("change", (e) => {
    const v = e.target.value;
    if (v === "minimalista" || v === "ilustrado") {
      estado.visual = v; estado.fundo = "estilizado";
    } else estado.fundo = v;
    try { localStorage.setItem("visual-v1", estado.visual); localStorage.setItem("fundo", estado.fundo); } catch { /* ignora */ }
    aplicarVisual();
    mapa.setFundo(estado.fundo);
    if (estado.agg) { graficos.tema(); renderizar(); }
    aoCarregarFontes();
  });
  $("#btn-top5").addEventListener("click", () => { estado.top5 = !estado.top5; renderizar(); });
  aplicarTema(temaInicial());
  abrirAba("resumo");

  try {
    const [anos, geo, regioes] = await Promise.all([carregarAnos(), carregarGeografia(), carregarRegioes()]);
    estado.anos = anos; estado.geo = geo; estado.regioes = regioes;
    mapa.setSilhueta(geo.silhueta);
    const sel = $("#sel-ano"), comp = $("#sel-comparar");
    for (const a of anos) { sel.add(new Option(a, a)); comp.add(new Option("vs " + a, a)); }
    comp.disabled = anos.length < 2;           // comparação só existe com 2+ anos
    comp.title = anos.length < 2 ? "Disponível quando houver mais de um ano" : "Comparar com outro ano";
    sel.value = anos[anos.length - 1];
    sel.addEventListener("change", () => trocarAno(sel.value).catch(mostrarErro));
    comp.addEventListener("change", () => trocarComparacao(comp.value).catch(mostrarErro));
    await trocarAno(sel.value);
    aoCarregarFontes();
  } catch (e) {
    mostrarErro(e);
  }
}

iniciar();
