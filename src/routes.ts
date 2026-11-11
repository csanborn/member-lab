import { lazy } from 'react';

/**
 * Pages off the signup path load on demand, keeping the landing page's JavaScript small.
 * Calling a loader early (on hover or focus of a link) starts the download before the click.
 */
export const loadMember = () => import('./pages/Member');
export const loadExperiments = () => import('./pages/Experiments');

export const Member = lazy(() => loadMember().then((module) => ({ default: module.Member })));
export const Experiments = lazy(() => loadExperiments().then((module) => ({ default: module.Experiments })));
