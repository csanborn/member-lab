import { useExperiments } from '../api/hooks';
import type { Experiment, VariantResult } from '../api/types';
import { IntervalChart } from '../components/IntervalChart';
import { formatCount, formatPercent, formatPoints, formatPValue } from '../format';

type Tone = 'info' | 'success' | 'warning' | 'neutral';

function verdict({ results }: Experiment): { tone: Tone; text: string } {
  if (results.sampleRatio.mismatch) {
    return {
      tone: 'warning',
      text: `Sample ratio mismatch (p ${formatPValue(results.sampleRatio.pValue)}). Exposures are off the planned split, so some exposures are being lost or misassigned. Fix the logging before trusting this result.`,
    };
  }
  if (results.status === 'COLLECTING') {
    return { tone: 'info', text: `Collecting data. Each variant needs ${String(results.minExposuresPerVariant)} exposures before the result is shown as final.` };
  }
  const winners = results.variants.filter((variant) => variant.comparison?.significant);
  if (winners.length === 0) {
    return { tone: 'neutral', text: 'No significant difference from the control at the 5% level.' };
  }
  return {
    tone: 'success',
    text: winners
      .map((variant) => {
        const comparison = variant.comparison;
        if (!comparison) return '';
        const direction = comparison.absoluteLift > 0 ? 'more' : 'fewer';
        const relative = comparison.relativeLift === null ? '' : `${formatPercent(Math.abs(comparison.relativeLift))} `;
        return `${variant.label} converts ${relative}${direction} visitors than the control (p ${formatPValue(comparison.pValue)}).`;
      })
      .join(' '),
  };
}

function liftCell(variant: VariantResult) {
  const { comparison } = variant;
  if (!comparison) return <span className="muted">Baseline</span>;
  return (
    <>
      <span className={comparison.significant ? (comparison.absoluteLift > 0 ? 'lift lift--up' : 'lift lift--down') : 'lift'}>
        {formatPoints(comparison.absoluteLift)}
        {comparison.relativeLift !== null && ` (${formatPercent(comparison.relativeLift, { signed: true })})`}
      </span>
      <span className="ci">
        95% CI {formatPoints(comparison.interval.low)} to {formatPoints(comparison.interval.high)}
      </span>
    </>
  );
}

function ExperimentCard({ experiment }: { experiment: Experiment }) {
  const { results } = experiment;
  const summary = verdict(experiment);
  const titleId = `experiment-${experiment.key}`;
  const control = results.variants.find((variant) => variant.isControl);
  const chartLabel = results.variants
    .map((variant) => `${variant.label}: ${formatPercent(variant.rate)}, 95% interval ${formatPercent(variant.interval.low)} to ${formatPercent(variant.interval.high)}`)
    .join('. ');

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

      <div className="table-wrap">
        <table className="results-table">
          <caption className="visually-hidden">
            Results for {experiment.key}, judged on {experiment.metric.replace('_', ' ')}
          </caption>
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
            {results.variants.map((variant) => (
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
                <td className="num">{liftCell(variant)}</td>
                <td className="num">{variant.comparison ? formatPValue(variant.comparison.pValue) : <span className="muted">n/a</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {results.totalExposures > 0 && control && <IntervalChart variants={results.variants} label={`Conversion rate by variant. ${chartLabel}.`} />}

      <p className="srm">
        Sample ratio check: chi-square {results.sampleRatio.chiSquare.toFixed(2)}, p {formatPValue(results.sampleRatio.pValue)}.{' '}
        {results.sampleRatio.mismatch ? 'Mismatch.' : 'Split looks as planned.'}
      </p>
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
      {data && (
        <p className="hint">
          Last updated <time dateTime={new Date(dataUpdatedAt).toISOString()}>{new Date(dataUpdatedAt).toLocaleTimeString()}</time>.
        </p>
      )}
    </div>
  );
}
