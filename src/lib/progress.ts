// Acompanhamento da produção por lista e linha (planilha de percentuais).
import { supabase } from "./supabase";
import { unwrap } from "./errors";
import { fetchAll } from "./fetch-all";
import { PAGE_SIZE } from "./constants";

export interface ProgressRow {
  list_id: string;
  list_code: string | null;
  list_name: string;
  delivery_date: string | null;
  line_id: string;
  line_name: string;
  sort_order: number;
  progress_source: "nesting" | "manual";
  items: number;
  qty_total: number;
  qty_done: number;
}

export function percent(done: number, total: number): number | null {
  if (total <= 0) return null;
  return Math.min(100, (done / total) * 100);
}

export async function fetchProgress(): Promise<ProgressRow[]> {
  return fetchAll<ProgressRow>((from, to) =>
    supabase().from("list_line_progress").select("*").order("list_code").order("sort_order").range(from, to),
  );
}

export interface LineItem {
  id: string;
  op_number: string;
  item_code: string | null;
  description: string | null;
  material: string | null;
  thickness_mm: number | null;
  quantity: number;
  qty_done: number;
}

export interface ProcessOption { id: string; name: string; sort_order: number; }

export interface ItemProcessStep {
  step_id: string;
  sector_id: string;
  process_name: string;
  step_order: number;
  status: string;
  quantity_completed: number;
}

export async function fetchItemProcessSteps(
  itemId: string,
  lineId: string,
): Promise<{ progressSource: "nesting" | "manual"; steps: ItemProcessStep[] }> {
  const [stepsRes, lineRes] = await Promise.all([
    supabase().from("production_order_steps")
      .select("id,sector_id,step_order,status,quantity_completed,production_sectors!inner(name)")
      .eq("production_order_id", itemId)
      .order("step_order"),
    supabase().from("production_lines").select("progress_source").eq("id", lineId).single(),
  ]);
  if (stepsRes.error) unwrap({ data: null, error: stepsRes.error });
  if (lineRes.error) unwrap({ data: null, error: lineRes.error });
  const rows = (stepsRes.data ?? []) as unknown as {
    id: string;
    sector_id: string;
    step_order: number;
    status: string;
    quantity_completed: number;
    production_sectors: { name: string };
  }[];
  return {
    progressSource: lineRes.data?.progress_source === "nesting" ? "nesting" : "manual",
    steps: rows.map((row) => ({
      step_id: row.id,
      sector_id: row.sector_id,
      process_name: row.production_sectors.name,
      step_order: row.step_order,
      status: row.status,
      quantity_completed: Number(row.quantity_completed),
    })),
  };
}

export async function fetchLineProcesses(lineId: string): Promise<ProcessOption[]> {
  const res = await supabase().from("production_line_processes")
    .select("step_order,production_sectors!inner(id,name,sort_order)")
    .eq("production_line_id", lineId).order("step_order");
  if (res.error) unwrap({ data: null, error: res.error });
  const rows = (res.data ?? []) as unknown as { step_order: number; production_sectors: { id: string; name: string } }[];
  const byProcess = new Map<string, ProcessOption>();
  for (const row of rows) {
    const name = row.production_sectors.name.trim();
    const key = name.toLocaleLowerCase("pt-BR");
    const candidate = { id: row.production_sectors.id, name, sort_order: row.step_order };
    const current = byProcess.get(key);
    if (!current || name === name.toLocaleLowerCase("pt-BR").replace(/(?:^|\s)\S/g, (letter) => letter.toLocaleUpperCase("pt-BR"))) byProcess.set(key, candidate);
  }
  return [...byProcess.values()].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, "pt-BR"));
}

export async function fetchProcessItems(listId: string, lineId: string, sectorId: string, page: number): Promise<{ rows: (LineItem & { step_id: string })[]; total: number }> {
  const from = page * PAGE_SIZE;
  const res = await supabase().from("production_order_steps")
    .select("id,quantity_completed,production_orders!inner(id,list_id,production_line_id,op_number,item_code,description,material,thickness_mm,quantity,archived_at),production_sectors!inner(id)", { count: "exact" })
    .eq("production_orders.list_id", listId).eq("production_orders.production_line_id", lineId)
    .eq("sector_id", sectorId).is("production_orders.archived_at", null)
    .order("id").range(from, from + PAGE_SIZE - 1);
  if (res.error) unwrap({ data: null, error: res.error });
  type StepWithOrder = { id: string; quantity_completed: number; production_orders: LineItem & { list_id: string; production_line_id: string; archived_at: string | null } };
  const data = (res.data ?? []) as unknown as StepWithOrder[];
  const rows = data.map((row) => ({ ...row.production_orders, qty_done: Number(row.quantity_completed), step_id: row.id }));
  return { rows, total: res.count ?? 0 };
}

export async function setProcessStepsDone(rows: { step_id: string; quantity_completed: number }[]): Promise<number> {
  return Number(unwrap(await supabase().rpc("set_process_steps_done", { p_rows: rows })) ?? 0);
}
