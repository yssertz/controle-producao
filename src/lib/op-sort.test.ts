import test from "node:test";
import assert from "node:assert/strict";
import { compareOpNumbers } from "./op-sort.ts";

test("ordena OPs como números mesmo com pontos de milhar", () => {
  assert.ok(compareOpNumbers("180.085", "7.500.200") < 0);
  assert.ok(compareOpNumbers("7.500.200", "180.085", "desc") < 0);
});

test("desempata versões da mesma OP e compara códigos não numéricos", () => {
  assert.equal(compareOpNumbers("001.020", "1.020"), 0);
  assert.ok(compareOpNumbers("OP-A", "OP-B") < 0);
});
