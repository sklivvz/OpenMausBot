import { ZodError } from 'zod';

export type ExecutionFailureCode =
  | 'invalid_request'
  | 'invalid_config'
  | 'source_unavailable'
  | 'artifact_root_unavailable'
  | 'artifact_path_rejected'
  | 'project_out_of_scope'
  | 'receipt_rejected'
  | 'internal_failure';

export interface ExecutionFailurePayload {
  code: ExecutionFailureCode;
  message: string;
  details?: Record<string, unknown>;
}

export class ExecutionFailure extends Error {
  readonly code: ExecutionFailureCode;
  readonly details?: Record<string, unknown>;

  constructor(code: ExecutionFailureCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ExecutionFailure';
    this.code = code;
    this.details = details;
  }
}

const CONFIG_FALLBACK: ExecutionFailurePayload = {
  code: 'invalid_config',
  message: 'Invalid execution host configuration',
};

export function invalidArguments(error: ZodError): ExecutionFailure {
  return new ExecutionFailure('invalid_request', 'Invalid tool arguments', {
    issues: error.issues.slice(0, 8).map(issue => ({
      path: issue.path.join('.'),
      message: issue.message.slice(0, 200),
    })),
  });
}

export function configFailure(error: unknown): ExecutionFailure {
  if (error instanceof ExecutionFailure) return error;
  if (error instanceof ZodError) {
    return new ExecutionFailure(CONFIG_FALLBACK.code, CONFIG_FALLBACK.message, {
      issues: error.issues.slice(0, 8).map(issue => ({
        path: issue.path.join('.'),
        message: issue.message.slice(0, 200),
      })),
    });
  }
  return new ExecutionFailure(CONFIG_FALLBACK.code, CONFIG_FALLBACK.message);
}

export function sourceFailure(error: unknown): ExecutionFailure {
  if (error instanceof ExecutionFailure) return error;
  const code = typeof error === 'object' && error && 'code' in error ? String((error as { code?: unknown }).code) : '';
  const name = typeof error === 'object' && error && 'name' in error ? String((error as { name?: unknown }).name) : '';
  if (['ETIMEDOUT', 'ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT'].includes(code) || /timeout|abort/i.test(name)) {
    return new ExecutionFailure('source_unavailable', 'A configured source is unreachable');
  }
  return new ExecutionFailure('source_unavailable', 'A configured source could not be read');
}

/** A safe wire shape: never includes raw error text or host configuration values. */
export function failurePayload(error: unknown): ExecutionFailurePayload {
  const failure = error instanceof ExecutionFailure
    ? error
    : error instanceof ZodError
      ? invalidArguments(error)
      : new ExecutionFailure('internal_failure', 'Execution operation failed without a verified result. Reconcile any uncertain write before retrying.');
  return {
    code: failure.code,
    message: failure.message,
    ...(failure.details ? { details: failure.details } : {}),
  };
}
