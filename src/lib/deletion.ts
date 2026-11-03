// Exclusão definitiva de listas, itens (OPs) e nestings.
// Todas as regras ficam no banco (migração 0009); aqui só chamamos as funções.
import { supabase } from "./supabase";
import { unwrap } from "./errors";
import type { NestingStatus } from "./types";

export interface BlockedItem {
  id: string;
  op_number: string;
  item_code: string | null;
  reason: string;
}

export interface ItemsDeleteInfo {
  total: number;
  deletable: number;
  blocked: BlockedItem[];
  sample: string[];
}

export interface ListDeleteInfo {
  name: string;
  code: string | null;
  items: number;
  qty_total: number;
  blocked_count: number;
  blocked_sample: { op_number: string; item_code: string | null; reason: string }[];
  legacy_nestings: number;
}

export interface NestingDeleteInfo {
  code: string;
  status: NestingStatus;
  items: number;
  cut_total: number;
  lists: string | null;
  events: number;
  /** true = nunca produziu: admin e PCP podem excluir */
  safe: boolean;
  is_admin: boolean;
}

export async function fetchItemsDeleteInfo(ids: string[]): Promise<ItemsDeleteInfo> {
  return unwrap(await supabase().rpc("delete_items_info", { p_ids: ids })) as ItemsDeleteInfo;
}

export async function deleteItems(ids: string[]): Promise<{ deleted: number; blocked: BlockedItem[] }> {
  return unwrap(await supabase().rpc("delete_items", { p_ids: ids })) as { deleted: number; blocked: BlockedItem[] };
}

export async function fetchListDeleteInfo(id: string): Promise<ListDeleteInfo> {
  return unwrap(await supabase().rpc("delete_list_info", { p_id: id })) as ListDeleteInfo;
}

export async function deleteList(id: string, withItems: boolean): Promise<{ deleted_items: number }> {
  return unwrap(await supabase().rpc("delete_list", { p_id: id, p_with_items: withItems })) as { deleted_items: number };
}

export async function fetchNestingDeleteInfo(id: string): Promise<NestingDeleteInfo> {
  return unwrap(await supabase().rpc("delete_nesting_info", { p_id: id })) as NestingDeleteInfo;
}

export async function deleteNesting(id: string, force: boolean): Promise<void> {
  unwrap(await supabase().rpc("delete_nesting", { p_id: id, p_force: force }));
}
