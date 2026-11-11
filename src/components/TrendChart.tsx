import { formatPercent, formatShortDate } from '../format';
import type { TrendPoint } from '../experiments/series';

const WIDTH = 640;
const HEIGHT = 220;
const LEFT = 48;
const RIGHT = 16;
const TOP = 12;
const BOTTOM = 28;

interface Line {
  key: string;
  label: string;
  isControl: boolean;
  points: TrendPoint[];
}

/**
 * Cumulative conversion rate by day, one line per variant. Drawn as plain SVG: two lines and a
 * few ticks do not need a charting library. The data also sits in a table below for screen readers.
 */
export function TrendChart({ lines, label }: { lines: Line[]; label: string }) {
  const dates = lines[0]?.points.map((point) => point.date) ?? [];
  const max = Math.max(0.01, ...lines.flatMap((line) => line.points.map((point) => point.rate))) * 1.15;
  // Spaced by calendar date, not by row, so a quiet stretch shows as a gap in time.
  const first = Date.parse(dates[0] ?? '');
  const span = Math.max(1, Date.parse(dates.at(-1) ?? '') - first);
  const x = (date: string) => LEFT + ((Date.parse(date) - first) / span) * (WIDTH - LEFT - RIGHT);
  const y = (rate: number) => TOP + (1 - rate / max) * (HEIGHT - TOP - BOTTOM);
  const ticks = [0, max / 2, max];

  return (
    <figure className="trend">
      <figcaption className="trend__legend">
        {lines.map((line) => (
          <span key={line.key} className={line.isControl ? 'legend legend--control' : 'legend legend--treatment'}>
            {line.label}
          </span>
        ))}
      </figcaption>
      <svg className="trend__chart" viewBox={`0 0 ${String(WIDTH)} ${String(HEIGHT)}`} role="img" aria-label={label}>
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={LEFT} x2={WIDTH - RIGHT} y1={y(tick)} y2={y(tick)} className="trend__grid" />
            <text x={LEFT - 8} y={y(tick) + 4} textAnchor="end" className="trend__tick">
              {formatPercent(tick)}
            </text>
          </g>
        ))}
        {dates.length > 0 && (
          <>
            <text x={LEFT} y={HEIGHT - 6} textAnchor="start" className="trend__tick">
              {formatShortDate(dates[0] ?? '')}
            </text>
            <text x={WIDTH - RIGHT} y={HEIGHT - 6} textAnchor="end" className="trend__tick">
              {formatShortDate(dates.at(-1) ?? '')}
            </text>
          </>
        )}
        {lines.map((line) => (
          <polyline
            key={line.key}
            points={line.points.map((point) => `${String(x(point.date))},${String(y(point.rate))}`).join(' ')}
            className={line.isControl ? 'trend__line trend__line--control' : 'trend__line trend__line--treatment'}
          />
        ))}
      </svg>
    </figure>
  );
}
