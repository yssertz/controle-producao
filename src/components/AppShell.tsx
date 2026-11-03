"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Activity, ClipboardList, Database, Factory, LayoutDashboard, Loader2, LogOut, Moon, Package, Sun, Truck, Zap } from "lucide-react";
import { configured } from "@/lib/supabase";
import { useAuth } from "./AuthProvider";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/listas", label: "Listas de produção", icon: ClipboardList },
  { href: "/ops", label: "OPs e peças", icon: Package },
  { href: "/nestings", label: "Nestings / Laser", icon: Zap },
  { href: "/leniors", label: "Leniors", icon: Truck },
  { href: "/acompanhamento", label: "Acompanhamento", icon: Activity },
  { href: "/catalogo", label: "Catálogo de itens", icon: Database },
  { href: "/setores", label: "Setores e linhas", icon: Factory },
];

const ROLE_LABEL = { admin: "Administrador", pcp: "PCP", operador: "Operador", leitura: "Somente leitura" } as const;

function FullScreenMessage({ children }: { children: ReactNode }) {
  return (
    <div className="fullscreen">
      <div className="card fullscreen-card">{children}</div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { loading, session, profile, profileError, role, signOut } = useAuth();
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const isLogin = pathname === "/login";

  useEffect(() => {
    const saved = window.localStorage.getItem("cgp-theme");
    const nextTheme = saved === "dark" ? "dark" : "light";
    document.documentElement.dataset.theme = nextTheme;
    setTheme(nextTheme);
  }, []);

  function toggleTheme() {
    const nextTheme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = nextTheme;
    window.localStorage.setItem("cgp-theme", nextTheme);
    setTheme(nextTheme);
  }

  // Quem não está logado vai para a tela de login.
  useEffect(() => {
    if (configured && !loading && !session && !isLogin) router.replace("/login");
  }, [loading, session, isLogin, router]);

  if (isLogin) return <>{children}</>;

  if (!configured) {
    return (
      <FullScreenMessage>
        <h1 style={{ fontSize: 20 }}>Supabase não configurado</h1>
        <p className="subtitle">
          Copie <code>.env.example</code> para <code>.env.local</code>, preencha <code>NEXT_PUBLIC_SUPABASE_URL</code> e{" "}
          <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> e reinicie o servidor (<code>npm run dev</code>).
        </p>
      </FullScreenMessage>
    );
  }

  if (loading || !session) {
    return (
      <FullScreenMessage>
        <div className="loading-inline">
          <Loader2 className="spin" size={18} /> Carregando...
        </div>
      </FullScreenMessage>
    );
  }

  if (!profile || !profile.active) {
    return (
      <FullScreenMessage>
        <h1 style={{ fontSize: 20 }}>Acesso ainda não liberado</h1>
        <p className="subtitle">
          Você entrou como <strong>{session.user.email}</strong>, mas um administrador ainda precisa liberar seu acesso ao sistema.
        </p>
        {profileError && <div className="notice error">{profileError}</div>}
        <button className="btn secondary" onClick={() => void signOut()}>
          <LogOut size={14} /> Sair
        </button>
      </FullScreenMessage>
    );
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <Link href="/" className="brand">
          <span className="mark">CG</span> Controle de Produção
        </Link>
        <div className="nav-label">SISTEMA</div>
        <nav className="nav">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");
            return (
              <Link key={href} href={href} className={active ? "nav-link active" : "nav-link"}>
                <Icon size={16} /> <span>{label}</span>
              </Link>
            );
          })}
        </nav>
      </aside>
      <div className="main">
        <header className="topbar">
          <div>
            <strong style={{ fontSize: 14 }}>Controle Geral de Produção</strong>
            <div className="muted">PCP · Produção · Corte a Laser</div>
          </div>
          <div className="topbar-user">
            <button
              className="btn secondary small theme-toggle"
              onClick={toggleTheme}
              title={theme === "dark" ? "Ativar modo claro" : "Ativar modo escuro"}
              aria-label={theme === "dark" ? "Ativar modo claro" : "Ativar modo escuro"}
              aria-pressed={theme === "dark"}
            >
              {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
              <span>{theme === "dark" ? "Modo claro" : "Modo escuro"}</span>
            </button>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 12, fontWeight: 700 }}>{profile.full_name?.trim() || profile.email}</div>
              <div className="muted">{role ? ROLE_LABEL[role] : ""}</div>
            </div>
            <button className="btn secondary small" onClick={() => void signOut()} title="Sair do sistema">
              <LogOut size={14} /> Sair
            </button>
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}
