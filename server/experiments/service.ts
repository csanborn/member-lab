import { EXPERIMENTS, type ExperimentConfig, type ExperimentKey } from '../../shared/experiments.js';
import type { Clock } from '../clock.js';
import type { Repository } from '../db/repository.js';
import type { Logger } from '../observability/logger.js';
import type { Metrics } from '../observability/metrics.js';
import { assignVariant } from './bucketing.js';
import { chiSquareGoodnessOfFit, compareProportions, wilsonInterval, type Comparison, type Interval } from './stats.js';

/** Below this many exposures in any variant, results are shown as still collecting. */
export const MIN_EXPOSURES_PER_VARIANT = 100;
export const SIGNIFICANCE_LEVEL = 0.05;
/** SRM is a data quality alarm, so it uses a strict threshold to keep false alarms rare. */
export const SRM_THRESHOLD = 0.001;

export interface Assignment {
  experimentKey: ExperimentKey;
  variant: string;
}

export interface VariantResult {
  key: string;
  label: string;
  weight: number;
  isControl: boolean;
  exposures: number;
  conversions: number;
  rate: number;
  interval: Interval;
  comparison: (Comparison & { significant: boolean }) | null;
}

export interface ExperimentResults {
  experiment: ExperimentConfig;
  status: 'COLLECTING' | 'READY';
  minExposuresPerVariant: number;
  totalExposures: number;
  variants: VariantResult[];
  sampleRatio: { chiSquare: number; pValue: number; mismatch: boolean };
}

export interface ExperimentServiceDeps {
  repo: Repository;
  clock: Clock;
  logger: Logger;
  metrics: Metrics;
}

export class ExperimentService {
  readonly #deps: ExperimentServiceDeps;

  constructor(deps: ExperimentServiceDeps) {
    this.#deps = deps;
  }

  /** A pure read: the same user always gets the same variant, and nothing is logged. */
  assign(userId: string, key: ExperimentKey): Assignment {
    return { experimentKey: key, variant: assignVariant(EXPERIMENTS[key], userId).key };
  }

  /**
   * Called once a variant is on screen. The variant is recomputed here, never taken from the
   * client, and only the first exposure per user counts.
   */
  logExposure(userId: string, key: ExperimentKey): { assignment: Assignment; firstExposure: boolean } {
    const assignment = this.assign(userId, key);
    const firstExposure = this.#deps.repo.insertExposure({
      experimentKey: key,
      userId,
      variant: assignment.variant,
      firstExposedAt: this.#deps.clock.now().toISOString(),
    });
    if (firstExposure) {
      this.#deps.metrics.experimentExposures.inc({ experiment: key, variant: assignment.variant });
      this.#deps.logger.info({ experiment: key, variant: assignment.variant }, 'exposure');
    }
    return { assignment, firstExposure };
  }

  results(key: ExperimentKey): ExperimentResults {
    const experiment = EXPERIMENTS[key];
    const counts = new Map(this.#deps.repo.countVariantResults(key, experiment.metric).map((row) => [row.variant, row]));
    const observed = experiment.variants.map((variant) => ({
      variant,
      exposures: counts.get(variant.key)?.exposures ?? 0,
      conversions: counts.get(variant.key)?.conversions ?? 0,
    }));
    const [control] = observed;
    if (!control) throw new Error(`Experiment ${key} has no variants`);

    const variants = observed.map(({ variant, exposures, conversions }, index): VariantResult => {
      const comparison = index === 0 ? null : compareProportions(control, { exposures, conversions });
      return {
        key: variant.key,
        label: variant.label,
        weight: variant.weight,
        isControl: index === 0,
        exposures,
        conversions,
        rate: exposures === 0 ? 0 : conversions / exposures,
        interval: wilsonInterval(conversions, exposures),
        comparison: comparison && { ...comparison, significant: comparison.pValue < SIGNIFICANCE_LEVEL },
      };
    });

    const fit = chiSquareGoodnessOfFit(
      observed.map((row) => row.exposures),
      experiment.variants.map((variant) => variant.weight),
    );
    const totalExposures = observed.reduce((sum, row) => sum + row.exposures, 0);
    return {
      experiment,
      status: observed.every((row) => row.exposures >= MIN_EXPOSURES_PER_VARIANT) ? 'READY' : 'COLLECTING',
      minExposuresPerVariant: MIN_EXPOSURES_PER_VARIANT,
      totalExposures,
      variants,
      sampleRatio: { chiSquare: fit.chiSquare, pValue: fit.pValue, mismatch: totalExposures > 0 && fit.pValue < SRM_THRESHOLD },
    };
  }
}
