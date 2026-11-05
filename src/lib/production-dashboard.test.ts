import test from "node:test";
import assert from "node:assert/strict";
import { aggregateLaserMachines, aggregateLineProcesses, aggregateProcesses, processCategory, totalProcessProgress, type ProcessLineProgressRow } from "./production-dashboard.ts";

const row = (line: string, process: string, items: number, total: number, done: number): ProcessLineProgressRow => ({
  list_id: "list",
  list_code: "L1",
  list_name: "Lista 1",
  line_id: line,
  line_name: line,
  progress_source: "manual",
  sector_id: process,
  process_name: process,
  process_sort_order: 10,
  items,
  qty_total: total,
  qty_done: done,
  qty_delivered: 0,
});

test("agrega o mesmo processo por linha sem duplicar variantes de caixa", () => {
  const result = aggregateLineProcesses([
    row("LASER 6KW DOBRA", "Dobra", 2, 12, 6),
    row("LASER 6KW DOBRA", "DOBRA", 1, 3, 1),
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].qty_total, 15);
  assert.equal(result[0].qty_done, 7);
});

test("reúne etapas de dobra e fabricação para leitura do gargalo", () => {
  const rows = aggregateLineProcesses([
    row("LASER 6KW DOBRA", "Laser", 1, 10, 10),
    row("LASER 6KW DOBRA", "Dobra", 1, 10, 4),
    row("GUILHOTINA DOBRA", "Dobra", 2, 8, 2),
  ]);
  assert.equal(processCategory("dObRa"), "Dobra");
  assert.deepEqual(totalProcessProgress(rows, "Dobra"), { items: 3, qty_total: 18, qty_done: 6, qty_delivered: 0 });
  assert.deepEqual(totalProcessProgress(rows, "Fabricação"), { items: 1, qty_total: 10, qty_done: 10, qty_delivered: 0 });
});

test("dashboard mostra processos agregados e mantém as lasers em grupos próprios", () => {
  const rows = [
    { ...row("LASER 6KW", "Laser", 2, 20, 10), progress_source: "nesting" as const },
    row("LASER 6KW DOBRA", "Dobra", 1, 10, 5),
    row("GUILHOTINA DOBRA", "Guilhotina", 3, 15, 5),
    row("GUILHOTINA DOBRA", "Dobra", 3, 15, 0),
    { ...row("LASER 40KW", "Laser", 1, 12, 12), progress_source: "nesting" as const },
  ];
  assert.deepEqual(aggregateProcesses(rows).map((r) => [r.process_name, r.qty_total, r.qty_done]), [["DOBRA", 25, 5], ["GUILHOTINA", 15, 5]]);
  assert.deepEqual(aggregateLaserMachines(rows).map((r) => [r.machine_name, r.qty_total, r.qty_done]), [["LASER 6KW", 20, 10], ["LASER 40KW", 12, 12]]);
});
