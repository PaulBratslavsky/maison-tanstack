import type { ReactNode } from 'react';

import type { ScreenError } from '../lib/status';
import { ErrorDetail } from './error-detail';

/**
 * An error in the customer's words: the error red, after a thin red rule. Under it, in mock mode, the technical cause
 * (ErrorDetail), then an optional way on, such as "Try again" or "Back to the start" (a .btn-text). It's an alert unless
 * the caller says it's a status, like a date the sheet can't take.
 */
export function ErrorNote({
  error,
  action,
  role = 'alert',
  className = '',
  children,
}: {
  error?: Pick<ScreenError, 'code' | 'message'> | null;
  action?: ReactNode;
  role?: 'alert' | 'status';
  className?: string;
  children: ReactNode;
}) {
  return (
    <div role={role} className={`border-l border-error pl-4 text-body text-error ${className}`}>
      <p>{children}</p>
      {error && <ErrorDetail error={error} />}
      {action}
    </div>
  );
}
