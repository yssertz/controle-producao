// Catálogo item -> linha de produção (vem da aba MAQUINA da planilha / do ERP).
import { supabase } from "./supabase";
import { unwrap } from "./errors";
import type { CatalogRow } from "./excel-paste";

export interface CatalogImportResult {
  processed: number;
  unknown_line_codes: number[];
}

export async function importCatalog(rows: CatalogRow[], onProgress?: (done: number, total: number) => void): Promise<CatalogImportResult> {
  const total: CatalogImportResult = { processed: 0, unknown_line_codes: [] };
  const unknown = new Set<number>();
  const CHUNK = 2000;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const part = rows.slice(i, i + CHUNK).map((r) => ({
      item_code: r.item_code,
      erp_line_code: String(r.erp_line_code),
      description: r.description,
    }));
    const res = await supabase().rpc("import_item_catalog", { p_rows: part });
    const r = unwrap(res) as CatalogImportResult;
    total.processed += r.processed;
    r.unknown_line_codes.forEach((c) => unknown.add(c));
    onProgress?.(Math.min(i + CHUNK, rows.length), rows.length);
  }
  total.unknown_line_codes = [...unknown].sort((a, b) => a - b);
  return total;
}

export async function fetchCatalogCount(): Promise<number> {
  const res = await supabase().from("item_line_catalog").select("item_code", { count: "exact", head: true });
  if (res.error) unwrap({ data: null, error: res.error });
  return res.count ?? 0;
}

export interface CatalogHit {
  item_code: string;
  erp_line_code: number | null;
  description: string | null;
}

export async function searchCatalog(term: string): Promise<CatalogHit[]> {
  const t = term.replace(/[,()%*\\]/g, " ").trim();
  if (t === "") return [];
  const res = await supabase()
    .from("item_line_catalog")
    .select("item_code,erp_line_code,description")
    .or(`item_code.ilike.${t.toUpperCase()}%,description.ilike.%${t}%`)
    .limit(30);
  return (unwrap(res) ?? []) as CatalogHit[];
}
