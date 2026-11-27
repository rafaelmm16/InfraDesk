"use client";

import React, { useState } from "react";
import { X } from "lucide-react";
import type {
  Asset,
  Role,
  Ticket,
  TicketCategory,
  TicketComment,
  TicketPriority,
  TicketStatus,
  User,
} from "@/lib/types";

interface CreateTicketModalProps {
  assets: Asset[];
  users: User[];
  preselectedAssetId?: string | null;
  onClose: () => void;
  onSubmit: (data: {
    title: string;
    description: string;
    category: TicketCategory;
    priority: TicketPriority;
    assetId: string | null;
    requesterName: string;
    requesterDepartment: string;
    assigneeId: string | null;
  }) => Promise<void>;
}

export function CreateTicketModal({
  assets,
  users,
  preselectedAssetId,
  onClose,
  onSubmit,
}: CreateTicketModalProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<TicketCategory>("hardware");
  const [priority, setPriority] = useState<TicketPriority>("medium");
  const [assetId, setAssetId] = useState<string>(preselectedAssetId || "");
  const [requesterName, setRequesterName] = useState("Mariana Costa");
  const [requesterDepartment, setRequesterDepartment] = useState("Financeiro & Contábil");
  const [assigneeId, setAssigneeId] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  const techs = users.filter((u) => u.role === "admin" || u.role === "technician");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await onSubmit({
        title,
        description,
        category,
        priority,
        assetId: assetId || null,
        requesterName,
        requesterDepartment,
        assigneeId: assigneeId || null,
      });
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  const inputCls =
    "w-full rounded border border-[var(--border-strong)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-xs text-[var(--ink-primary)] outline-none focus:border-[var(--ink-primary)]";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg border border-[var(--border-hairline)] bg-[var(--bg-surface)] shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-[var(--border-hairline)] px-5 py-3.5">
          <h2 className="text-sm font-semibold text-[var(--ink-primary)]">Abrir chamado</h2>
          <button
            onClick={onClose}
            className="p-1 text-[var(--ink-muted)] hover:text-[var(--ink-primary)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3.5 p-5 text-xs">
          <div>
            <label className="mb-1 block font-medium text-[var(--ink-secondary)]">Assunto *</label>
            <input
              required
              minLength={4}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex: Conta bloqueada no AD após atualização de credencial"
              className={inputCls}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block font-medium text-[var(--ink-secondary)]">Categoria</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as TicketCategory)}
                className={inputCls}
              >
                <option value="hardware">Hardware / Estação</option>
                <option value="software">Software / Aplicativos</option>
                <option value="network">Rede / Link</option>
                <option value="access_ad">Active Directory / Permissão</option>
                <option value="security">Segurança</option>
              </select>
            </div>

            <div>
              <label className="mb-1 block font-medium text-[var(--ink-secondary)]">Prioridade</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as TicketPriority)}
                className={inputCls}
              >
                <option value="critical">Crítica — SLA 2h</option>
                <option value="high">Alta — SLA 8h</option>
                <option value="medium">Média — SLA 24h</option>
                <option value="low">Baixa — SLA 48h</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block font-medium text-[var(--ink-secondary)]">
                Equipamento (opcional)
              </label>
              <select value={assetId} onChange={(e) => setAssetId(e.target.value)} className={inputCls}>
                <option value="">Não vinculado</option>
                {assets.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.hostname} ({a.assetTag})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block font-medium text-[var(--ink-secondary)]">Responsável</label>
              <select
                value={assigneeId}
                onChange={(e) => setAssigneeId(e.target.value)}
                className={inputCls}
              >
                <option value="">Triagem N1</option>
                {techs.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block font-medium text-[var(--ink-secondary)]">Solicitante *</label>
              <input
                required
                value={requesterName}
                onChange={(e) => setRequesterName(e.target.value)}
                className={inputCls}
              />
            </div>
            <div>
              <label className="mb-1 block font-medium text-[var(--ink-secondary)]">Setor *</label>
              <input
                required
                value={requesterDepartment}
                onChange={(e) => setRequesterDepartment(e.target.value)}
                className={inputCls}
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block font-medium text-[var(--ink-secondary)]">Descrição *</label>
            <textarea
              required
              minLength={8}
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Descreva o problema observado, código de erro ou horário..."
              className={inputCls}
            />
          </div>

          <div className="flex justify-end gap-2 border-t border-[var(--border-hairline)] pt-3.5">
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-[var(--border-strong)] px-3.5 py-1.5 text-xs font-medium text-[var(--ink-secondary)] hover:text-[var(--ink-primary)]"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded bg-[var(--ink-primary)] px-3.5 py-1.5 text-xs font-medium text-[var(--bg-surface)] hover:opacity-90 disabled:opacity-50"
            >
              {submitting ? "Salvando..." : "Registrar chamado"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface TicketDetailModalProps {
  ticket: Ticket;
  comments: TicketComment[];
  users: User[];
  userRole: Role;
  onClose: () => void;
  onUpdateStatus: (status: TicketStatus) => Promise<void>;
  onUpdateAssignee: (assigneeId: string | null) => Promise<void>;
  onAddComment: (body: string, internal: boolean) => Promise<void>;
}

export function TicketDetailModal({
  ticket,
  comments,
  users,
  userRole,
  onClose,
  onUpdateStatus,
  onUpdateAssignee,
  onAddComment,
}: TicketDetailModalProps) {
  const [commentBody, setCommentBody] = useState("");
  const [internalNote, setInternalNote] = useState(true);
  const [sending, setSending] = useState(false);

  const canOperate = userRole === "admin" || userRole === "technician";
  const techs = users.filter((u) => u.role === "admin" || u.role === "technician");

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commentBody.trim()) return;
    setSending(true);
    try {
      await onAddComment(commentBody.trim(), internalNote);
      setCommentBody("");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/35" onClick={onClose}>
      <aside
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full max-w-xl flex-col border-l border-[var(--border-hairline)] bg-[var(--bg-surface)] shadow-xl"
      >
        <div className="flex items-start justify-between border-b border-[var(--border-hairline)] px-5 py-4">
          <div className="pr-4">
            <div className="flex items-center gap-2 font-[family-name:var(--font-mono)] text-xs text-[var(--ink-muted)]">
              <span>{ticket.code}</span>
              {ticket.autoGenerated && (
                <span className="border border-[var(--border-hairline)] bg-[var(--bg-subtle)] px-1.5 py-0.5 text-[10px]">
                  gerado por telemetria
                </span>
              )}
            </div>
            <h2 className="mt-1 text-sm font-semibold text-[var(--ink-primary)]">{ticket.title}</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-[var(--ink-muted)] hover:text-[var(--ink-primary)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-5 text-xs">
          {/* Properties */}
          <div className="grid grid-cols-2 gap-3 border border-[var(--border-hairline)] bg-[var(--bg-subtle)] p-3">
            <div>
              <label className="mb-1 block text-[11px] text-[var(--ink-muted)]">Estágio</label>
              <select
                disabled={!canOperate}
                value={ticket.status}
                onChange={(e) => void onUpdateStatus(e.target.value as TicketStatus)}
                className="w-full rounded border border-[var(--border-strong)] bg-[var(--bg-surface)] px-2 py-1 text-xs disabled:opacity-50"
              >
                <option value="open">Aberto</option>
                <option value="in_progress">Em atendimento</option>
                <option value="waiting_user">Aguardando retorno</option>
                <option value="resolved">Resolvido</option>
                <option value="closed">Encerrado</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] text-[var(--ink-muted)]">Responsável</label>
              <select
                disabled={!canOperate}
                value={ticket.assigneeId || ""}
                onChange={(e) => void onUpdateAssignee(e.target.value || null)}
                className="w-full rounded border border-[var(--border-strong)] bg-[var(--bg-surface)] px-2 py-1 text-xs disabled:opacity-50"
              >
                <option value="">Fila N1</option>
                {techs.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <span className="text-[11px] text-[var(--ink-muted)]">Solicitante</span>
              <p className="mt-0.5 font-medium">
                {ticket.requesterName} · {ticket.requesterDepartment}
              </p>
            </div>
            <div>
              <span className="text-[11px] text-[var(--ink-muted)]">Prazo limite (SLA)</span>
              <p className="tabular mt-0.5 font-[family-name:var(--font-mono)]">
                {new Date(ticket.slaDueAt).toLocaleString("pt-BR", {
                  dateStyle: "short",
                  timeStyle: "short",
                })}
              </p>
            </div>
          </div>

          {/* Description */}
          <div>
            <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
              Relato / Evidência
            </h3>
            <p className="whitespace-pre-line border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-3 leading-relaxed text-[var(--ink-secondary)]">
              {ticket.description}
            </p>
          </div>

          {/* Comments */}
          <div>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
              Histórico de atendimento ({comments.length})
            </h3>
            {comments.length === 0 ? (
              <p className="text-[var(--ink-muted)]">Sem anotações registradas.</p>
            ) : (
              <div className="space-y-2.5 border-l border-[var(--border-strong)] pl-3">
                {comments.map((c) => (
                  <div key={c.id}>
                    <div className="flex items-center justify-between text-[11px] text-[var(--ink-muted)]">
                      <span>
                        <strong className="font-medium text-[var(--ink-primary)]">
                          {c.authorName}
                        </strong>{" "}
                        · {c.authorRole}
                        {c.internal ? " · nota interna" : ""}
                      </span>
                      <span className="font-[family-name:var(--font-mono)]">
                        {new Date(c.createdAt).toLocaleTimeString("pt-BR", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                    <p className="mt-1 text-[var(--ink-secondary)]">{c.body}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {canOperate && (
          <form
            onSubmit={handleSend}
            className="space-y-2 border-t border-[var(--border-hairline)] bg-[var(--bg-subtle)] p-4 text-xs"
          >
            <textarea
              rows={2}
              value={commentBody}
              onChange={(e) => setCommentBody(e.target.value)}
              placeholder="Adicionar apontamento técnico..."
              className="w-full rounded border border-[var(--border-strong)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-xs outline-none focus:border-[var(--ink-primary)]"
            />
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-1.5 text-[11px] text-[var(--ink-secondary)]">
                <input
                  type="checkbox"
                  checked={internalNote}
                  onChange={(e) => setInternalNote(e.target.checked)}
                />
                Visível apenas para equipe técnica
              </label>
              <button
                type="submit"
                disabled={sending || !commentBody.trim()}
                className="rounded bg-[var(--ink-primary)] px-3 py-1.5 text-xs font-medium text-[var(--bg-surface)] disabled:opacity-40"
              >
                Registrar nota
              </button>
            </div>
          </form>
        )}
      </aside>
    </div>
  );
}
