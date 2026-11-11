import type {
  DailyCounts,
  ExposureRow,
  IsoTime,
  MembershipHistoryRow,
  MembershipRow,
  Repository,
  VariantCounts,
} from './repository.js';

/**
 * Plain maps in one Node process. Data lasts until the server restarts, which suits a demo that
 * reseeds itself on startup. Rows are copied in and out so callers cannot edit stored state.
 */
export class InMemoryRepository implements Repository {
  readonly #memberships = new Map<string, MembershipRow>();
  readonly #membershipIdsByUser = new Map<string, string[]>();
  readonly #history = new Map<string, MembershipHistoryRow[]>();
  readonly #exposures = new Map<string, Map<string, ExposureRow>>();
  readonly #conversions = new Map<string, Map<string, IsoTime[]>>();

  findLiveMembership(userId: string): MembershipRow | undefined {
    return this.#userMemberships(userId).find((row) => row.status !== 'CANCELLED');
  }

  findLatestMembership(userId: string): MembershipRow | undefined {
    return this.#userMemberships(userId).at(-1);
  }

  findMembership(id: string): MembershipRow | undefined {
    const row = this.#memberships.get(id);
    return row && { ...row };
  }

  hasHadTrial(userId: string): boolean {
    return this.#userMemberships(userId).some((row) => row.trialEndsAt !== null);
  }

  saveMembership(row: MembershipRow): void {
    if (!this.#memberships.has(row.id)) {
      const ids = this.#membershipIdsByUser.get(row.userId) ?? [];
      ids.push(row.id);
      this.#membershipIdsByUser.set(row.userId, ids);
    }
    this.#memberships.set(row.id, { ...row });
  }

  addHistory(row: MembershipHistoryRow): void {
    const rows = this.#history.get(row.membershipId) ?? [];
    rows.push({ ...row });
    this.#history.set(row.membershipId, rows);
  }

  listHistory(membershipId: string): MembershipHistoryRow[] {
    return (this.#history.get(membershipId) ?? []).map((row) => ({ ...row }));
  }

  addExposure(row: ExposureRow): boolean {
    const byUser = this.#exposures.get(row.experimentKey) ?? new Map<string, ExposureRow>();
    this.#exposures.set(row.experimentKey, byUser);
    if (byUser.has(row.userId)) return false;
    byUser.set(row.userId, { ...row });
    return true;
  }

  addConversion({ userId, metric, at }: { userId: string; metric: string; at: IsoTime }): void {
    const byUser = this.#conversions.get(metric) ?? new Map<string, IsoTime[]>();
    this.#conversions.set(metric, byUser);
    byUser.set(userId, [...(byUser.get(userId) ?? []), at]);
  }

  variantCounts(experimentKey: string, metric: string): VariantCounts[] {
    const counts = new Map<string, VariantCounts>();
    for (const { exposure, convertedAt } of this.#exposedUsers(experimentKey, metric)) {
      const row = counts.get(exposure.variant) ?? { variant: exposure.variant, exposures: 0, conversions: 0 };
      row.exposures += 1;
      if (convertedAt) row.conversions += 1;
      counts.set(exposure.variant, row);
    }
    return [...counts.values()];
  }

  dailyCounts(experimentKey: string, metric: string): DailyCounts[] {
    const counts = new Map<string, DailyCounts>();
    const bump = (date: string, variant: string, field: 'exposures' | 'conversions') => {
      const id = `${date}|${variant}`;
      const row = counts.get(id) ?? { date, variant, exposures: 0, conversions: 0 };
      row[field] += 1;
      counts.set(id, row);
    };
    for (const { exposure, convertedAt } of this.#exposedUsers(experimentKey, metric)) {
      bump(exposure.firstExposedAt.slice(0, 10), exposure.variant, 'exposures');
      if (convertedAt) bump(convertedAt.slice(0, 10), exposure.variant, 'conversions');
    }
    return [...counts.values()].sort((a, b) => a.date.localeCompare(b.date) || a.variant.localeCompare(b.variant));
  }

  /** Each exposed user with the first conversion at or after their exposure, if any. */
  *#exposedUsers(experimentKey: string, metric: string) {
    const conversions = this.#conversions.get(metric);
    for (const exposure of this.#exposures.get(experimentKey)?.values() ?? []) {
      const convertedAt = conversions?.get(exposure.userId)?.find((at) => at >= exposure.firstExposedAt) ?? null;
      yield { exposure, convertedAt };
    }
  }

  #userMemberships(userId: string): MembershipRow[] {
    return (this.#membershipIdsByUser.get(userId) ?? []).flatMap((id) => {
      const row = this.#memberships.get(id);
      return row ? [{ ...row }] : [];
    });
  }
}
