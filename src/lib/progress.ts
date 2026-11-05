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
export async function fetchLineProcesses(lineId: string): Promise<ProcessOption[]> {
  const res = await supabase().from("production_line_processes")
    .select("step_order,production_sectors!inner(id,name,sort_order)")
    .eq("production_line_id", lineId).order("step_order");
  if (res.error) unwrap({ data: null, error: res.error });
  const rows = (res.data ?? []) as unknown as { step_order: number; production_sectors: { id: string; name: string } }[];
  return rows.map((row) => ({ id: row.production_sectors.id, name: row.production_sectors.name, sort_order: row.step_order }));
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
