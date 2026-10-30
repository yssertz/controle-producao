// Acompanhamento Leniors: etapas Corte / Dobra / Acabamento por item + nota fiscal.
import { supabase } from "./supabase";
import { unwrap } from "./errors";
import { fetchAll } from "./fetch-all";

export type StepState = "Aguardando" | "Concluída" | "Não se aplica";
export const STEP_NAMES = ["Corte", "Dobra", "Acabamento"] as const;

export interface LeniorsItem {
  id: string;
  op_number: string;
  item_code: string | null;
  description: string | null;
  quantity: number;
  invoice_number: string | null;
  steps: [StepState, StepState, StepState];
}

interface Raw {
  id: string;
  op_number: string;
  item_code: string | null;
  description: string | null;
  quantity: number;
  invoice_number: string | null;
  production_order_steps: { step_order: number; status: string }[] | null;
}

function toState(status: string | undefined): StepState {
  return status === "Concluída" || status === "Não se aplica" ? status : "Aguardando";
}

export async function fetchLeniorsItems(listId: string): Promise<LeniorsItem[]> {
  const raw = await fetchAll<Raw>((from, to) =>
    supabase()
      .from("production_orders")
      .select("id,op_number,item_code,description,quantity,invoice_number,production_order_steps(step_order,status)")
      .eq("list_id", listId)
      .is("archived_at", null)
      .order("op_number")
      .order("item_code")
      .range(from, to),
  );
  return raw.map((r) => {
    const by = new Map((r.production_order_steps ?? []).map((s) => [s.step_order, s.status]));
    return {
      id: r.id,
      op_number: r.op_number,
      item_code: r.item_code,
      description: r.description,
      quantity: r.quantity,
      invoice_number: r.invoice_number,
      steps: [toState(by.get(1)), toState(by.get(2)), toState(by.get(3))],
    };
  });
}

/** Uma OP está finalizada quando Corte, Dobra e Acabamento estão Concluída ou Não se aplica. */
export function isFinished(item: LeniorsItem): boolean {
  return item.steps.every((s) => s === "Concluída" || s === "Não se aplica");
}

export function nextState(s: StepState): StepState {
  return s === "Aguardando" ? "Concluída" : s === "Concluída" ? "Não se aplica" : "Aguardando";
}

export async function setLeniorsStep(itemId: string, step: 1 | 2 | 3, state: StepState): Promise<void> {
  unwrap(await supabase().rpc("set_leniors_step", { p_item_id: itemId, p_step: step, p_state: state }));
}
