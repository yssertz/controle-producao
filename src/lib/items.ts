import { supabase } from "./supabase";
import { unwrap } from "./errors";
import { fetchAll } from "./fetch-all";
import { PAGE_SIZE } from "./constants";
import { itemKey } from "./excel-paste";
import type { ImportResult, ItemBalance, ItemNestingRow, ItemStatus, ResolvedLine } from "./types";

export interface ItemFilters {
  listId: string;
  lineId: string;
  status: string;
  search: string;
  showArchived: boolean;
  /** só itens de linhas que aceitam nesting (laser) */
  onlyNestable?: boolean;
  /** só itens que ainda têm quantidade a programar */
  onlyUnscheduled?: boolean;
}

/** Remove caracteres que quebrariam o filtro .or() do PostgREST. */
function sanitizeSearch(term: string): string {
  return term.replace(/[,()%*\\]/g, " ").trim();
}

export async function searchItems(filters: ItemFilters, page: number): Promise<{ rows: ItemBalance[]; total: number }> {
  let q = supabase().from("production_item_balance").select("*", { count: "exact" });
  if (filters.listId) q = q.eq("list_id", filters.listId);
  if (filters.lineId) q = q.eq("production_line_id", filters.lineId);
  if (filters.status) q = q.eq("status", filters.status);
  if (filters.onlyNestable) q = q.eq("line_allows_nesting", true);
  if (filters.onlyUnscheduled) q = q.gt("qty_unscheduled", 0);
  q = filters.showArchived ? q.not("archived_at", "is", null) : q.is("archived_at", null);
  const term = sanitizeSearch(filters.search);
  if (term) q = q.or(`op_number.ilike.%${term}%,item_code.ilike.%${term}%,description.ilike.%${term}%`);
  const from = page * PAGE_SIZE;
  const res = await q.order("created_at", { ascending: false }).range(from, from + PAGE_SIZE - 1);
  if (res.error) unwrap({ data: null, error: res.error });
  return { rows: (res.data ?? []) as ItemBalance[], total: res.count ?? 0 };
}

export async function fetchItem(id: string): Promise<ItemBalance | null> {
  return unwrap(await supabase().from("production_item_balance").select("*").eq("id", id).maybeSingle());
}

export async function fetchItemsByIds(ids: string[]): Promise<ItemBalance[]> {
  if (ids.length === 0) return [];
  const out: ItemBalance[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const res = await supabase().from("production_item_balance").select("*").in("id", ids.slice(i, i + 100));
    out.push(...((unwrap(res) ?? []) as ItemBalance[]));
  }
  return out;
}

export async function fetchItemNestings(itemId: string): Promise<ItemNestingRow[]> {
  const res = await supabase()
    .from("nesting_order_items")
    .select("id,quantity_programmed,quantity_cut,allow_excess,nestings(id,code,status,programmed_at,laser_machines(name))")
    .eq("production_order_id", itemId)
    .order("created_at", { ascending: false });
  return (unwrap(res) ?? []) as unknown as ItemNestingRow[];
}

/** Busca itens pelos pares (OP, código), usado ao importar o texto do PDF de nesting. */
export async function fetchItemsByOpCodes(pairs: { op_number: string }[]): Promise<ItemBalance[]> {
  const ops = [...new Set(pairs.map((p) => p.op_number))];
  const out: ItemBalance[] = [];
  for (let i = 0; i < ops.length; i += 100) {
    const res = await supabase()
      .from("production_item_balance")
      .select("*")
      .in("op_number", ops.slice(i, i + 100))
      .is("archived_at", null);
    out.push(...((unwrap(res) ?? []) as ItemBalance[]));
  }
  return out;
}

export interface ItemInput {
  op_number: string;
  list_id: string;
  production_line_id: string;
  item_code: string | null;
  description: string | null;
  quantity: number;
  unit: string;
  equipment_name: string | null;
  material: string | null;
  thickness_mm: number | null;
  due_date: string | null;
  status: ItemStatus;
  notes: string | null;
  material_code?: string | null;
}

export async function createItem(input: ItemInput): Promise<void> {
  unwrap(await supabase().from("production_orders").insert(input));
}

export async function updateItem(id: string, input: ItemInput): Promise<void> {
  unwrap(await supabase().from("production_orders").update(input).eq("id", id));
}

export async function setItemArchived(id: string, archived: boolean): Promise<void> {
  unwrap(
    await supabase()
      .from("production_orders")
      .update({ archived_at: archived ? new Date().toISOString() : null })
      .eq("id", id),
  );
}

/** Chaves (OP|Código|Código MP) dos itens já cadastrados na lista, para avisar duplicidade na prévia. */
export async function fetchExistingKeys(listId: string): Promise<Set<string>> {
  const rows = await fetchAll<{ op_number: string; item_code: string | null; material_code: string | null }>((from, to) =>
    supabase()
      .from("production_orders")
      .select("op_number,item_code,material_code")
      .eq("list_id", listId)
      .is("archived_at", null)
      .range(from, to),
  );
  return new Set(rows.map((r) => itemKey(r.op_number, r.item_code ?? "", r.material_code ?? "")));
}

/** Descobre a linha de cada código de item pelo catálogo (em lotes). */
export async function resolveLines(codes: string[]): Promise<Map<string, ResolvedLine>> {
  const unique = [...new Set(codes.map((c) => c.trim().toUpperCase()).filter((c) => c !== ""))];
  const map = new Map<string, ResolvedLine>();
  for (let i = 0; i < unique.length; i += 1000) {
    const res = await supabase().rpc("resolve_item_lines", { p_codes: unique.slice(i, i + 1000) });
    for (const r of (unwrap(res) ?? []) as ResolvedLine[]) map.set(r.code, r);
  }
  return map;
}

export interface ImportRow {
  row: number;
  op_number: string;
  quantity: number;
  item_code: string;
  description: string;
  material_code: string;
  material_qty: number | null;
  material_unit: string;
  material: string;
  item_unit: string;
  erp_line_code: number | null;
}

export async function importItemsErp(
  listId: string,
  rows: ImportRow[],
  defaultLineId: string | null,
  skipDuplicates: boolean,
): Promise<ImportResult> {
  const total: ImportResult = { inserted: 0, duplicates: 0, duplicate_rows: [], no_line: 0, errors: [] };
  // lotes de 1000 linhas por chamada
  for (let i = 0; i < rows.length; i += 1000) {
    const res = await supabase().rpc("import_items_erp", {
      p_list_id: listId,
      p_rows: rows.slice(i, i + 1000),
      p_default_line_id: defaultLineId,
      p_skip_duplicates: skipDuplicates,
    });
    const r = unwrap(res) as ImportResult;
    total.inserted += r.inserted;
    total.duplicates += r.duplicates;
    total.no_line += r.no_line;
    total.duplicate_rows.push(...r.duplicate_rows);
    total.errors.push(...r.errors);
  }
  return total;
}

/** Atualiza a nota fiscal de um ou mais itens (Leniors). */
export async function setItemInvoice(ids: string[], invoice: string): Promise<void> {
  unwrap(await supabase().rpc("set_item_invoice", { p_item_ids: ids, p_invoice: invoice }));
}

export async function deleteItem(id: string): Promise<void> {
  unwrap(await supabase().rpc("delete_production_order", { p_order_id: id }));
}
