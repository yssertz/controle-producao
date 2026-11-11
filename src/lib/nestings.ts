import { supabase } from "./supabase";
import { unwrap } from "./errors";
import { PAGE_SIZE } from "./constants";
import type { NestingHistoryRow, NestingItemRow, NestingSummary } from "./types";

export interface NestingFilters {
  listId: string;
  machineId: string;
  status: string;
  search: string;
}

export async function searchNestings(filters: NestingFilters, page: number): Promise<{ rows: NestingSummary[]; total: number }> {
  let q = supabase().from("nesting_summary").select("*", { count: "exact" });
  if (filters.listId) q = q.contains("list_ids", [filters.listId]);
  if (filters.machineId) q = q.eq("laser_machine_id", filters.machineId);
  if (filters.status) q = q.eq("status", filters.status);
  const term = filters.search.replace(/[%*\\]/g, " ").trim();
  if (term) q = q.ilike("code", `%${term}%`);
  const from = page * PAGE_SIZE;
  const res = await q.order("created_at", { ascending: false }).range(from, from + PAGE_SIZE - 1);
  if (res.error) unwrap({ data: null, error: res.error });
  return { rows: (res.data ?? []) as NestingSummary[], total: res.count ?? 0 };
}

export async function fetchNesting(id: string): Promise<NestingSummary | null> {
  return unwrap(await supabase().from("nesting_summary").select("*").eq("id", id).maybeSingle());
}

export async function fetchNestingItems(nestingId: string): Promise<NestingItemRow[]> {
  const res = await supabase()
    .from("nesting_order_items")
    .select("id,production_order_id,op_number,equipment_name,description,material,thickness_mm,quantity_programmed,quantity_cut,allow_excess,notes,production_orders(id,op_number,item_code,description,quantity,unit,production_lists(code,name))")
    .eq("nesting_id", nestingId)
    .order("created_at");
  return (unwrap(res) ?? []) as unknown as NestingItemRow[];
}

export async function fetchNestingHistory(nestingId: string): Promise<NestingHistoryRow[]> {
  return unwrap(
    await supabase().from("nesting_history").select("*").eq("nesting_id", nestingId).order("created_at", { ascending: false }),
  ) ?? [];
}

/** id -> nome, para mostrar quem fez cada ação no histórico. */
export async function fetchProfileNames(): Promise<Map<string, string>> {
  const rows: { id: string; full_name: string | null; email: string | null }[] =
    unwrap(await supabase().from("user_profiles").select("id,full_name,email")) ?? [];
  return new Map(rows.map((r) => [r.id, r.full_name?.trim() || r.email || "Usuário"]));
}

export type NestingItemInput = {
  production_order_id: string;
  quantity_programmed: number;
  notes: string | null;
  allow_excess: boolean;
} | {
  production_order_id: null;
  op_number: string;
  equipment_name: string;
  description: string;
  material: string;
  thickness_mm: number;
  quantity_programmed: number;
  notes: null;
  allow_excess: false;
};

export interface NestingInput {
  id: string | null;
  code: string;
  laser_machine_id: string;
  material: string | null;
  sheet_material_type: string;
  thickness_mm: number | null;
  programmed_at: string | null;
  notes: string | null;
  items: NestingItemInput[];
}

/** Cria ou edita o nesting e suas OPs em uma única operação no banco. Retorna o id. */
export async function saveNesting(input: NestingInput): Promise<string> {
  const res = await supabase().rpc("save_nesting", {
    p_nesting_id: input.id,
    p_code: input.code,
    p_laser_machine_id: input.laser_machine_id,
    p_material: input.material,
    p_material_code: null,
    p_sheet_material_type: input.sheet_material_type,
    p_thickness_mm: input.thickness_mm,
    p_programmed_at: input.programmed_at,
    p_notes: input.notes,
    p_items: input.items,
  });
  return unwrap(res) as string;
}

export async function startNesting(id: string): Promise<void> {
  unwrap(await supabase().rpc("start_nesting", { p_nesting_id: id }));
}

export interface CutInput {
  nesting_item_id: string;
  quantity_cut: number;
}

export async function recordNestingCut(id: string, items: CutInput[]): Promise<void> {
  unwrap(await supabase().rpc("record_nesting_cut", { p_nesting_id: id, p_items: items }));
}

export async function completeNesting(id: string, items: CutInput[], note: string): Promise<void> {
  unwrap(await supabase().rpc("complete_nesting", { p_nesting_id: id, p_items: items, p_note: note.trim() || null }));
}

export async function cancelNesting(id: string, reason: string): Promise<void> {
  unwrap(await supabase().rpc("cancel_nesting", { p_nesting_id: id, p_reason: reason }));
}

export async function reopenNesting(id: string, reason: string): Promise<void> {
  unwrap(await supabase().rpc("reopen_nesting", { p_nesting_id: id, p_reason: reason }));
}

/** Próximo código da sequência (L0001, L0002...). */
export async function fetchNextNestingCode(): Promise<string> {
  return unwrap(await supabase().rpc("next_nesting_code")) as string;
}
