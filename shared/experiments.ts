export interface VariantConfig {
  key: string;
  label: string;
  /** Relative weight. Weights within an experiment need not sum to 100. */
  weight: number;
}

export interface ExperimentConfig {
  key: string;
  description: string;
  /** The conversion event this experiment is judged on. */
  metric: 'membership_started';
  /** Changing the salt reshuffles every user, which is how a rerun gets fresh buckets. */
  salt: string;
  /** Exactly two arms: the control first, then the treatment. */
  variants: readonly [control: VariantConfig, treatment: VariantConfig];
}

export const EXPERIMENTS = {
  landing_hero: {
    key: 'landing_hero',
    description: 'Does leading with a savings calculator start more memberships than the classic perks headline?',
    metric: 'membership_started',
    salt: '2026-09-a',
    variants: [
      { key: 'control', label: 'Perks headline', weight: 50 },
      { key: 'savings_calculator', label: 'Savings calculator', weight: 50 },
    ],
  },
  signup_default_plan: {
    key: 'signup_default_plan',
    description: 'Does preselecting the annual plan on the signup form change how many people join?',
    metric: 'membership_started',
    salt: '2026-09-a',
    variants: [
      { key: 'control', label: 'Monthly preselected', weight: 50 },
      { key: 'annual_default', label: 'Annual preselected', weight: 50 },
    ],
  },
} as const satisfies Record<string, ExperimentConfig>;

export type ExperimentKey = keyof typeof EXPERIMENTS;
export type VariantKey<K extends ExperimentKey> = (typeof EXPERIMENTS)[K]['variants'][number]['key'];

export const EXPERIMENT_KEYS = Object.keys(EXPERIMENTS) as ExperimentKey[];

export function isExperimentKey(key: string): key is ExperimentKey {
  return Object.hasOwn(EXPERIMENTS, key);
}
