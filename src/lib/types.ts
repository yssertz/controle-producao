import type { ITEM_STATUSES, LIST_STATUSES, LIST_TYPES, NESTING_STATUSES } from "./constants";

export type ListType = (typeof LIST_TYPES)[number];
export type ListStatus = (typeof LIST_STATUSES)[number];
export type ItemStatus = (typeof ITEM_STATUSES)[number] | "Fabricada";
export type NestingStatus = (typeof NESTING_STATUSES)[number];
export type Role = "admin" | "pcp" | "operador" | "leitura";

export interface UserProfile {
  id: string;
  email: string | null;
  full_name: string | null;
  role: Role;
  active: boolean;
}

export interface ProductionLine {
  id: string;
  name: string;
  sort_order: number;
  active: boolean;
  /** true = peças desta linha podem entrar em nesting (laser) */
  allows_nesting: boolean;
}

export interface LaserMachine {
  id: string;
  name: string;
  sort_order: number;
  active: boolean;
}

export interface ProductionSector {
  id: string;
  name: string;
  is_external: boolean;
  active: boolean;
  sort_order: number;
}

/** Linha da view production_list_summary */
export interface ListSummary {
  id: string;
  code: string | null;
  delivery_date: string | null;
  name: string;
  list_type: ListType;
  reference_date: string | null;
  status: ListStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
  items_count: number;
  qty_total: number;
  nestings_count: number;
}

/** Linha da view production_item_balance: o item + o saldo de corte */
export interface ItemBalance {
  id: string;
  list_id: string | null;
  list_name: string | null;
  list_code: string | null;
  list_type: ListType | null;
  list_delivery_date: string | null;
  production_line_id: string | null;
  line_name: string | null;
  line_allows_nesting: boolean | null;
  op_number: string;
  item_code: string | null;
  description: string | null;
  unit: string;
  equipment_name: string | null;
  material: string | null;
  material_code: string | null;
  material_qty: number | null;
  material_unit: string | null;
  thickness_mm: number | null;
  due_date: string | null;
  status: ItemStatus;
  notes: string | null;
  invoice_number: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  qty_total: number;
  qty_programmed: number;
  qty_cut: number;
  qty_unscheduled: number;
  qty_pending_cut: number;
  qty_excess_programmed: number;
  qty_excess_cut: number;
}

/** Linha da view nesting_summary */
export interface NestingSummary {
  id: string;
  code: string;
  /** listas dos itens do nesting (um nesting pode misturar listas) */
  list_ids: string[] | null;
  list_names: string | null;
  laser_machine_id: string | null;
  machine_name: string | null;
  material: string | null;
  material_code?: string | null;
  sheet_material_type: string | null;
  thickness_mm: number | null;
  status: NestingStatus;
  programmed_at: string | null;
  notes: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  items_count: number;
  qty_programmed: number;
  qty_cut: number;
}

/** Vínculo nesting x item (tabela nesting_order_items) com o item embutido */
export interface NestingItemRow {
  id: string;
  production_order_id: string;
  quantity_programmed: number;
  quantity_cut: number;
  allow_excess: boolean;
  notes: string | null;
  production_orders: {
    id: string;
    op_number: string;
    item_code: string | null;
    description: string | null;
    quantity: number;
    unit: string;
    production_lists: { code: string | null; name: string } | null;
  } | null;
}

/** Vínculo visto pelo lado do item: lista de nestings onde ele aparece */
export interface ItemNestingRow {
  id: string;
  quantity_programmed: number;
  quantity_cut: number;
  allow_excess: boolean;
  nestings: {
    id: string;
    code: string;
    status: NestingStatus;
    programmed_at: string | null;
    laser_machines: { name: string } | null;
  } | null;
}

export interface NestingHistoryRow {
  id: string;
  event_type: string;
  from_status: string | null;
  to_status: string | null;
  note: string | null;
  details: Record<string, unknown> | null;
  created_by: string | null;
  created_at: string;
}

export interface DashboardSummary {
  lists_total: number;
  items: {
    total: number;
    open: number;
    waiting: number;
    in_production: number;
    partial: number;
    fabricated: number;
    done: number;
    blocked: number;
    ops_open: number;
    ops_waiting: number;
  };
  nestings: {
    programmed: number;
    in_production: number;
    done_period: number;
    cancelled: number;
    pieces_programmed: number;
    pieces_cut: number;
  };
  items_by_line: { line: string; total: number; done: number }[];
  nestings_by_machine: {
    machine: string;
    programmed: number;
    in_production: number;
    done: number;
    pieces_programmed: number;
    pieces_cut: number;
  }[];
}

export interface ImportResult {
  inserted: number;
  duplicates: number;
  duplicate_rows: number[];
  /** linhas ignoradas por não terem linha de produção no catálogo */
  no_line: number;
  errors: { row: number; message: string }[];
}

export interface ErpLineCode {
  code: number;
  description: string;
  line_id: string | null;
}

export interface ResolvedLine {
  code: string;
  erp_line_code: number | null;
  line_id: string | null;
  line_name: string | null;
}
