import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ExperimentKey, VariantKey } from '../../shared/experiments';
import { useVisitorId } from '../visitor';
import { ApiError, gql } from './client';
import type { DemoPaymentMethod, Experiment, MembershipPayload, Plan, PlanId, Viewer } from './types';

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

const PAYLOAD_FIELDS = /* GraphQL */ `
  membership { ...MembershipFields }
  error { code message }
`;

/** Retries only failures where a retry can help. Mutations are safe to retry: they carry an idempotency key. */
function retryTransient(failureCount: number, error: Error): boolean {
  return failureCount < 3 && error instanceof ApiError && error.retryable;
}

function retryDelay(attempt: number): number {
  return Math.min(250 * 2 ** attempt, 2000);
}

export const queryKeys = {
  viewer: (visitorId: string) => ['viewer', visitorId] as const,
  assignment: (visitorId: string, key: string) => ['assignment', visitorId, key] as const,
  plans: ['plans'] as const,
  experiments: ['experiments'] as const,
};

export function useViewer() {
  const visitorId = useVisitorId();
  return useQuery({
    queryKey: queryKeys.viewer(visitorId),
    queryFn: () =>
      gql<{ viewer: Viewer }>(
        'Viewer',
        `query Viewer { viewer { id trialEligible membership { ...MembershipFields } } } ${MEMBERSHIP_FIELDS}`,
      ).then((data) => data.viewer),
  });
}

export function usePlans() {
  return useQuery({
    queryKey: queryKeys.plans,
    queryFn: () =>
      gql<{ plans: Plan[] }>('Plans', 'query Plans { plans { id name priceCents interval trialDays } }').then((data) => data.plans),
    staleTime: Infinity,
  });
}

/** The variant this visitor is bucketed into. Reading it logs nothing; see `useExposure`. */
export function useAssignment<K extends ExperimentKey>(experimentKey: K) {
  const visitorId = useVisitorId();
  return useQuery({
    queryKey: queryKeys.assignment(visitorId, experimentKey),
    queryFn: () =>
      gql<{ assignment: { variant: VariantKey<K> } }>(
        'Assignment',
        'query Assignment($key: String!) { assignment(experimentKey: $key) { variant } }',
        { key: experimentKey },
      ).then((data) => data.assignment.variant),
    staleTime: Infinity,
  });
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

/** Shared by every membership mutation: the payload's membership becomes the viewer's. */
function useMembershipMutation<V extends { idempotencyKey: string }>(operationName: string, document: string) {
  const visitorId = useVisitorId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: V) =>
      gql<Record<string, MembershipPayload>>(operationName, `${document} ${MEMBERSHIP_FIELDS}`, { input }).then((data) => {
        const payload = Object.values(data)[0];
        if (!payload) throw new ApiError('The server sent an empty response.', true);
        return payload;
      }),
    retry: retryTransient,
    retryDelay,
    onSuccess: (payload) => {
      const { membership } = payload;
      if (membership) {
        queryClient.setQueryData<Viewer>(queryKeys.viewer(visitorId), (viewer) =>
          viewer ? { ...viewer, membership, trialEligible: viewer.trialEligible && membership.trialEndsAt === null } : viewer,
        );
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.viewer(visitorId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.experiments });
    },
  });
}

export function useStartMembership() {
  return useMembershipMutation<{ planId: PlanId; paymentMethod: DemoPaymentMethod; idempotencyKey: string }>(
    'StartMembership',
    `mutation StartMembership($input: StartMembershipInput!) { startMembership(input: $input) { ${PAYLOAD_FIELDS} } }`,
  );
}

export function useCancelMembership() {
  return useMembershipMutation<{ idempotencyKey: string }>(
    'CancelMembership',
    `mutation CancelMembership($input: CancelMembershipInput!) { cancelMembership(input: $input) { ${PAYLOAD_FIELDS} } }`,
  );
}

export function useRunBilling() {
  return useMembershipMutation<{ paymentMethod: DemoPaymentMethod; idempotencyKey: string }>(
    'RunBilling',
    `mutation RunBilling($input: RunBillingInput!) { runBilling(input: $input) { ${PAYLOAD_FIELDS} } }`,
  );
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
              sampleRatio { chiSquare pValue mismatch }
              variants {
                key label weight isControl exposures conversions rate
                interval { low high }
                comparison { absoluteLift relativeLift pValue significant interval { low high } }
              }
            }
          }
        }`,
      ).then((data) => data.experiments),
    refetchInterval: 15_000,
  });
}
