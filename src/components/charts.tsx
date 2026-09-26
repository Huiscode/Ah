"use client";

import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatWowMoney } from "@/lib/wow-money";

const formatGold = (copper: number) => formatWowMoney(copper, { compact: true });
// Hover values must stay readable at sub-silver prices: compact mode folds
// 1s00c-1s99c into "1s", so the tooltip uses full precision to the copper.
const formatHover = (copper: number) => formatWowMoney(copper);

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
            contentStyle={{ background: "rgba(18, 22, 31, 0.88)", border: "1px solid #263042", color: "#dce3ef" }}
            itemStyle={{ color: "#dce3ef" }}
            labelStyle={{ color: "#dce3ef" }}
            labelFormatter={(value) => formatClock(Number(value))}
            formatter={(value, name) => {
              const entry = series.find((s) => s.key === name);
              if (entry) return [formatHover(Number(value)), entry.name];
              if (name === "volume") return [String(value), "在售量"];
              return [formatHover(Number(value)), String(name)];
            }}
          />
          <Bar yAxisId="volume" dataKey="volume" fill="#263f5c" opacity={0.7} />
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

type CandlePoint = { label: string; open: number; close: number; high: number; low: number; volume: number };

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
  if (!payload || height <= 0) return <g />;
  const { open, close, high, low } = payload;
  const range = high - low || 1;
  // Recharts always passes the bar's x/y/width/height span to the shape; the
  // high-low wick runs the full height, the body sits between open/close.
  const pixelFor = (value: number) => y + ((high - value) / range) * height;
  const rising = close >= open;
  const color = rising ? "#39d98a" : "#ff5c7a";
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

export function CandlestickChart({ data }: { data: CandlePoint[] }) {
  const withRange = data.map((point) => ({ ...point, lowHigh: [point.low, point.high] as [number, number] }));
  return (
    <ResponsiveContainer width="100%" height={300}>
      <ComposedChart data={withRange} margin={{ top: 18, right: 20, bottom: 8, left: 8 }}>
        <CartesianGrid stroke="#263042" strokeDasharray="3 3" />
        <XAxis dataKey="label" tick={{ fill: "#8d96a8", fontSize: 11 }} />
        <YAxis
          yAxisId="price"
          domain={["dataMin", "dataMax"]}
          tick={{ fill: "#8d96a8", fontSize: 11 }}
          tickFormatter={formatGold}
          width={72}
        />
        <Tooltip
          contentStyle={{ background: "rgba(18, 22, 31, 0.88)", border: "1px solid #263042", color: "#dce3ef" }}
          itemStyle={{ color: "#dce3ef" }}
          labelStyle={{ color: "#dce3ef" }}
          formatter={(value, name) => {
            if (Array.isArray(value)) return [`${formatHover(Number(value[0]))} - ${formatHover(Number(value[1]))}`, "低-高"];
            return [formatHover(Number(value)), String(name)];
          }}
        />
        <Bar yAxisId="price" dataKey="lowHigh" shape={<CandleShape />} isAnimationActive={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}