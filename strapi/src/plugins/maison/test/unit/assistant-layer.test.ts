// @vitest-environment jsdom
import { darkTheme, lightTheme } from '@strapi/design-system';
import { describe, expect, it } from 'vitest';
import { assistantLayer } from '../../admin/src/components/assistant/layer';

/**
 * Where the launcher and the drawer sit in the stack. The numbers the admin writes itself are from @strapi/admin 5.57.0: the left menu
 * (`MainNav.mjs`, z-index 4), the sticky page header (`HeaderLayout.mjs`, 2), the guided tour (`Tours.mjs`, 10) and the survey card
 * (`NpsSurvey.mjs`, 200). The rest are the design system's own `theme.zIndices`.
 */
const ADMIN_LAYOUT_LAYERS = { leftMenu: 4, pageHeader: 2, guidedTour: 10, surveyCard: 200 };

describe.each([
  ['light', lightTheme],
  ['dark', darkTheme],
])('the assistant layer, in the %s theme', (_name, theme) => {
  const layer = assistantLayer({ theme });

  it('is above the design system\'s navigation layer, and above everything the admin draws at the level of its layout', () => {
    expect(layer).toBeGreaterThan(theme.zIndices.navigation);
    for (const [name, value] of Object.entries(ADMIN_LAYOUT_LAYERS)) expect(layer, name).toBeGreaterThan(value);
  });

  it('is below the dim layer behind the design system\'s dialogs, below its modals, and below its dialogs: Reply on LINE and Answer open above the drawer', () => {
    expect(layer).toBeLessThan(theme.zIndices.overlay);
    expect(layer).toBeLessThan(theme.zIndices.modal);
    expect(layer).toBeLessThan(theme.zIndices.dialog);
  });

  it('is below popovers, notifications and tooltips', () => {
    expect(layer).toBeLessThan(theme.zIndices.popover);
    expect(layer).toBeLessThan(theme.zIndices.notification);
    expect(layer).toBeLessThan(theme.zIndices.tooltip);
  });

  it('is one below the overlay, which is the value the comment on it names: 299 in design system 2.2.4', () => {
    expect(layer).toBe(theme.zIndices.overlay - 1);
    expect(layer).toBe(299);
  });
});
