import type { VariantResult } from '../api/types';
import { formatPercent } from '../format';

const ROW = 44;
const LABEL_WIDTH = 170;
const WIDTH = 640;
const PAD = 16;

/**
 * Each variant's conversion rate as a dot on its 95% interval. Overlapping bars are a quick
 * visual hint, not the test: the p-value in the table is. The table carries the same data for
 * assistive tech, so the chart is a labelled image.
 */
export function IntervalChart({ variants, label }: { variants: VariantResult[]; label: string }) {
  const lows = variants.map((variant) => variant.interval.low);
  const highs = variants.map((variant) => variant.interval.high);
  const min = Math.max(0, Math.min(...lows) - 0.01);
  const max = Math.min(1, Math.max(...highs) + 0.01);
  const span = max - min || 1;
  const x = (value: number) => LABEL_WIDTH + PAD + ((value - min) / span) * (WIDTH - LABEL_WIDTH - PAD * 2);
  const height = variants.length * ROW + 28;

  return (
    <svg className="interval-chart" viewBox={`0 0 ${String(WIDTH)} ${String(height)}`} role="img" aria-label={label}>
      {[min, (min + max) / 2, max].map((tick, index) => (
        <g key={tick}>
          <line x1={x(tick)} x2={x(tick)} y1={4} y2={height - 24} className="interval-chart__grid" />
          <text x={x(tick)} y={height - 6} textAnchor={index === 0 ? 'start' : index === 2 ? 'end' : 'middle'} className="interval-chart__tick">
            {formatPercent(tick)}
          </text>
        </g>
      ))}
      {variants.map((variant, index) => {
        const y = index * ROW + ROW / 2 + 4;
        return (
          <g key={variant.key} className={variant.isControl ? 'interval-chart__row' : 'interval-chart__row interval-chart__row--treatment'}>
            <text x={0} y={y + 5} className="interval-chart__label">
              {variant.label}
            </text>
            <line x1={x(variant.interval.low)} x2={x(variant.interval.high)} y1={y} y2={y} className="interval-chart__bar" />
            <circle cx={x(variant.rate)} cy={y} r={7} className="interval-chart__dot" />
          </g>
        );
      })}
    </svg>
  );
}
