import { supabase } from "./supabase";
import { unwrap } from "./errors";
import { fetchAll } from "./fetch-all";
import type { ItemBalance } from "./types";

export interface ProductionDelivery {
  id: string;
  list_id: string;
  op_number: string;
  delivered_by_name: string;
  delivered_at: string;
  notes: string | null;
  production_delivery_items: { production_order_id: string; quantity_delivered: number }[];
}

export interface ProductionScrapReport {
  id: string;
  production_order_id: string;
  sector_id: string;
  quantity: number;
  reason: string;
  reported_by_name: string;
  reported_at: string;
  production_sectors: { name: string } | null;
  production_orders: {
    op_number: string;
    item_code: string | null;
    description: string | null;
  } | null;
}

export async function fetchItemsByOpNumber(opNumber: string): Promise<ItemBalance[]> {
  return fetchAll<ItemBalance>((from, to) =>
    supabase()
      .from("production_item_balance")
      .select("*")
      .eq("op_number", opNumber.trim())
      .is("archived_at", null)
      .order("item_code")
      .range(from, to),
  );
}

export async function fetchProductionDelivery(listId: string, opNumber: string): Promise<ProductionDelivery | null> {
  return unwrap(
    await supabase()
      .from("production_deliveries")
      .select("id,list_id,op_number,delivered_by_name,delivered_at,notes,production_delivery_items(production_order_id,quantity_delivered)")
      .eq("list_id", listId)
      .eq("op_number", opNumber.trim())
      .maybeSingle(),
  ) as ProductionDelivery | null;
}

export async function fetchProductionScrapReports(listId: string, opNumber: string): Promise<ProductionScrapReport[]> {
  const rows = await fetchAll<Omit<ProductionScrapReport, "production_sectors" | "production_orders"> & {
    production_sectors: { name: string }[] | { name: string } | null;
    production_orders: NonNullable<ProductionScrapReport["production_orders"]>[] | NonNullable<ProductionScrapReport["production_orders"]> | null;
  }>((from, to) =>
    supabase()
      .from("production_scrap_reports")
      .select("id,production_order_id,sector_id,quantity,reason,reported_by_name,reported_at,production_sectors(name),production_orders!inner(op_number,list_id,item_code,description)")
      .eq("production_orders.list_id", listId)
      .eq("production_orders.op_number", opNumber.trim())
      .order("reported_at", { ascending: false })
      .range(from, to),
  );
  return rows.map((row) => ({
    ...row,
    production_sectors: Array.isArray(row.production_sectors) ? row.production_sectors[0] ?? null : row.production_sectors,
    production_orders: Array.isArray(row.production_orders) ? row.production_orders[0] ?? null : row.production_orders,
  }));
}

export async function recordProductionDelivery(listId: string, opNumber: string): Promise<string> {
  return unwrap(
    await supabase().rpc("record_production_delivery", { p_list_id: listId, p_op_number: opNumber.trim() }),
  ) as string;
}

export async function recordProductionScrap(input: {
  productionOrderId: string;
  sectorId: string;
  quantity: number;
  reason: string;
}): Promise<string> {
  return unwrap(
    await supabase().rpc("record_production_scrap", {
      p_production_order_id: input.productionOrderId,
      p_sector_id: input.sectorId,
      p_quantity: input.quantity,
      p_reason: input.reason.trim(),
    }),
  ) as string;
}
