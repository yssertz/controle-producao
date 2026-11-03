import test from "node:test";
import assert from "node:assert/strict";
import { parseThicknessMm } from "./thickness.ts";

// Descrições REAIS de MP encontradas nas planilhas (linhas de laser) e a espessura esperada.
const CASES: [string, number | null][] = [
  ["CHAPA 1/4 SAE 1010/20 (1200 X 3000) - MP", 6.35],
  ["CHAPA 3/8 ASTM A-36 (1500 X 3070) - MP", 9.5],
  ["CHAPA 1/2 ASTM A-36 (1200 X 3000) - MP", 12.7],
  ["CHAPA 8 SAE 1010/20 (1200 X 3000) - MP", 4.17],
  ["CHAPA 5/8 ASTM A-36 (1200 X 3000) - MP", 15.88],
  ["CHAPA 1 ASTM A-36 (2440 X 6000) - MP", 25.4],
  ["CHAPA 3/16 SAE 1010/20 (1500 X 3070) - MP", 4.76],
  ["CHAPA 12 SAE 1010/20 (1500 X 3070) - MP", 2.66],
  ["CHAPA 3/16 (4,76 mm) LNE-38 (1200 X 3000) - MP", 4.76],
  ["CHAPA 5/16 ASTM A-36 (1200 X 3000) - MP", 7.94],
  ["CHAPA 3/4 ASTM A-36 (2440 X 6000) - MP", 19.05],
  ["CHAPA 10 SAE 1010/20 (1500 X 3070) - MP", 3.42],
  ["CHAPA 3/8 (9,50 mm) LNE-38 ( 1200 X 3000 )", 9.5],
  ["CHAPA 1/4 (6,35 mm) LNE-38 ( 1200 X 2900 )", 6.35],
  ["CHAPA 14 SAE 1010/20 (1500 X 3070) - MP", 1.9],
  ["CHAPA 1 1/2 ASTM A-36 (2440 X 6000) - MP", 38.1],
  ["CHAPA 2 ASTM A36 (2440 X 6000) - MP", 50.8],
  ["CHAPA 5/16 (7,94 mm) LNE-38 ( 1200 X 2500 )", 7.94],
  ["CHAPA 1 1/4 ASTM A-36 (2440 X 6000) - MP", 31.75],
  ["CHAPA 1 3/4 ASTM A36 (2440 X 6000) - MP", 44.45],
  ["CHAPA 2 1/2 ASTM A36 (2440 X 3000) - MP", 63.5],
  ["CHAPA INOX DIN 410 - 4,76mm x 1270mm x 3000mm - APERAM - MP", 4.76],
  ["CHAPA 3 1/2 ASTM A-36  (2440 X 3000) - MP", 88.9],
  ["FERRO CHAT 3/16 X 1 1/4 (6M) - MP", 4.76],
  ["CHAPA INOX 14 NORMAL-LAMINADO TIPO 304 (1240 X 3070) - MP", 1.9],
  ["CHAPA ANTIDERRAPANTE 1/8 - 1000 X 3000 (PE DE GALINHA) - MP", 3.18],
  ["CHAPA 8 SAE 1010/20 (1200 X 2585mm) - MP", 4.17], // 2585mm é largura, não espessura
  ["CHAPA INOX UNS 439 - 2,00mm x 1240mm x 3000mm - APERAM", 2],
  ["CHAPA 1/2 SAE 1045 - 1200 X 3000 - MP", 12.7],
  ["CHAPA 16 SAE 1010/20 (1500 X 3070) - MP", 1.52],
  ["CHAPA 1 1/4 USI-RAVUR 450  2550mm x 3000mm", 31.75], // 2550mm ignorado (> 100)
  ["CHAPA 1/4 COR 420, USI SAC 300 ( 1500 X 6000 )", 6.35],
  // não são chapa: sem espessura
  ["ACO REDONDO 0 1/2 X 6M - SAE1020 - MECANICO - MP", null],
  ["CANTONEIRA 3/16 X 1 1/2 X 1 1/2 (6M) - MP", null],
  ["TUBO RETANGULAR 120 X 80 X 6,35", null],
  ["", null],
];

for (const [desc, expected] of CASES) {
  test(`espessura: ${desc || "(vazio)"}`, () => {
    assert.equal(parseThicknessMm(desc), expected);
  });
}

test("espessura: nulo e indefinido", () => {
  assert.equal(parseThicknessMm(null), null);
  assert.equal(parseThicknessMm(undefined), null);
});
