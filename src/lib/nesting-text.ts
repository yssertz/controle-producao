// Leitura do TEXTO dos PDFs de nesting gerados pelo software de corte (cabeçalho + tabela de peças).
// Sem dependências, para poder ser testado sozinho (npm test).
// Entrada: o texto das linhas da tabela, de preferência gerado por pdf-text.ts a partir do ARQUIVO PDF
// (texto copiado e colado de um leitor de PDF pode vir embaralhado e não é confiável).
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
  /** coluna "Equipamento" só com as palavras (ex.: "Poli"); o número da lista não é confiável quando o texto vem colado */
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
  /** espessura da chapa em mm (linha "Descrição 2900 x 1200 x 6.35") */
  thickness_mm: number | null;
  programmer: string | null;
  utilization: string | null;
  total_time: string | null;
  parts: NestingPart[];
  /** linhas da tabela que não entram (ex.: corpo de prova, sem OP) */
  skipped: string[];
  warnings: string[];
}

const TIME = String.raw`\d{2}:\d{2}:\d{2}\.\d{2}`;
// Final de cada linha da tabela: Chapa | Total | Faltam | Dimensões (a x b) | Peso | Perímetro | Ataques | Tempo unitário.
// É a âncora do leitor: funciona mesmo quando o texto copiado do PDF vem SEM quebras de linha
// (ex.: "...00:02:30.82Poli 8423 30450013 7603893 1 1 0 2580 x 322.858 ...").
const ROW_TAIL = new RegExp(String.raw`(\d+) (\d+) (\d+) [\d.]+ ?x ?[\d.]+ [\d.]+ \d+ \d+ ${TIME}`, "g");

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
  // Tudo em uma linha só, com espaços simples: assim não importa como o PDF quebrou as linhas ao copiar.
  const flat = text.replace(/\s+/g, " ");

  const codeMatch = /(?<![A-Za-z])L(\d{4,})(?!\d)/.exec(flat);
  const machineMatch = /\b(?:[A-Za-zÀ-ú]+ )?Laser [A-Za-zÀ-ú ]*- ?(\d{4,5})\b(?: ?- ?[A-ZÀ-Ú]{3,})?/.exec(flat);
  const bobina = /bobina/i.test(flat);
  const machineText = machineMatch ? machineMatch[0].trim() : bobina ? "Bobina" : null;
  const materialMatch = /Chapa\s+\S+(?:\s+[A-Z]{2,}[\w-]*)?\s+\d{3,4}\s*x\s*\d{3,4}/.exec(flat);
  const dateMatch = /(?<!\d)(\d{2})\/(\d{2})\/(\d{4})(?!\d)/.exec(flat); // vem colada: "29/10/2026L3321"
  const util = /Aproveitamento:?\s*([\d.]+)/.exec(flat);
  const time = new RegExp(String.raw`Tempo total[^:]{0,40}?(${TIME})`).exec(flat);
  const prog = /Peso MP \(kg\)\s+([A-Za-zÀ-ú]+)/.exec(flat);
  // "2900 x1200 x 6.35 Aço Carbono" (os "x" podem vir separados) ou só "6.35 Aço Carbono"
  const thick =
    /\b\d{3,4} ?x? ?x? ?\d{3,4} x? ?(\d{1,3}(?:[.,]\d+)?) (?:x )?(?:A[çc]o|Inox|Alum[ií]nio|Galv)/i.exec(flat) ??
    /(?<![\d.,])(\d{1,3}(?:[.,]\d+)?) (?:x )?(?:A[çc]o|Inox|Alum[ií]nio|Galv)/i.exec(flat);

  const parts: NestingPart[] = [];
  const skipped: string[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();

  let prevEnd = 0;
  for (const m of flat.matchAll(ROW_TAIL)) {
    const start = m.index ?? 0;
    // O que vem antes do final da linha: "... # Referência OP"
    const before = flat.slice(prevEnd, start).trim().split(" ").filter((t) => t !== "");
    const end = start + m[0].length;
    prevEnd = end;
    const after = /^ ?([A-Za-zÀ-ú]+(?: [A-Za-zÀ-ú]+)*)/.exec(flat.slice(end));
    const equipment = after ? after[1].trim() : "";

    const op = before[before.length - 1] ?? "";
    if (/^\d{6,8}$/.test(op) && before.length >= 2) {
      const ref = before[before.length - 2];
      const key = `${op}|${ref.toUpperCase()}`;
      if (seen.has(key)) {
        warnings.push(`Peça repetida no texto colado (OP ${op}, ${ref}): considerada uma vez.`);
        continue;
      }
      seen.add(key);
      parts.push({ op_number: op, item_code: ref, quantity: Number(m[1]), total: Number(m[2]), equipment });
    } else {
      // linha sem OP (ex.: corpo de prova)
      const label = before.slice(-4).join(" ");
      skipped.push(`${label || "linha"}${equipment ? ` (${equipment})` : ""} — sem OP, não entra no nesting`);
    }
  }

  if (!codeMatch) warnings.push("Código do nesting (ex.: L3318) não encontrado no texto.");
  if (parts.length === 0) {
    warnings.push("Nenhuma peça com OP encontrada. Cole o texto completo do PDF (Ctrl+A, Ctrl+C) ou envie o arquivo PDF.");
  }

  return {
    code: codeMatch ? `L${codeMatch[1]}` : null,
    machine_text: machineText,
    machine_guess: machineText ? guessMachineName(machineText) : null,
    date: dateMatch ? `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}` : null,
    material: materialMatch ? materialMatch[0].trim() : null,
    thickness_mm: thick ? Number(thick[1].replace(",", ".")) : null,
    programmer: prog ? prog[1] : null,
    utilization: util ? util[1] : null,
    total_time: time ? time[1] : null,
    parts,
    skipped,
    warnings,
  };
}
