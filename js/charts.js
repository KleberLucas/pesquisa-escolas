/**
 * charts.js — gráficos (Chart.js via CDN, global `Chart`).
 * Clicar numa barra/fatia chama os callbacks, que aplicam o filtro correspondente (e vice-versa,
 * pois os gráficos são redesenhados a cada mudança de filtro, destacando o que está selecionado).
 */
// Paleta categórica segura para daltonismo (Okabe-Ito); cinza = "Demais/Outros"
const css0 = (v, padrao) => getComputedStyle(document.documentElement).getPropertyValue(v).trim() || padrao;
/** Categóricas do visual ativo (variáveis --cat-1..6; Okabe-Ito no Minimalista, paleta dos selos no Ilustrado). */
const categoricas = () => [1, 2, 3, 4, 5, 6].map((i) => css0(`--cat-${i}`, "#0072B2"));
const cinza = () => css0("--cat-outros", "#8a97a8");

const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const alfa = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };

export function criarGraficos(el, cb) {
  const inst = {};

  function opcoesBase() {
    Chart.defaults.font.family = css0("--fonte-texto", '"Inter", system-ui, sans-serif');
    Chart.defaults.color = css("--texto-2");
    Chart.defaults.borderColor = css("--borda");
  }

  const horizontal = (canvas, aoClicar) => new Chart(canvas, {
    type: "bar",
    data: { labels: [], datasets: [{ data: [], borderRadius: 6 }] },
    options: {
      indexAxis: "y", responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${c.parsed.x} alunos` } } },
      scales: { x: { beginAtZero: true, ticks: { precision: 0 }, grid: { display: true } }, y: { grid: { display: false }, ticks: { autoSkip: false, callback(v) { const t = String(this.getLabelForValue(v)); return t.length > 24 ? t.slice(0, 23) + "…" : t; } } } },
      onClick: (_e, els, ch) => { if (els.length) aoClicar(ch.data.labels[els[0].index]); },
      onHover: (e, els) => { e.native.target.style.cursor = els.length ? "pointer" : "default"; },
    },
  });

  function criar() {
    opcoesBase();
    inst.bairros = horizontal(el.bairros, cb.bairro);
    inst.escolas = horizontal(el.escolas, cb.escola);
    inst.cursos = new Chart(el.cursos, {
      type: "doughnut",
      data: { labels: [], datasets: [{ data: [], borderWidth: 2 }] },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: "58%",
        plugins: {
          legend: { position: "bottom", labels: { boxWidth: 12, usePointStyle: true }, onClick: (_e, item, leg) => cb.curso(leg.chart.data.labels[item.index]) },
          tooltip: { callbacks: { label: (c) => ` ${c.label}: ${c.parsed} alunos` } },
        },
        onClick: (_e, els, ch) => { if (els.length) cb.curso(ch.data.labels[els[0].index]); },
        onHover: (e, els) => { e.native.target.style.cursor = els.length ? "pointer" : "default"; },
      },
    });
    inst.dias = new Chart(el.dias, {
      type: "line",
      data: { labels: [], datasets: [{ data: [], fill: true, tension: 0.3, pointRadius: 3, borderWidth: 2 }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${c.parsed.y} inscrições` } } },
        scales: { y: { beginAtZero: true, ticks: { precision: 0 } }, x: { grid: { display: false } } },
      },
    });
  }

  /** Pinta barras: selecionadas em destaque; se houver seleção, as demais ficam suaves. */
  function pintarBarras(ch, labels, sel) {
    const base = css("--seq-3"), dest = css("--destaque");
    ch.data.datasets[0].backgroundColor = labels.map((l) => (sel.has(l) ? dest : sel.size ? alfa(base.startsWith("#") ? base : "#3f61a8", 0.35) : base));
  }

  function atualizar(d) {
    if (!inst.bairros) criar();
    // top bairros
    const tb = d.topBairros.slice(0, 10);
    inst.bairros.data.labels = tb.map(([n]) => n);
    inst.bairros.data.datasets[0].data = tb.map(([, n]) => n);
    pintarBarras(inst.bairros, inst.bairros.data.labels, d.selBairros);
    // escolas
    inst.escolas.data.labels = d.escolas.map(([n]) => n);
    inst.escolas.data.datasets[0].data = d.escolas.map(([, n]) => n);
    pintarBarras(inst.escolas, inst.escolas.data.labels, d.selEscolas);
    el.escolas.parentElement.style.height = Math.max(160, d.escolas.length * 26 + 40) + "px";
    el.bairros.parentElement.style.height = Math.max(160, tb.length * 26 + 40) + "px";
    // cursos: 6 maiores + "Demais"
    const top = d.cursos.filter(([n]) => n !== "Outros").slice(0, 6);
    const resto = d.cursos.reduce((s, [n, v]) => s + v, 0) - top.reduce((s, [, v]) => s + v, 0);
    const labels = top.map(([n]) => n).concat(resto > 0 ? ["Demais"] : []);
    inst.cursos.data.labels = labels;
    inst.cursos.data.datasets[0].data = top.map(([, n]) => n).concat(resto > 0 ? [resto] : []);
    inst.cursos.data.datasets[0].backgroundColor = labels.map((l, i) => {
      const c = l === "Demais" ? cinza() : categoricas()[i];
      return d.selCursos.size && !d.selCursos.has(l) ? alfa(c, 0.3) : c;
    });
    inst.cursos.data.datasets[0].borderColor = css("--superficie");
    // dias
    inst.dias.data.labels = d.dias.map(([dia]) => dia.slice(8, 10) + "/" + dia.slice(5, 7));
    inst.dias.data.datasets[0].data = d.dias.map(([, n]) => n);
    inst.dias.data.datasets[0].borderColor = css("--primaria");
    const primaria = css("--primaria");
    inst.dias.data.datasets[0].backgroundColor = alfa(primaria.startsWith("#") && primaria.length === 7 ? primaria : "#0a5fb4", 0.18);
    for (const c of Object.values(inst)) c.update();
  }

  /** Reaplica cores do tema. */
  function tema() {
    if (!inst.bairros) return;
    opcoesBase();
    for (const c of Object.values(inst)) {
      c.options.scales && Object.values(c.options.scales).forEach((s) => { s.grid = { ...s.grid, color: css("--borda") }; });
      c.update();
    }
  }

  return { atualizar, tema, redimensionar: () => Object.values(inst).forEach((c) => c.resize()) };
}
