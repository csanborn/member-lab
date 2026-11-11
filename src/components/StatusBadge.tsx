import type { MembershipStatus } from '../api/types';
import { statusLabel } from '../status';

export function StatusBadge({ status }: { status: MembershipStatus }) {
  return (
    <span className={`badge badge--${status.toLowerCase()}`} data-testid="membership-status">
      {statusLabel(status)}
    </span>
  );
}
