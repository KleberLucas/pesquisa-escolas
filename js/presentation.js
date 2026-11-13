/**
 * presentation.js — modo apresentação: tela cheia + passos automáticos com transições.
 * Quem chama (main.js) entrega os passos: [{ titulo, aplicar(), duracao? }].
 */
const $ = (s) => document.querySelector(s);

export function criarApresentacao({ montarPassos, aoSair }) {
  let passos = [], i = 0, timer = 0, pausado = false, ativo = false, inicio = 0, duracaoAtual = 8000, restante = 0;

  const barra = $("#ap-prog");

  function mostrar(n) {
    clearTimeout(timer);
    i = (n + passos.length) % passos.length;
    const p = passos[i];
    $("#ap-passo").textContent = `${i + 1} / ${passos.length}`;
    $("#ap-titulo").textContent = p.titulo;
    p.aplicar();
    duracaoAtual = p.duracao || 8000;
    restante = duracaoAtual;
    barra.style.transition = "none";
    barra.style.width = "0%";
    requestAnimationFrame(() => requestAnimationFrame(() => agendar()));
  }

  function agendar() {
    if (!ativo || pausado) return;
    inicio = performance.now();
    barra.style.transition = `width ${restante}ms linear`;
    barra.style.width = "100%";
    timer = setTimeout(() => mostrar(i + 1), restante);
  }

  function alternarPausa() {
    pausado = !pausado;
    $("#ap-pausa").textContent = pausado ? "▶" : "⏸";
    $("#ap-pausa").setAttribute("aria-label", pausado ? "Continuar" : "Pausar");
    if (pausado) {
      clearTimeout(timer);
      restante = Math.max(500, restante - (performance.now() - inicio));
      const w = getComputedStyle(barra).width; barra.style.transition = "none"; barra.style.width = w; // congela a barra
    } else agendar();
  }

  function teclas(e) {
    if (!ativo) return;
    if (e.key === "ArrowRight") mostrar(i + 1);
    else if (e.key === "ArrowLeft") mostrar(i - 1);
    else if (e.key === " ") { e.preventDefault(); alternarPausa(); }
  }

  async function iniciar() {
    passos = montarPassos();
    if (!passos.length) return;
    ativo = true; pausado = false;
    document.body.classList.add("apresentando");
    $("#apres").hidden = false;
    try { await document.documentElement.requestFullscreen(); } catch { /* sem tela cheia: segue em janela */ }
    addEventListener("keydown", teclas);
    mostrar(0);
  }

  function sair() {
    if (!ativo) return;
    ativo = false;
    clearTimeout(timer);
    removeEventListener("keydown", teclas);
    document.body.classList.remove("apresentando");
    $("#apres").hidden = true;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    aoSair();
  }

  $("#ap-prox").addEventListener("click", () => mostrar(i + 1));
  $("#ap-ant").addEventListener("click", () => mostrar(i - 1));
  $("#ap-pausa").addEventListener("click", alternarPausa);
  $("#ap-sair").addEventListener("click", sair);
  // Esc sai da tela cheia → encerra também a apresentação
  document.addEventListener("fullscreenchange", () => { if (ativo && !document.fullscreenElement) sair(); });

  return { iniciar, sair, ativo: () => ativo };
}
