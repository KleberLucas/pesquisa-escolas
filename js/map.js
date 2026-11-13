/**
 * map.js — mapa Leaflet desenhado pelo próprio site.
 *
 * Fundos: "estilizado" (padrão: cor lisa + silhueta urbana, sem ruas), "ruas" (OSM) e "satelite" (Esri).
 * Duas camadas independentes:
 *   - "Bairros": um marcador pequeno por bairro com dados, com ajuste de colisão (linha fina até o ponto real
 *     quando o marcador é deslocado) e rótulos só para os maiores (mais nomes conforme o zoom);
 *   - "Áreas": REGIÕES que agrupam bairros próximos (contornos vindos de data/publico/regioes.json), pintadas
 *     pela escala de calor, com o título e a lista de bairros (com nº de alunos) dentro de cada uma.
 * Modo "diferença" (comparação de anos): cor divergente azul/laranja. Leaflet vem por CDN (global `L`).
 */
import { ANEIS_KM, fmtDist } from "./proximidade.js";

const CENTRO = [-20.5565, -48.5665];
const FUNDOS = {
  ruas: { url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", atrib: '&copy; <a href="https://www.openstreetmap.org/copyright">colaboradores do OpenStreetMap</a>', maxZoom: 19 },
  satelite: { url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", atrib: "Imagens &copy; Esri, Maxar, Earthstar Geographics", maxZoom: 19 },
};
const MIN_PUBLICO = 3;   // k mínimo dos dados públicos (igual a MIN_EXIBIR em data.js)
const ATRIB_PROPRIA = "Mapa de bairros desenhado pelo projeto";

/** Paradas da escala sequencial (iguais a --seq-0..4 em css/variaveis.css). */
let PARADAS = ["#dff4e8", "#7fcdb4", "#3a9fae", "#3f61a8", "#2b1c63"];
/** Cor do "resto" esmaecido quando o Top 5 está ligado. */
let ESMAECIDO = "#dff4e8";
/** Cores dos selos do Top 5 (1º ao 5º). */
let TOPS = ["#e3a50f", "#719739", "#25789c", "#e9893a", "#d27973"];
const ehIlustrado = () => document.documentElement.dataset.visual === "ilustrado";

/** Relê a escala de calor e as cores do Top 5 das variáveis CSS (mudam com o visual e o tema). */
export function atualizarPaleta() {
  const cs = getComputedStyle(document.documentElement);
  const ler = (v, padrao) => (cs.getPropertyValue(v).trim() || padrao);
  PARADAS = PARADAS.map((p, i) => ler(`--calor-${i}`, p));
  ESMAECIDO = ler("--calor-esmaecido", ESMAECIDO);
  TOPS = TOPS.map((p, i) => ler(`--top-${i + 1}`, p));
}
/** Divergente (daltonismo-seguro): azul = mais que o outro ano, laranja = menos. */
export const COR_MAIS = "#1f6fb5", COR_MENOS = "#d9631e";

/** Raio (px) do marcador de um bairro: pequeno, para não ficar "bola colada em bola". */
export const raioBairro = (valor, max) => 3.5 + 11 * Math.sqrt(valor / max);

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
export function corEscala(t) {
  const x = Math.min(1, Math.max(0, t)) * (PARADAS.length - 1);
  const i = Math.min(PARADAS.length - 2, Math.floor(x));
  const [a, b] = [hex(PARADAS[i]), hex(PARADAS[i + 1])];
  const k = x - i;
  return `rgb(${a.map((v, j) => Math.round(v + (b[j] - v) * k)).join(",")})`;
}
/** Luminância relativa (WCAG) de [r,g,b] 0–255. */
const lumRel = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
/** Razão de contraste (WCAG) entre duas cores [r,g,b]. */
export function contraste(a, b) { const [x, y] = [lumRel(a), lumRel(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); }
/** Cor do texto (branco ou escuro): a que tem MAIOR contraste com o preenchimento "rgb(r,g,b)" / "#rrggbb". */
export function corTextoSobre(cor) {
  const rgb = cor.startsWith("#") ? hex(cor) : cor.match(/\d+/g).map(Number);
  return contraste(rgb, [255, 255, 255]) >= contraste(rgb, hex("#14233a")) ? "#ffffff" : "#14233a";
}

/**
 * Faixas por QUANTIS (só no visual Ilustrado; no Minimalista devolve null e vale o degradê contínuo).
 * `valores` = os valores EXIBIDOS agora (só Áreas ou só Bairros). Até 5 faixas com quantidades parecidas de itens;
 * cada faixa usa uma cor fixa da rampa verde → amarelo → laranja → vermelho. Com menos faixas, as cores se espalham
 * pela rampa inteira (a menor sempre verde, a maior sempre a última).
 * Devolve { faixas: [{ min, max, cor }], cor(valor) }.
 */
export function criarFaixas(valores) {
  if (!ehIlustrado()) return null;
  const v = valores.filter((n) => n > 0).sort((a, b) => a - b);
  if (!v.length) return null;
  // valores distintos e quantos itens tem cada um (empates ficam sempre na mesma faixa)
  const dist = [], cont = [];
  for (const x of v) { if (dist.at(-1) === x) cont[cont.length - 1]++; else { dist.push(x); cont.push(1); } }
  const n = v.length, D = dist.length, k = Math.min(5, D);
  const acum = []; cont.reduce((s, c, i) => (acum[i] = s + c), 0);
  // cada faixa termina no valor cuja contagem acumulada fica mais perto do quantil ideal, deixando valores para as faixas seguintes
  const limites = [];
  let j0 = 0;
  for (let i = 0; i < k - 1; i++) {
    const alvo = (n * (i + 1)) / k, jMax = D - 1 - (k - 1 - i);
    let melhor = j0;
    for (let j = j0; j <= jMax; j++) if (Math.abs(acum[j] - alvo) < Math.abs(acum[melhor] - alvo)) melhor = j;
    limites.push(dist[melhor]); j0 = melhor + 1;
  }
  limites.push(dist[D - 1]);
  const m = limites.length;
  const faixas = limites.map((max, i) => ({
    min: v.find((x) => i === 0 || x > limites[i - 1]), max,
    cor: PARADAS[m === 1 ? 0 : Math.round((i * (PARADAS.length - 1)) / (m - 1))],
  }));
  return { faixas, cor: (x) => (faixas.find((f) => x <= f.max) || faixas[faixas.length - 1]).cor };
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const sinal = (n) => (n > 0 ? "+" : "") + n;
const pct1 = (a, b) => ((a / (b || 1)) * 100).toFixed(1).replace(".", ",");

/** Linha "≈ X km do Senac" (só com o pino ligado; estimativa em linha reta a partir do ponto do bairro/centro da região). */
const linhaDist = (x, o) => (o.senac?.ativo && x.distSenac != null ? `<small class="dist-senac">≈ ${fmtDist(x.distSenac)} do Senac (linha reta)</small>` : "");

/** HTML do cartão do pino do Senac (hover/clique): nome, endereço e resumo da proximidade. */
export function htmlCartaoSenac(s, resumo) {
  const r = resumo;
  const f1 = (n) => n.toFixed(0).replace(".", ",");
  return `<strong>${esc(s.nome)}</strong><small>${esc(s.endereco)}</small>` +
    (r ? `<small><b>${f1(r.pctAte3)}%</b> dos alunos a até 3 km · distância média ≈ <b>${fmtDist(r.media)}</b></small>` +
         `<small>Considera ${r.considerados.toLocaleString("pt-BR")} de ${r.totalGeral.toLocaleString("pt-BR")} alunos (bairros com posição no mapa e 3+ alunos)</small>`
       : "<small>Sem alunos com posição no mapa neste recorte.</small>") +
    "<small>Distâncias aproximadas, em linha reta, a partir do ponto de cada bairro.</small>" +
    (s.provisorio ? "<small>⚠ posição provisória do pino (Centro)</small>" : "");
}

/** HTML do tooltip de um bairro (usado pelo mapa e pelo painel de bairros sem posição). */
export function htmlTooltip(b, o) {
  if (b.contexto) return `<strong>${esc(b.nome)}</strong><small>Sem alunos desta escola para exibir (menos de ${MIN_PUBLICO})</small>`;
  if (o.modo === "diff") {
    return `<strong>${esc(b.nome)}</strong><small>${o.rotuloA}: ${b.totalA} · ${o.rotuloB}: ${b.totalB}</small><small>Diferença: ${sinal(b.diff)}</small>${linhaDist(b, o)}`;
  }
  const cursos = [...b.cursos.entries()].sort((x, y) => y[1] - x[1]).filter(([c]) => c !== "Outros").slice(0, 2).map(([c, n]) => `${esc(c)} (${n})`).join(", ");
  return `<strong>${esc(b.nome)}</strong><small>${b.total} alunos · ${pct1(b.total, o.totalGeral)}% do total</small>${cursos ? `<small>${cursos}</small>` : ""}${linhaDist(b, o)}`;
}

/** HTML do tooltip de uma região: total, %, nº de bairros e os 3 bairros com mais alunos. */
export function htmlTooltipRegiao(r, o) {
  if (o.modo === "diff") {
    return `<strong>${esc(r.nome)}</strong><small>${o.rotuloA}: ${r.totalA} · ${o.rotuloB}: ${r.totalB}</small><small>Diferença: ${sinal(r.diff)}</small>${linhaDist(r, o)}<small>⚠ divisão estimada</small>`;
  }
  if (r.apagada) return `<strong>${esc(r.nome)}</strong><small>Sem alunos neste recorte (${r.membros} ${r.membros === 1 ? "bairro" : "bairros"})</small>`;
  const top = r.bairros.slice(0, 3).map((b) => `${esc(b.nome)} (${b.total})`).join(", ");
  return `<strong>${esc(r.nome)}</strong><small>${r.total} alunos · ${pct1(r.total, o.totalGeral)}% do total</small>` +
    `<small>${r.membros} ${r.membros === 1 ? "bairro" : "bairros"}${top ? ": " + top : ""}</small>${linhaDist(r, o)}<small>⚠ região estimada (agrupamento aproximado)</small>`;
}

/** Gota de localização do Senac (SVG inline, dois tons de vermelho, círculo branco e halo branco). A ponta (20,50) é o ponto exato. */
export const PINO_W = 36, PINO_H = 46.8, PINO_ANCORA = [18, 45];
const D_PINO = "M20 50C20 50 4 31 4 18A16 16 0 0 1 36 18C36 31 20 50 20 50Z";
export function svgPinoSenac() {
  return `<svg viewBox="0 0 40 52" width="${PINO_W}" height="${PINO_H}" aria-hidden="true" focusable="false">` +
    `<path d="${D_PINO}" fill="#fff" stroke="#fff" stroke-width="4" stroke-linejoin="round"/>` +
    `<path d="M20 50C20 50 4 31 4 18A16 16 0 0 1 20 2Z" fill="#FF3636"/>` +
    `<path d="M20 2A16 16 0 0 1 36 18C36 31 20 50 20 50Z" fill="#F50000"/>` +
    `<circle cx="20" cy="18" r="6.6" fill="#fff"/></svg>`;
}

/** Centroide (ponderado pela área) do maior anel do polígono — posição do marcador de um bairro com área real. */
function centroide(feicao) {
  const geom = feicao.geometry ?? feicao;   // aceita Feature ou geometria
  const polis = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
  let melhor = null;
  for (const p of polis) {
    const anel = p[0];
    let a = 0, cx = 0, cy = 0;
    for (let i = 0; i < anel.length - 1; i++) {
      const [x1, y1] = anel[i], [x2, y2] = anel[i + 1], f = x1 * y2 - x2 * y1;
      a += f; cx += (x1 + x2) * f; cy += (y1 + y2) * f;
    }
    if (!melhor || Math.abs(a) > Math.abs(melhor.a)) melhor = { a, cx, cy, anel };
  }
  if (!melhor) return null;
  if (Math.abs(melhor.a) < 1e-12) {   // degenerado: média dos vértices
    const n = melhor.anel.length;
    return [melhor.anel.reduce((s, q) => s + q[1], 0) / n, melhor.anel.reduce((s, q) => s + q[0], 0) / n];
  }
  return [melhor.cy / (3 * melhor.a), melhor.cx / (3 * melhor.a)];   // [lat, lon]
}

/** Onde fica o marcador do bairro: ponto marcado à mão > centroide do polígono real > ponto automático. */
export function posicaoBolha(b) {
  const tem = b.lat != null && b.lon != null;
  if (tem && b.fonte === "manual") return [b.lat, b.lon];
  if (b.poligono) return centroide(b.poligono);
  return tem ? [b.lat, b.lon] : null;
}

/** Pino em forma de gota com o número do Top 5 (o número garante que a posição não dependa só da cor). */
function pino(rank, cor, alturaExtra) {
  return L.divIcon({
    className: "pino-top5-wrap", iconSize: [30, 30], iconAnchor: [15, 37 + alturaExtra],
    html: `<div class="pino-top5" style="--cor:${cor}" role="img" aria-label="Posição ${rank}"><span>${rank}</span></div>`,
  });
}

/** Afasta marcadores que se sobrepõem (em px), puxando-os de volta ao ponto real. Altera x/y dos itens. */
function afastar(m) {
  for (let it = 0; it < 80; it++) {
    let mexeu = false;
    for (let i = 0; i < m.length; i++) {
      for (let j = i + 1; j < m.length; j++) {
        const a = m[i], b = m[j];
        let dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
        const min = a.r + b.r + 2;
        if (d >= min) continue;
        if (d < 0.01) { dx = Math.cos(i + j); dy = Math.sin(i + j); d = 1; }
        const empurra = (min - d) / 2, ux = dx / d, uy = dy / d;
        const pa = b.r / (a.r + b.r) * 2, pb = a.r / (a.r + b.r) * 2;     // o menor se move mais
        a.x -= ux * empurra * pa; a.y -= uy * empurra * pa;
        b.x += ux * empurra * pb; b.y += uy * empurra * pb;
        mexeu = true;
      }
    }
    for (const a of m) { a.x += (a.x0 - a.x) * 0.04; a.y += (a.y0 - a.y) * 0.04; }   // mola até o ponto real
    if (!mexeu) break;
  }
}

/* ------------------------------------------------------------------ rótulos das regiões: geometria e medidas */
const M_LAT = 110574, M_LON = 111320;   // metros por grau (aproximação local; basta para posicionar texto)

/** Distância de (x,y) ao segmento ab, ao quadrado. */
function dist2Seg(x, y, a, b) {
  let dx = b[0] - a[0], dy = b[1] - a[1], t = 0;
  const d2 = dx * dx + dy * dy;
  if (d2) t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / d2));
  dx = x - (a[0] + t * (b[0] - a[0])); dy = y - (a[1] + t * (b[1] - a[1]));
  return dx * dx + dy * dy;
}
/** Distância assinada do ponto à borda (positiva = dentro; regra par-ímpar sobre todos os anéis). */
function distBorda(x, y, aneis) {
  let dentro = false, min = Infinity;
  for (const an of aneis) {
    for (let i = 0, j = an.length - 1; i < an.length; j = i++) {
      const a = an[i], b = an[j];
      if ((a[1] > y) !== (b[1] > y) && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) dentro = !dentro;
      min = Math.min(min, dist2Seg(x, y, a, b));
    }
  }
  return (dentro ? 1 : -1) * Math.sqrt(min);
}
function pontoDentro(x, y, aneis) {
  let dentro = false;
  for (const an of aneis) {
    for (let i = 0, j = an.length - 1; i < an.length; j = i++) {
      const a = an[i], b = an[j];
      if ((a[1] > y) !== (b[1] > y) && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) dentro = !dentro;
    }
  }
  return dentro;
}
const areaAnel = (an) => Math.abs(an.reduce((s, p, i) => { const q = an[(i + 1) % an.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;

/** "Polo de inacessibilidade" (polylabel): o ponto mais distante da borda do polígono (primeiro anel = externo). */
function polylabel(aneis, precisao = 4) {
  const xs = aneis[0].map((p) => p[0]), ys = aneis[0].map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const tam = Math.min(x1 - x0, y1 - y0) || 1;
  let h = tam / 2;
  const cel = (x, y, hh) => { const d = distBorda(x, y, aneis); return { x, y, h: hh, d, max: d + hh * Math.SQRT2 }; };
  let fila = [];
  for (let x = x0; x < x1; x += tam) for (let y = y0; y < y1; y += tam) fila.push(cel(x + h, y + h, h));
  let melhor = cel((x0 + x1) / 2, (y0 + y1) / 2, 0);
  for (const c of fila) if (c.d > melhor.d) melhor = c;
  let guarda = 0;
  while (fila.length && guarda++ < 4000) {
    let k = 0;
    for (let i = 1; i < fila.length; i++) if (fila[i].max > fila[k].max) k = i;
    const c = fila.splice(k, 1)[0];
    if (c.d > melhor.d) melhor = c;
    if (c.max - melhor.d <= precisao) continue;
    h = c.h / 2;
    fila.push(cel(c.x - h, c.y - h, h), cel(c.x + h, c.y - h, h), cel(c.x - h, c.y + h, h), cel(c.x + h, c.y + h, h));
  }
  return melhor;
}

/** Por região (e só uma vez): anéis em metros, polo de inacessibilidade e pontos internos candidatos (ordenados do mais interno). */
const geoRotulos = new WeakMap();
function geometriaRotulo(r) {
  let g = geoRotulos.get(r.geometry);
  if (g) return g;
  const [lat0, lon0] = r.centro;
  const kx = M_LON * Math.cos((lat0 * Math.PI) / 180);
  const polis = r.geometry.type === "Polygon" ? [r.geometry.coordinates] : r.geometry.coordinates;
  const emM = (an) => an.map(([lon, lat]) => [(lon - lon0) * kx, (lat - lat0) * M_LAT]);
  const polisM = polis.map((p) => p.map(emM));
  const maior = polisM.reduce((a, b) => (areaAnel(b[0]) > areaAnel(a[0]) ? b : a));
  const aneis = polisM.flat();
  const polo = polylabel(maior);
  const xs = aneis.flatMap((an) => an.map((p) => p[0])), ys = aneis.flatMap((an) => an.map((p) => p[1]));
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const passo = Math.max(30, Math.min(x1 - x0, y1 - y0) / 16);
  const cands = [{ x: polo.x, y: polo.y, d: polo.d }];
  for (let x = x0; x <= x1; x += passo) for (let y = y0; y <= y1; y += passo) {
    const d = distBorda(x, y, aneis);
    if (d > 15) cands.push({ x, y, d });
  }
  cands.sort((a, b) => b.d - a.d);
  cands[0] = { x: polo.x, y: polo.y, d: polo.d };   // o polo sempre é a 1ª escolha
  g = { aneis, polo, cands, lat0, lon0, kx };
  geoRotulos.set(r.geometry, g);
  return g;
}

/** Medidas de texto com a fonte REAL (canvas), para decidir quebra de linha e tamanho antes de desenhar. */
const medidor = document.createElement("canvas").getContext("2d");
function larguraTexto(txt, tam, peso, familia, maiusc, espaco) {
  medidor.font = `${peso} ${tam}px ${familia}`;
  const t = maiusc ? txt.toLocaleUpperCase("pt-BR") : txt;
  return medidor.measureText(t).width + t.length * espaco * tam;
}
/** Quebras possíveis do nome em k linhas (k = 1..3), por palavras; o "-" fica colado à palavra anterior ("VIDA NOVA -" / "NOVA BARRETOS"). */
function quebrasDoNome(nome, largura) {
  const palavras = [];
  for (const p of nome.split(/\s+/)) { if (p === "-" && palavras.length) palavras[palavras.length - 1] += " -"; else palavras.push(p); }
  const res = [];
  const n = palavras.length;
  const monta = (cortes) => { const ls = []; let ini = 0; for (const c of [...cortes, n]) { ls.push(palavras.slice(ini, c).join(" ")); ini = c; } return ls; };
  const pior = (ls) => Math.max(...ls.map(largura));
  const candidatos = (k) => {
    if (k === 1) return [monta([])];
    if (k === 2) return Array.from({ length: n - 1 }, (_, i) => monta([i + 1]));
    const out = [];
    for (let i = 1; i < n - 1; i++) for (let j = i + 1; j < n; j++) out.push(monta([i, j]));
    return out;
  };
  const dash = palavras.findIndex((p) => p.endsWith(" -"));   // nome composto "A - B": a quebra deve cair logo depois do hífen
  for (let k = 1; k <= Math.min(3, n); k++) {
    let cs = candidatos(k);
    if (dash >= 0 && k > 1) {
      // posição (em palavras, contando o "-" como parte da palavra anterior) do corte depois do hífen
      const alvo = dash + 1;
      const com = cs.filter((ls) => { let acc = 0; for (const l of ls.slice(0, -1)) { acc += l.split(" ").filter((w) => w !== "-").length; if (acc === alvo) return true; } return false; });
      if (com.length) cs = com;
    }
    const c = cs.sort((a, b) => pior(a) - pior(b))[0];
    if (c) res.push(c);
  }
  return res;
}

export function criarMapa(el, { aoSelecionar, aoSelecionarRegiao, aoSelecionarBairroNome }) {
  const mapa = L.map(el, { zoomControl: false, attributionControl: false, minZoom: 10, zoomSnap: 0.25 }).setView(CENTRO, 13);
  L.control.zoom({ position: "topleft" }).addTo(mapa);
  const atrib = L.control.attribution({ position: "bottomleft", prefix: false }).addTo(mapa); // fora da área do painel

  let base = null, fundo = "estilizado", tema = "light";
  mapa.createPane("silhueta").style.zIndex = 250;        // acima dos tiles, abaixo de tudo que é dado
  mapa.createPane("brilho").style.zIndex = 440;          // brilho dos 5 destaques
  mapa.createPane("contorno").style.zIndex = 450;        // contorno da cidade: ACIMA do preenchimento das regiões
  mapa.createPane("aneis").style.zIndex = 445;           // anéis de distância do Senac: acima das regiões, abaixo do contorno
  mapa.createPane("aneis-rot").style.zIndex = 480;       // rótulos dos anéis
  mapa.createPane("senac").style.zIndex = 645;           // pino do Senac: acima de regiões, bolhas e rótulos (e do halo dos destaques)
  mapa.createPane("marcadores").style.zIndex = 470;      // marcadores dos bairros: acima do contorno
  const camadaSilhueta = L.layerGroup().addTo(mapa);
  const camadaContorno = L.layerGroup().addTo(mapa);
  const camadaRegioes = L.layerGroup().addTo(mapa);
  const camadaLigacoes = L.layerGroup().addTo(mapa);
  const camadaBolhas = L.layerGroup().addTo(mapa);
  const camadaBrilho = L.layerGroup().addTo(mapa);
  const camadaRotulos = L.layerGroup().addTo(mapa);
  const camadaPinos = L.layerGroup().addTo(mapa);
  const camadaAneis = L.layerGroup().addTo(mapa);
  let ultimo = null, primeiraVez = true, todos = null, silhueta = null;
  let pinoSenac = null, chavePino = "";

  /** Pino do Senac + anéis de distância. O pino é recriado só quando muda o visual/tema/posição (mantém o cartão aberto). */
  function desenharSenac(sn, c) {
    camadaAneis.clearLayers();
    if (!sn?.ativo || !sn.dados) { if (pinoSenac) { mapa.removeLayer(pinoSenac); pinoSenac = null; chavePino = ""; } return; }
    const { lat, lng } = sn.dados, centro = [lat, lng];
    const html = htmlCartaoSenac(sn.dados, sn.resumo);
    const chave = `${ehIlustrado()}|${tema}|${lat},${lng}`;
    if (!pinoSenac || chave !== chavePino) {
      if (pinoSenac) mapa.removeLayer(pinoSenac);
      const icone = L.divIcon({
        className: "pino-senac-wrap", iconSize: [PINO_W, PINO_H], iconAnchor: PINO_ANCORA,
        html: `<div class="pino-senac">${svgPinoSenac()}<span class="pino-senac-etq" aria-hidden="true">${ehIlustrado() ? "SENAC BARRETOS" : "Senac Barretos"}</span></div>`,
      });
      pinoSenac = L.marker(centro, { icon: icone, pane: "senac", keyboard: true, riseOnHover: false })
        .bindTooltip(html, { className: "tip tip-senac", direction: "top", offset: [0, -46] })
        .bindPopup(html, { className: "popup-senac", offset: [0, -42], maxWidth: 300 })
        .on("popupopen", () => pinoSenac.closeTooltip())
        .addTo(mapa);
      chavePino = chave;
      const el = pinoSenac.getElement();
      if (el) {   // acessível por teclado (Enter abre o cartão) e com texto alternativo
        el.setAttribute("role", "button");
        el.setAttribute("aria-label", `${sn.dados.nome}, ${sn.dados.endereco}. Pressione Enter para ver a proximidade dos alunos.`);
      }
    } else {
      pinoSenac.setTooltipContent(html);
      pinoSenac.setPopupContent(html);
    }
    if (sn.aneis) {
      for (const km of ANEIS_KM) {
        L.circle(centro, { pane: "aneis", radius: km * 1000, fill: false, color: c.borda, weight: 1.4, opacity: 0.75, dashArray: "6 5", interactive: false }).addTo(camadaAneis);
        L.marker([lat + (km * 1000) / M_LAT, lng], {
          pane: "aneis-rot", interactive: false, keyboard: false,
          icon: L.divIcon({ className: "anel-rot-wrap", iconSize: [0, 0], html: `<span class="anel-rot">${km} km</span>` }),
        }).addTo(camadaAneis);
      }
    }
  }

  /** Silhueta da área urbana (IBGE): preenchimento suave e contorno fino, só no fundo "Estilizado". */
  function desenharSilhueta() {
    camadaSilhueta.clearLayers();
    camadaContorno.clearLayers();
    if (!silhueta) return;
    const escuro = tema === "dark";
    // preenchimento suave da cidade: só no fundo liso
    if (fundo === "estilizado") {
      const ilus = ehIlustrado();
      L.geoJSON(silhueta, {
        pane: "silhueta", interactive: false,
        style: ilus
          ? { color: escuro ? "#8a6a3a" : "#8a6a33", weight: 1, fillColor: escuro ? "#4a3c25" : "#f4e4b6", fillOpacity: escuro ? 0.7 : 0.75 }
          : { color: escuro ? "#3d5278" : "#9db0c7", weight: 1, fillColor: "#ffffff", fillOpacity: escuro ? 0.05 : 0.65 },
      }).addTo(camadaSilhueta);
    }
    // contorno externo GROSSO e destacado, em todos os fundos: halo largo e translúcido por baixo + traço sólido por cima
    const cor = corContorno();
    const halo = ehIlustrado() ? (escuro ? "#ffe9ad" : "#fffdf0") : cor;    // brilho: branco-quente no Ilustrado
    const base = { pane: "contorno", interactive: false, fill: false, lineJoin: "round", lineCap: "round" };
    L.geoJSON(silhueta, { ...base, color: halo, style: { color: halo, weight: 11, opacity: ehIlustrado() ? 0.5 : fundo === "satelite" || escuro ? 0.32 : 0.26 } }).addTo(camadaContorno);
    L.geoJSON(silhueta, { ...base, color: cor, style: { color: cor, weight: 3.5, opacity: 1 } }).addTo(camadaContorno);
  }
  /** Cor de destaque do contorno: laranja-queimado no claro; âmbar claro no escuro e no satélite. */
  function corContorno() {
    if (ehIlustrado()) return tema === "dark" ? "#f7dd9b" : "#fff1c9";        // creme (Ilustrado)
    return tema === "dark" || fundo === "satelite" ? "#ffc861" : "#d9680a";   // tom contrastante (Minimalista)
  }
  function setSilhueta(g) { silhueta = g; desenharSilhueta(); }

  /* ---------------------------------------------------------- fundo e tema */
  function aplicarFundo() {
    if (base) { mapa.removeLayer(base); base = null; }
    for (const a of Object.values(FUNDOS)) atrib.removeAttribution(a.atrib);
    atrib.removeAttribution(ATRIB_PROPRIA);
    el.classList.toggle("fundo-liso", fundo === "estilizado");
    el.classList.toggle("mapa-escuro", fundo === "ruas" && tema === "dark"); // só as ruas ganham filtro escuro
    desenharSilhueta();
    if (fundo === "estilizado") { atrib.addAttribution(ATRIB_PROPRIA); return; }
    const f = FUNDOS[fundo];
    // crossOrigin: permite exportar o mapa em PNG (os servidores de tiles aceitam CORS)
    base = L.tileLayer(f.url, { attribution: f.atrib, maxZoom: f.maxZoom, crossOrigin: "anonymous" }).addTo(mapa);
    base.bringToBack();
  }

  const redesenhar = () => { if (ultimo) desenhar(ultimo.itens, ultimo.opcoes); };
  function setFundo(nome) { fundo = nome; aplicarFundo(); redesenhar(); }
  function setTema(t) { tema = t; aplicarFundo(); redesenhar(); }

  /* ---------------------------------------------------------- desenho */
  function cores(o) {
    const escuro = tema === "dark";
    const ilus = ehIlustrado();
    return {
      borda: fundo === "satelite" ? "#ffffff" : ilus ? (escuro ? "#f4e6c4" : "#34250f") : escuro ? "#e8eefb" : "#14233a",
      fronteira: fundo === "satelite" || escuro ? "rgba(255,255,255,.55)" : ilus ? "rgba(70,45,15,.45)" : "rgba(20,35,58,.4)",   // fina e discreta
      destaque: escuro || fundo === "satelite" ? "#ffd166" : ilus ? "#c98a00" : "#f08a1c",
      halo: escuro ? "#0b1424" : "#f4f8fc",
    };
  }

  /** Áreas = regiões. Devolve quantas foram desenhadas. */
  function desenharRegioes(o, c) {
    const regioes = o.mostrarAreas ? o.regioes || [] : [];
    const maxReg = Math.max(1, ...regioes.map((r) => (o.modo === "diff" ? Math.abs(r.diff) : r.total)));
    const opacBase = fundo === "estilizado" ? 0.9 : 0.72;
    const top = o.top5?.ativo && o.top5.modo === "regioes" ? o.top5.ranks : null;   // Top 5: cor do selo + brilho; o resto esmaece
    for (const r of regioes) {
      const rank = top?.get(r.id);
      let cor = o.modo === "diff" ? (r.diff >= 0 ? COR_MAIS : COR_MENOS) : o.faixas?.areas ? o.faixas.areas.cor(r.total) : corEscala(Math.sqrt(r.total / maxReg));
      let fillOp = r.apagada ? 0.05 : o.modo === "diff" ? 0.2 + 0.7 * Math.abs(r.diff) / maxReg : opacBase;
      if (top && !r.apagada) { if (rank) { cor = TOPS[rank - 1]; fillOp = 0.94; } else { cor = ESMAECIDO; fillOp = 0.55; } }
      // fronteiras entre regiões: 1,1 px e discretas (bem mais leves que o contorno da cidade); selecionada/hover ganham realce
      const estilo = { color: r.selecionada ? c.borda : c.fronteira, weight: r.selecionada ? 3 : 1.1, dashArray: r.apagada ? "4 4" : null, opacity: r.apagada ? 0.6 : 1, fillColor: cor, fillOpacity: fillOp };
      const hover = { ...estilo, weight: 2.5, color: c.borda, dashArray: null, opacity: 1, fillOpacity: Math.min(1, fillOp + 0.08) };
      const g = L.geoJSON({ type: "Feature", geometry: r.geometry }, { style: estilo });
      g.eachLayer((camada) => camada
        .bindTooltip(htmlTooltipRegiao(r, o), { className: "tip", sticky: true })
        .on({ mouseover: () => { camada.setStyle(hover); camada.bringToFront?.(); }, mouseout: () => camada.setStyle(estilo), click: () => aoSelecionarRegiao(r) }));
      g.addTo(camadaRegioes);
      r._cor = cor; r._rank = 0;
      if (rank) {   // brilho suave por fora + pino numerado
        L.geoJSON({ type: "Feature", geometry: r.geometry }, { pane: "brilho", interactive: false, style: { color: cor, weight: 14, opacity: 0.4, fill: false, lineJoin: "round" } }).addTo(camadaBrilho);
        r._rank = rank; r._corPino = cor;   // o pino é posto por rotulosRegioes, acima do bloco de texto
      }
    }
    return regioes.length;
  }

  /**
   * Rótulos das regiões. TODA região visível mostra o nome completo, em qualquer zoom:
   *  1) nome (quebrado em até 3 linhas, fonte de 11 px até 14 px conforme o zoom) no ponto mais interno da região
   *     (polylabel), deslocando-o dentro da própria região e reduzindo a fonte antes de desistir de algum;
   *  2) onde sobra espaço, "melhora" o rótulo: abaixo do nome entram a lista de bairros "Nome (n)" ou o total.
   * Último recurso (nome não cabe nem na fonte mínima): marcador numerado + legenda com o nome (e o tooltip da região).
   */
  function rotulosRegioes(o) {
    const legNum = document.getElementById("leg-reg-num");
    if (legNum) { legNum.hidden = true; legNum.replaceChildren(); }
    if (!o.mostrarAreas) return;
    const z = mapa.getZoom();
    const ilus = ehIlustrado();
    const cs = getComputedStyle(document.documentElement);
    const famT = cs.getPropertyValue("--fonte-titulo").trim() || "sans-serif";
    const famX = cs.getPropertyValue("--fonte-texto").trim() || "sans-serif";
    const pesoT = ilus ? 400 : 700, espT = ilus ? 0.02 : 0, espX = ilus ? 0.03 : 0;
    const tamBn = ilus ? 10.5 : 11, pesoBn = ilus ? 700 : 500, tamSub = 11;
    const TAM_MIN = 11, tf0 = Math.max(TAM_MIN, Math.min(14, 11 + (z - 12) * 1.5));
    const wTit = (s, tam) => larguraTexto(s, tam, pesoT, famT, ilus, espT);
    const wBn = (s) => larguraTexto(s, tamBn, pesoBn, famX, ilus, espX);
    const wSub = (s) => larguraTexto(s, tamSub, 600, famX, ilus, espX);
    const regs = (o.regioes || []).filter((r) => r.geometry && r.centro).map((r) => {
      const g = geometriaRotulo(r);
      const mpp = (156543.03392 * Math.cos((g.lat0 * Math.PI) / 180)) / 2 ** z;
      const polo = mapa.latLngToContainerPoint([g.lat0 + g.polo.y / M_LAT, g.lon0 + g.polo.x / g.kx]);
      return { r, g, mpp, polo, id: r.id };
    });
    const blocos = new Map();
    const pxDe = (R, c) => ({ x: R.polo.x + (c.x - R.g.polo.x) / R.mpp, y: R.polo.y - (c.y - R.g.polo.y) / R.mpp });
    const llDe = (R, c) => [R.g.lat0 + c.y / M_LAT, R.g.lon0 + c.x / R.g.kx];
    const cabe = (R, c, w, h) => {
      for (const dx of [-w / 2, 0, w / 2]) for (const dy of [-h / 2, 0, h / 2]) if (!pontoDentro(c.x + dx * R.mpp, c.y - dy * R.mpp, R.g.aneis)) return false;
      return true;
    };
    const colide = (ret, ignorar) => {
      for (const [id, b] of blocos) {
        if (id === ignorar || b.numerado) continue;
        if (ret.x < b.ret.x + b.ret.w + 4 && ret.x + ret.w + 4 > b.ret.x && ret.y < b.ret.y + b.ret.h + 3 && ret.y + ret.h + 3 > b.ret.y) return true;
      }
      return false;
    };
    /** Procura uma posição para um bloco w×h (px) dentro da região, sem colidir; `preferido` é testado primeiro. */
    const posicionar = (R, w, h, acima, preferido, estrito) => {
      let lista = preferido ? [preferido, ...R.g.cands] : R.g.cands;
      if (!estrito) {   // relaxado: além dos pontos internos, tenta posições em volta do polo (o texto pode passar um pouco da borda)
        const anel = [];
        for (const fy of [0, -1, 1, -2, 2]) for (const fx of [0, -0.7, 0.7, -1.4, 1.4]) anel.push({ x: R.g.polo.x + fx * w * 0.5 * R.mpp, y: R.g.polo.y - fy * h * R.mpp, d: 0 });
        lista = [...R.g.cands.slice(0, 25), ...anel];
      }
      let n = 0;
      for (const c of lista) {
        if (estrito && c.d / R.mpp < Math.min(w, h) * 0.35 && c !== preferido) break;   // já não cabe nenhum retângulo deste tamanho
        if (!estrito && n++ > 60) break;
        const p = pxDe(R, c);
        const ret = { x: p.x - w / 2, y: p.y - h / 2 - acima, w, h: h + acima };
        if (estrito && !cabe(R, c, w, h)) continue;
        if (!colide(ret, R.id)) return { c, p, ret };
      }
      return null;
    };
    const montarTitulo = (R, tam, linhas) => ({ linhas, tam, w: Math.max(...linhas.map((s) => wTit(s, tam))), h: linhas.length * tam * 1.25 + 2 });

    // ---- fase 1: o NOME de todas as regiões (as mais apertadas primeiro)
    const numerados = [];
    for (const R of [...regs].sort((a, b) => a.g.polo.d - b.g.polo.d)) {
      const acima = R.r._rank ? 40 : 0;
      let ok = null;
      for (let tam = tf0; tam >= TAM_MIN - 1e-6 && !ok; tam -= 0.5) {
        for (const linhas of quebrasDoNome(R.r.nome, (s) => wTit(s, tam))) {
          const t = montarTitulo(R, tam, linhas);
          const pos = posicionar(R, t.w + 6, t.h, acima, null, true);
          if (pos) { ok = { ...pos, t, w: t.w + 6, h: t.h }; break; }
        }
      }
      if (!ok) {   // relaxado: fonte mínima, o rótulo pode encostar na borda (só não pode cobrir outro rótulo)
        for (const linhas of quebrasDoNome(R.r.nome, (s) => wTit(s, TAM_MIN)).reverse()) {   // mais linhas = bloco mais estreito, fica mais perto da região
          const t = montarTitulo(R, TAM_MIN, linhas);
          const pos = posicionar(R, t.w + 6, t.h, acima, null, false);
          if (pos) { ok = { ...pos, t, w: t.w + 6, h: t.h }; break; }
        }
      }
      if (!ok) { blocos.set(R.id, { numerado: true, R }); numerados.push(R); continue; }
      blocos.set(R.id, { R, c: ok.c, p: ok.p, ret: ok.ret, t: ok.t, w: ok.w, h: ok.h, acima, linhas: [], extra: "" });
    }

    // ---- fase 2: onde cabe, lista de bairros (ou total) abaixo do nome — as maiores primeiro
    const semListaGeral = o.modo === "diff";
    for (const R of [...regs].sort((a, b) => b.g.polo.d - a.g.polo.d)) {
      const b = blocos.get(R.id);
      if (!b || b.numerado) continue;
      const semLista = semListaGeral || R.r.apagada;
      const maxN = semLista ? 0 : Math.min(12, R.r.bairros.length);
      for (let n = maxN; n >= 0; n--) {
        let linhas = [], extra = "";
        if (semLista) extra = o.modo === "diff" ? `Δ ${sinal(R.r.diff)}` : "sem alunos";
        else if (n === 0) extra = `${R.r.total} alunos`;
        else {
          const mostrar = R.r.bairros.length > n ? R.r.bairros.slice(0, Math.max(1, n - 1)) : R.r.bairros;
          linhas = mostrar.map((x) => ({ nome: x.nome, total: x.total }));
          if (mostrar.length < R.r.bairros.length) extra = `+${R.r.bairros.length - mostrar.length} bairros`;
        }
        const w = Math.max(b.t.w, ...linhas.map((l) => wBn(`${l.nome} (${l.total})`)), extra ? wSub(extra) : 0) + 6;
        const h = b.t.h + linhas.length * tamBn * 1.25 + (extra ? tamSub * 1.25 : 0);
        const pos = posicionar(R, w, h, b.acima, b.c, true);
        if (pos) { Object.assign(b, { c: pos.c, p: pos.p, ret: pos.ret, w, h, linhas, extra }); break; }
        if (semLista) break;
      }
    }

    // ---- desenho
    for (const R of regs) {
      const b = blocos.get(R.id);
      if (b.numerado) {
        const n = numerados.indexOf(R) + 1;
        L.marker([R.g.lat0 + R.g.polo.y / M_LAT, R.g.lon0 + R.g.polo.x / R.g.kx], {
          icon: L.divIcon({ className: "rot-num-wrap", iconSize: [22, 22], html: `<span class="rot-num" aria-hidden="true">${n}</span>` }), interactive: false, keyboard: false, zIndexOffset: 200,
        }).addTo(camadaRotulos);
        if (R.r._rank) L.marker([R.g.lat0 + R.g.polo.y / M_LAT, R.g.lon0 + R.g.polo.x / R.g.kx], { icon: pino(R.r._rank, R.r._corPino, 14), interactive: false, keyboard: false, zIndexOffset: 400 }).addTo(camadaPinos);
        if (legNum) { const li = document.createElement("li"); li.textContent = `${n} = ${R.r.nome}`; legNum.append(li); legNum.hidden = false; }
        continue;
      }
      const topo = b.p.y - b.h / 2;
      if (R.r._rank) L.marker(mapa.containerPointToLatLng(L.point(b.p.x, topo - 3)), { icon: pino(R.r._rank, R.r._corPino, 0), interactive: false, keyboard: false, zIndexOffset: 400 }).addTo(camadaPinos);
      const claro = R.r.apagada ? null : corTextoSobre(R.r._cor);
      const estilo = claro ? `color:${claro};--halo:${claro === "#ffffff" ? "rgba(20,35,58,.65)" : "rgba(255,255,255,.7)"};` : "";
      const tit = b.t.linhas.map((s, i) => `<b class="r-titulo"${i === b.t.linhas.length - 1 ? ' style="margin-bottom:2px"' : ""}>${esc(s)}</b>`).join("");
      const corpo = b.linhas.map((l) => `<span class="bn" data-b="${esc(l.nome)}">${esc(l.nome)} (${l.total})</span>`).join("") +
        (b.extra ? `<span class="r-sub">${esc(b.extra)}</span>` : "");
      const icone = L.divIcon({
        className: "rotulo-regiao", iconSize: [0, 0],
        html: `<div class="r-caixa" style="width:${Math.ceil(b.w)}px;--tf:${b.t.tam}px;${estilo}">${tit}${corpo}</div>`,
      });
      const m = L.marker(llDe(R, b.c), { icon: icone, interactive: true, keyboard: false, zIndexOffset: -100 }).addTo(camadaRotulos);
      m.on("click", (e) => {
        const alvo = e.originalEvent.target.closest?.(".bn");
        if (alvo) aoSelecionarBairroNome(alvo.dataset.b);
      });
    }
  }

  /** Bairros = marcadores pequenos com ajuste de colisão. Devolve quantos foram desenhados. */
  function desenharBairros(itens, o, c) {
    if (!o.mostrarBairros) return 0;
    const valor = (b) => (o.modo === "diff" ? Math.abs(b.diff) : b.total);
    const cor = (b) => (o.modo === "diff" ? (b.diff >= 0 ? COR_MAIS : COR_MENOS) : o.faixas?.bairros ? o.faixas.bairros.cor(b.total) : corEscala(Math.sqrt(b.total / o.max)));
    const top = o.top5?.ativo && o.top5.modo === "bairros" ? o.top5.ranks : null;
    const marc = [];
    itens.forEach((b, posicao) => {
      const pos = posicaoBolha(b);
      if (!pos) return;
      const p = mapa.latLngToLayerPoint(pos);
      marc.push({ b, posicao, pos, r: raioBairro(valor(b), o.max), x: p.x, y: p.y, x0: p.x, y0: p.y });
    });
    afastar(marc);
    const rotulaveis = [];
    // maiores primeiro (ficam por baixo); os menores desenhados por último, sobre os maiores
    for (const m of [...marc].sort((a, b) => b.r - a.r)) {
      const b = m.b, opac = b.dim ? 0.18 : 1;
      const deslocado = Math.hypot(m.x - m.x0, m.y - m.y0) > 3;
      const alvo = deslocado ? mapa.layerPointToLatLng(L.point(m.x, m.y)) : L.latLng(m.pos);
      if (deslocado) {   // linha fina ligando o marcador deslocado ao ponto real + pontinho no ponto real
        L.polyline([m.pos, alvo], { pane: "marcadores", color: c.borda, weight: 1, opacity: 0.55 * opac, interactive: false }).addTo(camadaLigacoes);
        L.circleMarker(m.pos, { pane: "marcadores", radius: 2, color: c.borda, weight: 1, fillColor: c.borda, fillOpacity: 0.9 * opac, opacity: opac, interactive: false }).addTo(camadaLigacoes);
      }
      const rank = top?.get(b.nome);
      let corFill = cor(b), opFill = 0.92 * opac;
      if (top) { if (rank) { corFill = TOPS[rank - 1]; opFill = 0.96; } else { corFill = ESMAECIDO; opFill = 0.6 * opac; } }
      if (rank) {
        L.circleMarker(alvo, { pane: "marcadores", radius: m.r + 7, stroke: false, fillColor: corFill, fillOpacity: 0.38, interactive: false }).addTo(camadaBolhas);
        L.marker(alvo, { icon: pino(rank, corFill, m.r), interactive: false, keyboard: false, zIndexOffset: 400 }).addTo(camadaPinos);
      }
      const estilo = { pane: "marcadores", radius: m.r, color: b.selecionado ? "#f08a1c" : c.borda, weight: b.selecionado ? 3.5 : 1.3, fillColor: corFill, fillOpacity: opFill, opacity: Math.max(0.4, opac) };
      const hover = { ...estilo, weight: 3.5, color: c.destaque, fillOpacity: 1 };
      const marcador = L.circleMarker(alvo, estilo)
        .bindTooltip(htmlTooltip(b, o), { className: "tip", sticky: true })
        .on({ mouseover: () => { marcador.setStyle(hover); marcador.bringToFront(); }, mouseout: () => marcador.setStyle(estilo), click: () => aoSelecionar(b) });
      marcador.addTo(camadaBolhas);
      if (!b.dim) rotulaveis.push({ b, pos: alvo, posicao: m.posicao, desl: m.r + 3 });
    }
    // rótulos só dos maiores (mais nomes conforme o zoom); com "Áreas" ligado os nomes já estão dentro das regiões
    if (o.modo !== "diff" && !o.mostrarAreas) {
      const z = mapa.getZoom();
      const quantos = z <= 12 ? 3 : z === 13 ? 7 : z === 14 ? 14 : 999;
      for (const r of rotulaveis.filter((x) => x.posicao < quantos)) {
        const icone = L.divIcon({ className: "rotulo-mapa", iconSize: [0, 0], html: `<span style="transform:translate(-50%, ${r.desl}px)">${esc(r.b.nome)}</span>` });
        L.marker(r.pos, { icon: icone, interactive: false, keyboard: false }).addTo(camadaRotulos);
      }
    }
    return marc.length;
  }

  function desenhar(itens, o) {
    for (const cm of [camadaRegioes, camadaLigacoes, camadaBolhas, camadaRotulos, camadaBrilho, camadaPinos]) cm.clearLayers();
    const c = cores(o);
    const contagem = { areas: desenharRegioes(o, c), bolhas: 0 };
    contagem.bolhas = desenharBairros(itens, o, c);
    rotulosRegioes(o);
    desenharSenac(o.senac, c);

    // enquadramento: considera tudo o que existe no mapa, mesmo com as camadas desligadas
    const limites = [];
    for (const b of itens) { const p = posicaoBolha(b); if (p) limites.push(L.latLngBounds(p, p)); }
    for (const r of o.regioes || []) limites.push(L.geoJSON({ type: "Feature", geometry: r.geometry }).getBounds());
    if (limites.length) todos = limites.reduce((a, b) => L.latLngBounds(a.getSouthWest(), a.getNorthEast()).extend(b));
    if (primeiraVez && todos) { enquadrar(todos); primeiraVez = false; }
    return contagem;
  }
  // zoom muda o ajuste de colisão e quantos nomes cabem: redesenha
  mapa.on("zoomend", redesenhar);

  /** Enquadra considerando o painel lateral (desktop) ou a gaveta inferior (celular). */
  function enquadrar(bounds) {
    const largo = innerWidth > 900;
    mapa.fitBounds(bounds, { paddingTopLeft: [40, 40], paddingBottomRight: [largo ? 460 : 30, largo ? 40 : Math.round(innerHeight * 0.46) + 30], maxZoom: 14 });
  }

  function atualizar(itens, opcoes) { ultimo = { itens, opcoes }; return desenhar(itens, opcoes); }

  function irPara(alvo) {
    const largo = innerWidth > 900;
    const opt = { paddingBottomRight: [largo ? 460 : 30, largo ? 40 : Math.round(innerHeight * 0.46) + 30], maxZoom: 15, duration: 0.6 };
    if (alvo.geometry && alvo.centro) mapa.flyToBounds(L.geoJSON({ type: "Feature", geometry: alvo.geometry }).getBounds(), { ...opt, maxZoom: 14 });   // região
    else {
      const p = posicaoBolha(alvo);
      if (p) mapa.flyToBounds(L.latLngBounds(p, p).pad(0.002), opt);
    }
  }

  /** Retângulo do mapa que sobra livre (coordenadas do container): fora do painel lateral/gaveta, da legenda, do topo e do rodapé. */
  function areaLivre() {
    const box = el.getBoundingClientRect(), leg = document.getElementById("legenda")?.getBoundingClientRect(), dock = document.getElementById("dock")?.getBoundingClientRect();
    const largo = innerWidth > 900;
    let esq = 12, dir = box.width - 12, topo = 12, base = box.height - 12;
    if (largo) { if (leg) esq = Math.max(esq, leg.right - box.left + 16); if (dock) dir = Math.min(dir, dock.left - box.left - 16); }
    else if (leg) base = Math.min(base, leg.top - box.top - 12);   // celular: a legenda fica sobre a gaveta, o espaço livre é a faixa de cima
    base = Math.max(base, topo + 72);
    return { esq, dir, topo, base, w: box.width, h: box.height, largo };
  }

  /** Leva o pino (ou, com `aneis`, os anéis) para a área livre do mapa, longe da legenda e do painel. */
  function focarSenac(dados, aneis) {
    if (!dados) return;
    const f = areaLivre(), p = L.latLng(dados.lat, dados.lng);
    if (aneis) {
      mapa.flyToBounds(p.toBounds(f.largo ? 10000 : 6000), { paddingTopLeft: [f.esq, f.topo], paddingBottomRight: [f.w - f.dir, f.h - f.base], maxZoom: 14, duration: 0.6 });
      return;
    }
    const pt = mapa.latLngToContainerPoint(p);
    const dentro = pt.x >= f.esq + 24 && pt.x <= f.dir - 130 && pt.y >= f.topo + 52 && pt.y <= f.base - 8;   // sobra espaço p/ a etiqueta (à direita) e a altura do pino
    if (!dentro) mapa.panBy([pt.x - ((f.esq + f.dir) / 2 - 40), pt.y - ((f.topo + f.base) / 2 + 24)], { duration: 0.5 });
  }

  aplicarFundo();
  return { atualizar, focarSenac, setTema, setFundo, setSilhueta, irPara, reenquadrar: () => todos && enquadrar(todos), mapa, invalidar: () => mapa.invalidateSize() };
}
