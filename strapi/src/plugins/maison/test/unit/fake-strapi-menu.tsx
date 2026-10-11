import { AccessibleIcon, DesignSystemProvider, Tooltip, darkTheme, lightTheme } from '@strapi/design-system';
import { useState, type ComponentType } from 'react';
import { IntlProvider } from 'react-intl';
import { MemoryRouter, NavLink, useLocation } from 'react-router-dom';

/**
 * Strapi 5.57.0's left menu, as far as Maison's menu icon depends on it, for the tests of the assistant's mount. The assistant is drawn by the
 * menu icon, so how Strapi draws that icon decides whether the assistant stays on the screen. Each part below says which file of `@strapi/admin`
 * (`dist/admin/admin/src/...`) it follows. If a Strapi upgrade changes one of them, this stand-in is where to change it, and the tests then say
 * whether the icon still works.
 *
 * The one fact that matters most: Strapi makes the icon again on every change of location. `LeftMenu` reads the location (`useLocation`), so it
 * renders again each time the address changes, and `MainNavIcons` makes a new component type for every link on every render, so React throws
 * the old link away, with the icon in it, and draws a new one. A chat held by the icon would be lost at each click on a menu link, and at each
 * change of tab on the Maison page, which changes the address too.
 */

export interface MenuLink {
  to: string;
  label: string;
  icon: ComponentType<any>;
  /** Handlers on the link, so a test can see what reaches it from inside the assistant. */
  handlers?: Record<string, (event: any) => void>;
}

/**
 * `MainNavIcons` (components/MainNav/MainNavLinks.mjs, lines 47 to 99): each link is `Flex li > NavLink.Tooltip > LinkElement`, and `LinkElement`
 * is `NavLink.NavButton > NavLink.Icon > LinkIcon`, with the icon given `width="20" height="20" fill="neutral500"`. `NavLink.Tooltip` is a
 * design system `Tooltip` around a `span` (NavLink.mjs, lines 87 to 96), and `NavLink.Icon` is the design system's `AccessibleIcon` (lines 99 to 107).
 */
const MainNavIcons = ({ links }: { links: MenuLink[] }) => (
  <>
    {links.map((link) => {
      const LinkIcon = link.icon;
      // Written inside the map, as Strapi writes it (MainNavLinks.mjs, line 58): a new component type on every render of the menu.
      const LinkElement = () => (
        <NavLink to={link.to} aria-label={link.label} {...link.handlers}>
          <AccessibleIcon label={link.label}>
            <LinkIcon width="20" height="20" fill="neutral500" />
          </AccessibleIcon>
        </NavLink>
      );
      return (
        <li key={link.to}>
          <Tooltip label={link.label} side="right" delayDuration={0}>
            <span>
              <LinkElement />
            </span>
          </Tooltip>
        </li>
      );
    })}
  </>
);

/**
 * `MainNavBurgerMenuLinks` (MainNavLinks.mjs, lines 105 to 154): the menu of a narrow screen draws the icon again, in `NavLink.Link`, with the
 * same three props. It has no `LinkElement`, so the icon there is not drawn again when the menu renders again.
 */
const BurgerMenuLinks = ({ links }: { links: MenuLink[] }) => (
  <>
    {links.map((link) => {
      const LinkIcon = link.icon;
      return (
        <li key={link.to}>
          <NavLink to={link.to} aria-label={`${link.label} (mobile menu)`}>
            <LinkIcon width="20" height="20" fill="neutral500" />
            <span>{link.label}</span>
          </NavLink>
        </li>
      );
    })}
  </>
);

/**
 * `LeftMenu` (components/LeftMenu.mjs, lines 51 to 191): reads the location, so a change of address renders it again, and shows the burger menu
 * while `isBurgerMenuShown` is true. Pressing Menu changes that state, which renders the menu again too.
 */
export const FakeLeftMenu = ({ links }: { links: MenuLink[] }) => {
  const [burgerShown, setBurgerShown] = useState(false);
  useLocation();
  return (
    <nav aria-label="Main navigation">
      <ul>
        <MainNavIcons links={links} />
      </ul>
      <button type="button" aria-expanded={burgerShown} onClick={() => setBurgerShown((shown) => !shown)}>
        Menu
      </button>
      {burgerShown && (
        <div role="dialog" aria-label="Mobile menu">
          <ul>
            <BurgerMenuLinks links={links} />
          </ul>
        </div>
      )}
    </nav>
  );
};

/** The address, so a test can see which page the admin is on, and that a click did not take them to another. */
const Where = () => {
  const { pathname, search } = useLocation();
  return <p data-testid="location">{`${pathname}${search}`}</p>;
};

/**
 * `Theme` (components/Theme.mjs): the design system's provider with the theme the admin has chosen. A button switches it, as the profile menu does.
 * Strapi's own provider sits above the menu and above every page.
 */
const Themed = ({ children }: { children: React.ReactNode }) => {
  const [dark, setDark] = useState(false);
  return (
    <DesignSystemProvider locale="en" theme={dark ? darkTheme : lightTheme}>
      <button type="button" onClick={() => setDark((value) => !value)}>
        Switch the theme
      </button>
      {children}
    </DesignSystemProvider>
  );
};

/** The admin around the menu: the language provider, the router, the theme, the menu and a place that says where the admin is. */
export const FakeAdmin = ({ links, path = '/' }: { links: MenuLink[]; path?: string }) => (
  <IntlProvider locale="en" messages={{}}>
    <MemoryRouter initialEntries={[path]}>
      <Themed>
        <FakeLeftMenu links={links} />
        <main>
          <Where />
        </main>
      </Themed>
    </MemoryRouter>
  </IntlProvider>
);
