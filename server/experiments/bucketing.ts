import type { ExperimentConfig, VariantConfig } from '../../shared/experiments.js';

export const BUCKET_COUNT = 10_000;

const encoder = new TextEncoder();

/**
 * 32-bit FNV-1a over the UTF-8 bytes, then the MurmurHash3 finalizer. FNV-1a alone mixes its low
 * bits poorly for inputs that differ only at the end (user-1, user-2, ...), and the finalizer
 * spreads every input bit across the whole output.
 */
export function hash32(input: string): number {
  let hash = 0x811c9dc5;
  for (const byte of encoder.encode(input)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return hash >>> 0;
}

/** A stable number in [0, BUCKET_COUNT) for this user in this experiment. */
export function bucketFor(experiment: Pick<ExperimentConfig, 'key' | 'salt'>, userId: string): number {
  return hash32(`${experiment.salt}:${experiment.key}:${userId}`) % BUCKET_COUNT;
}

/** Lays the variants' weights end to end over the buckets and returns the one this user lands in. */
export function assignVariant(experiment: ExperimentConfig, userId: string): VariantConfig {
  const bucket = bucketFor(experiment, userId);
  const total = experiment.variants.reduce((sum, variant) => sum + variant.weight, 0);
  let upper = 0;
  for (const variant of experiment.variants) {
    upper += (variant.weight / total) * BUCKET_COUNT;
    if (bucket < upper) return variant;
  }
  const last = experiment.variants.at(-1);
  if (!last) throw new Error(`Experiment ${experiment.key} has no variants`);
  return last;
}
