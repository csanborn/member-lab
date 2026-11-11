import { GraphQLError } from 'graphql';
import { createSchema } from 'graphql-yoga';
import { EXPERIMENT_KEYS, EXPERIMENTS, isExperimentKey, type ExperimentConfig, type ExperimentKey } from '../../shared/experiments.js';
import { PLAN_IDS, PLANS, type PlanId } from '../../shared/plans.js';
import type { MembershipRow } from '../db/repository.js';
import type { MembershipOutcome } from '../membership/service.js';
import type { DemoPaymentMethod } from '../payments/provider.js';
import type { Services } from '../services.js';

export interface GraphQLContext {
  /** The anonymous visitor id from the `x-visitor-id` header, or null when it is missing or malformed. */
  userId: string | null;
  services: Services;
}

export const typeDefs = /* GraphQL */ `
  enum PlanId { MONTHLY ANNUAL }
  enum BillingInterval { MONTH YEAR }
  enum MembershipStatus { TRIAL ACTIVE PAST_DUE CANCELLED }
  enum MembershipHistoryEvent { STARTED CHARGE_SUCCEEDED CHARGE_FAILED GRACE_EXPIRED CANCEL }
  "Payment methods of the fake provider. No real card data exists anywhere in this app."
  enum DemoPaymentMethod { CARD_OK CARD_DECLINES }
  enum UserErrorCode { PAYMENT_DECLINED ALREADY_MEMBER NOT_A_MEMBER IDEMPOTENCY_KEY_REUSED }
  enum VitalName { LCP INP CLS FCP TTFB }
  enum VitalRating { GOOD NEEDS_IMPROVEMENT POOR }
  enum ResultsStatus { COLLECTING READY }

  type Plan {
    id: PlanId!
    name: String!
    priceCents: Int!
    interval: BillingInterval!
    trialDays: Int!
  }

  type Viewer {
    id: ID!
    "True until the visitor's first trial. Later memberships are charged at signup."
    trialEligible: Boolean!
    "The visitor's most recent membership, including a cancelled one."
    membership: Membership
  }

  type Membership {
    id: ID!
    plan: Plan!
    status: MembershipStatus!
    paymentMethod: DemoPaymentMethod!
    startedAt: String!
    trialEndsAt: String
    currentPeriodEnd: String!
    cancelledAt: String
    failedChargeCount: Int!
    history: [MembershipHistoryEntry!]!
  }

  type MembershipHistoryEntry {
    id: ID!
    event: MembershipHistoryEvent!
    fromStatus: MembershipStatus
    toStatus: MembershipStatus!
    at: String!
    detail: String
  }

  "An expected business outcome, returned as data rather than as a GraphQL error."
  type UserError {
    code: UserErrorCode!
    message: String!
  }

  type MembershipPayload {
    membership: Membership
    error: UserError
  }

  type Assignment {
    experimentKey: String!
    variant: String!
  }

  type ExposurePayload {
    assignment: Assignment!
    "False when this visitor had already been exposed. Only the first exposure counts."
    firstExposure: Boolean!
  }

  type Variant {
    key: String!
    label: String!
    weight: Int!
  }

  type Experiment {
    key: String!
    description: String!
    metric: String!
    variants: [Variant!]!
    results: ExperimentResults!
  }

  type Interval {
    low: Float!
    high: Float!
  }

  type VariantComparison {
    absoluteLift: Float!
    interval: Interval!
    relativeLift: Float
    z: Float!
    pValue: Float!
    significant: Boolean!
  }

  type VariantResult {
    key: String!
    label: String!
    weight: Int!
    isControl: Boolean!
    exposures: Int!
    conversions: Int!
    rate: Float!
    interval: Interval!
    "Null for the control."
    comparison: VariantComparison
  }

  type SampleRatioCheck {
    "Share of exposures the control actually got."
    observedShare: Float!
    "Share the control should get from the weights."
    expectedShare: Float!
    pValue: Float!
    mismatch: Boolean!
  }

  "New exposures and conversions for one variant on one UTC day."
  type DailyCount {
    date: String!
    variant: String!
    exposures: Int!
    conversions: Int!
  }

  type WebVital {
    name: VitalName!
    "75th percentile of recent samples: milliseconds, or unitless for CLS."
    p75: Float!
    samples: Int!
    rating: VitalRating!
  }

  type ExperimentResults {
    status: ResultsStatus!
    minExposuresPerVariant: Int!
    totalExposures: Int!
    variants: [VariantResult!]!
    sampleRatio: SampleRatioCheck!
    daily: [DailyCount!]!
  }

  type Query {
    viewer: Viewer!
    plans: [Plan!]!
    "Which variant this visitor gets. A pure read: it logs no exposure."
    assignment(experimentKey: String!): Assignment!
    experiments: [Experiment!]!
    experiment(key: String!): Experiment
    "Field performance from real page loads on this server."
    webVitals: [WebVital!]!
  }

  input StartMembershipInput {
    planId: PlanId!
    paymentMethod: DemoPaymentMethod!
    idempotencyKey: String!
  }

  input CancelMembershipInput {
    idempotencyKey: String!
  }

  input RunBillingInput {
    paymentMethod: DemoPaymentMethod!
    idempotencyKey: String!
  }

  type Mutation {
    "Call after the variant is on screen. The server recomputes the variant itself."
    logExposure(experimentKey: String!): ExposurePayload!
    startMembership(input: StartMembershipInput!): MembershipPayload!
    cancelMembership(input: CancelMembershipInput!): MembershipPayload!
    "Demo control: run the next charge now (end of trial, renewal, or a retry while past due)."
    runBilling(input: RunBillingInput!): MembershipPayload!
  }
`;

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,128}$/;

