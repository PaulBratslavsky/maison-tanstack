import type { DefaultTheme } from 'styled-components';

/**
 * The z-index of the assistant's launcher and drawer: 299.
 *
 * It is one below the design system's `zIndices.overlay` (300), the dim layer behind its dialogs. The Reply on LINE, Answer and Change label
 * dialogs are a `Modal`, whose box is `zIndices.modal` (310), so each opens above the drawer, and the dim layer covers the drawer with the page.
 *
 * It is above everything the admin draws at the level of its layout: the left menu is 4, the sticky page headers 2, the guided tour 10 and the
 * survey card 200. So the drawer covers them, and nothing of Strapi's sits over the chat. It is below `zIndices.popover` (500, the lists a
 * Select opens), notifications (700) and tooltips (1000), which belong above whatever is under them.
 *
 * It is worked out from the theme and not written as a number, so it stays one below the overlay if the design system moves its layers.
 */
export const assistantLayer = ({ theme }: { theme: DefaultTheme }): number => theme.zIndices.overlay - 1;
