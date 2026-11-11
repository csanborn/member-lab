import { getVisitorId } from '../visitor';

export class ApiError extends Error {
  /** Network failures and server errors are worth retrying. Bad requests are not. */
  readonly retryable: boolean;

  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = 'ApiError';
    this.retryable = retryable;
  }
}

interface GraphQLResponse<T> {
  data?: T | null;
  errors?: { message: string; extensions?: { code?: string } }[];
}

const NOT_RETRYABLE = new Set(['BAD_USER_INPUT', 'UNAUTHENTICATED', 'GRAPHQL_VALIDATION_FAILED']);

/** POSTs one named operation to /graphql as the current visitor. */
export async function gql<T>(operationName: string, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch('/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-visitor-id': getVisitorId() },
      body: JSON.stringify({ operationName, query, variables }),
    });
  } catch {
    throw new ApiError('Could not reach the server. Check your connection.', true);
  }
  if (response.status >= 500) throw new ApiError('The server had a problem. Trying again usually works.', true);

  const body = (await response.json()) as GraphQLResponse<T>;
  const [error] = body.errors ?? [];
  if (error) throw new ApiError(error.message, !NOT_RETRYABLE.has(error.extensions?.code ?? ''));
  if (!body.data) throw new ApiError('The server sent an empty response.', true);
  return body.data;
}

/** A fresh key for one user intent. Retries of that intent reuse it. */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