function badInput(message: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code: 'BAD_USER_INPUT' } });
}

function requireUser(context: GraphQLContext): string {
  if (!context.userId) {
    throw new GraphQLError('Send a visitor id in the x-visitor-id header', { extensions: { code: 'UNAUTHENTICATED' } });
  }
  return context.userId;
}

function requireIdempotencyKey(key: string): string {
  if (!IDEMPOTENCY_KEY.test(key)) throw badInput('idempotencyKey must be 8 to 128 letters, digits, dashes or underscores');
  return key;
}

function requireExperiment(key: string): ExperimentKey {
  if (!isExperimentKey(key)) throw badInput(`Unknown experiment: ${key}`);
  return key;
}

type NoArgs = Record<string, never>;

export const resolvers = {
  Query: {
    viewer: (_: unknown, __: NoArgs, context: GraphQLContext) => ({ id: requireUser(context) }),
    plans: () => PLAN_IDS.map((id) => PLANS[id]),
    assignment: (_: unknown, args: { experimentKey: string }, context: GraphQLContext) =>
      context.services.experiments.assign(requireUser(context), requireExperiment(args.experimentKey)),
    experiments: () => EXPERIMENT_KEYS.map((key) => EXPERIMENTS[key]),
    experiment: (_: unknown, args: { key: string }) => (isExperimentKey(args.key) ? EXPERIMENTS[args.key] : null),
    webVitals: (_: unknown, __: NoArgs, context: GraphQLContext) =>
      context.services.vitals.summary().map((vital) => ({ ...vital, rating: vital.rating.toUpperCase().replace('-', '_') })),
  },
  Mutation: {
    logExposure: (_: unknown, args: { experimentKey: string }, context: GraphQLContext) =>
      context.services.experiments.logExposure(requireUser(context), requireExperiment(args.experimentKey)),
    startMembership: (
      _: unknown,
      args: { input: { planId: PlanId; paymentMethod: DemoPaymentMethod; idempotencyKey: string } },
      context: GraphQLContext,
    ) =>
      context.services.memberships.start(requireUser(context), {
        ...args.input,
        idempotencyKey: requireIdempotencyKey(args.input.idempotencyKey),
      }),
    cancelMembership: (_: unknown, args: { input: { idempotencyKey: string } }, context: GraphQLContext) =>
      context.services.memberships.cancel(requireUser(context), requireIdempotencyKey(args.input.idempotencyKey)),
    runBilling: (
      _: unknown,
      args: { input: { paymentMethod: DemoPaymentMethod; idempotencyKey: string } },
      context: GraphQLContext,
    ) =>
      context.services.memberships.runBilling(requireUser(context), {
        ...args.input,
        idempotencyKey: requireIdempotencyKey(args.input.idempotencyKey),
      }),
  },
  Viewer: {
    trialEligible: (viewer: { id: string }, _: NoArgs, context: GraphQLContext) =>
      context.services.memberships.trialEligible(viewer.id),
    membership: (viewer: { id: string }, _: NoArgs, context: GraphQLContext) =>
      context.services.memberships.latest(viewer.id) ?? null,
  },
  Membership: {
    plan: (row: MembershipRow) => PLANS[row.planId],
    history: (row: MembershipRow, _: NoArgs, context: GraphQLContext) => context.services.memberships.history(row.id),
  },
  MembershipPayload: {
    membership: (outcome: MembershipOutcome, _: NoArgs, context: GraphQLContext) =>
      outcome.membershipId === null ? null : (context.services.memberships.find(outcome.membershipId) ?? null),
  },
  Experiment: {
    results: (experiment: ExperimentConfig, _: NoArgs, context: GraphQLContext) =>
      context.services.experiments.results(requireExperiment(experiment.key)),
  },
};

export function createGraphQLSchema() {
  return createSchema<GraphQLContext>({ typeDefs, resolvers });
}
