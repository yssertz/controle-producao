import test from "node:test";
import assert from "node:assert/strict";
import { opNumberVariants } from "./op-number.ts";

test("OP avulsa localiza com ou sem pontos", () => {
  assert.deepEqual(opNumberVariants("180.085"), ["180.085", "180085"]);
  assert.deepEqual(opNumberVariants("180085"), ["180085", "180.085"]);
});

test("OP de lista localiza com ou sem pontos", () => {
  assert.deepEqual(opNumberVariants("7.500.100"), ["7.500.100", "7500100"]);
  assert.deepEqual(opNumberVariants("7500100"), ["7500100", "7.500.100"]);
});

test("entrada vazia não cria chaves de busca", () => {
  assert.deepEqual(opNumberVariants("  "), []);
});
