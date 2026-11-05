// Leitura e validação de dados colados do ERP/Excel.
// Este arquivo NÃO depende de React nem do Supabase, para poder ser testado sozinho (npm test).
//
// Formato da colagem de itens (aba DADOS das planilhas, colunas separadas por TAB):
//   OP | Qtde | Código | Descrição | Código MP | Qtde MP | Und | Descrição MP          (layout padrão, sem cabeçalho)
// Se a colagem INCLUIR a linha de cabeçalho (OP, Qtde, Und, Código...), as colunas são localizadas
// pelo nome (há planilhas com "Und" logo após a "Qtde" e com as colunas "Linha"/"Fabricação").
// Coluna "Linha" (código ERP) presente = usada; senão o sistema descobre pelo Código do item (catálogo).
//
// Regra de duplicidade (espelhada na função SQL import_items_erp):
//   mesma lista + mesma linha + mesma OP + mesmo Código + mesmo Código MP (sem diferenciar maiúsculas/espaços).

export const PASTE_COLUMNS = ["OP", "Qtde", "Código", "Descrição", "Código MP", "Qtde MP", "Und", "Descrição MP"] as const;

export const MAX_QUANTITY = 99_999_999_999; // limite do numeric(14,3)
const MAX_OP = 50;
const MAX_ITEM = 80;
const MAX_DESC = 300;
const MAX_MAT = 300;

export interface DecimalResult {
  value: number | null;
  /** true quando "1.500" foi lido como mil e quinhentos (padrão brasileiro) */
  thousandsGuess: boolean;
}

/**
 * Converte texto numérico brasileiro (ou simples) em número.
 *  "4"        -> 4
 *  "2,5"      -> 2.5
 *  "1.234,56" -> 1234.56
 *  "1.234"    -> 1234   (ponto = milhar, padrão brasileiro; marca thousandsGuess)
 *  "0.125"    -> 0.125  (começa com zero: é decimal)
 *  "abc", ""  -> null
 */
export function parseDecimalBR(input: string): DecimalResult {
  const text = input.replace(/[\s\u00a0]/g, "");
  if (text === "") return { value: null, thousandsGuess: false };
  if (!/^[+-]?[\d.,]+$/.test(text)) return { value: null, thousandsGuess: false };

  const hasDot = text.includes(".");
  const hasComma = text.includes(",");
  let normalized: string;
  let thousandsGuess = false;

  if (hasDot && hasComma) {
    // O último separador é o decimal. Ex.: 1.234,56 (BR) ou 1,234.56 (US)
    const decimalSep = text.lastIndexOf(",") > text.lastIndexOf(".") ? "," : ".";
    const thousandSep = decimalSep === "," ? "." : ",";
    normalized = text.split(thousandSep).join("").replace(decimalSep, ".");
  } else if (hasComma) {
    if ((text.match(/,/g) ?? []).length > 1) return { value: null, thousandsGuess: false };
    normalized = text.replace(",", ".");
  } else if (hasDot) {
    if (/^[+-]?[1-9]\d{0,2}(\.\d{3})+$/.test(text)) {
      normalized = text.split(".").join("");
      thousandsGuess = true;
    } else {
      if ((text.match(/\./g) ?? []).length > 1) return { value: null, thousandsGuess: false };
      normalized = text;
    }
  } else {
    normalized = text;
  }

  if (!/^[+-]?\d+(\.\d+)?$/.test(normalized)) return { value: null, thousandsGuess: false };
  const value = Number(normalized);
  if (!Number.isFinite(value)) return { value: null, thousandsGuess: false };
  return { value, thousandsGuess };
}

/** Quantas casas decimais o número informado tem (o banco guarda no máximo 3). */
function decimalPlaces(n: number): number {
  const s = String(n);
  const i = s.indexOf(".");
  return i === -1 ? 0 : s.length - i - 1;
}

/** Chave usada para detectar duplicidade (mesma regra do SQL). */
export function itemKey(op: string, item: string, materialCode: string): string {
  return `${op.trim().toUpperCase()}|${item.trim().toUpperCase()}|${materialCode.trim().toUpperCase()}`;
}

