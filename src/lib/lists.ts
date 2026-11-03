import { supabase } from "./supabase";
import { unwrap } from "./errors";
import { emptyToNull } from "./format";
import type { ListStatus, ListSummary, ListType } from "./types";

export interface ListInput {
  code: string;
  delivery_date: string;
  name: string;
  list_type: ListType;
  reference_date: string;
  status?: ListStatus;
  notes: string;
}

export async function fetchListSummaries(): Promise<ListSummary[]> {
  return unwrap(await supabase().from("production_list_summary").select("*").order("created_at", { ascending: false })) ?? [];
}

export async function fetchListSummary(id: string): Promise<ListSummary | null> {
  return unwrap(await supabase().from("production_list_summary").select("*").eq("id", id).maybeSingle());
}

export async function createList(input: ListInput): Promise<void> {
  unwrap(
    await supabase().from("production_lists").insert({
      code: emptyToNull(input.code),
      delivery_date: emptyToNull(input.delivery_date),
      name: input.name.trim(),
      list_type: input.list_type,
      reference_date: emptyToNull(input.reference_date),
      notes: emptyToNull(input.notes),
    }),
  );
}

export async function updateList(id: string, input: ListInput): Promise<void> {
  unwrap(
    await supabase()
      .from("production_lists")
      .update({
        code: emptyToNull(input.code),
        delivery_date: emptyToNull(input.delivery_date),
        name: input.name.trim(),
        list_type: input.list_type,
        reference_date: emptyToNull(input.reference_date),
        status: input.status,
        notes: emptyToNull(input.notes),
      })
      .eq("id", id),
  );
}

export async function setListStatus(id: string, status: ListStatus): Promise<void> {
  unwrap(await supabase().from("production_lists").update({ status }).eq("id", id));
}
