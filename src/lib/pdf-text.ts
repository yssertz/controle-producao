// Extrai o texto de um PDF reconstruindo as LINHAS pela posição de cada trecho (x, y).
// Isso é necessário porque o texto "copiado" de um PDF costuma vir embaralhado (uma célula por linha,
// colunas fora de ordem). Aqui as células da mesma linha da tabela voltam juntas, separadas por TAB.
//
// Recebe o módulo do pdf.js como parâmetro, assim o mesmo código roda no navegador e nos testes (Node).

interface TextItem {
  str: string;
  transform: number[];
  width: number;
}
interface PdfPage {
  getTextContent(): Promise<{ items: unknown[] }>;
}
interface PdfDocument {
  numPages: number;
  getPage(n: number): Promise<PdfPage>;
}
export interface PdfJsLike {
  getDocument(src: { data: Uint8Array }): { promise: Promise<unknown> };
}

function isTextItem(x: unknown): x is TextItem {
  const o = x as Partial<TextItem>;
  return typeof o?.str === "string" && Array.isArray(o.transform) && typeof o.width === "number";
}

/** Agrupa os trechos de uma página em linhas (mesma altura) e ordena da esquerda para a direita. */
export function itemsToLines(items: unknown[]): string[] {
  const texts = items.filter(isTextItem).filter((t) => t.str.trim() !== "");
  // y maior = mais alto na página; ordena de cima para baixo
  texts.sort((a, b) => b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4]);

  const rows: TextItem[][] = [];
  let currentY = Number.NaN;
  for (const t of texts) {
    const y = t.transform[5];
    if (rows.length === 0 || Math.abs(y - currentY) > 3) {
      rows.push([t]);
      currentY = y;
    } else {
      rows[rows.length - 1].push(t);
    }
  }

  return rows.map((row) => {
    row.sort((a, b) => a.transform[4] - b.transform[4]);
    let line = "";
    let prevEnd = Number.NaN;
    for (const t of row) {
      const x = t.transform[4];
      if (line !== "") {
        const gap = x - prevEnd;
        line += gap > 6 ? "\t" : gap > 0.5 ? " " : "";
      }
      line += t.str.trim();
      prevEnd = x + t.width;
    }
    return line;
  });
}

/** Texto do PDF inteiro (todas as páginas), uma linha de tabela por linha de texto. */
export async function pdfToText(pdfjs: PdfJsLike, data: Uint8Array): Promise<string> {
  const doc = (await pdfjs.getDocument({ data }).promise) as PdfDocument;
  const out: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    out.push(...itemsToLines(content.items));
  }
  return out.join("\n");
}
