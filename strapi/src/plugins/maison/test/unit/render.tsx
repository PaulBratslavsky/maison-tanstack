import { DesignSystemProvider, darkTheme, lightTheme } from '@strapi/design-system';
import { cleanup, render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach } from 'vitest';

// Vitest has no globals here, so Testing Library can't register its own clean-up: without it each render stays in the document.
afterEach(cleanup);

/**
 * Renders `ui` inside the design system's provider, in the light theme or the dark one, as the Strapi admin shows it. `rerender` keeps the
 * provider around what it is given, which Testing Library's own does not. The provider adds two live regions of its own to the document
 * (`role="status"` and `role="alert"`), so a test that looks for one of those roles looks inside the element it tests, or by name.
 */
export const renderInTheme = (ui: ReactElement, { dark = false }: { dark?: boolean } = {}) => {
  const inProvider = (node: ReactElement) => (
    <DesignSystemProvider locale="en" theme={dark ? darkTheme : lightTheme}>
      {node}
    </DesignSystemProvider>
  );
  const view = render(inProvider(ui));
  return { ...view, rerender: (next: ReactElement) => view.rerender(inProvider(next)) };
};
