"use client";

import { useEffect, useState, type ReactNode } from "react";
import { X } from "lucide-react";

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}

/** Janela sobre a página. Fecha com Esc ou no X (não fecha ao clicar fora, para não perder o que foi digitado). */
export function Modal({ title, onClose, children, footer, wide }: ModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop">
      <div className={wide ? "modal wide" : "modal"} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Fechar">
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

interface ConfirmProps {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  /** Se informado, o usuário precisa digitar exatamente este texto para liberar o botão. */
  typeToConfirm?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Confirmação para ações que mudam ou escondem dados. */
export function ConfirmModal({ title, message, confirmLabel, danger, busy, typeToConfirm, onConfirm, onCancel }: ConfirmProps) {
  const [typed, setTyped] = useState("");
  const locked = typeToConfirm !== undefined && typed.trim() !== typeToConfirm;
  return (
    <Modal
      title={title}
      onClose={onCancel}
      footer={
        <>
          <button className="btn secondary" onClick={onCancel} disabled={busy}>
            Voltar
          </button>
          <button className={danger ? "btn danger" : "btn primary"} onClick={onConfirm} disabled={busy || locked}>
            {busy ? "Aguarde..." : confirmLabel}
          </button>
        </>
      }
    >
      <div style={{ fontSize: 13, lineHeight: 1.6 }}>{message}</div>
      {typeToConfirm !== undefined && (
        <div className="field" style={{ marginTop: 14 }}>
          <label htmlFor="type-confirm">
            Para confirmar, digite <strong>{typeToConfirm}</strong>
          </label>
          <input id="type-confirm" className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
        </div>
      )}
    </Modal>
  );
}

interface ReasonProps {
  title: string;
  description: ReactNode;
  label: string;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}

/** Pede um motivo escrito (cancelar / reabrir), que fica registrado no histórico. */
export function ReasonModal({ title, description, label, confirmLabel, danger, busy, onConfirm, onCancel }: ReasonProps) {
  const [reason, setReason] = useState("");
  const valid = reason.trim().length >= 3;
  return (
    <Modal
      title={title}
      onClose={onCancel}
      footer={
        <>
          <button className="btn secondary" onClick={onCancel} disabled={busy}>
            Voltar
          </button>
          <button className={danger ? "btn danger" : "btn primary"} onClick={() => onConfirm(reason.trim())} disabled={busy || !valid}>
            {busy ? "Aguarde..." : confirmLabel}
          </button>
        </>
      }
    >
      <div style={{ fontSize: 13, lineHeight: 1.6, marginBottom: 12 }}>{description}</div>
      <div className="field">
        <label>{label} *</label>
        <textarea className="input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
      </div>
    </Modal>
  );
}
