/**
 * sempos.js — painel "Bairros sem posição": bolhas dos bairros que têm alunos mas ainda não têm ponto
 * nem polígono, organizadas por EMPACOTAMENTO CIRCULAR (circle packing).
 *
 * Importante: as bolhas NÃO representam lugares — não há coordenadas inventadas. Elas só são agrupadas
 * por tamanho. Mesma escala de cor/tamanho do mapa; mesmo tooltip; clique abre o painel do bairro.
 * Grupos "Outros", cidades de fora, área rural e "Não informado" nunca chegam aqui (ver data.js/classificar).
 */
import { corEscala, htmlTooltip, raioBairro } from "./map.js";

const NS = "http://www.w3.org/2000/svg";
const svgEl = (tag, attrs = {}, txt) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (txt != null) e.textContent = txt;
  return e;
};

/** Raio da bolha em unidades do SVG: mesma proporção do marcador do mapa, ampliada (2,4x) para caber número e nome. */
export const raioBolha = (total, max) => 2.4 * raioBairro(total, max);

/**
 * Empacota círculos (maiores primeiro) em espiral a partir do centro, sem sobreposição.
 * Devolve [{...item, x, y, r}] centrado em (0,0).
 */
export function empacotar(itens, max, folga = 5) {
  const postos = [];
  for (const it of [...itens].sort((a, b) => b.total - a.total)) {
    const r = raioBolha(it.total, max);
    if (!postos.length) { postos.push({ ...it, x: 0, y: 0, r }); continue; }
    let achou = null;
    for (let rho = 0; !achou && rho < 4000; rho += 2) {
      const passos = Math.max(1, Math.ceil((2 * Math.PI * rho) / 8));   // ~8 px de arco entre tentativas
      let melhor = null;
      for (let k = 0; k < passos; k++) {
        const ang = (2 * Math.PI * k) / passos + rho * 0.7;
        const x = rho * Math.cos(ang), y = rho * Math.sin(ang);
        if (postos.every((p) => Math.hypot(p.x - x, p.y - y) >= p.r + r + folga)) {
          // entre as posições livres deste anel, prefere a mais próxima do centro de massa (mais compacto)
          const d = Math.hypot(x, y * 1.15);
          if (!melhor || d < melhor.d) melhor = { x, y, d };
        }
      }
      if (melhor) achou = melhor;
    }
    postos.push({ ...it, x: achou?.x ?? 0, y: achou?.y ?? 0, r });
  }
  return postos;
}

/** Cor do texto (branco ou escuro) conforme o brilho do preenchimento. */
function corTexto(rgb) {
  const [r, g, b] = rgb.match(/\d+/g).map(Number);
  return 0.299 * r + 0.587 * g + 0.114 * b < 150 ? "#ffffff" : "#14233a";
}

