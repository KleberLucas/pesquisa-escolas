/**
 * data.js — carregamento e consulta dos dados PÚBLICOS (somente agregados).
 *
 * O navegador só recebe tabelas de contagem (data/publico/<ano>.json), nunca linhas por aluno.
 * Cada tabela cobre uma combinação de dimensões: b=bairro, c=curso, e=escola
 * (b, c, e, bc, be, ce, bce) e já vem com supressão de células < 3 ("Outros").
 * `consultar` escolhe a tabela certa conforme as dimensões pedidas + as filtradas.
 */

export const MIN_EXIBIR = 3;
export const OUTROS = "Outros";
const ORDEM = "bce";
const TIPOS_NO_MAPA = new Set(["bairro", "distrito"]);

async function buscarJSON(url) {
  const r = await fetch(url, { cache: "no-cache" });
  if (!r.ok) throw new Error(`Não foi possível carregar ${url} (HTTP ${r.status}).`);
  return r.json();
}

export const carregarAnos = () => buscarJSON("data/publico/anos.json");

/** Carrega um ano: tabelas + série de inscrições por dia. */
export async function carregarAno(ano) {
  const [d, dias] = await Promise.all([
    buscarJSON(`data/publico/${ano}.json`),
    buscarJSON(`data/publico/${ano}-dias.json`).catch(() => ({ dias: [] })),
  ]);
  d.dias = dias.dias;
  d.nomes = {
    b: d.bairros.map((b) => b.nome),
    c: d.cursos,
    e: d.escolas.map((e) => e.nome),
  };
  d.indice = { b: new Map(), c: new Map(), e: new Map() };
  for (const k of ORDEM) d.nomes[k].forEach((n, i) => d.indice[k].set(n, i));
  d.idxConcluiu = new Set(d.escolas.map((e, i) => (e.concluiu ? i : -1)).filter((i) => i >= 0));
  return d;
}

/**
 * Pontos e polígonos dos bairros publicados. Feições Point em bairros.geojson
 * (marcadas à mão no editor) valem como ponto manual.
 */
export async function carregarGeografia() {
  const vazio = { type: "FeatureCollection", features: [] };
  const [pontos, geo, silhueta] = await Promise.all([
    buscarJSON("data/publico/bairros-pontos.json"), buscarJSON("data/publico/bairros.geojson"),
    buscarJSON("data/publico/silhueta.geojson").catch(() => vazio),          // opcional: o site funciona sem ela
  ]);
  const porNome = new Map(), porId = new Map(), poligonos = new Map();
  for (const p of pontos) { const info = { ...p }; porNome.set(p.nome, info); porId.set(p.id, info); }
  for (const f of geo.features) {
    const info = porId.get(f.properties?.id);
    if (!info) continue;
    if (f.geometry.type === "Point") { [info.lon, info.lat] = f.geometry.coordinates; info.fonte = "manual"; }
    else { poligonos.set(info.id, f); info.tem_poligono = true; }
  }
  return { porNome, porId, poligonos, silhueta };
}

/**
 * Regiões que agrupam bairros próximos (data/publico/regioes.json, gerado por scripts/regioes.py):
 * [{ id, nome, bairros: [nomes], centro: [lat, lon], raio_m, geometry }]. Sem arquivo = modo "Áreas" sem dados.
 */
export async function carregarRegioes() {
  try { return (await buscarJSON("data/publico/regioes.json")).regioes || []; } catch { return []; }
}

/** Local do Senac Barretos ({ nome, endereco, lat, lng }; data/publico/senac.json). Sem arquivo = o botão do pino some. */
export async function carregarSenac() {
  try {
    const s = await buscarJSON("data/publico/senac.json");
    return Number.isFinite(s.lat) && Number.isFinite(s.lng) ? s : null;
  } catch { return null; }
}

/** Locais das escolas ([{ nome, lat, lng, curto? }]; data/publico/escolas.json). O nome é igual ao normalizado nos dados. Sem arquivo = []. */
export async function carregarEscolasGeo() {
  try {
    const l = await buscarJSON("data/publico/escolas.json");
    return Array.isArray(l) ? l.filter((e) => e && typeof e.nome === "string" && Number.isFinite(e.lat) && Number.isFinite(e.lng)) : [];
  } catch { return []; }
}

/**
 * Totais das regiões sob os filtros atuais, somando os bairros de cada uma (agg = montarAgregado).
 * Bairros "Outros"/sem posição não entram. Devolve [{ ...região, total, membros, bairros:[{nome,total}], cursos, escolas }].
 */
export function totaisRegioes(regioes, agg) {
  const porNome = new Map([...agg.porBairro.values()].map((b) => [b.nome, b]));
  return regioes.map((r) => {
    const cursos = new Map(), escolas = new Map();
    const bairros = [];
    for (const nome of r.bairros) {
      const b = porNome.get(nome);
      if (!b || !b.total) continue;
      bairros.push({ nome, total: b.total });
      for (const [c, n] of b.cursos) cursos.set(c, (cursos.get(c) || 0) + n);
      for (const [e, n] of b.escolas) escolas.set(e, (escolas.get(e) || 0) + n);
    }
    bairros.sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome, "pt-BR"));
    const total = bairros.reduce((s, b) => s + b.total, 0);
    return { ...r, total, membros: r.bairros.length, bairros, cursos, escolas, apagada: total === 0 };
  });
}

/* ------------------------------------------------------------------ filtros → índices */

