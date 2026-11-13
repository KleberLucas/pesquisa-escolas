/**
 * boasvindas.js — modal de boas-vindas. Aparece a cada abertura (nada é salvo no navegador).
 * Enquanto aberto: o site (#site) fica inerte (sem cliques, foco, rolagem ou atalhos); Esc e clique fora não fecham;
 * o foco fica preso no botão "Avançar". Ao confirmar, o foco volta para o site.
 */
const $ = (s) => document.querySelector(s);

export function iniciarBoasVindas() {
  const modal = $("#bv"), btn = $("#bv-avancar"), site = $("#site");
  if (!modal || !btn || !site) { site?.removeAttribute("inert"); return; }
  let aberto = true;

  site.setAttribute("inert", "");   // (já vem no HTML; repete por segurança)
  btn.focus({ preventScroll: true });

  // Nenhuma tecla chega ao site; só Enter/Espaço no botão confirmam (comportamento nativo do <button>).
  const teclas = (e) => {
    if (!aberto) return;
    if (e.key === "Tab") { e.preventDefault(); e.stopPropagation(); btn.focus({ preventScroll: true }); return; }
    if (e.key === "Escape" || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") || e.key === "/") e.preventDefault();
    if (e.key === "Enter" || e.key === " ") { if (e.target !== btn) e.preventDefault(); return; }
    e.stopPropagation();
  };
  const foco = (e) => { if (aberto && !modal.contains(e.target)) btn.focus({ preventScroll: true }); };
  // O desfoque do navegador (ex.: clique no fundo) devolve o foco ao botão.
  const perdeu = () => { if (aberto) setTimeout(() => { if (aberto && document.activeElement !== btn) btn.focus({ preventScroll: true }); }, 0); };
  document.addEventListener("keydown", teclas, true);
  document.addEventListener("focusin", foco, true);
  btn.addEventListener("blur", perdeu);
  // Rolagem/gestos por trás do modal não passam (o fundo é só o overlay).
  modal.addEventListener("wheel", (e) => { if (e.target === modal) e.preventDefault(); }, { passive: false });

  function fechar() {
    if (!aberto) return;
    aberto = false;
    document.removeEventListener("keydown", teclas, true);
    document.removeEventListener("focusin", foco, true);
    btn.removeEventListener("blur", perdeu);
    btn.disabled = true;
    const terminar = () => {
      modal.remove();
      site.removeAttribute("inert");
      const alvo = $(".marca h1");           // devolve o foco ao site (início da página)
      if (alvo) { alvo.tabIndex = -1; alvo.focus({ preventScroll: true }); alvo.addEventListener("blur", () => alvo.removeAttribute("tabindex"), { once: true }); }
      window.dispatchEvent(new Event("boasvindas:fechado"));
    };
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return terminar();
    modal.classList.add("saindo");
    let feito = false;
    const uma = () => { if (!feito) { feito = true; terminar(); } };
    modal.addEventListener("animationend", (e) => { if (e.target === modal) uma(); });
    setTimeout(uma, 500);   // garantia
  }

  btn.addEventListener("click", fechar);
}
