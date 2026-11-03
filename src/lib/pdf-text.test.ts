import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pdfToText, type PdfJsLike } from "./pdf-text.ts";
import { parseNestingText } from "./nesting-text.ts";

// PDFs reais de nesting (L3318, páginas 1 e 2). O teste usa o pdf.js instalado (npm install) e é pulado se ele não existir.
async function loadPdfJs(): Promise<PdfJsLike | null> {
  try {
    return (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as PdfJsLike;
  } catch {
    return null;
  }
}

const dir = new URL("./__fixtures__/", import.meta.url);

test("PDF real: as duas páginas do L3318 viram 10 peças com OP, em qualquer ordem de células", async (t) => {
  const pdfjs = await loadPdfJs();
  if (!pdfjs) return t.skip("pdfjs-dist não instalado");
  const pages = ["nesting_L3318_pagina1.pdf", "nesting_L3318_pagina2.pdf"];
  let text = "";
  for (const f of pages) text += (await pdfToText(pdfjs, new Uint8Array(readFileSync(new URL(f, dir))))) + "\n";
  const r = parseNestingText(text);
  assert.equal(r.code, "L3318");
  assert.equal(r.machine_guess, "Laser 6KW");
  assert.equal(r.thickness_mm, 6.35);
  assert.equal(r.parts.length, 10);
  const sum = (op: string) => r.parts.filter((p) => p.op_number === op).reduce((s, p) => s + p.quantity, 0);
  assert.equal(sum("7604587"), 30); // J007217
  assert.equal(r.skipped.length, 1); // corpo de prova
});
