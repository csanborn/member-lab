import { useEffect } from 'react';
import type { ExperimentKey } from '../../shared/experiments';
import { useLogExposure } from '../api/hooks';
import { useVisitorId } from '../visitor';

/** Exposures already sent from this page load, so remounts and Strict Mode do not resend. */
const sent = new Set<string>();

/**
 * Call from inside the component that renders a variant. The effect runs only after that
 * component has committed to the screen, so a visitor who never sees the variant is never
 * counted. The server also keeps only the first exposure, so this guard just saves requests.
 */
export function useExposure(experimentKey: ExperimentKey): void {
  const visitorId = useVisitorId();
  const { mutate } = useLogExposure();
  useEffect(() => {
    const id = `${visitorId}:${experimentKey}`;
    if (sent.has(id)) return;
    sent.add(id);
    mutate(experimentKey, { onError: () => sent.delete(id) });
  }, [visitorId, experimentKey, mutate]);
}