export interface PasteFields {
  op_number: string;
  quantity_text: string;
  item_code: string;
  description: string;
  material_code: string;
  material_qty_text: string;
  material_unit: string;
  material: string;
  /** unidade do item (ex.: PC), quando a planilha tem essa coluna */
  item_unit: string;
  /** texto da coluna "Linha" (código ERP), quando existe */
  line_code_text: string;
}

export interface Validation {
  quantity: number | null;
  material_qty: number | null;
  errors: string[];
  warnings: string[];
}

/** Valores de erro do Excel ("#N/A") contam como vazio. */
function clean(value: string | undefined): string {
  const t = (value ?? "").trim();
  return t.startsWith("#") && /^#(N\/A|REF!|VALUE!|NAME\?|DIV\/0!)$/i.test(t) ? "" : t;
}

/** Valida UMA linha (usada na colagem e quando o usuário corrige a prévia). */
export function validateFields(f: PasteFields): Validation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const op = f.op_number.trim();
  const item = f.item_code.trim();

  if (op === "") errors.push("OP é obrigatória.");
  else if (op.length > MAX_OP) errors.push(`OP muito longa (máximo ${MAX_OP} caracteres).`);
  if (item === "") errors.push("Código do item é obrigatório.");
  else if (item.length > MAX_ITEM) errors.push(`Código muito longo (máximo ${MAX_ITEM} caracteres).`);
  if (f.description.trim().length > MAX_DESC) errors.push(`Descrição muito longa (máximo ${MAX_DESC} caracteres).`);
  if (f.material.trim().length > MAX_MAT) errors.push(`Descrição MP muito longa (máximo ${MAX_MAT} caracteres).`);

  const isHeader = op.toUpperCase() === "OP" && /^q(tde|uant|td)/i.test(f.quantity_text.trim());
  if (isHeader) errors.push("Esta linha parece ser o cabeçalho da planilha. Remova-a (cole somente os dados).");

  let quantity: number | null = null;
  if (!isHeader) {
    if (f.quantity_text.trim() === "") {
      errors.push("Qtde é obrigatória.");
    } else {
      const parsed = parseDecimalBR(f.quantity_text);
      if (parsed.value === null) errors.push(`Qtde inválida: "${f.quantity_text.trim()}".`);
      else if (parsed.value <= 0) errors.push("Qtde deve ser maior que zero.");
      else if (parsed.value > MAX_QUANTITY) errors.push("Qtde grande demais.");
      else if (decimalPlaces(parsed.value) > 3) errors.push("Qtde com mais de 3 casas decimais.");
      else {
        quantity = parsed.value;
        if (parsed.thousandsGuess) {
          warnings.push(`"${f.quantity_text.trim()}" foi lido como ${parsed.value.toLocaleString("pt-BR")} (ponto = milhar). Confira.`);
        }
      }
    }
  }

  // Qtde MP é opcional, mas se vier precisa ser número válido
  let material_qty: number | null = null;
  if (f.material_qty_text.trim() !== "" && !isHeader) {
    const m = parseDecimalBR(f.material_qty_text);
    // a matéria-prima vem do ERP com até 4 casas (ex.: 117,9545)
    if (m.value === null || m.value < 0 || m.value > MAX_QUANTITY || decimalPlaces(m.value) > 4) {
      errors.push(`Qtde MP inválida: "${f.material_qty_text.trim()}".`);
    } else {
      material_qty = m.value;
    }
  }
  return { quantity, material_qty, errors, warnings };
}

/**
 * Separa o texto colado em linhas e colunas (TSV do Excel).
 * Entende células entre aspas (o Excel usa aspas quando a célula tem quebra de linha, tab ou aspas).
 * Linhas totalmente vazias são ignoradas. Retorna também o número da linha original.
 */
