import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createMetrics } from './metrics.js';

describe('ops/alerts.yml', () => {
  const rules = readFileSync(new URL('../../ops/alerts.yml', import.meta.url), 'utf8');

  it('only queries metrics and labels the server exports', async () => {
    const metrics = createMetrics();
    const exported = new Set((await metrics.registry.getMetricsAsJSON()).map((metric) => metric.name));
    const queried = new Set(rules.match(/\b[a-z_]+_(?:total|seconds)\b/g));
    expect(queried.size).toBeGreaterThan(0);
    for (const name of queried) expect(exported).toContain(name);

    // The outcome values the rule filters on are the ones the metrics plugin writes.
    metrics.graphqlOperations.inc({ operation: 'x', type: 'query', outcome: 'success' });
    metrics.graphqlOperations.inc({ operation: 'x', type: 'query', outcome: 'error' });
    const outcomes = (await metrics.graphqlOperations.get()).values.map((value) => value.labels.outcome);
    for (const outcome of rules.match(/outcome=~?"([^"]+)"/g) ?? []) {
      const allowed = outcome.replace(/^outcome=~?"|"$/g, '').split('|');
      for (const value of allowed) expect(outcomes).toContain(value);
    }
  });

  it('names a runbook that exists in the README', () => {
    const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
    expect(rules).toContain('runbook: README.md#alert-graphqlerrorratehigh');
    expect(readme).toContain('### Alert: GraphQLErrorRateHigh');
  });
});
