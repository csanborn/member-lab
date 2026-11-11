import { useEffect, useRef } from 'react';
import { NavLink, Route, Routes, useLocation } from 'react-router';
import { CrateLogo } from './components/CrateLogo';
import { Experiments } from './pages/Experiments';
import { Join } from './pages/Join';
import { Landing } from './pages/Landing';
import { Member } from './pages/Member';
import { NotFound } from './pages/NotFound';
import { resetVisitor, useVisitorId } from './visitor';

const TITLES: Record<string, string> = {
  '/': 'Crate Club by Corner Crate',
  '/join': 'Join Crate Club',
  '/member': 'Your membership',
  '/experiments': 'Experiment results',
};

/** On navigation: set the title and move focus to the main region, so screen readers hear the new page. */
function useRouteAnnouncements() {
  const { pathname } = useLocation();
  const main = useRef<HTMLElement>(null);
  const first = useRef(true);
  useEffect(() => {
    document.title = TITLES[pathname] ?? 'Page not found';
    if (first.current) {
      first.current = false;
      return;
    }
    main.current?.focus();
  }, [pathname]);
  return main;
}

export function App() {
  const main = useRouteAnnouncements();
  const visitorId = useVisitorId();

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <div className="container site-header__inner">
          <NavLink to="/" className="brand" aria-label="Corner Crate home">
            <CrateLogo />
            <span>
              Corner Crate <span className="brand__club">Crate Club</span>
            </span>
          </NavLink>
          <nav aria-label="Main">
            <ul className="nav">
              <li>
                <NavLink to="/" end>
                  Membership
                </NavLink>
              </li>
              <li>
                <NavLink to="/member">My membership</NavLink>
              </li>
              <li>
                <NavLink to="/experiments">Experiments</NavLink>
              </li>
            </ul>
          </nav>
        </div>
      </header>

      <main id="main" ref={main} tabIndex={-1}>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/join" element={<Join />} />
          <Route path="/member" element={<Member />} />
          <Route path="/experiments" element={<Experiments />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>

      <footer className="site-footer">
        <div className="container site-footer__inner">
          <p>Corner Crate and Crate Club are fictional. No real payments are made.</p>
          <p className="visitor">
            <span>
              Visitor <code data-testid="visitor-id">{visitorId.slice(0, 8)}</code>
            </span>
            <button type="button" className="button button--link" onClick={resetVisitor}>
              Start over as a new visitor
            </button>
          </p>
        </div>
      </footer>
    </>
  );
}