/**
 * Converte o estado de filtros (nomes) em conjuntos de índices por dimensão ({b,c,e}: Set|null).
 * `ignorar` pode conter "bairros", "cursos", "escolas", "ocultar", "busca": usado para que cada gráfico
 * continue mostrando as opções da própria dimensão que ele filtra.
 */
export function filtrosParaIndices(dados, f, ignorar = new Set()) {
  const fi = { b: null, c: null, e: null };
  const inter = (a, b) => (a ? new Set([...a].filter((x) => b.has(x))) : b);

  if (!ignorar.has("bairros") && f.bairros.size) fi.b = new Set([...f.bairros].map((n) => dados.indice.b.get(n)).filter((i) => i != null));
  const termo = f.busca.trim().toLocaleLowerCase("pt-BR");
  if (!ignorar.has("busca") && termo) {
    const achados = new Set(dados.nomes.b.map((n, i) => (n.toLocaleLowerCase("pt-BR").includes(termo) ? i : -1)).filter((i) => i >= 0));
    fi.b = inter(fi.b, achados);
  }
  if (!ignorar.has("cursos") && f.cursos.size) fi.c = new Set([...f.cursos].map((n) => dados.indice.c.get(n)).filter((i) => i != null));

  let esc = null;
  if (!ignorar.has("escolas") && f.escolas.size) esc = new Set([...f.escolas].map((n) => dados.indice.e.get(n)).filter((i) => i != null));
  if (!ignorar.has("ocultar") && f.ocultarConcluiu) {
    const base = esc || new Set(dados.nomes.e.map((_, i) => i));
    esc = new Set([...base].filter((i) => !dados.idxConcluiu.has(i)));
  }
  fi.e = esc;
  return fi;
}

/**
 * Soma as contagens agrupando por `por` (ex.: "bc") sob os filtros `fi`.
 * Devolve Map chave→n, onde a chave é "i" ou "i|j" (índices das dimensões em `por`).
 */
export function consultar(dados, por, fi) {
  const dims = [...new Set([...por, ...[...ORDEM].filter((d) => fi[d])])].sort((a, b) => ORDEM.indexOf(a) - ORDEM.indexOf(b)).join("") || "b";
  const linhas = dados.tabelas[dims];
  const pos = {};
  [...dims].forEach((d, i) => (pos[d] = i));
  const out = new Map();
  for (const l of linhas) {
    let ok = true;
    for (const d of dims) if (fi[d] && !fi[d].has(l[pos[d]])) { ok = false; break; }
    if (!ok) continue;
    const chave = [...por].map((d) => l[pos[d]]).join("|");
    out.set(chave, (out.get(chave) || 0) + l[l.length - 1]);
  }
  return out;
}

/** Atalho: consulta de uma dimensão → [[nome, n], ...] do maior para o menor. */
export function ranking1(dados, dim, fi) {
  return [...consultar(dados, dim, fi)].map(([k, n]) => [dados.nomes[dim][+k], n]).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "pt-BR"));
}

/* ------------------------------------------------------------------ agregado por bairro */

/** Monta o agregado por bairro (total, cursos e escolas) sob os filtros. */
export function montarAgregado(dados, geo, f, ignorar = new Set()) {
  const fi = filtrosParaIndices(dados, f, ignorar);
  const tot = consultar(dados, "b", fi);
  const bc = consultar(dados, "bc", fi);
  const be = consultar(dados, "be", fi);
  const porBairro = new Map();
  let total = 0;
  for (const [k, n] of tot) {
    const nome = dados.nomes.b[+k];
    const info = geo.porNome.get(nome);
    porBairro.set(+k, { idx: +k, nome, id: info?.id ?? null, tipo: dados.bairros[+k].tipo, total: n, cursos: new Map(), escolas: new Map() });
    total += n;
  }
  for (const [k, n] of bc) { const [b, c] = k.split("|"); porBairro.get(+b)?.cursos.set(dados.nomes.c[+c], n); }
  for (const [k, n] of be) { const [b, e] = k.split("|"); porBairro.get(+b)?.escolas.set(dados.nomes.e[+e], n); }
  return { total, porBairro, fi };
}

/**
 * Separa o que vai para o mapa do que precisa de aviso:
 *  noMapa (≥3 alunos e com polígono/ponto) · semPosicao (≥3 sem posição) ·
 *  pequenos (grupo "Outros") · foraMapa (cidades de fora, área rural, não informado)
 */
export function classificar(agg, geo) {
  const noMapa = [], semPosicao = [];
  const pequenos = { alunos: 0 }, foraMapa = { alunos: 0 };
  for (const b of agg.porBairro.values()) {
    if (b.tipo === "outros") { pequenos.alunos += b.total; continue; }
    if (!TIPOS_NO_MAPA.has(b.tipo)) { foraMapa.alunos += b.total; continue; }
    const info = geo.porId.get(b.id);
    // O polígono real (OSM/editor) só serve para achar o centroide do marcador: não é desenhado
    const poligono = geo.poligonos.get(b.id) || null;
    if (poligono || (info && info.lat != null)) {
      noMapa.push({ ...b, lat: info?.lat, lon: info?.lon, fonte: info?.fonte, poligono });
    } else semPosicao.push(b);
  }
  noMapa.sort((a, c) => c.total - a.total);
  semPosicao.sort((a, c) => c.total - a.total);
  return { noMapa, semPosicao, pequenos, foraMapa };
}

/** Itens de um Map ordenados do maior para o menor. */
export const ranking = (mapa) => [...mapa.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "pt-BR"));
