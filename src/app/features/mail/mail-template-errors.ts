import { HttpErrorResponse } from '@angular/common/http';

import { FastApiValidationError } from '../../core/models/auth.models';

export interface MailTemplateErrorDetails {
  message: string;
  fields: Record<string, string>;
  unknownPlaceholders: string[];
}

export function mailTemplateErrorDetails(
  error: unknown,
  fallback: string,
): MailTemplateErrorDetails {
  const result: MailTemplateErrorDetails = {
    message: fallback,
    fields: {},
    unknownPlaceholders: [],
  };
  if (!(error instanceof HttpErrorResponse)) return result;
  const problem = (error.error || {}) as {
    message?: string;
    detail?: string | FastApiValidationError[] | { message?: string; placeholders?: string[] };
  };
  if (typeof problem.detail === 'string') result.message = problem.detail;
  else if (problem.detail && !Array.isArray(problem.detail)) {
    result.message = problem.detail.message || fallback;
    result.unknownPlaceholders = problem.detail.placeholders || [];
  } else if (Array.isArray(problem.detail)) {
    for (const item of problem.detail) {
      const field =
        item.field ||
        item.loc
          ?.filter((part) => part !== 'body')
          .at(-1)
          ?.toString();
      const message = item.msg || item.message || 'Invalid value';
      if (field) result.fields[field] = message;
    }
    const messages = Object.values(result.fields);
    if (messages.length) result.message = messages.join(' ');
  } else if (problem.message) result.message = problem.message;
  if (error.status === 413) result.message = 'The selected file exceeds the backend upload limit.';
  if (error.status === 403) result.message = 'You do not have permission to perform this action.';
  return result;
}
