// Tradução dos erros do Supabase/PostgreSQL para mensagens úteis em português.

interface PgError {
  message: string;
  code?: string;
  details?: string | null;
}

/** Erro lançado pelas funções de acesso a dados. Guarda o código para a tela decidir o que fazer. */
export class DbError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = "DbError";
    this.code = code;
  }
  /** Código CG001 = soma programada passaria do necessário (precisa de confirmação explícita). */
  get isExcess(): boolean {
    return this.code === "CG001";
  }
}

export function friendlyMessage(err: PgError): string {
  const msg = err.message ?? "Erro desconhecido.";
  switch (err.code) {
    case "23505":
      if (msg.includes("nestings_code")) return "Já existe um nesting com este código.";
      if (msg.includes("production_lists_name")) return "Já existe uma lista com este nome.";
      if (msg.includes("production_lines_name")) return "Já existe uma linha com este nome.";
      return "Já existe um registro com esses dados.";
    case "23503":
      return "Este registro está vinculado a outros dados e não pode ser alterado desta forma.";
    case "23514":
      return "Algum dado informado é inválido (" + (err.details ?? msg) + ").";
    case "42501":
      return "Você não tem permissão para esta ação.";
    case "PGRST301":
      return "Sua sessão expirou. Entre novamente.";
    default:
      break;
  }
  if (msg.toLowerCase().includes("row-level security")) return "Você não tem permissão para esta ação.";
  if (msg.includes("JWT expired")) return "Sua sessão expirou. Entre novamente.";
  if (msg.includes("Failed to fetch") || msg.includes("NetworkError")) {
    return "Não foi possível conectar ao Supabase. Verifique a internet e as variáveis do .env.local.";
  }
  if (err.code === "PGRST205" || err.code === "42P01" || err.code === "PGRST202") {
    return "O banco ainda não tem as tabelas/funções necessárias. Execute as migrações SQL (veja o README). Detalhe: " + msg;
  }
  return msg;
}

/** Converte o resultado { data, error } do Supabase em dados ou em uma exceção DbError. */
export function unwrap<T>(result: { data: T | null; error: PgError | null }): T {
  if (result.error) throw new DbError(friendlyMessage(result.error), result.error.code);
  return result.data as T;
}

/** Texto de erro para mostrar ao usuário a partir de qualquer coisa capturada em um catch. */
export function errorText(e: unknown): string {
  if (e instanceof Error) return e.message;
  return "Ocorreu um erro inesperado.";
}
