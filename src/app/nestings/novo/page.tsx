"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { NestingForm } from "@/components/NestingForm";
import { BackLink, Loading, Notice } from "@/components/ui";

function Content() {
  const { canPlan } = useAuth();
  const params = useSearchParams();
  return (
    <main className="content">
      <BackLink href="/nestings">Voltar para os nestings</BackLink>
      <div className="heading">
        <div>
          <div className="eyebrow">Chão de fábrica / Laser</div>
          <h1>Novo nesting</h1>
        </div>
      </div>
      {canPlan ? <NestingForm initialListId={params.get("lista") ?? ""} /> : <Notice kind="warning">Seu perfil não permite criar nestings.</Notice>}
    </main>
  );
}

export default function NovoNestingPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Content />
    </Suspense>
  );
}
