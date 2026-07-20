import { formatINR } from "../lib/api";

type Slice = {
  key: string;
  label: string;
  value: number;
  color: string;
};

type Props = {
  cash: number;
  online: number;
  finance: number;
  due: number;
  periodLabel: string;
};

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: cx + r * Math.cos(rad),
    y: cy + r * Math.sin(rad),
  };
}

function describeSlice(
  cx: number,
  cy: number,
  r: number,
  startAngle: number,
  endAngle: number,
) {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return [
    `M ${cx} ${cy}`,
    `L ${start.x} ${start.y}`,
    `A ${r} ${r} 0 ${largeArc} 0 ${end.x} ${end.y}`,
    "Z",
  ].join(" ");
}

export function SalesMixPieChart({
  cash,
  online,
  finance,
  due,
  periodLabel,
}: Props) {
  const slices: Slice[] = [
    { key: "cash", label: "Cash", value: cash, color: "#0D9488" },
    { key: "online", label: "Online", value: online, color: "#143049" },
    { key: "finance", label: "Finance", value: finance, color: "#B45309" },
    { key: "due", label: "Due", value: due, color: "#EA580C" },
  ].filter((slice) => slice.value > 0);

  const total = slices.reduce((sum, slice) => sum + slice.value, 0);

  if (total <= 0) {
    return (
      <div className="glass-panel flex min-h-[220px] items-center justify-center px-5 py-10 text-center">
        <div>
          <p className="font-display text-lg font-semibold text-ink-900">
            No sales mix yet
          </p>
          <p className="mt-1 text-sm text-ink-500">
            Cash, online, finance, and dues for {periodLabel.toLowerCase()} will
            appear here.
          </p>
        </div>
      </div>
    );
  }

  const size = 220;
  const cx = size / 2;
  const cy = size / 2;
  const r = 92;
  let angle = 0;

  const arcs = slices.map((slice) => {
    const portion = (slice.value / total) * 360;
    // Full circle needs a special path — single slice 100%
    const startAngle = angle;
    const endAngle = angle + portion;
    angle = endAngle;
    const percent = (slice.value / total) * 100;
    return { ...slice, startAngle, endAngle, percent };
  });

  return (
    <div className="glass-panel px-5 py-6 sm:px-6">
      <div className="mb-5">
        <h2 className="font-display text-xl font-semibold text-ink-900">
          Sales mix
        </h2>
        <p className="mt-1 text-sm text-ink-500">
          Payment split for {periodLabel.toLowerCase()} — cash, online, finance,
          and dues.
        </p>
      </div>

      <div className="flex flex-col items-center gap-8 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative shrink-0">
          <svg
            width={size}
            height={size}
            viewBox={`0 0 ${size} ${size}`}
            role="img"
            aria-label={`Sales mix pie chart for ${periodLabel}`}
          >
            {arcs.length === 1 ? (
              <circle cx={cx} cy={cy} r={r} fill={arcs[0].color} />
            ) : (
              arcs.map((arc) => (
                <path
                  key={arc.key}
                  d={describeSlice(cx, cy, r, arc.startAngle, arc.endAngle)}
                  fill={arc.color}
                />
              ))
            )}
            <circle cx={cx} cy={cy} r={52} fill="white" />
            <text
              x={cx}
              y={cy - 6}
              textAnchor="middle"
              className="fill-ink-500"
              style={{ fontSize: 11, fontFamily: '"Google Sans", sans-serif' }}
            >
              Total paid mix
            </text>
            <text
              x={cx}
              y={cy + 14}
              textAnchor="middle"
              className="fill-ink-900"
              style={{
                fontSize: 15,
                fontWeight: 600,
                fontFamily: '"Google Sans", sans-serif',
              }}
            >
              {formatINR(total)}
            </text>
          </svg>
        </div>

        <ul className="grid w-full max-w-md gap-3 sm:grid-cols-2">
          {arcs.map((arc) => (
            <li
              key={arc.key}
              className="flex items-start gap-3 rounded-2xl border border-ink-100/80 bg-white/70 px-3.5 py-3"
            >
              <span
                className="mt-1 h-3 w-3 shrink-0 rounded-full"
                style={{ backgroundColor: arc.color }}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-sm font-medium text-ink-900">{arc.label}</p>
                  <p className="font-display text-sm font-semibold text-ink-900">
                    {arc.percent.toFixed(1)}%
                  </p>
                </div>
                <p className="mt-0.5 text-xs text-ink-500">
                  {formatINR(arc.value)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
