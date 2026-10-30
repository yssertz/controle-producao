import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// IMPORTANTE: o Next.js só "enxerga" variáveis NEXT_PUBLIC_ escritas por extenso, como abaixo.
// Somente a chave pública (anon) pode ficar aqui. NUNCA use a service_role no navegador.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const configured = Boolean(url && anonKey && !url.includes("SEU-PROJETO"));

let client: SupabaseClient | null = null;

/** Retorna SEMPRE o mesmo cliente (evita várias sessões de login duplicadas). */
export function supabase(): SupabaseClient {
  if (!configured || !url || !anonKey) {
    throw new Error("Configure as variáveis do Supabase em .env.local e reinicie o servidor.");
  }
  if (!client) client = createClient(url, anonKey);
  return client;
}