export function splitTsv(text: string, delimiter = "\t"): { line: number; cells: string[] }[] {
  const input = text.replace(/\r\n?/g, "\n");
  const rows: { line: number; cells: string[] }[] = [];
  let cells: string[] = [];
  let cell = "";
  let inQuotes = false;
  let line = 1;
  let rowStartLine = 1;
  let cellStarted = false;

  const pushCell = () => {
    cells.push(cell);
    cell = "";
    cellStarted = false;
  };
  const pushRow = () => {
    pushCell();
    if (cells.some((c) => c.trim() !== "")) rows.push({ line: rowStartLine, cells });
    cells = [];
  };

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === "\n") line++;
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && !cellStarted && cell === "") {
      inQuotes = true;
      cellStarted = true;
    } else if (ch === delimiter) {
      pushCell();
    } else if (ch === "\n") {
      pushRow();
      line++;
      rowStartLine = line;
    } else {
      cell += ch;
      cellStarted = true;
    }
  }
  pushRow();
  return rows;
}

/** Posição de cada coluna (-1 = a planilha não tem essa coluna). */
export interface ColumnMap {
  op: number;
  quantity: number;
  item_unit: number;
  item_code: number;
  description: number;
  material_code: number;
  material_qty: number;
  material_unit: number;
  material: number;
  line_code: number;
}

export const DEFAULT_COLUMNS: ColumnMap = {
  op: 0, quantity: 1, item_unit: -1, item_code: 2, description: 3,
  material_code: 4, material_qty: 5, material_unit: 6, material: 7, line_code: -1,
};

function norm(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase().replace(/[.:]/g, " ").replace(/\s+/g, " ");
}

/** Se a linha for um cabeçalho de planilha (OP, Qtde, Código...), devolve o mapa de colunas. */
export function detectHeader(cells: string[]): ColumnMap | null {
  const n = cells.map(norm);
  const idxAll = (re: RegExp) => n.flatMap((c, i) => (re.test(c) ? [i] : []));
  const op = n.indexOf("op");
  const qtde = idxAll(/^(qtde|quant\.?|quantidade)$/);
  const itemCode = n.findIndex((c) => c === "codigo");
  if (op < 0 || qtde.length === 0 || itemCode < 0) return null;
  const units = idxAll(/^(und|un|unid|unidade)$/);
  let itemUnit = -1;
  let materialUnit = -1;
  if (units.length >= 2) {
    itemUnit = units[0];
    materialUnit = units[1];
  } else if (units.length === 1) {
    if (units[0] < itemCode) itemUnit = units[0];
    else materialUnit = units[0];
  }
  const explicitLineCode = n.findIndex((c) => ["linha", "cod linha", "codigo linha", "codigo da linha", "linha erp", "cod linha erp", "codigo linha erp"].includes(c));
  const fabrication = n.indexOf("fabricacao");
  // Algumas exportações do ERP deixam sem título a coluna do código (310),
  // posicionada imediatamente antes de "Fabricação" (ROD. GEKA).
  const inferredLineCode = fabrication > 0 && n[fabrication - 1] === "" ? fabrication - 1 : -1;
  return {
    op,
    quantity: qtde[0],
    item_unit: itemUnit,
    item_code: itemCode,
    description: n.findIndex((c) => c === "descricao"),
    material_code: n.findIndex((c) => c === "codigo mp"),
    material_qty: qtde[1] ?? -1,
    material_unit: materialUnit,
    material: n.findIndex((c) => /^descricao (materia prima|mp)/.test(c)),
    line_code: explicitLineCode >= 0 ? explicitLineCode : inferredLineCode,
  };
}

export interface ParsedRow extends PasteFields {
  /** número da linha no texto colado (para mensagens) */
  line: number;
  quantity: number | null;
  material_qty: number | null;
  /** código de linha do ERP vindo da coluna "Linha" (nulo se não veio ou era #N/A) */
  erp_line_code: number | null;
  errors: string[];
  warnings: string[];
}

export interface ParseResult {
  rows: ParsedRow[];
  noTabFound: boolean;
  /** cabeçalho reconhecido na colagem (colunas localizadas pelo nome) */
  headerFound: boolean;
  /** linhas acima do cabeçalho que foram ignoradas (ex.: linha do equipamento) */
  ignoredAboveHeader: number;
}

