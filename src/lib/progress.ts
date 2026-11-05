// Acompanhamento da produção por lista e linha (planilha de percentuais).
import { supabase } from "./supabase";
import { unwrap } from "./errors";
import { fetchAll } from "./fetch-all";
import { PAGE_SIZE } from "./constants";
import type { ProductionProcessProgress } from "./types";

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

export async function fetchProcessProgress(): Promise<ProductionProcessProgress[]> {
  return fetchAll<ProductionProcessProgress>((from, to) =>
    supabase().from("production_process_progress").select("*").order("list_code").order("sort_order").range(from, to),
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

export async function fetchLineItems(listId: string, lineId: string, page: number): Promise<{ rows: LineItem[]; total: number }> {
  const from = page * PAGE_SIZE;
  const res = await supabase()
    .from("production_orders")
    .select("id,op_number,item_code,description,material,thickness_mm,quantity,qty_done", { count: "exact" })
    .eq("list_id", listId)
    .eq("production_line_id", lineId)
    .is("archived_at", null)
    .order("op_number")
    .order("item_code")
    .range(from, from + PAGE_SIZE - 1);
  if (res.error) unwrap({ data: null, error: res.error });
  return { rows: (res.data ?? []) as LineItem[], total: res.count ?? 0 };
}

export async function setItemsDone(rows: { id: string; qty_done: number }[]): Promise<number> {
  return Number(unwrap(await supabase().rpc("set_items_done", { p_rows: rows })) ?? 0);
}
