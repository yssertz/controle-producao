"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { configured, supabase } from "@/lib/supabase";
import { useAuth } from "@/components/AuthProvider";
import { Notice } from "@/components/ui";

export default function LoginPage() {
  const router = useRouter();
  const { loading, session } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Quem já está logado vai direto para o painel.
  useEffect(() => {
    if (!loading && session) router.replace("/");
  }, [loading, session, router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const { error: authError } = await supabase().auth.signInWithPassword({ email: email.trim(), password });
      if (authError) {
        setError(authError.message.toLowerCase().includes("invalid") ? "E-mail ou senha incorretos." : authError.message);
        return;
      }
      router.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível entrar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={onSubmit}>
        <div>
          <div className="eyebrow">Controle Geral de Produção</div>
          <h1 style={{ fontSize: 22 }}>Entrar no sistema</h1>
        </div>
        {!configured && (
          <Notice kind="warning">
            Supabase não configurado. Preencha o arquivo <code>.env.local</code> e reinicie o servidor.
          </Notice>
        )}
        {error && <Notice kind="error">{error}</Notice>}
        <div className="field">
          <label htmlFor="email">E-mail</label>
          <input id="email" className="input" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="senha">Senha</label>
          <input id="senha" className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <button className="btn primary" disabled={busy || !configured}>
          {busy ? (
            <>
              <Loader2 className="spin" size={14} /> Entrando...
            </>
          ) : (
            "Entrar"
          )}
        </button>
        <p className="muted" style={{ margin: 0 }}>
          Não há cadastro público. Peça a um administrador para criar e liberar seu acesso.
        </p>
      </form>
    </div>
  );
}