export function parsePaste(text: string): ParseResult {
  const raw = splitTsv(text);
  // Procura um cabeçalho nas primeiras linhas; o que vier antes dele é ignorado.
  let map = DEFAULT_COLUMNS;
  let start = 0;
  let headerFound = false;
  for (let i = 0; i < Math.min(raw.length, 8); i++) {
    const h = detectHeader(raw[i].cells);
    if (h) {
      map = h;
      start = i + 1;
      headerFound = true;
      break;
    }
  }
  const at = (cells: string[], i: number) => (i >= 0 ? clean(cells[i]) : "");
  const rows: ParsedRow[] = raw.slice(start).map(({ line, cells }) => {
    const fields: PasteFields = {
      op_number: at(cells, map.op),
      quantity_text: at(cells, map.quantity),
      item_code: at(cells, map.item_code),
      description: at(cells, map.description),
      material_code: at(cells, map.material_code),
      material_qty_text: at(cells, map.material_qty),
      material_unit: at(cells, map.material_unit),
      material: at(cells, map.material),
      item_unit: at(cells, map.item_unit),
      line_code_text: at(cells, map.line_code),
    };
    const v = validateFields(fields);
    const warnings = [...v.warnings];
    let erp: number | null = null;
    if (fields.line_code_text !== "") {
      if (/^\d+$/.test(fields.line_code_text)) erp = Number(fields.line_code_text);
      else warnings.push(`Código de linha "${fields.line_code_text}" ignorado.`);
    }
    if (!headerFound && cells.length > PASTE_COLUMNS.length && cells.slice(PASTE_COLUMNS.length).some((c) => c.trim() !== "")) {
      warnings.push("Há colunas além das 8 esperadas; elas foram ignoradas. Cole também a linha de cabeçalho para o sistema localizar as colunas.");
    }
    return { ...fields, line, quantity: v.quantity, material_qty: v.material_qty, erp_line_code: erp, errors: v.errors, warnings };
  });
  const noTabFound = rows.length > 0 && !text.includes("\t");
  return { rows, noTabFound, headerFound, ignoredAboveHeader: start > 0 ? start - 1 : 0 };
}

/** Marca linhas repetidas DENTRO da própria colagem (a primeira vale, as outras são repetidas). */
export function findRepeatedInPaste(rows: Pick<PasteFields, "op_number" | "item_code" | "material_code">[]): Set<number> {
  const seen = new Set<string>();
  const repeated = new Set<number>();
  rows.forEach((r, idx) => {
    const key = itemKey(r.op_number, r.item_code, r.material_code);
    if (seen.has(key)) repeated.add(idx);
    else seen.add(key);
  });
  return repeated;
}

// ---------------------------------------------------------------------------
// Catálogo item -> linha (colunas da aba MAQUINA: Cód. Linha | Linha | Item | Descrição)
// ---------------------------------------------------------------------------

export interface CatalogRow {
  line: number;
  erp_line_code: number;
  item_code: string;
  description: string;
}

export interface CatalogParse {
  rows: CatalogRow[];
  errors: { line: number; message: string }[];
  headerSkipped: boolean;
}

function detectDelimiter(text: string): string {
  if (text.includes("\t")) return "\t";
  const first = text.split(/\r?\n/, 1)[0] ?? "";
  return first.includes(";") ? ";" : ",";
}

export function parseCatalog(text: string): CatalogParse {
  const raw = splitTsv(text, detectDelimiter(text));
  const rows: CatalogRow[] = [];
  const errors: { line: number; message: string }[] = [];
  let headerSkipped = false;
  raw.forEach(({ line, cells }, idx) => {
    const codeText = (cells[0] ?? "").trim();
    // Cabeçalho (ex.: "Cód. Linha") só é aceito na primeira linha e é avisado ao usuário
    if (idx === 0 && !/^\d+$/.test(codeText) && /c[oó]d/i.test(codeText)) {
      headerSkipped = true;
      return;
    }
    const item = (cells[2] ?? "").trim();
    if (!/^\d+$/.test(codeText)) {
      errors.push({ line, message: `Código de linha inválido: "${codeText}".` });
      return;
    }
    if (item === "") {
      errors.push({ line, message: "Código do item vazio." });
      return;
    }
    if (item.length > 80) {
      errors.push({ line, message: "Código do item muito longo." });
      return;
    }
    rows.push({ line, erp_line_code: Number(codeText), item_code: item.toUpperCase(), description: clean(cells[3]).slice(0, 300) });
  });
  return { rows, errors, headerSkipped };
}
