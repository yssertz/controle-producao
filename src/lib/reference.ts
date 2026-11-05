// Dados de apoio usados em filtros e formulários: linhas, máquinas laser, setores, listas.
import { supabase } from "./supabase";
import { unwrap } from "./errors";
import type { ErpLineCode, LaserMachine, ListStatus, ListType, ProductionLine, ProductionSector } from "./types";

export async function fetchLines(onlyActive = true): Promise<ProductionLine[]> {
  let q = supabase().from("production_lines").select("id,name,sort_order,active,allows_nesting").order("sort_order");
  if (onlyActive) q = q.eq("active", true);
  return unwrap(await q) ?? [];
}

export async function fetchLaserMachines(onlyActive = true): Promise<LaserMachine[]> {
  let q = supabase().from("laser_machines").select("id,name,sort_order,active").order("sort_order");
  if (onlyActive) q = q.eq("active", true);
  return unwrap(await q) ?? [];
}

export async function fetchSectors(): Promise<ProductionSector[]> {
  return unwrap(await supabase().from("production_sectors").select("id,name,is_external,active,sort_order").order("sort_order")) ?? [];
}

export interface ListOption {
  id: string;
  code: string | null;
  name: string;
  list_type: ListType;
  status: ListStatus;
}

/** Listas para os seletores. Por padrão não traz as arquivadas. */
export async function fetchListOptions(includeArchived = false): Promise<ListOption[]> {
  let q = supabase().from("production_lists").select("id,code,name,list_type,status").order("created_at", { ascending: false });
  if (!includeArchived) q = q.neq("status", "Arquivada");
  return unwrap(await q) ?? [];
}

export async function addLine(name: string, sortOrder: number): Promise<void> {
  const normalized = name.trim().replace(/\s+/g, " ").toLocaleUpperCase("pt-BR");
  unwrap(await supabase().from("production_lines").insert({ name: normalized, sort_order: sortOrder }));
}

export async function setLineActive(id: string, active: boolean): Promise<void> {
  unwrap(await supabase().from("production_lines").update({ active }).eq("id", id));
}

export async function setLineAllowsNesting(id: string, allows: boolean): Promise<void> {
  unwrap(await supabase().from("production_lines").update({ allows_nesting: allows }).eq("id", id));
}

export async function fetchErpCodes(): Promise<ErpLineCode[]> {
  return unwrap(await supabase().from("erp_line_codes").select("code,description,line_id").order("code")) ?? [];
}
