import test from "node:test";
import assert from "node:assert/strict";
import { guessMachineName, parseNestingText } from "./nesting-text.ts";

// Texto real (pdftotext -layout) do PDF do nesting L3318 (página 2): cabeçalho e linhas da tabela.
const L3318 = `                                      Ref. MP                                                                                        Máquina                                                                             Rep. CNC:
                                        Chapa 1/4" LNE 2900x1200                                                                           Calfran Laser Fiber - 6000 - RODOVIARIO 1                                                            x
                                      Descrição           2900       x 1200         x 6.35 x Aço Carbono                             Tempo total x 1       00:17:39.17         x1                00:17:39.17             Programador
                                      XY Mínimo           X 2887.5         Y 1197.5                                                  Aproveitamento: 83.034              % 144.956            kg Peso MP (kg) Matheus
                                      Data                                                                                           Retalho:              0             % 0                  kg 174.574                 29/10/2026
                                      CNC                 L3318                                                                      Sucata:               16.966        % 29.618             kg                         09:55:05.00
    #   Imagem       Referência            OP                                   Chapa      Total       Faltam Dimensões                        Peso       Perímetro Ataques    Tempo unitário              Equipamento
31                   J028049               7604620                              2          24          0      162         x    150             0.83       739       1          00:00:19.22                 Leniors 83
27                   corpo de prova                                             1          4           3      100         x    100             0.357      577       2          00:00:15.53                 Corpo de Prova
7                    30450070              7603872                              1          11          0      76          x    58.963          0.1        278       1          00:00:07.53                 Poli 84
29                   J007217               7604587                              30         58          0      154         x    126             0.819      549       1          00:00:14.40                 Leniors 83
Operador                                                                              Data de Corte                                                                                               Corpo de Prova`;

test("parseNestingText: cabeçalho do nesting", () => {
  const r = parseNestingText(L3318);
  assert.equal(r.code, "L3318");
  assert.equal(r.machine_text, "Calfran Laser Fiber - 6000 - RODOVIARIO");
  assert.equal(r.machine_guess, "Laser 6KW");
  assert.equal(r.date, "2026-10-29");
  assert.equal(r.material, 'Chapa 1/4" LNE 2900x1200');
});

test("parseNestingText: peças com OP; corpo de prova (sem OP) é ignorado e avisado", () => {
  const r = parseNestingText(L3318);
  assert.deepEqual(
    r.parts.map((p) => [p.op_number, p.item_code, p.quantity, p.total, p.equipment]),
    [
      ["7604620", "J028049", 2, 24, "Leniors 83"],
      ["7603872", "30450070", 1, 11, "Poli 84"],
      ["7604587", "J007217", 30, 58, "Leniors 83"],
    ],
  );
  assert.equal(r.skipped.length, 1);
  assert.match(r.skipped[0], /corpo de prova/i);
});

test("parseNestingText: texto repetido conta a peça uma vez e avisa", () => {
  const page = "L3999 x\n10   30450001   7600001   2   4   0   100 x 50   1.5   300   1   00:00:10.00   Lista 9";
  const r = parseNestingText(page + "\n" + page);
  assert.equal(r.parts.length, 1);
  assert.equal(r.warnings.length, 1);
});

test("parseNestingText: texto sem nada útil gera avisos", () => {
  const r = parseNestingText("qualquer coisa");
  assert.equal(r.code, null);
  assert.equal(r.parts.length, 0);
  assert.equal(r.warnings.length, 2);
});

test("guessMachineName", () => {
  assert.equal(guessMachineName("Calfran Laser Fiber - 12000 - RODOVIARIO"), "Laser 12KW");
  assert.equal(guessMachineName("Laser Fiber - 40000"), "Laser 40KW");
  assert.equal(guessMachineName("Linha de Bobina 2"), "Bobina");
  assert.equal(guessMachineName("Guilhotina"), null);
});
