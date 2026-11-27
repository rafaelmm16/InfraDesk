"use client";

import React from "react";
import { X } from "lucide-react";
import { TelemetryChart } from "./TelemetryChart";
import type { Asset, Role, TelemetrySample, Ticket } from "@/lib/types";

interface AssetDetailModalProps {
  asset: Asset;
  telemetry: TelemetrySample[];
  tickets: Ticket[];
  userRole: Role;
  busy: boolean;
  onClose: () => void;
  onSimulatePulse: (mode: "healthy" | "critical") => void;
  onOpenCreateTicketForAsset: (asset: Asset) => void;
}

export function AssetDetailModal({
  asset,
  telemetry,
  tickets,
  userRole,
  busy,
  onClose,
  onSimulatePulse,
  onOpenCreateTicketForAsset,
}: AssetDetailModalProps) {
  const canOperate = userRole === "admin" || userRole === "technician";

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/35" onClick={onClose}>
      <aside
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full max-w-xl flex-col border-l border-[var(--border-hairline)] bg-[var(--bg-surface)] shadow-xl"
      >
        {/* Drawer Header */}
        <div className="flex items-start justify-between border-b border-[var(--border-hairline)] px-5 py-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-[family-name:var(--font-mono)] text-base font-semibold text-[var(--ink-primary)]">
                {asset.hostname}
              </h2>
              <span className="border border-[var(--border-hairline)] bg-[var(--bg-subtle)] px-1.5 py-0.5 font-[family-name:var(--font-mono)] text-[11px] text-[var(--ink-secondary)]">
                {asset.assetTag}
              </span>
            </div>
            <p className="mt-1 font-[family-name:var(--font-mono)] text-[11px] text-[var(--ink-muted)]">
              {asset.adOu}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-[var(--ink-muted)] hover:text-[var(--ink-primary)]"
            aria-label="Fechar painel"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Drawer Body */}
        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          {/* Compact 4-column metric strip */}
          <div className="grid grid-cols-4 divide-x divide-[var(--border-hairline)] border border-[var(--border-hairline)] bg-[var(--bg-subtle)]">
            <div className="p-2.5">
              <div className="text-[11px] text-[var(--ink-muted)]">CPU</div>
              <div
                className={`tabular mt-0.5 font-[family-name:var(--font-mono)] text-sm font-semibold ${
                  asset.cpuPercent >= 90 ? "text-red-600 dark:text-red-400" : ""
                }`}
              >
                {asset.cpuPercent}%
              </div>
            </div>
            <div className="p-2.5">
              <div className="text-[11px] text-[var(--ink-muted)]">Memória</div>
              <div className="tabular mt-0.5 font-[family-name:var(--font-mono)] text-sm font-semibold">
                {asset.ramPercent}%
              </div>
            </div>
            <div className="p-2.5">
              <div className="text-[11px] text-[var(--ink-muted)]">Disco</div>
              <div
                className={`tabular mt-0.5 font-[family-name:var(--font-mono)] text-sm font-semibold ${
                  asset.diskPercent >= 90 ? "text-red-600 dark:text-red-400" : ""
                }`}
              >
                {asset.diskPercent}%
              </div>
            </div>
            <div className="p-2.5">
              <div className="text-[11px] text-[var(--ink-muted)]">Inatividade</div>
              <div className="tabular mt-0.5 font-[family-name:var(--font-mono)] text-sm font-semibold">
                {asset.idleMinutes}m
              </div>
            </div>
          </div>

          <TelemetryChart samples={telemetry} />

          {/* Property Table */}
          <div>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
              Dados de Inventário
            </h3>
            <dl className="divide-y divide-[var(--border-hairline)] border-y border-[var(--border-hairline)] text-xs">
              {[
                ["Usuário logado", asset.loggedUser, true],
                ["Departamento", asset.department, false],
                ["Endereço IP / MAC", `${asset.ipAddress} · ${asset.macAddress}`, true],
                ["Sistema Operacional", `${asset.osName} (${asset.osVersion})`, false],
                ["Processador", asset.cpuModel, false],
                ["Capacidade Física", `${asset.ramTotalGb} GB RAM · ${asset.diskTotalGb} GB Disco`, true],
                ["Tempo ligado (Uptime)", `${asset.uptimeHours} horas`, true],
                [
                  "Última coleta",
                  new Date(asset.lastSeenAt).toLocaleString("pt-BR", {
                    dateStyle: "short",
                    timeStyle: "medium",
                  }),
                  true,
                ],
              ].map(([label, val, mono]) => (
                <div key={String(label)} className="flex justify-between gap-4 py-2">
                  <dt className="text-[var(--ink-secondary)]">{label}</dt>
                  <dd
                    className={`truncate text-right font-medium text-[var(--ink-primary)] ${
                      mono ? "font-[family-name:var(--font-mono)] text-[11.5px]" : ""
                    }`}
                  >
                    {val}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          {/* Processes */}
          <div>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
              Processos com maior consumo
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {asset.topProcesses.map((proc) => (
                <span
                  key={proc}
                  className="border border-[var(--border-hairline)] bg-[var(--bg-subtle)] px-2 py-0.5 font-[family-name:var(--font-mono)] text-[11.5px] text-[var(--ink-primary)]"
                >
                  {proc}
                </span>
              ))}
            </div>
          </div>

          {/* Linked Tickets */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
                Chamados associados ({tickets.length})
              </h3>
              {canOperate && (
                <button
                  onClick={() => onOpenCreateTicketForAsset(asset)}
                  className="text-xs font-medium underline underline-offset-2 hover:opacity-80"
                >
                  Abrir chamado neste ativo
                </button>
              )}
            </div>
            {tickets.length === 0 ? (
              <p className="text-xs text-[var(--ink-muted)]">Nenhum registro vinculado.</p>
            ) : (
              <div className="divide-y divide-[var(--border-hairline)] border border-[var(--border-hairline)]">
                {tickets.map((t) => (
                  <div key={t.id} className="flex items-center justify-between px-3 py-2 text-xs">
                    <div className="truncate pr-3">
                      <span className="mr-2 font-[family-name:var(--font-mono)] text-[var(--ink-muted)]">
                        {t.code}
                      </span>
                      <span>{t.title}</span>
                    </div>
                    <span className="shrink-0 font-[family-name:var(--font-mono)] text-[11px] text-[var(--ink-secondary)]">
                      {t.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Drawer Footer */}
        <div className="flex items-center justify-between gap-2 border-t border-[var(--border-hairline)] bg-[var(--bg-subtle)] px-5 py-3">
          <span className="text-[11px] text-[var(--ink-muted)]">
            {canOperate ? "Teste de ingestão manual:" : "Perfil somente-leitura"}
          </span>
          <div className="flex items-center gap-2">
            <button
              disabled={!canOperate || busy}
              onClick={() => onSimulatePulse("healthy")}
              className="rounded border border-[var(--border-strong)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-medium text-[var(--ink-primary)] hover:bg-[var(--bg-subtle)] disabled:opacity-40"
            >
              Enviar leitura normal
            </button>
            <button
              disabled={!canOperate || busy}
              onClick={() => onSimulatePulse("critical")}
              className="rounded border border-red-700/40 bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-40"
            >
              Simular pico &gt;92%
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}
