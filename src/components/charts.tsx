"use client";

import type { CSSProperties } from "react";
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatWowMoney } from "@/lib/wow-money";

const formatGold = (copper: number) => formatWowMoney(copper, { compact: true });
// Hover values must stay readable at sub-silver prices: compact mode folds
// 1s00c-1s99c into "1s", so the tooltip uses full precision to the copper.
const formatHover = (copper: number) => formatWowMoney(copper);

// One hover panel spec for every chart: the K-line and the intraday chart
// must look identical. The candlestick panel adds whiteSpace nowrap so a
// long low-high range stretches the panel wider instead of wrapping.
const tooltipPanelStyle: CSSProperties = {
  background: "rgba(18, 22, 31, 0.9)",
  border: "1px solid #263042",
  color: "#dce3ef",
  borderRadius: 4,
  padding: "5px 9px",
  fontSize: 11,
};

type IntradayPoint = { ts: number; price?: number; alt?: number; volume?: number };

const formatClock = (ts: number) => {
  const date = new Date(ts);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
};

// Time-proportional X axis: gaps in scanning render as real gaps, so
// the trend shape is honest about when data actually exists. `series`
// defines one price line per data channel ("price" = primary/latest source,
// "alt" = the other channel), so the addon P10 and the website median can
// sit on the same chart without blending.
export function TimeSeriesChart({ data, series, height = 280 }: {
  data: IntradayPoint[];
  series: Array<{ key: "price" | "alt"; color: string; name: string }>;
  height?: number;
}) {
  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center gap-3 font-mono text-[10px] text-terminal-muted">
        {series.map((entry) => (
          <span key={entry.key} className="inline-flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: entry.color }} />
            {entry.name}
          </span>
        ))}
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: "#3f6aa8" }} />
          在售量
        </span>
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ top: 18, right: 20, bottom: 8, left: 8 }}>
          <CartesianGrid stroke="#263042" strokeDasharray="3 3" />
          <XAxis
            dataKey="ts"
            type="number"
            scale="time"
            domain={["dataMin", "dataMax"]}
            tickFormatter={formatClock}
            tick={{ fill: "#8d96a8", fontSize: 11 }}
          />
          <YAxis yAxisId="price" domain={["auto", "auto"]} tick={{ fill: "#8d96a8", fontSize: 11 }} tickFormatter={formatGold} width={72} />
          <YAxis yAxisId="volume" orientation="right" tick={{ fill: "#8d96a8", fontSize: 11 }} width={54} />
          <Tooltip
            contentStyle={tooltipPanelStyle}
            itemStyle={{ color: "#dce3ef", fontSize: 11 }}
            labelStyle={{ color: "#8d96a8", fontSize: 10 }}
            labelFormatter={(value) => formatClock(Number(value))}
            formatter={(value, name) => {
              const seriesEntry = series.find((s) => s.key === name);
              if (seriesEntry) return [formatHover(Number(value)), seriesEntry.name];
              if (name === "volume") return [String(value), "在售量"];
              return [formatHover(Number(value)), String(name)];
            }}
          />
          <Line yAxisId="volume" dataKey="volume" type="monotone" connectNulls stroke="#3f6aa8" strokeWidth={1.5} dot={false} />
          {series.map((entry) => (
            <Line
              key={entry.key}
              yAxisId="price"
              type="monotone"
              dataKey={entry.key}
              connectNulls
              dot={{ r: 2 }}
              stroke={entry.color}
              strokeWidth={2}
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// Trend of a candle is judged against the PREVIOUS day's close, not the
// intraday open/close: the first candle has no reference and always counts
// as up (red). Up = red, down = green, flat (same close) = blue.
type CandlePoint = { label: string; open: number; close: number; high: number; low: number; volume: number; trend?: "up" | "down" | "flat"; change?: number | null };

// Recharts has no candlestick primitive; each candle renders through a
// custom Bar shape spanning [low, high] with the body at [open, close].
type CandleShapeProps = {
  x?: number;
  width?: number;
  y?: number;
  height?: number;
  payload?: CandlePoint;
};

function CandleShape(props: CandleShapeProps) {
  const { x = 0, width = 0, y = 0, height = 0, payload } = props;
  if (!payload) return <g />;
  const { open, close, high, low } = payload;
  const color = payload.trend === "down" ? "#39d98a" : payload.trend === "flat" ? "#4d9fff" : "#ff5c7a";
  // Flat day (high == low, e.g. a fixed-price item): the low-high bar span is
  // 0px, so draw a doji tick across the candle instead of rendering nothing.
  if (height <= 0) {
    return <line x1={x} x2={x + width} y1={y} y2={y} stroke={color} strokeWidth={2} />;
  }
  const range = high - low || 1;
  // Recharts always passes the bar's x/y/width/height span to the shape; the
  // high-low wick runs the full height, the body sits between open/close.
  const pixelFor = (value: number) => y + ((high - value) / range) * height;
  const bodyTop = pixelFor(Math.max(open, close));
  const bodyBottom = pixelFor(Math.min(open, close));
  const centerX = x + width / 2;
  return (
    <g>
      <line x1={centerX} x2={centerX} y1={pixelFor(high)} y2={pixelFor(low)} stroke={color} strokeWidth={2} />
      <rect
        x={x + width * 0.2}
        width={Math.max(width * 0.6, 3)}
        y={bodyTop}
        height={Math.max(bodyBottom - bodyTop, 2)}
        fill={color}
        stroke={color}
        strokeWidth={1}
      />
    </g>
  );
}

// Stock-style OHLC hover: the down-candle keeps the user's 高-低 direction
// row (high value first), the up/flat candle reads 低-高; below it the panel
// adds the day's open and close — the close being the LAST scan of the day.
function CandleTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload?: CandlePoint }> }) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0].payload;
  if (!point) return null;
  const down = point.trend === "down";
  const up = point.trend === "up";
  const change = point.change ?? null;
  return (
    <div style={{ ...tooltipPanelStyle, whiteSpace: "nowrap" }}>
      <div>
        {point.label}
        {down ? " ▼" : up ? " ▲" : ""}
        {change !== null && change !== 0 ? `  ${change > 0 ? "+" : ""}${change.toFixed(1)}%` : ""}
      </div>
      <div>
        {down ? "高-低" : "低-高"}：{formatHover(down ? point.high : point.low)} - {formatHover(down ? point.low : point.high)}
      </div>
      <div>开盘 {formatHover(point.open)}　收盘 {formatHover(point.close)}</div>
    </div>
  );
}

