import type { MembershipStatus } from './api/types';

const LABELS: Record<MembershipStatus, string> = {
  TRIAL: 'Free trial',
  ACTIVE: 'Active',
  PAST_DUE: 'Payment past due',
  CANCELLED: 'Cancelled',
};

export function statusLabel(status: MembershipStatus): string {
  return LABELS[status];
}
