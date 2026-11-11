import { useExperiments, useWebVitals } from '../api/hooks';
import type { Experiment, VariantResult, WebVital } from '../api/types';
import { IntervalChart } from '../components/IntervalChart';
import { TrendChart } from '../components/TrendChart';
import { cumulativeSeries } from '../experiments/series';
import { formatCount, formatPercent, formatPoints, formatPValue, formatShortDate } from '../format';

type Tone = 'info' | 'success' | 'warning' | 'neutral';

/** One plain-language sentence a product manager can act on. Data problems outrank results. */
function verdict({ results }: Experiment): { tone: Tone; text: string } {
  const { sampleRatio } = results;
  if (sampleRatio.mismatch) {
    return {
      tone: 'warning',
      text: `Sample ratio mismatch: the control got ${formatPercent(sampleRatio.observedShare)} of exposures instead of ${formatPercent(sampleRatio.expectedShare)} (p ${formatPValue(sampleRatio.pValue)}). Exposures are being lost or misassigned, so do not trust this comparison until the logging is fixed.`,
    };
  }
  if (results.status === 'COLLECTING') {
    return { tone: 'info', text: `Collecting data. Each variant needs ${String(results.minExposuresPerVariant)} exposures before the result is shown as final.` };
  }
  const treatment = results.variants.find((variant) => !variant.isControl);
  const comparison = treatment?.comparison;
  if (!treatment || !comparison?.significant) {
    return { tone: 'neutral', text: 'No significant difference from the control at the 5% level. Keep the control, or run longer for more power.' };
  }
  const direction = comparison.absoluteLift > 0 ? 'more' : 'fewer';
  const relative = comparison.relativeLift === null ? '' : `${formatPercent(Math.abs(comparison.relativeLift))} `;
  return {
    tone: comparison.absoluteLift > 0 ? 'success' : 'warning',
    text: `${treatment.label} converts ${relative}${direction} visitors than the control (p ${formatPValue(comparison.pValue)}).`,
  };
}

function LiftCell({ variant }: { variant: VariantResult }) {
  const { comparison } = variant;
  if (!comparison) return <span className="muted">Baseline</span>;
  const tone = comparison.significant ? (comparison.absoluteLift > 0 ? 'lift lift--up' : 'lift lift--down') : 'lift';
  return (
    <>
      <span className={tone}>
        {formatPoints(comparison.absoluteLift)}
        {comparison.relativeLift !== null && ` (${formatPercent(comparison.relativeLift, { signed: true })})`}
      </span>
      <span className="ci">
        95% CI {formatPoints(comparison.interval.low)} to {formatPoints(comparison.interval.high)}
      </span>
    </>
  );
}

