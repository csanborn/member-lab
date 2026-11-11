import { getOperationAST, type DocumentNode } from 'graphql';
import { isAsyncIterable, type Plugin } from 'graphql-yoga';
import type { Metrics } from '../observability/metrics.js';

function describe(document: DocumentNode, operationName: string | null | undefined) {
  const operation = getOperationAST(document, operationName);
  return { operation: operation?.name?.value ?? 'anonymous', type: operation?.operation ?? 'unknown' };
}

/**
 * Counts and times every GraphQL operation. A GraphQL error still answers HTTP 200, so the HTTP
 * metrics alone would miss it: this is where the error rate comes from.
 */
export function useOperationMetrics(metrics: Metrics): Plugin {
  return {
    onValidate() {
      return ({ valid }) => {
        if (!valid) metrics.graphqlOperations.inc({ operation: 'invalid', type: 'unknown', outcome: 'invalid' });
      };
    },
    onExecute({ args }) {
      const { document, operationName } = args as { document: DocumentNode; operationName?: string | null };
      const labels = describe(document, operationName);
      const stop = metrics.graphqlDuration.startTimer(labels);
      return {
        onExecuteDone({ result }) {
          stop();
          const outcome = isAsyncIterable(result) || !result.errors?.length ? 'success' : 'error';
          metrics.graphqlOperations.inc({ ...labels, outcome });
        },
      };
    },
  };
}
