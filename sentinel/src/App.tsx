import { useEffect, useState } from 'react';
import { ArrowUpRight, ListFilter, LogOut, PanelLeft, ScrollText, Users } from 'lucide-react';
import { sessionUser, supabase } from './lib/supabase';
import type { SessionUser } from './lib/types';
import { Login } from './features/auth/Login';
import { Decisions } from './features/decisions/Decisions';
import { AgentRegistry } from './features/agents/AgentRegistry';
import { AuditLog } from './features/audit/AuditLog';
import { ErrorNotice, LoadingRows } from './components/Primitives';

function locationState() {
  const [section, query = ''] = window.location.hash.slice(1).split('?');
  return {
    section: section || 'decisions',
    agentId: new URLSearchParams(query).get('agentId') || '',
  };
}

export default function App() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [checking, setChecking] = useState(true);
  const [route, setRoute] = useState(locationState);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setUser(data.session?.user ? sessionUser(data.session.user) : null);
      setChecking(false);
    });
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) setUser(session?.user ? sessionUser(session.user) : null);
    });
    const navigate = () => {
      setRoute(locationState());
      setMobileOpen(false);
    };
    const sessionExpired = () => {
      void supabase.auth.signOut({ scope: 'local' });
      setUser(null);
    };
    window.addEventListener('hashchange', navigate);
    window.addEventListener('sentinel:session-expired', sessionExpired);
    return () => {
      active = false;
      authListener.subscription.unsubscribe();
      window.removeEventListener('hashchange', navigate);
      window.removeEventListener('sentinel:session-expired', sessionExpired);
    };
  }, []);

  async function logout() {
    try {
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) throw signOutError;
      setUser(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not sign out.');
    }
  }

  if (checking)
    return (
      <main className="session-loading">
        <span className="wordmark">
          Sentinel<span> / </span>
        </span>
        <LoadingRows count={3} />
      </main>
    );
  if (!user) return <Login onLogin={setUser} />;

  const knownRoute = ['decisions', 'agents', 'audit'].includes(route.section);

  return (
    <div className="app-shell">
      <a
        href="#main"
        className="skip-link"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById('main')?.focus();
        }}
      >
        Skip to content
      </a>
      <header className="mobile-header">
        <a href="#decisions" className="wordmark">
          Sentinel<span> / </span>
        </a>
        <button
          className="icon-button"
          type="button"
          aria-expanded={mobileOpen}
          aria-label="Toggle navigation"
          onClick={() => setMobileOpen(!mobileOpen)}
        >
          <PanelLeft size={21} />
        </button>
      </header>
      <aside className={`sidebar ${mobileOpen ? 'sidebar--open' : ''}`}>
        <a href="#decisions" className="wordmark sidebar-wordmark">
          Sentinel<span> / </span>
        </a>
        <p className="sidebar-subtitle">Authorization console</p>
        <nav aria-label="Main navigation">
          {[
            { id: 'decisions', name: 'Decision feed', icon: ListFilter },
            { id: 'agents', name: 'Agent registry', icon: Users },
            { id: 'audit', name: 'Audit trail', icon: ScrollText },
          ].map(({ id, name, icon: Icon }) => (
            <a href={`#${id}`} key={id} aria-current={route.section === id ? 'page' : undefined}>
              <Icon size={17} />
              <span>{name}</span>
              {route.section === id && <span className="nav-active-mark" />}
            </a>
          ))}
        </nav>
        <div className="sidebar-note">
          <span className="eyebrow">Independent by design</span>
          <p>
            A buying agent proposes.
            <br />
            Sentinel verifies its authority.
          </p>
        </div>
        <div className="sidebar-account">
          <div className="account-avatar">{user.username.slice(0, 1).toUpperCase()}</div>
          <div>
            <strong>{user.username}</strong>
            <span>{user.role === 'admin' ? 'Administrator' : 'Agent operator'}</span>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={() => void logout()}
            aria-label="Sign out"
          >
            <LogOut size={16} />
          </button>
        </div>
      </aside>
      <div className="workspace">
        <div className="workspace-bar">
          <span>
            Sentinel <span className="breadcrumb-divider">/</span>{' '}
            {route.section === 'agents'
              ? 'Agent registry'
              : route.section === 'audit'
                ? 'Audit trail'
                : 'Decision feed'}
          </span>
          <span>
            RazorCart product suite <ArrowUpRight size={13} />
          </span>
        </div>
        <main id="main" tabIndex={-1} className="main-content">
          {error && <ErrorNotice message={error} />}
          {route.section === 'decisions' && <Decisions />}
          {route.section === 'agents' && <AgentRegistry isAdmin={user.role === 'admin'} />}
          {route.section === 'audit' && (
            <AuditLog key={route.agentId} initialAgentId={route.agentId} />
          )}
          {!knownRoute && (
            <div className="not-found">
              <p className="eyebrow">404 / Unlisted destination</p>
              <h1>This page isn’t in the ledger.</h1>
              <p>Your authorization records are still where you left them.</p>
              <a className="button button--primary" href="#decisions">
                Return to decisions
                <ArrowUpRight size={16} />
              </a>
            </div>
          )}
          <footer className="workspace-footer">
            <span>Sentinel</span>
            <p>Authority before action.</p>
          </footer>
        </main>
      </div>
    </div>
  );
}