export function criarPainelSemPosicao(raiz, { aoSelecionar, local }) {
  const svg = raiz.querySelector("#sp-svg"), tip = raiz.querySelector("#sp-tip"), resumo = raiz.querySelector("#sp-resumo");

  /**
   * itens: bairros sem posição [{nome,id,total,cursos,selecionado,dim}]
   * opc: { max, totalGeral }
   */
  let links = null, esconder = 0;
  /** Mostra o link do bairro (um por vez) e o esconde com pequeno atraso, para dar tempo de alcançá-lo. */
  function mostrarLink(g) {
    clearTimeout(esconder);
    links?.querySelectorAll(".posicionar.vis").forEach((l) => l.classList.remove("vis"));
    g._link?.classList.add("vis");
  }
  function ocultarLink(a) { clearTimeout(esconder); esconder = setTimeout(() => a.classList.remove("vis"), 350); }

  function atualizar(itens, opc) {
    svg.replaceChildren();
    tip.hidden = true;
    svg.style.width = svg.style.height = "";
    const soma = itens.reduce((s, b) => s + b.total, 0);
    if (!itens.length) {
      resumo.textContent = "Nenhum bairro pendente neste recorte. 🎉";
      svg.setAttribute("viewBox", "0 0 300 80");
      svg.append(svgEl("text", { x: 150, y: 44, "text-anchor": "middle", class: "sp-vazio" }, "Todos os bairros já têm posição no mapa."));
      return;
    }
    const pct = ((soma / (opc.totalGeral || 1)) * 100).toFixed(1).replace(".", ",");
    resumo.textContent = `${itens.length} ${itens.length === 1 ? "bairro" : "bairros"} · ${soma.toLocaleString("pt-BR")} alunos (${pct}% do total)`;

    links = svgEl("g", { class: "links" });
    const postos = empacotar(itens, opc.max);
    const x0 = Math.min(...postos.map((p) => p.x - p.r)) - 14, x1 = Math.max(...postos.map((p) => p.x + p.r)) + 14;
    const y0 = Math.min(...postos.map((p) => p.y - p.r)) - 14, y1 = Math.max(...postos.map((p) => p.y + p.r)) + 26;
    svg.setAttribute("viewBox", `${x0} ${y0} ${x1 - x0} ${y1 - y0}`);
    svg.style.width = (x1 - x0) * 1.15 + "px";      // no máximo 1,15x o tamanho do mapa; encolhe se faltar espaço
    svg.style.height = (y1 - y0) * 1.15 + "px";

    for (const p of postos) {
      const cor = opc.faixas ? opc.faixas.cor(p.total) : corEscala(Math.sqrt(p.total / opc.max));
      const g = svgEl("g", { class: "bolha" + (p.selecionado ? " sel" : "") + (p.dim ? " dim" : ""), transform: `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`, tabindex: 0, role: "button", "aria-label": `${p.nome}: ${p.total} alunos` });
      g.append(svgEl("circle", { r: p.r.toFixed(1), fill: cor }));
      const claro = corTexto(cor);
      const maxChars = Math.floor((p.r * 1.8) / 5.7);
      if (p.r >= 24) {
        const nome = p.nome.length > maxChars ? p.nome.slice(0, Math.max(3, maxChars - 1)) + "…" : p.nome;
        g.append(svgEl("text", { y: -2, class: "nome", fill: claro }, nome), svgEl("text", { y: 12, class: "valor", fill: claro }, String(p.total)));
      } else {
        g.append(svgEl("text", { y: 4, class: "valor", fill: claro }, String(p.total)));
      }
      // link para o editor: só existe no uso local (no site público nem é desenhado). Fica numa camada
      // por cima de todas as bolhas, para não ser coberto pelas vizinhas.
      if (local) {
        const a = svgEl("a", { href: `editor.html?bairro=${encodeURIComponent(p.id)}`, target: "_blank", rel: "noopener", class: "posicionar", transform: `translate(${p.x.toFixed(1)} ${(p.y + p.r + 14).toFixed(1)})` });
        a.append(svgEl("text", { class: "link" }, "📍 Posicionar no mapa"));
        a.addEventListener("mouseenter", () => { clearTimeout(esconder); });
        a.addEventListener("mouseleave", () => ocultarLink(a));
        a.addEventListener("click", (e) => e.stopPropagation());
        links.append(a);
        g._link = a;
      }
      g.addEventListener("click", () => { if (matchMedia("(hover: none)").matches) tip.hidden = true; aoSelecionar(p); });
      g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); aoSelecionar(p); } });
      g.addEventListener("mouseenter", () => { mostrarLink(g); });
      g.addEventListener("focus", () => { mostrarLink(g); });
      g.addEventListener("mouseleave", () => { if (g._link) ocultarLink(g._link); });
      g.addEventListener("mouseenter", () => { tip.innerHTML = htmlTooltip(p, { modo: "normal", totalGeral: opc.totalGeral || 1 }); tip.hidden = false; });
      g.addEventListener("mousemove", (e) => {
        const r = raiz.getBoundingClientRect();
        tip.style.left = Math.min(e.clientX - r.left + 14, r.width - tip.offsetWidth - 8) + "px";
        tip.style.top = Math.max(8, e.clientY - r.top - tip.offsetHeight - 14) + "px";
      });
      g.addEventListener("mouseleave", () => { tip.hidden = true; });
      svg.append(g);
    }
    svg.append(links);
  }

  return { atualizar };
}
