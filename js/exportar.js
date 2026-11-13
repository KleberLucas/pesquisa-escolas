/**
 * exportar.js — exporta a visualização atual: CSV agregado (sem dados pessoais) e PNG da tela.
 */
import { consultar } from "./data.js";

function baixar(blob, nome) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = nome;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}

const celula = (v) => `"${String(v).replace(/"/g, '""')}"`;

/** CSV (separador ;, com BOM para abrir certo no Excel) com bairro × curso × escola sob os filtros atuais. */
export function exportarCSV(dados, fi, ano) {
  const linhas = [...consultar(dados, "bce", fi)]
    .map(([k, n]) => { const [b, c, e] = k.split("|").map(Number); return [dados.nomes.b[b], dados.nomes.c[c], dados.nomes.e[e], n]; })
    .sort((x, y) => y[3] - x[3] || x[0].localeCompare(y[0], "pt-BR"));
  const texto = ["bairro;curso;escola;alunos", ...linhas.map((l) => l.map(celula).join(";"))].join("\r\n");
  baixar(new Blob(["﻿" + texto], { type: "text/csv;charset=utf-8" }), `alunos-agregado-${ano}.csv`);
  return linhas.length;
}

let promessaLib = null;
function carregarHtml2Canvas() {
  if (window.html2canvas) return Promise.resolve(window.html2canvas);
  promessaLib ||= new Promise((ok, erro) => {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
    s.onload = () => ok(window.html2canvas);
    s.onerror = () => { promessaLib = null; erro(new Error("não foi possível baixar a biblioteca de captura (sem internet?)")); };
    document.head.append(s);
  });
  return promessaLib;
}

const CREDITO = "© Desenvolvido por Kleber Lucas da Silva - Senac Barretos 2026";
function desenharCredito(canvas) {
  const ctx = canvas.getContext("2d"), h = Math.round(canvas.height * 0.03) + 14;
  ctx.fillStyle = "rgb(39 79 43 / 92%)"; ctx.fillRect(0, canvas.height - h, canvas.width, h);
  ctx.fillStyle = "#fff4d6"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.font = `600 ${Math.round(h * 0.5)}px Inter, system-ui, sans-serif`;
  ctx.fillText(CREDITO, canvas.width / 2, canvas.height - h / 2);
}

/** Captura a tela (mapa + painéis + rodapé com o crédito) em PNG. */
export async function exportarPNG(ano) {
  const h2c = await carregarHtml2Canvas();
  const fundo = getComputedStyle(document.body).backgroundColor;
  const canvas = await h2c(document.body, { useCORS: true, backgroundColor: fundo, scale: Math.min(2, devicePixelRatio || 1), logging: false, ignoreElements: (e) => e.classList?.contains("toast") || e.classList?.contains("bv") });
  // O rodapé (#rodape) faz parte da página e já sai na captura; se faltar por qualquer motivo, desenha a mesma linha de crédito.
  if (!document.querySelector("#rodape")) desenharCredito(canvas);
  const blob = await new Promise((ok) => canvas.toBlob(ok, "image/png"));
  if (!blob) throw new Error("não foi possível gerar a imagem");
  baixar(blob, `mapa-alunos-barretos-${ano}.png`);
}
