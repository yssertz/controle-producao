import test from "node:test";
import assert from "node:assert/strict";
import { detectHeader, parseDecimalBR, parsePaste, parseCatalog, splitTsv, itemKey, findRepeatedInPaste, validateFields } from "./excel-paste.ts";

test("parseDecimalBR: formatos brasileiros e simples", () => {
  assert.equal(parseDecimalBR("4").value, 4);
  assert.equal(parseDecimalBR("2,5").value, 2.5);
  assert.equal(parseDecimalBR("1.234,56").value, 1234.56);
  assert.equal(parseDecimalBR("1,234.56").value, 1234.56);
  assert.equal(parseDecimalBR("0,125").value, 0.125);
  assert.equal(parseDecimalBR("0.125").value, 0.125);
  assert.equal(parseDecimalBR("2.5").value, 2.5);
});

test("parseDecimalBR: ponto de milhar é marcado como suposição", () => {
  const r = parseDecimalBR("1.500");
  assert.equal(r.value, 1500);
  assert.equal(r.thousandsGuess, true);
});

test("parseDecimalBR: inválidos", () => {
  for (const t of ["", "abc", "1,2,3", "1..2", "4 un"]) assert.equal(parseDecimalBR(t).value, null);
});

// Linha real da planilha ROLL-ON (aba DADOS): OP, Qtde, Código, Descrição, Código MP, Qtde MP, Und, Descrição MP
const REAL = "7446970\t2\t1128028\tCH. GUIA LATERAL INT.\t20100072\t3,5\tKG\tCHAPA 3/8 LNE-38";

test("parsePaste: formato do ERP (8 colunas)", () => {
  const { rows, noTabFound } = parsePaste(REAL + "\r\n\r\n7446971\t1,5\tJ0001\tPEÇA\t\t\t\t\r\n");
  assert.equal(noTabFound, false);
  assert.equal(rows.length, 2);
  const r = rows[0];
  assert.equal(r.op_number, "7446970");
  assert.equal(r.quantity, 2);
  assert.equal(r.item_code, "1128028");
  assert.equal(r.material_code, "20100072");
  assert.equal(r.material_qty, 3.5);
  assert.equal(r.material_unit, "KG");
  assert.equal(r.material, "CHAPA 3/8 LNE-38");
  assert.deepEqual(r.errors, []);
  assert.equal(rows[1].quantity, 1.5);
  assert.deepEqual(rows[1].errors, []);
});

test("parsePaste: Qtde MP aceita 4 casas (real do ERP)", () => {
  const r = parsePaste("100\t1\tA1\tD\tMP\t117.9545\tMT\tX").rows[0];
  assert.equal(r.material_qty, 117.9545);
  assert.deepEqual(r.errors, []);
});

test("parsePaste: '#N/A' do Excel conta como vazio", () => {
  const { rows } = parsePaste("100\t1\tA1\t#N/A\t#N/A\t\t\t");
  assert.equal(rows[0].description, "");
  assert.equal(rows[0].material_code, "");
  assert.deepEqual(rows[0].errors, []);
});

test("parsePaste: preserva zeros à esquerda da OP", () => {
  assert.equal(parsePaste("000123\t1\tA\tx\t\t\t\t").rows[0].op_number, "000123");
});

test("parsePaste: erros por linha", () => {
  const text = [
    "\t3\tJ1\tD\t\t\t\t",
    "100\t0\tJ2\tD\t\t\t\t",
    "101\tabc\tJ3\tD\t\t\t\t",
    "102\t5\t\tD\t\t\t\t",
    "103\t\tJ4\tD\t\t\t\t",
    "104\t1,2345\tJ5\tD\t\t\t\t",
    "105\t1\tJ6\tD\tMP\tx\tKG\t",
  ].join("\n");
  const { rows } = parsePaste(text);
  assert.match(rows[0].errors.join(" "), /OP é obrigatória/);
  assert.match(rows[1].errors.join(" "), /maior que zero/);
  assert.match(rows[2].errors.join(" "), /inválida/);
  assert.match(rows[3].errors.join(" "), /Código do item/);
  assert.match(rows[4].errors.join(" "), /Qtde é obrigatória/);
  assert.match(rows[5].errors.join(" "), /3 casas/);
  assert.match(rows[6].errors.join(" "), /Qtde MP inválida/);
});

test("parsePaste: cabeçalho colado é reconhecido e não vira linha de dados", () => {
  const r = parsePaste("OP\tQtde\tCódigo\tDescrição\tCódigo MP\tQtde MP\tUnd\tDescrição MP\n" + REAL);
  assert.equal(r.headerFound, true);
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].errors.length, 0);
});

test("parsePaste: sem TAB avisa", () => {
  const { noTabFound, rows } = parsePaste("100 1 J1 Peça");
  assert.equal(noTabFound, true);
  assert.ok(rows[0].errors.length > 0);
});

test("splitTsv: células entre aspas e delimitador ;", () => {
  const rows = splitTsv('100\t"Linha 1\nLinha 2"\t"Diâmetro 5"" "\t2');
  assert.equal(rows[0].cells[1], "Linha 1\nLinha 2");
  assert.equal(rows[0].cells[2], 'Diâmetro 5" ');
  assert.deepEqual(splitTsv("a;b;c", ";")[0].cells, ["a", "b", "c"]);
});

