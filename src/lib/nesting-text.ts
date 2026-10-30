// Leitura do TEXTO dos PDFs de nesting gerados pelo software de corte (cabeçalho + tabela de peças).
// Sem dependências, para poder ser testado sozinho (npm test).
// Como usar: abra o PDF, selecione tudo (Ctrl+A), copie (Ctrl+C) e cole na tela de nesting.
// Se o nesting tiver mais de uma página, cole o texto de todas as páginas.
//
// Colunas da tabela do PDF: # | Referência | OP | Chapa | Total | Faltam | Dimensões | Peso | Perímetro | Ataques | Tempo unitário | Equipamento
//   Chapa  = quantidade cortada NESTE nesting (já multiplicada pelas repetições)  -> quantidade programada
//   Total  = quantidade total da OP; Faltam = saldo calculado pelo software (o sistema calcula o seu próprio)

export interface NestingPart {
  op_number: string;
  item_code: string;
  /** coluna "Chapa": quantidade neste nesting */
  quantity: number;
  /** coluna "Total": quantidade total da OP segundo o PDF */
  total: number;
  /** coluna "Equipamento" (ex.: "Poli 84") */
  equipment: string;
}

export interface NestingText {
  code: string | null;
  /** ex.: "Calfran Laser Fiber - 6000 - RODOVIARIO" */
  machine_text: string | null;
  /** nome da máquina do sistema sugerido a partir do texto (ex.: "Laser 6KW"), se reconhecido */
  machine_guess: string | null;
  /** AAAA-MM-DD */
  date: string | null;
  /** ex.: Chapa 1/4" LNE 2900x1200 */
  material: string | null;
  programmer: string | null;
  utilization: string | null;
  total_time: string | null;
  parts: NestingPart[];
  /** linhas da tabela que não entram (ex.: corpo de prova, sem OP) */
  skipped: string[];
  warnings: string[];
}

const TIME = String.raw`\d{2}:\d{2}:\d{2}\.\d{2}`;
// # | Referência | OP | Chapa | Total | Faltam | Dimensões (a x b) | Peso | Perímetro | Ataques | Tempo | Equipamento
const ROW_WITH_OP = new RegExp(
  String.raw`^\s*(\d+)\s+(.+?)\s+(\d{6,8})\s+(\d+)\s+(\d+)\s+(\d+)\s+[\d.]+\s*x\s*[\d.]+\s+[\d.]+\s+\d+\s+\d+\s+${TIME}\s+(.+?)\s*$`,
);
const ROW_NO_OP = new RegExp(
  String.raw`^\s*(\d+)\s+(.+?)\s+(\d+)\s+(\d+)\s+(\d+)\s+[\d.]+\s*x\s*[\d.]+\s+[\d.]+\s+\d+\s+\d+\s+${TIME}\s+(.+?)\s*$`,
);

/** Potência em watts no nome da máquina ("... - 6000 - ...") -> "Laser 6KW". */
export function guessMachineName(text: string): string | null {
  if (/bobina/i.test(text)) return "Bobina";
  const m = /-\s*(\d{4,5})\b/.exec(text);
  if (m && /laser/i.test(text)) {
    const kw = Number(m[1]) / 1000;
    if (Number.isInteger(kw) && kw > 0) return `Laser ${kw}KW`;
  }
  return null;
}

export function parseNestingText(text: string): NestingText {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const segments = lines.flatMap((l) => l.split(/\t|\s{2,}/).map((s) => s.trim()).filter((s) => s !== ""));

  const codeMatch = /\bCNC\s+(L\d{4,})\b/.exec(text) ?? /\b(L\d{4,})\b/.exec(text);
  const machineSeg = segments.find((s) => /laser/i.test(s) && /-\s*\d{4,5}\b/.test(s)) ?? segments.find((s) => /bobina/i.test(s)) ?? null;
  const machineText = machineSeg ? machineSeg.replace(/\s+\d+$/, "").trim() : null; // remove a repetição ("... RODOVIARIO 1")
  const materialSeg = segments.find((s) => /^Chapa\b/i.test(s) && /\d{3,4}\s*x\s*\d{3,4}/i.test(s)) ?? null;
  const dateMatch = /\b(\d{2})\/(\d{2})\/(\d{4})\b/.exec(text);
  const util = /Aproveitamento:?\s+([\d.]+)/.exec(text);
  const time = new RegExp(String.raw`Tempo total[^\n]*?(${TIME})`).exec(text);
  const prog = /Peso MP \(kg\)\s+([A-Za-zÀ-ú]+)/.exec(text);

  const parts: NestingPart[] = [];
  const skipped: string[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    const m = ROW_WITH_OP.exec(line);
    if (m) {
      const key = `${m[3]}|${m[2].trim().toUpperCase()}`;
      if (seen.has(key)) {
        warnings.push(`Peça repetida no texto colado (OP ${m[3]}, ${m[2].trim()}): considerada uma vez.`);
        continue;
      }
      seen.add(key);
      parts.push({ op_number: m[3], item_code: m[2].trim(), quantity: Number(m[4]), total: Number(m[5]), equipment: m[7].trim() });
      continue;
    }
    const n = ROW_NO_OP.exec(line);
    if (n) skipped.push(`${n[2].trim()} (${n[6].trim()}) — sem OP, não entra no nesting`);
  }

  if (!codeMatch) warnings.push("Código do nesting (ex.: L3318) não encontrado no texto.");
  if (parts.length === 0) warnings.push("Nenhuma peça com OP encontrada. Cole o texto completo do PDF (Ctrl+A, Ctrl+C).");

  return {
    code: codeMatch ? codeMatch[1] : null,
    machine_text: machineText,
    machine_guess: machineText ? guessMachineName(machineText) : null,
    date: dateMatch ? `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}` : null,
    material: materialSeg,
    programmer: prog ? prog[1] : null,
    utilization: util ? util[1] : null,
    total_time: time ? time[1] : null,
    parts,
    skipped,
    warnings,
  };
}
