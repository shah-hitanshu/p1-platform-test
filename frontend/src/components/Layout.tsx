/**
 * Layout Component
 *
 * Main application shell using PDS dashboard components.
 */

import { NavLink, Link, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import {
  DashboardGlobal,
  DashboardInner,
  DashboardNav,
  Navbar,
  PantheonLogo,
  SiteFooter,
  UserMenu,
} from '@pantheon-systems/pds-toolkit-react';

const navItems = [
  { icon: 'house' as const, label: 'Dashboard', to: '/', end: true },
  { icon: 'sitemap' as const, label: 'Sites', to: '/sites', end: false },
  { icon: 'users' as const, label: 'Users', to: '/users', end: false },
  { icon: 'robot' as const, label: 'Agents', to: '/agents', end: false },
];

export function Layout() {
  const { user, logout } = useAuth();
  const location = useLocation();

  const userMenuItems = [{ label: 'Log out', callback: logout, iconName: 'xmark' as const }];

  return (
    <DashboardGlobal logoLinkContent={<Link to="/">P1</Link>}>
      <Navbar
        slot="header"
        colorType="transparent"
        containerWidth="full"
        hideLogo
        hideBorder
      >
        <UserMenu
          slot="items-right"
          userName={user?.name}
          userEmail={user?.email}
          menuItems={userMenuItems}
        />
      </Navbar>

      <div slot="sidebar" className="sidebar-content">
        <PantheonLogo
          displayType="sub-brand"
          subBrand="P1"
          linkContent={<Link to="/">P1</Link>}
        />
        <DashboardNav
          ariaLabel="Main navigation"
          data-testid="sidebar"
          menuItems={navItems.map((item) => ({
          icon: item.icon,
          isActive: item.end
            ? location.pathname === item.to
            : location.pathname.startsWith(item.to),
          linkContent: (
            <NavLink
              to={item.to}
              end={item.end}
              data-testid={`nav-${item.label.toLowerCase()}`}
            >
              {item.label}
            </NavLink>
          ),
        }))}
        />
      </div>

      <DashboardInner slot="main">
        <Outlet />
      </DashboardInner>

      <SiteFooter
        slot="footer"
        containerWidth="full"
        hasTopBorder
        legalLinks={[
          'privacy',
          'cookiePolicy',
          'termsOfUse',
          'acceptableUse',
          'accessibilityStatement',
        ]}
      />
    </DashboardGlobal>
  );
}