test("itemKey / findRepeatedInPaste: mesma OP+código com MP diferente NÃO é duplicado", () => {
  assert.equal(itemKey(" 100 ", "j1", "mp1"), itemKey("100", "J1", "MP1"));
  assert.notEqual(itemKey("100", "J1", "MP1"), itemKey("100", "J1", "MP2"));
  const rep = findRepeatedInPaste([
    { op_number: "1", item_code: "A", material_code: "M1" },
    { op_number: "1", item_code: "a", material_code: "m1" },
    { op_number: "1", item_code: "A", material_code: "M2" },
  ]);
  assert.deepEqual([...rep], [1]);
});

test("validateFields: aviso de milhar", () => {
  const v = validateFields({ op_number: "1", quantity_text: "1.500", item_code: "A", description: "", material_code: "", material_qty_text: "", material_unit: "", material: "", item_unit: "", line_code_text: "" });
  assert.equal(v.quantity, 1500);
  assert.equal(v.warnings.length, 1);
});

test("parseCatalog: colunas da aba MAQUINA, com cabeçalho e ;", () => {
  const tsv = "Cód. Linha\tLinha de Produção\tItem\tDescrição\n310\tROD.  GEKA\t1128028\tCH. GUIA\n330\tROD - LASER 6,6 KW\t j029516 \t";
  const r = parseCatalog(tsv);
  assert.equal(r.headerSkipped, true);
  assert.equal(r.rows.length, 2);
  assert.equal(r.rows[0].erp_line_code, 310);
  assert.equal(r.rows[1].item_code, "J029516");
  const csv = parseCatalog("310;GEKA;111;Peça\n330;LASER;222;Outra");
  assert.equal(csv.rows.length, 2);
  const bad = parseCatalog("abc\tX\t1\tD\n310\tX\t\tD");
  assert.equal(bad.rows.length, 0);
  assert.equal(bad.errors.length, 2);
});

// Layouts reais: Roll-On/Poli (Und só depois da Qtde MP) e Coletor/Lifter (Und logo após a Qtde)
const H_POLI = "OP\tQtde\tCódigo\tDescrição\tCódigo MP\tQtde\tUnd\tDescrição Matéria prima\tLinha\tFabricação";
const H_COLETOR = "OP\tQtde\tUnd\tCódigo\tDescrição\tQtde\tUnd\tCódigo MP\tDescrição Matéria prima\tLinha\tFabricação";

test("cabeçalho do Poli: colunas por nome + código de linha do ERP", () => {
  const txt = "1\t90450001\tPOLI POSTIÇO\t\t\t\t\t\tLASER 6K / 12K\n" + H_POLI +
    "\n7603839\t4\t30450066\tALÇA CX.\t00828-4\t0,768\tMT\tACO REDONDO\t311\tROD. GEKA/DOBRA" +
    "\n7603844\t2\t30450099\tPEÇA\t\t\t\t\t#N/A\t#N/A";
  const r = parsePaste(txt);
  assert.equal(r.headerFound, true);
  assert.equal(r.ignoredAboveHeader, 1);
  assert.equal(r.rows.length, 2);
  assert.equal(r.rows[0].erp_line_code, 311);
  assert.equal(r.rows[0].material_unit, "MT");
  assert.equal(r.rows[0].material_qty, 0.768);
  assert.equal(r.rows[1].erp_line_code, null);
  assert.deepEqual(r.rows[1].errors, []);
});

test("cabeçalho do Coletor: Und logo após Qtde NÃO vira código do item", () => {
  const txt = H_COLETOR + "\n7600531\t6\tPC\t30551029\tREF. MAIOR PROT.\t13,62\tMT\t05713-3\tFERRO CHAT 1/8\t310\tROD. GEKA";
  const r = parsePaste(txt);
  const x = r.rows[0];
  assert.equal(x.item_code, "30551029");
  assert.equal(x.item_unit, "PC");
  assert.equal(x.quantity, 6);
  assert.equal(x.material_code, "05713-3");
  assert.equal(x.material_qty, 13.62);
  assert.equal(x.material_unit, "MT");
  assert.equal(x.erp_line_code, 310);
  assert.deepEqual(x.errors, []);
});

test("cabeçalho Cód. Linha reconhece o código ERP e usa o mapeamento explícito", () => {
  const text = "OP\tQtde\tCódigo\tDescrição\tCód. Linha\tFabricação\n180.085\t2\t1128028\tCH. GUIA LATERAL INT.\t310\tROD. GEKA";
  const r = parsePaste(text);
  assert.equal(r.headerFound, true);
  assert.equal(r.rows[0].erp_line_code, 310);
});

test("exportação ERP com coluna de código sem cabeçalho antes de Fabricação", () => {
  const text = "OP\tQtde\tCódigo\tDescrição\tCódigo MP\tQtde\tUnd\tDescrição Matéria prima\t\tFabricação\n" +
    "7.604.001\t2\t30300101\tTRAVA SEGURANCA CARRINHO 21 TON.\t00693-2\t0,264\tMT\tFERRO CHAT 1/2 X 1 1/2 (6M) - MP\t310\tROD. GEKA";
  const r = parsePaste(text);
  assert.equal(r.headerFound, true);
  assert.equal(r.rows[0].op_number, "7.604.001");
  assert.equal(r.rows[0].erp_line_code, 310);
});

test("detectHeader: linha de dados não é cabeçalho", () => {
  assert.equal(detectHeader("7603839\t4\t30450066\tALÇA".split("\t")), null);
});
