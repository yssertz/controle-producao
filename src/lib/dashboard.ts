import { supabase } from "./supabase";
import { unwrap } from "./errors";
import type { DashboardSummary } from "./types";

export interface DashboardFilters {
  from: string;
  to: string;
  listId: string;
  lineId: string;
  itemStatus: string;
  nestingStatus: string;
  machineId: string;
}

export const EMPTY_DASHBOARD_FILTERS: DashboardFilters = {
  from: "",
  to: "",
  listId: "",
  lineId: "",
  itemStatus: "",
  nestingStatus: "",
  machineId: "",
};

export function hasActiveFilters(f: DashboardFilters): boolean {
  return Object.values(f).some((v) => v !== "");
}

export async function fetchDashboard(f: DashboardFilters): Promise<DashboardSummary> {
  const res = await supabase().rpc("dashboard_summary", {
    p_from: f.from || null,
    p_to: f.to || null,
    p_list_id: f.listId || null,
    p_line_id: f.lineId || null,
    p_item_status: f.itemStatus || null,
    p_nesting_status: f.nestingStatus || null,
    p_machine_id: f.machineId || null,
  });
  return unwrap(res) as DashboardSummary;
}
