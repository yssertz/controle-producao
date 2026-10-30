"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { configured, supabase } from "@/lib/supabase";
import { friendlyMessage } from "@/lib/errors";
import type { Role, UserProfile } from "@/lib/types";

interface AuthState {
  loading: boolean;
  session: Session | null;
  profile: UserProfile | null;
  profileError: string;
  role: Role | null;
  /** admin ou pcp: cria/edita listas, itens e nestings */
  canPlan: boolean;
  /** admin, pcp ou operador: inicia, registra quantidades e conclui nestings */
  canOperate: boolean;
  isAdmin: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth precisa estar dentro de <AuthProvider>.");
  return ctx;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionChecked, setSessionChecked] = useState(!configured);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileFor, setProfileFor] = useState<string | null>(null);
  const [profileError, setProfileError] = useState("");

  // 1) Descobre se há alguém logado e acompanha entradas/saídas.
  useEffect(() => {
    if (!configured) return;
    const db = supabase();
    db.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setSessionChecked(true);
    });
    const { data } = db.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  // 2) Com o usuário conhecido, carrega o perfil (papel e se está liberado).
  const userId = session?.user.id ?? null;
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    supabase()
      .from("user_profiles")
      .select("id,email,full_name,role,active")
      .eq("id", userId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        setProfile((data as UserProfile | null) ?? null);
        setProfileError(error ? friendlyMessage(error) : "");
        setProfileFor(userId);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const loading = !sessionChecked || (userId !== null && profileFor !== userId);

  const value = useMemo<AuthState>(() => {
    const activeProfile = userId && profileFor === userId && profile?.active ? profile : null;
    const role = activeProfile?.role ?? null;
    return {
      loading,
      session,
      profile: userId && profileFor === userId ? profile : null,
      profileError,
      role,
      canPlan: role === "admin" || role === "pcp",
      canOperate: role === "admin" || role === "pcp" || role === "operador",
      isAdmin: role === "admin",
      signOut: async () => {
        await supabase().auth.signOut();
        setProfile(null);
        setProfileFor(null);
      },
    };
  }, [loading, session, profile, profileFor, profileError, userId]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
