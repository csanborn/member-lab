import { onCLS, onFCP, onINP, onLCP, onTTFB, type Metric } from 'web-vitals';

/**
 * Reports Core Web Vitals from real page loads to the server, which shows their 75th percentile
 * on the results page. `sendBeacon` survives the page being closed, which is when LCP, INP and
 * CLS are finally known.
 */
export function reportWebVitals(endpoint = '/vitals'): void {
  const send = ({ name, value }: Metric) => {
    const body = JSON.stringify({ name, value });
    if (!navigator.sendBeacon(endpoint, new Blob([body], { type: 'application/json' }))) {
      void fetch(endpoint, { method: 'POST', body, keepalive: true }).catch(() => undefined);
    }
  };
  onLCP(send);
  onINP(send);
  onCLS(send);
  onFCP(send);
  onTTFB(send);
}
