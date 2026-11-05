export interface ProcessLineProgressRow {
  list_id: string;
  list_code: string | null;
  list_name: string;
  line_id: string;
  line_name: string;
  progress_source: "nesting" | "manual";
  sector_id: string;
  process_name: string;
  process_sort_order: number;
  items: number;
  qty_total: number;
  qty_done: number;
  qty_delivered: number;
}

export interface ProcessDashboardRow {
  line_name?: string;
  process_name: string;
  process_sort_order: number;
  items: number;
  qty_total: number;
  qty_done: number;
  qty_delivered: number;
}

export interface LaserDashboardRow {
  machine_name: string;
  items: number;
  qty_total: number;
  qty_done: number;
  qty_delivered: number;
}

export function processKey(name: string): string {
  return name.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
}

export function aggregateLineProcesses(rows: ProcessLineProgressRow[]): ProcessDashboardRow[] {
  const groups = new Map<string, ProcessDashboardRow>();
  for (const row of rows) {
    const key = `${row.line_id}|${processKey(row.process_name)}`;
    const current = groups.get(key) ?? {
      line_name: row.line_name,
      process_name: row.process_name,
      process_sort_order: row.process_sort_order,
      items: 0,
      qty_total: 0,
      qty_done: 0,
      qty_delivered: 0,
    };
    current.items += row.items;
    current.qty_total += Number(row.qty_total);
    current.qty_done += Number(row.qty_done);
    current.qty_delivered += Number(row.qty_delivered);
    if (row.process_sort_order < current.process_sort_order) current.process_sort_order = row.process_sort_order;
    if (row.process_name === row.process_name.toLocaleLowerCase("pt-BR").replace(/(?:^|\s)\S/g, (letter) => letter.toLocaleUpperCase("pt-BR"))) {
      current.process_name = row.process_name;
    }
    groups.set(key, current);
  }
  return [...groups.values()].sort((a, b) =>
    a.process_sort_order - b.process_sort_order ||
    (a.line_name ?? "").localeCompare(b.line_name ?? "", "pt-BR") ||
    a.process_name.localeCompare(b.process_name, "pt-BR"),
  );
}

export function processCategory(name: string): "Dobra" | "Fabricação" {
  return processKey(name) === "dobra" ? "Dobra" : "Fabricação";
}

export function totalProcessProgress(rows: ProcessDashboardRow[], category: "Dobra" | "Fabricação") {
  return rows.filter((row) => processCategory(row.process_name) === category)
    .reduce((total, row) => ({
      items: total.items + row.items,
      qty_total: total.qty_total + row.qty_total,
      qty_done: total.qty_done + row.qty_done,
      qty_delivered: total.qty_delivered + row.qty_delivered,
    }), { items: 0, qty_total: 0, qty_done: 0, qty_delivered: 0 });
}

export function aggregateProcesses(rows: ProcessLineProgressRow[]): ProcessDashboardRow[] {
  const groups = new Map<string, ProcessDashboardRow>();
  for (const row of rows) {
    const key = processKey(row.process_name);
    if (!key || key === "laser") continue;
    const current = groups.get(key) ?? {
      process_name: row.process_name.trim().toLocaleUpperCase("pt-BR"),
      process_sort_order: row.process_sort_order,
      items: 0,
      qty_total: 0,
      qty_done: 0,
      qty_delivered: 0,
    };
    current.items += row.items;
    current.qty_total += Number(row.qty_total);
    current.qty_done += Number(row.qty_done);
    current.qty_delivered += Number(row.qty_delivered);
    current.process_sort_order = Math.min(current.process_sort_order, row.process_sort_order);
    groups.set(key, current);
  }
  return [...groups.values()].sort((a, b) => a.process_sort_order - b.process_sort_order || a.process_name.localeCompare(b.process_name, "pt-BR"));
}

export function aggregateLaserMachines(rows: ProcessLineProgressRow[]): LaserDashboardRow[] {
  const groups = new Map<string, LaserDashboardRow>();
  for (const row of rows) {
    if (processKey(row.process_name) !== "laser") continue;
    const machine = row.line_name.match(/LASER\s+(6|12|40)\s*KW/i)?.[1];
    if (!machine) continue;
    const name = `LASER ${machine}KW`;
    const current = groups.get(name) ?? { machine_name: name, items: 0, qty_total: 0, qty_done: 0, qty_delivered: 0 };
    current.items += row.items;
    current.qty_total += Number(row.qty_total);
    current.qty_done += Number(row.qty_done);
    current.qty_delivered += Number(row.qty_delivered);
    groups.set(name, current);
  }
  return [...groups.values()].sort((a, b) => a.machine_name.localeCompare(b.machine_name, "pt-BR", { numeric: true }));
}
