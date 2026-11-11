import { queryOptions, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import type { ExperimentKey, VariantKey } from '../../shared/experiments';
import { useVisitorId } from '../visitor';
import { ApiError, gql } from './client';
import type { DemoPaymentMethod, Experiment, MembershipPayload, Plan, PlanId, Viewer, WebVital } from './types';

const MEMBERSHIP_FIELDS = /* GraphQL */ `
  fragment MembershipFields on Membership {
    id
    status
    paymentMethod
    startedAt
    trialEndsAt
    currentPeriodEnd
    cancelledAt
    failedChargeCount
    plan { id name priceCents interval trialDays }
    history { id event fromStatus toStatus at detail }
  }
`;

/**
 * Retry only failures where a retry can help (network errors, 5xx). Mutations are safe to retry
 * too: each carries an idempotency key, so the server runs it once however many times it arrives.
 */
function retryTransient(failureCount: number, error: Error): boolean {
  return failureCount < 3 && error instanceof ApiError && error.retryable;
}

function retryDelay(attempt: number): number {
  return Math.min(250 * 2 ** attempt, 2000);
}

/** Every query key is scoped to the visitor, so starting over as a new visitor never shows stale data. */
export const queryKeys = {
  viewer: (visitorId: string) => ['viewer', visitorId] as const,
  assignment: (visitorId: string, key: string) => ['assignment', visitorId, key] as const,
  plans: ['plans'] as const,
  experiments: ['experiments'] as const,
  webVitals: ['web-vitals'] as const,
};

const viewerQuery = (visitorId: string) =>
  queryOptions({
    queryKey: queryKeys.viewer(visitorId),
    queryFn: () =>
      gql<{ viewer: Viewer }>(
        'Viewer',
        `query Viewer { viewer { id trialEligible membership { ...MembershipFields } } } ${MEMBERSHIP_FIELDS}`,
      ).then((data) => data.viewer),
  });

const plansQuery = queryOptions({
  queryKey: queryKeys.plans,
  queryFn: () => gql<{ plans: Plan[] }>('Plans', 'query Plans { plans { id name priceCents interval trialDays } }').then((data) => data.plans),
  // Prices do not change during a visit.
  staleTime: Infinity,
});

const assignmentQuery = <K extends ExperimentKey>(visitorId: string, experimentKey: K) =>
  queryOptions({
    queryKey: queryKeys.assignment(visitorId, experimentKey),
    queryFn: () =>
      gql<{ assignment: { variant: VariantKey<K> } }>(
        'Assignment',
        'query Assignment($key: String!) { assignment(experimentKey: $key) { variant } }',
        { key: experimentKey },
      ).then((data) => data.assignment.variant),
    // Bucketing is deterministic, so a visitor's variant never changes.
    staleTime: Infinity,
  });

export function useViewer() {
  return useQuery(viewerQuery(useVisitorId()));
}

export function usePlans() {
  return useQuery(plansQuery);
}

/** The variant this visitor is bucketed into. Reading it logs nothing: see `useExposure`. */
export function useAssignment<K extends ExperimentKey>(experimentKey: K) {
  return useQuery(assignmentQuery(useVisitorId(), experimentKey));
}

/**
 * Warms the cache for the signup form (plans and the default-plan variant), so it renders at once
 * when the visitor clicks through. Call on hover or focus of a link to /join.
 */
export function usePrefetchJoin(): () => void {
  const queryClient = useQueryClient();
  const visitorId = useVisitorId();
  return useCallback(() => {
    // A failed prefetch is harmless: the form fetches again when it mounts.
    queryClient.query(plansQuery).catch(() => undefined);
    queryClient.query(assignmentQuery(visitorId, 'signup_default_plan')).catch(() => undefined);
  }, [queryClient, visitorId]);
}

export function useLogExposure() {
  return useMutation({
    mutationFn: (experimentKey: ExperimentKey) =>
      gql('LogExposure', 'mutation LogExposure($key: String!) { logExposure(experimentKey: $key) { firstExposure } }', {
        key: experimentKey,
      }),
    retry: retryTransient,
    retryDelay,
  });
}

function membershipMutation(operationName: string, field: string, inputType: string) {
  const document = `mutation ${operationName}($input: ${inputType}!) {
    ${field}(input: $input) { membership { ...MembershipFields } error { code message } }
  } ${MEMBERSHIP_FIELDS}`;
  return (input: object) =>
    gql<Record<string, MembershipPayload | undefined>>(operationName, document, { input }).then((data) => {
      const payload = data[field];
      if (!payload) throw new ApiError('The server sent an empty response.', true);
      return payload;
    });
}

/** Puts the server's answer into the viewer cache, then refetches the viewer and results in the background. */
function settle(queryClient: QueryClient, visitorId: string, payload: MembershipPayload | undefined) {
  const membership = payload?.membership;
  if (membership) {
    queryClient.setQueryData<Viewer>(queryKeys.viewer(visitorId), (viewer) =>
      viewer ? { ...viewer, membership, trialEligible: viewer.trialEligible && membership.trialEndsAt === null } : viewer,
    );
  }
  void queryClient.invalidateQueries({ queryKey: queryKeys.viewer(visitorId) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.experiments });
}

const startMembership = membershipMutation('StartMembership', 'startMembership', 'StartMembershipInput');
const runBilling = membershipMutation('RunBilling', 'runBilling', 'RunBillingInput');
const cancelMembership = membershipMutation('CancelMembership', 'cancelMembership', 'CancelMembershipInput');

/**
 * Not optimistic: money moves and declines are common, so the page waits for the real answer
 * instead of showing a membership that might vanish a second later.
 */
export function useStartMembership() {
  const queryClient = useQueryClient();
  const visitorId = useVisitorId();
  return useMutation({
    mutationFn: (input: { planId: PlanId; paymentMethod: DemoPaymentMethod; idempotencyKey: string }) => startMembership(input),
    retry: retryTransient,
    retryDelay,
    onSettled: (payload) => {
      settle(queryClient, visitorId, payload);
    },
  });
}

/** Not optimistic either: whether a charge succeeds is exactly what the visitor is waiting to learn. */
export function useRunBilling() {
  const queryClient = useQueryClient();
  const visitorId = useVisitorId();
  return useMutation({
    mutationFn: (input: { paymentMethod: DemoPaymentMethod; idempotencyKey: string }) => runBilling(input),
    retry: retryTransient,
    retryDelay,
    onSettled: (payload) => {
      settle(queryClient, visitorId, payload);
    },
  });
}

/**
 * Optimistic: cancelling almost always succeeds, so the page shows "Cancelled" at once. If the
 * server says no (or every retry fails), the previous membership is put back and the page says so.
 */
export function useCancelMembership() {
  const queryClient = useQueryClient();
  const visitorId = useVisitorId();
  const key = queryKeys.viewer(visitorId);

  const rollback = (previous: Viewer | undefined) => {
    if (previous) queryClient.setQueryData(key, previous);
  };

  return useMutation({
    mutationFn: (input: { idempotencyKey: string }) => cancelMembership(input),
    retry: retryTransient,
    retryDelay,
    onMutate: async () => {
      // A refetch landing mid-mutation would overwrite the optimistic state with stale data.
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Viewer>(key);
      if (previous?.membership) {
        const now = new Date().toISOString();
        queryClient.setQueryData<Viewer>(key, { ...previous, membership: { ...previous.membership, status: 'CANCELLED', cancelledAt: now } });
      }
      return { previous };
    },
    onSuccess: (payload, _input, context) => {
      if (payload.error) rollback(context.previous);
    },
    onError: (_error, _input, context) => {
      rollback(context?.previous);
    },
    onSettled: (payload) => {
      settle(queryClient, visitorId, payload?.error ? undefined : payload);
    },
  });
}

export function useExperiments() {
  return useQuery({
    queryKey: queryKeys.experiments,
    queryFn: () =>
      gql<{ experiments: Experiment[] }>(
        'ExperimentResults',
        `query ExperimentResults {
          experiments {
            key description metric
            results {
              status minExposuresPerVariant totalExposures
              sampleRatio { observedShare expectedShare pValue mismatch }
              variants {
                key label weight isControl exposures conversions rate
                interval { low high }
                comparison { absoluteLift relativeLift pValue significant interval { low high } }
              }
              daily { date variant exposures conversions }
            }
          }
        }`,
      ).then((data) => data.experiments),
    // Live results: poll while the page is open. TanStack Query pauses polling in background tabs.
    refetchInterval: 15_000,
  });
}

export function useWebVitals() {
  return useQuery({
    queryKey: queryKeys.webVitals,
    queryFn: () =>
      gql<{ webVitals: WebVital[] }>('WebVitals', 'query WebVitals { webVitals { name p75 samples rating } }').then((data) => data.webVitals),
    refetchInterval: 15_000,
  });
}