function ResultsTable({ experiment }: { experiment: Experiment }) {
  return (
    <div className="table-wrap">
      <table className="results-table">
        <caption className="visually-hidden">Results for {experiment.key}, judged on {experiment.metric.replace('_', ' ')}</caption>
        <thead>
          <tr>
            <th scope="col">Variant</th>
            <th scope="col" className="num">
              Exposed
            </th>
            <th scope="col" className="num">
              Converted
            </th>
            <th scope="col" className="num">
              Rate (95% CI)
            </th>
            <th scope="col" className="num">
              Lift vs control
            </th>
            <th scope="col" className="num">
              p-value
            </th>
          </tr>
        </thead>
        <tbody>
          {experiment.results.variants.map((variant) => (
            <tr key={variant.key} data-testid={`variant-${variant.key}`}>
              <th scope="row">
                {variant.label}
                <span className="variant-key">
                  {variant.key}, weight {variant.weight}
                </span>
              </th>
              <td className="num" data-testid="exposures">
                {formatCount(variant.exposures)}
              </td>
              <td className="num" data-testid="conversions">
                {formatCount(variant.conversions)}
              </td>
              <td className="num">
                {formatPercent(variant.rate)}
                <span className="ci">
                  {formatPercent(variant.interval.low)} to {formatPercent(variant.interval.high)}
                </span>
              </td>
              <td className="num">
                <LiftCell variant={variant} />
              </td>
              <td className="num">{variant.comparison ? formatPValue(variant.comparison.pValue) : <span className="muted">n/a</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Charts({ experiment }: { experiment: Experiment }) {
  const { variants, daily } = experiment.results;
  const series = cumulativeSeries(
    daily,
    variants.map((variant) => variant.key),
  );
  const lines = variants.map((variant) => ({ key: variant.key, label: variant.label, isControl: variant.isControl, points: series.get(variant.key) ?? [] }));
  const days = lines[0]?.points ?? [];
  const intervalLabel = variants
    .map((variant) => `${variant.label}: ${formatPercent(variant.rate)}, 95% interval ${formatPercent(variant.interval.low)} to ${formatPercent(variant.interval.high)}`)
    .join('. ');
  const last = lines.map((line) => `${line.label} ${formatPercent(line.points.at(-1)?.rate ?? 0)}`).join(', ');

  return (
    <div className="charts">
      <div className="chart-panel">
        <h3>Conversion rate, 95% interval</h3>
        <IntervalChart variants={variants} label={`Conversion rate by variant. ${intervalLabel}.`} />
      </div>
      <div className="chart-panel">
        <h3>Cumulative conversion rate by day</h3>
        {days.length >= 2 ? (
          <>
            <TrendChart lines={lines} label={`Cumulative conversion rate over ${String(days.length)} days. Latest: ${last}.`} />
            <details className="chart-data">
              <summary>Show the daily numbers</summary>
              <div className="table-wrap">
                <table className="results-table results-table--compact">
                  <caption className="visually-hidden">Cumulative exposures and conversion rate by day</caption>
                  <thead>
                    <tr>
                      <th scope="col">Day</th>
                      {lines.map((line) => (
                        <th key={line.key} scope="col" className="num">
                          {line.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {days.map((day, index) => (
                      <tr key={day.date}>
                        <th scope="row">{formatShortDate(day.date)}</th>
                        {lines.map((line) => {
                          const point = line.points[index];
                          return (
                            <td key={line.key} className="num">
                              {point ? `${formatPercent(point.rate)} of ${formatCount(point.exposures)}` : 'n/a'}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </>
        ) : (
          <p className="hint">The trend appears once there are two days of data.</p>
        )}
      </div>
    </div>
  );
}

function ExperimentCard({ experiment }: { experiment: Experiment }) {
  const { results } = experiment;
  const summary = verdict(experiment);
  const titleId = `experiment-${experiment.key}`;
  return (
    <section className="card experiment" aria-labelledby={titleId} data-testid={`experiment-${experiment.key}`}>
      <div className="experiment__head">
        <div>
          <h2 id={titleId}>
            <code>{experiment.key}</code>
          </h2>
          <p>{experiment.description}</p>
        </div>
        <span className={`badge ${results.status === 'READY' ? 'badge--active' : 'badge--trial'}`}>
          {results.status === 'READY' ? 'Ready' : 'Collecting'}
        </span>
      </div>
      <p className={`alert alert--${summary.tone}`} data-testid="verdict">
        {summary.text}
      </p>
      <ResultsTable experiment={experiment} />
      {results.totalExposures > 0 && <Charts experiment={experiment} />}
    </section>
  );
}

const VITAL_LABELS: Record<WebVital['name'], string> = {
  LCP: 'Largest Contentful Paint',
  INP: 'Interaction to Next Paint',
  CLS: 'Cumulative Layout Shift',
  FCP: 'First Contentful Paint',
  TTFB: 'Time to First Byte',
};

const RATING_LABELS: Record<WebVital['rating'], string> = { GOOD: 'Good', NEEDS_IMPROVEMENT: 'Needs work', POOR: 'Poor' };

function formatVital({ name, p75 }: WebVital): string {
  return name === 'CLS' ? p75.toFixed(3) : `${formatCount(Math.round(p75))} ms`;
}

function WebVitalsPanel() {
  const { data } = useWebVitals();
  return (
    <section className="card" aria-labelledby="vitals-title" data-testid="web-vitals">
      <h2 id="vitals-title">Site performance</h2>
      <p className="hint">
        Core Web Vitals from real page loads on this server, at the 75th percentile (three in four visits do at least this well).
      </p>
      {data && data.length > 0 ? (
        <ul className="vitals">
          {data.map((vital) => (
            <li key={vital.name} className="vital">
              <span className="vital__name">
                <abbr title={VITAL_LABELS[vital.name]}>{vital.name}</abbr>
              </span>
              <span className="vital__value">{formatVital(vital)}</span>
              <span className={`badge badge--${vital.rating.toLowerCase().replace('_', '-')}`}>{RATING_LABELS[vital.rating]}</span>
              <span className="vital__samples">
                {formatCount(vital.samples)} {vital.samples === 1 ? 'sample' : 'samples'}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p>No samples yet. Browse a few pages and they will appear here.</p>
      )}
    </section>
  );
}

export function Experiments() {
  const { data, isPending, isError, dataUpdatedAt } = useExperiments();
  return (
    <div className="container page">
      <div className="page-head">
        <h1>Experiment results</h1>
        <p>
          Exposures count visitors who actually saw a variant. A conversion is a membership started at or after that first
          exposure. Updates every 15 seconds.
        </p>
      </div>
      {isError && (
        <p className="alert alert--error" role="alert">
          Results could not load. They will retry shortly.
        </p>
      )}
      {isPending && (
        <div aria-busy="true">
          <span className="visually-hidden">Loading results</span>
          <div className="skeleton skeleton--card" />
        </div>
      )}
      {data?.map((experiment) => <ExperimentCard key={experiment.key} experiment={experiment} />)}
      <WebVitalsPanel />
      {data && (
        <p className="hint">
          Last updated <time dateTime={new Date(dataUpdatedAt).toISOString()}>{new Date(dataUpdatedAt).toLocaleTimeString()}</time>.
        </p>
      )}
    </div>
  );
}
