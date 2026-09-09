import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useTheme } from "@mui/material/styles";

export interface ChartPoint {
  x: number;
  y: number;
}

export interface ChartSeries {
  id: string;
  color: string;
  dash?: string;
  points: ChartPoint[];
}

export type HandleAxis = "x" | "y";

export interface ChartHandle {
  id: string;
  x: number;
  y: number;
  color: string;
  axis: HandleAxis;
}

interface Props {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  xLabel: string;
  yLabel: string;
  series: ChartSeries[];
  handles: ChartHandle[];
  onMove: (id: string, x: number, y: number) => void;
  height?: number;
}

const PAD = { l: 48, r: 16, t: 14, b: 36 };
const HANDLE_R = 12;
/** Touch target larger than the visible circle — 28-point handles overlap. */
const HIT_R = 22;

function DragLineChart({
  xMin,
  xMax,
  yMin,
  yMax,
  xLabel,
  yLabel,
  series,
  handles,
  onMove,
  height = 240,
}: Props) {
  const theme = useTheme();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const drag = useRef<{ id: string; axis: HandleAxis } | null>(null);
  const ghostRef = useRef<{ id: string; x: number; y: number } | null>(null);
  const [ghost, setGhost] = useState<{ id: string; x: number; y: number } | null>(null);
  const [width, setWidth] = useState(640);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 1) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const xSpan = Math.max(1e-6, xMax - xMin);
  const ySpan = Math.max(1e-6, yMax - yMin);

  const toPx = useCallback(
    (x: number, y: number) => {
      const px = PAD.l + ((x - xMin) / xSpan) * (width - PAD.l - PAD.r);
      const py = PAD.t + (1 - (y - yMin) / ySpan) * (height - PAD.t - PAD.b);
      return { px, py };
    },
    [xMin, yMin, xSpan, ySpan, width, height],
  );

  const fromClient = useCallback(
    (clientX: number, clientY: number) => {
      const svg = svgRef.current;
      if (!svg) return null;
      const rect = svg.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return null;
      const vx = ((clientX - rect.left) / rect.width) * width;
      const vy = ((clientY - rect.top) / rect.height) * height;
      const x = xMin + ((vx - PAD.l) / Math.max(1, width - PAD.l - PAD.r)) * xSpan;
      const y = yMin + (1 - (vy - PAD.t) / Math.max(1, height - PAD.t - PAD.b)) * ySpan;
      return { x, y, vx, vy };
    },
    [xMin, yMin, xSpan, ySpan, width, height],
  );

  const nearestHandle = (vx: number, vy: number): ChartHandle | null => {
    let best: ChartHandle | null = null;
    let bestD = HIT_R * HIT_R;
    for (const h of handles) {
      const shown = ghost && ghost.id === h.id ? ghost : h;
      const { px, py } = toPx(shown.x, shown.y);
      const d = (px - vx) ** 2 + (py - vy) ** 2;
      if (d <= bestD) {
        best = h;
        bestD = d;
      }
    }
    return best;
  };

  const onPointerDown = (ev: ReactPointerEvent<SVGSVGElement>) => {
    const pos = fromClient(ev.clientX, ev.clientY);
    if (!pos) return;
    const handle = nearestHandle(pos.vx, pos.vy);
    if (!handle) return;
    ev.preventDefault();
    svgRef.current?.setPointerCapture(ev.pointerId);
    drag.current = { id: handle.id, axis: handle.axis };
    const next = { id: handle.id, x: handle.x, y: handle.y };
    ghostRef.current = next;
    setGhost(next);
  };

  const onPointerMove = (ev: ReactPointerEvent<SVGSVGElement>) => {
    const active = drag.current;
    if (!active) return;
    const pos = fromClient(ev.clientX, ev.clientY);
    if (!pos) return;
    const handle = handles.find((h) => h.id === active.id);
    if (!handle) return;
    const x = active.axis === "x" ? pos.x : handle.x;
    const y = active.axis === "y" ? pos.y : handle.y;
    const next = { id: active.id, x, y };
    ghostRef.current = next;
    setGhost(next);
  };

  const onPointerUp = () => {
    const active = drag.current;
    const g = ghostRef.current;
    drag.current = null;
    ghostRef.current = null;
    setGhost(null);
    if (active && g) onMove(active.id, g.x, g.y);
  };

  const gridX = 5;
  const gridY = 4;
  const axis = theme.palette.text.secondary;
  const grid = theme.palette.divider;

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height={height}
      style={{ display: "block", touchAction: "none", userSelect: "none" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {Array.from({ length: gridX + 1 }, (_, i) => {
        const x = xMin + (i / gridX) * xSpan;
        const { px } = toPx(x, yMin);
        return (
          <g key={`gx-${i}`}>
            <line x1={px} y1={PAD.t} x2={px} y2={height - PAD.b} stroke={grid} />
            <text
              x={px}
              y={height - 8}
              textAnchor="middle"
              fill={axis}
              fontSize={11}
              fontFamily="Roboto, system-ui, sans-serif"
            >
              {formatTick(x)}
            </text>
          </g>
        );
      })}
      {Array.from({ length: gridY + 1 }, (_, i) => {
        const y = yMin + (i / gridY) * ySpan;
        const { py } = toPx(xMin, y);
        return (
          <g key={`gy-${i}`}>
            <line x1={PAD.l} y1={py} x2={width - PAD.r} y2={py} stroke={grid} />
            <text
              x={PAD.l - 6}
              y={py + 4}
              textAnchor="end"
              fill={axis}
              fontSize={11}
              fontFamily="Roboto, system-ui, sans-serif"
            >
              {formatTick(y)}
            </text>
          </g>
        );
      })}
      <text
        x={width / 2}
        y={height - 2}
        textAnchor="middle"
        fill={axis}
        fontSize={12}
        fontFamily="Roboto, system-ui, sans-serif"
      >
        {xLabel}
      </text>
      <text
        x={14}
        y={height / 2}
        textAnchor="middle"
        fill={axis}
        fontSize={12}
        fontFamily="Roboto, system-ui, sans-serif"
        transform={`rotate(-90 14 ${height / 2})`}
      >
        {yLabel}
      </text>
      {series.map((s) => (
        <polyline
          key={s.id}
          fill="none"
          stroke={s.color}
          strokeWidth={2.5}
          strokeDasharray={s.dash}
          strokeLinejoin="round"
          strokeLinecap="round"
          points={s.points
            .map((p) => {
              const { px, py } = toPx(p.x, p.y);
              return `${px},${py}`;
            })
            .join(" ")}
        />
      ))}
      {handles.map((h) => {
        const shown = ghost && ghost.id === h.id ? ghost : h;
        const { px, py } = toPx(shown.x, shown.y);
        return (
          <g key={h.id}>
            <circle cx={px} cy={py} r={HIT_R} fill="transparent" pointerEvents="none" />
            <circle
              cx={px}
              cy={py}
              r={HANDLE_R}
              fill={h.color}
              stroke="#fff"
              strokeWidth={2}
              style={{ cursor: h.axis === "x" ? "ew-resize" : "ns-resize" }}
              pointerEvents="none"
            />
          </g>
        );
      })}
    </svg>
  );
}

function formatTick(n: number): string {
  if (Math.abs(n) >= 100 || Number.isInteger(n)) return String(Math.round(n));
  return n.toFixed(1);
}

export default memo(DragLineChart);