export function CandlestickChart({ data }: { data: CandlePoint[] }) {
  const withRange = data.map((point, i) => {
    const prevClose = i > 0 ? data[i - 1].close : null;
    const trend = prevClose === null ? "up" : point.close < prevClose ? "down" : point.close > prevClose ? "up" : "flat";
    const change = prevClose !== null && prevClose > 0 ? ((point.close - prevClose) / prevClose) * 100 : null;
    return { ...point, lowHigh: [point.low, point.high] as [number, number], trend, change };
  });
  const prices = data.flatMap((p) => [p.open, p.close, p.high, p.low]);
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  // An all-flat series (fixed-price item) collapses ["dataMin","dataMax"] to a
  // single point and every candle disappears; pad the domain by 5% instead.
  const domain: [number, number] = lo === hi
    ? [lo - Math.max(1, Math.floor(lo * 0.05)), hi + Math.max(1, Math.floor(hi * 0.05))]
    : [lo, hi];
  return (
    <ResponsiveContainer width="100%" height={300}>
      <ComposedChart data={withRange} margin={{ top: 18, right: 20, bottom: 8, left: 8 }}>
        <CartesianGrid stroke="#263042" strokeDasharray="3 3" />
        <XAxis dataKey="label" tick={{ fill: "#8d96a8", fontSize: 11 }} />
        <YAxis
          yAxisId="price"
          domain={domain}
          tick={{ fill: "#8d96a8", fontSize: 11 }}
          tickFormatter={formatGold}
          width={72}
        />
        <Tooltip content={<CandleTooltip />} cursor={{ fill: "rgba(38, 63, 92, 0.15)" }} />
        <Bar yAxisId="price" dataKey="lowHigh" shape={<CandleShape />} isAnimationActive={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
