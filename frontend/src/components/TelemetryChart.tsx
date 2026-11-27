"use client";

import React from "react";
import type { TelemetrySample } from "@/lib/types";

interface TelemetryChartProps {
  samples: TelemetrySample[];
}

export function TelemetryChart({ samples }: TelemetryChartProps) {
  if (samples.length === 0) {
    return (
      <div className="flex h-36 items-center justify-center border border-[var(--border-hairline)] bg-[var(--bg-subtle)] text-xs text-[var(--ink-muted)]">
        Sem leituras recentes para este host.
      </div>
    );
  }

  const width = 560;
  const height = 148;
  const padLeft = 30;
  const padRight = 10;
  const padTop = 12;
  const padBottom = 20;
  const innerW = width - padLeft - padRight;
  const innerH = height - padTop - padBottom;

  const toX = (idx: number) =>
    samples.length === 1 ? width / 2 : padLeft + (idx / (samples.length - 1)) * innerW;
  const toY = (pct: number) =>
    padTop + innerH - (Math.min(100, Math.max(0, pct)) / 100) * innerH;

  const cpuPoints = samples.map((s, idx) => `${toX(idx)},${toY(s.cpuPercent)}`).join(" ");
  const ramPoints = samples.map((s, idx) => `${toX(idx)},${toY(s.ramPercent)}`).join(" ");
  const criticalY = toY(90);

  const firstTime = new Date(samples[0].recordedAt).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const lastTime = new Date(samples[samples.length - 1].recordedAt).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="border border-[var(--border-hairline)] bg-[var(--bg-surface)] p-3">
      <div className="mb-2 flex items-center justify-between text-[11px] text-[var(--ink-secondary)]">
        <span className="font-medium uppercase tracking-wide text-[var(--ink-muted)]">
          Série Temporal ({samples.length} amostras)
        </span>
        <div className="flex items-center gap-4 font-[family-name:var(--font-mono)]">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-[2px] w-3 bg-current text-[var(--ink-primary)]" />
            CPU
          </span>
          <span className="flex items-center gap-1.5 text-[var(--ink-muted)]">
            <span className="inline-block h-[2px] w-3 border-t border-dashed border-current" />
            RAM
          </span>
          <span className="flex items-center gap-1.5 text-red-600 dark:text-red-400">
            <span className="inline-block h-[1px] w-3 bg-current" />
            90%
          </span>
        </div>
      </div>

      <svg viewBox={`0 0 ${width} ${height}`} className="h-36 w-full overflow-visible">
        {[0, 50, 100].map((grid) => {
          const y = toY(grid);
          return (
            <g key={grid}>
              <line
                x1={padLeft}
                y1={y}
                x2={width - padRight}
                y2={y}
                stroke="var(--border-hairline)"
                strokeWidth="1"
              />
              <text
                x={0}
                y={y + 3}
                fill="var(--ink-muted)"
                fontSize="9"
                fontFamily="var(--font-mono)"
              >
                {grid}%
              </text>
            </g>
          );
        })}

        <line
          x1={padLeft}
          y1={criticalY}
          x2={width - padRight}
          y2={criticalY}
          stroke="#dc2626"
          strokeDasharray="3 3"
          strokeOpacity="0.55"
          strokeWidth="1"
        />

        <polyline
          fill="none"
          stroke="var(--ink-muted)"
          strokeWidth="1.5"
          strokeDasharray="3 3"
          points={ramPoints}
        />

        <polyline
          fill="none"
          stroke="var(--ink-primary)"
          strokeWidth="1.8"
          points={cpuPoints}
        />

        {samples.map((s, idx) => (
          <circle
            key={s.id}
            cx={toX(idx)}
            cy={toY(s.cpuPercent)}
            r={s.cpuPercent >= 90 ? "3" : "2"}
            fill={s.cpuPercent >= 90 ? "#dc2626" : "var(--ink-primary)"}
          >
            <title>
              {new Date(s.recordedAt).toLocaleTimeString("pt-BR", {
                hour: "2-digit",
                minute: "2-digit",
              })}{" "}
              · CPU {s.cpuPercent}% · RAM {s.ramPercent}%
            </title>
          </circle>
        ))}

        <text
          x={padLeft}
          y={height - 3}
          fill="var(--ink-muted)"
          fontSize="9"
          fontFamily="var(--font-mono)"
        >
          {firstTime}
        </text>
        <text
          x={width - padRight}
          y={height - 3}
          textAnchor="end"
          fill="var(--ink-muted)"
          fontSize="9"
          fontFamily="var(--font-mono)"
        >
          {lastTime}
        </text>
      </svg>
    </div>
  );
}
