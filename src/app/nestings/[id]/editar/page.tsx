"use client";

import { useParams } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { NestingForm } from "@/components/NestingForm";
import { BackLink, Notice } from "@/components/ui";

export default function EditarNestingPage() {
  const { id } = useParams<{ id: string }>();
  const { canPlan } = useAuth();
  return (
    <main className="content">
      <BackLink href={`/nestings/${id}`}>Voltar para o nesting</BackLink>
      <div className="heading">
        <div>
          <div className="eyebrow">Chão de fábrica / Laser</div>
          <h1>Editar nesting</h1>
        </div>
      </div>
      {canPlan ? <NestingForm nestingId={id} /> : <Notice kind="warning">Seu perfil não permite editar nestings.</Notice>}
    </main>
  );
}
