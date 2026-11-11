import { EXPERIMENTS, type ExperimentConfig, type ExperimentKey } from '../../shared/experiments.js';
import type { Clock } from '../clock.js';
import type { DailyCounts, Repository } from '../db/repository.js';
import type { Logger } from '../observability/logger.js';
import { assignVariant } from './bucketing.js';
import { compareProportions, sampleRatioCheck, wilsonInterval, type Comparison, type Interval, type SampleRatioCheck } from './stats.js';

/** Below this many exposures in either arm, results are shown as still collecting. */
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
  status: 'COLLECTING' | 'READY';
  minExposuresPerVariant: number;
  totalExposures: number;
  variants: VariantResult[];
  sampleRatio: SampleRatioCheck & { mismatch: boolean };
  daily: DailyCounts[];
}

export interface ExperimentServiceDeps {
  repo: Repository;
  clock: Clock;
  logger: Logger;
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
    const firstExposure = this.#deps.repo.addExposure({
      experimentKey: key,
      userId,
      variant: assignment.variant,
      firstExposedAt: this.#deps.clock.now().toISOString(),
    });
    if (firstExposure) this.#deps.logger.debug({ experiment: key, variant: assignment.variant }, 'exposure');
    return { assignment, firstExposure };
  }

  results(key: ExperimentKey): ExperimentResults {
    const experiment: ExperimentConfig = EXPERIMENTS[key];
    const counts = new Map(this.#deps.repo.variantCounts(key, experiment.metric).map((row) => [row.variant, row]));
    const [control, treatment] = experiment.variants.map((variant) => ({
      variant,
      exposures: counts.get(variant.key)?.exposures ?? 0,
      conversions: counts.get(variant.key)?.conversions ?? 0,
    })) as [Arm, Arm];

    const comparison = compareProportions(control, treatment);
    const toResult = (arm: Arm, isControl: boolean): VariantResult => ({
      key: arm.variant.key,
      label: arm.variant.label,
      weight: arm.variant.weight,
      isControl,
      exposures: arm.exposures,
      conversions: arm.conversions,
      rate: arm.exposures === 0 ? 0 : arm.conversions / arm.exposures,
      interval: wilsonInterval(arm.conversions, arm.exposures),
      comparison: isControl ? null : { ...comparison, significant: comparison.pValue < SIGNIFICANCE_LEVEL },
    });

    const totalExposures = control.exposures + treatment.exposures;
    const ratio = sampleRatioCheck(control.exposures, treatment.exposures, control.variant.weight, treatment.variant.weight);
    return {
      status: Math.min(control.exposures, treatment.exposures) >= MIN_EXPOSURES_PER_VARIANT ? 'READY' : 'COLLECTING',
      minExposuresPerVariant: MIN_EXPOSURES_PER_VARIANT,
      totalExposures,
      variants: [toResult(control, true), toResult(treatment, false)],
      sampleRatio: { ...ratio, mismatch: totalExposures > 0 && ratio.pValue < SRM_THRESHOLD },
      daily: this.#deps.repo.dailyCounts(key, experiment.metric),
    };
  }
}

interface Arm {
  variant: ExperimentConfig['variants'][number];
  exposures: number;
  conversions: number;
}
