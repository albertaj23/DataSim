import { motion } from 'motion/react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { ALL_ITEMS } from './nav';
import { DataSimLogo } from '../brand/DataSimLogo';

/** Desktop morphic navigation: the active route lifts out of the glass rail. */
export function DesktopNavbar() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  return (
    <nav aria-label="Main desktop" className="desktop-navbar">
      <div className="desktop-navbar-glass">
        <NavLink to="/" aria-label="DataSim home" className="desktop-nav-brand">
          <DataSimLogo symbolSize={28} animateIntro />
        </NavLink>
        {ALL_ITEMS.map((item) => {
          const active = item.to === '/' ? pathname === '/' || pathname.startsWith('/workspaces/') : pathname.startsWith(item.to);
          return (
            <NavLink key={item.to} to={item.to} end={item.to === '/'} className="desktop-nav-link" onClick={(event) => { event.preventDefault(); navigate(item.to); }}>
              {active && <motion.span layoutId="desktop-nav-active" className="desktop-nav-active" transition={{ type: 'spring', stiffness: 420, damping: 32 }} />}
              <item.Icon size={15} aria-hidden />
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}
