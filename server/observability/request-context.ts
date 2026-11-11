import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  requestId: string;
  /** Set once GraphQL knows which operation the request runs, for the access log. */
  operationName?: string;
}

/** Carries the request id through async work, so every log line of a request can be joined up. */
export const requestContext = new AsyncLocalStorage<RequestContext>();
