/**
 * filters.js — estado dos filtros e a interface (listas com caixas de seleção, busca, limpar).
 * Os filtros são combináveis; o estado guarda NOMES (não índices) para sobreviver à troca de ano.
 */
import { ranking1, filtrosParaIndices } from "./data.js";

export const filtrosVazios = () => ({
  cursos: new Set(),        // vazio = todos
  escolas: new Set(),       // vazio = todas
  ocultarConcluiu: false,   // esconde "Já concluiu o ensino médio"
  busca: "",                // texto do nome do bairro
  bairros: new Set(),       // seleção por clique (mapa/gráfico)
});

export const qtdAtivos = (f) => f.cursos.size + f.escolas.size + (f.ocultarConcluiu ? 1 : 0) + (f.busca.trim() ? 1 : 0) + f.bairros.size;

/** Liga/desliga um valor num Set do estado. */
export function alternar(conjunto, valor) {
  if (conjunto.has(valor)) conjunto.delete(valor); else conjunto.add(valor);
}

/**
 * Monta a interface de filtros. `aoMudar` é chamado a cada alteração.
 * Devolve { sincronizar(dados, estado) } para refazer as listas/contagens.
 */
export function criarInterface(raiz, estado, aoMudar) {
  const ulC = raiz.querySelector("#lista-cursos"), ulE = raiz.querySelector("#lista-escolas");
  const busca = raiz.querySelector("#f-busca"), ocultar = raiz.querySelector("#f-ocultar");

  let tempo = 0;
  busca.addEventListener("input", () => { clearTimeout(tempo); tempo = setTimeout(() => { estado.busca = busca.value; aoMudar(); }, 150); });
  ocultar.addEventListener("change", () => { estado.ocultarConcluiu = ocultar.checked; aoMudar(); });
  raiz.querySelector("#f-limpar").addEventListener("click", () => {
    Object.assign(estado, filtrosVazios());
    busca.value = "";
    aoMudar();
  });

  function lista(ul, itens, conjunto) {
    ul.replaceChildren();
    for (const [nome, n] of itens) {
      const li = document.createElement("li");
      const rotulo = document.createElement("label");
      const cb = document.createElement("input");
      cb.type = "checkbox"; cb.checked = conjunto.has(nome);
      cb.addEventListener("change", () => { alternar(conjunto, nome); aoMudar(); });
      const t = document.createElement("span"); t.textContent = nome;
      const q = document.createElement("small"); q.textContent = n;
      rotulo.append(cb, t, q);
      li.append(rotulo);
      ul.append(li);
    }
    if (!itens.length) { const li = document.createElement("li"); li.className = "vazio"; li.textContent = "Sem opções neste recorte."; ul.append(li); }
  }

  return {
    sincronizar(dados) {
      // faixa de filtros ativos (cada chip remove o seu filtro)
      const faixa = raiz.querySelector("#filtros-ativos");
      if (faixa) {
        faixa.replaceChildren();
        const chip = (txt, remover) => { const b = document.createElement("button"); b.type = "button"; b.textContent = txt; b.title = "Remover filtro"; b.addEventListener("click", () => { remover(); aoMudar(); }); faixa.append(b); };
        for (const n of estado.cursos) chip("Curso: " + n, () => estado.cursos.delete(n));
        for (const n of estado.escolas) chip("Escola: " + n, () => estado.escolas.delete(n));
        if (estado.ocultarConcluiu) chip("Sem quem já concluiu", () => { estado.ocultarConcluiu = false; });
        if (estado.busca.trim()) chip("Busca: " + estado.busca.trim(), () => { estado.busca = ""; busca.value = ""; });
        faixa.hidden = faixa.childElementCount === 0;
      }
      // Cada lista mostra as contagens com os OUTROS filtros aplicados (e ignora o próprio)
      const cursos = ranking1(dados, "c", filtrosParaIndices(dados, estado, new Set(["cursos"])));
      const escolas = ranking1(dados, "e", filtrosParaIndices(dados, estado, new Set(["escolas"])));
      // mantém selecionados que sumiram do recorte, para o usuário conseguir desmarcar
      for (const n of estado.cursos) if (!cursos.some(([x]) => x === n)) cursos.push([n, 0]);
      for (const n of estado.escolas) if (!escolas.some(([x]) => x === n)) escolas.push([n, 0]);
      lista(ulC, cursos, estado.cursos);
      lista(ulE, escolas, estado.escolas);
      ocultar.checked = estado.ocultarConcluiu;
      if (document.activeElement !== busca) busca.value = estado.busca;
    },
  };
}
