import { Link } from '@tanstack/react-router';

import { COPY } from '../lib/copy';
import { errorText, leadsHome, type ScreenError } from '../lib/status';
import { ErrorNote } from './error-note';
import { useMaison } from './maison-provider';
import { Spinner } from './spinner';

/**
 * Loading and error states for one tool call: LINE's spinner, or the error in red (ErrorNote). People see plain copy
 * for the error's code; the tool's own message and hint are written for agents, and the agent view shows them (mock
 * mode adds them on a technical line). An error that trying again can't fix offers a way back, not a retry: not_found,
 * and invalid_input when the call's input came from the URL (`fromUrl`).
 */
export function StatusNote({
  loading,
  error,
  retry,
  fromUrl = false,
}: {
  loading: boolean;
  error: ScreenError | null;
  retry: () => void;
  fromUrl?: boolean;
}) {
  const { locale } = useMaison();
  const t = COPY[locale];
  if (error) {
    return (
      <ErrorNote
        error={error}
        className="mx-5 my-6"
        action={
          leadsHome(error.code, fromUrl) ? (
            <Link to="/" className="btn-text">
              {t.backHome}
            </Link>
          ) : (
            <button type="button" onClick={retry} className="btn-text">
              {t.retry}
            </button>
          )
        }
      >
        {errorText(error, locale)}
      </ErrorNote>
    );
  }
  return loading ? <Spinner label={t.loading} /> : null;
}
