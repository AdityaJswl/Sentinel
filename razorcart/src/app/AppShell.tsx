import { Menu, Search, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { AgentSelector } from '../features/agents/AgentSelector';
import { CartButton, CartDrawer } from '../features/cart/CartDrawer';
import { useCart } from '../features/cart/CartProvider';

export function AppShell({ children }: { children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { message } = useCart();

  function focusAssistant() {
    if (location.pathname !== '/') {
      navigate('/');
      window.setTimeout(() => {
        document.getElementById('assistant-query')?.focus();
      }, 80);
      return;
    }
    document.getElementById('assistant-query')?.focus();
    document
      .getElementById('shopping-desk')
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  return (
    <div className="site-frame">
      <header className="site-header">
        <Link
          to="/"
          className="wordmark"
          aria-label="RazorCart home"
          onClick={() => setMenuOpen(false)}
        >
          <span className="wordmark__cut">R</span>
          <span>RazorCart</span>
        </Link>
        <nav
          className={`site-nav ${menuOpen ? 'site-nav--open' : ''}`}
          aria-label="Primary navigation"
        >
          <NavLink to="/" end onClick={() => setMenuOpen(false)}>
            Catalog
          </NavLink>
          <NavLink to="/admin/agent-setup" onClick={() => setMenuOpen(false)}>
            Agent setup
          </NavLink>
          <NavLink to="/audit" onClick={() => setMenuOpen(false)}>
            Audit trail
          </NavLink>
          <div className="site-nav__mobile-agent">
            <AgentSelector />
          </div>
        </nav>
        <div className="site-header__actions">
          <button className="header-search" type="button" onClick={focusAssistant}>
            <Search size={16} /> <span>Ask the desk</span> <kbd>/</kbd>
          </button>
          <div className="site-header__agent">
            <AgentSelector compact />
          </div>
          <CartButton />
          <button
            className="menu-button"
            type="button"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </header>
      {children}
      <footer className="site-footer">
        <div>
          <span className="wordmark wordmark--footer">RazorCart</span>
          <p>A buying agent with the receipts left in.</p>
        </div>
        <div className="site-footer__links">
          <Link to="/admin/agent-setup">Delegations</Link>
          <Link to="/audit">Transparency log</Link>
          <span>No payment rail connected</span>
        </div>
        <small>Catalog data refreshed from DummyJSON · Prices shown in INR</small>
      </footer>
      <CartDrawer />
      <div className={`toast ${message ? 'toast--visible' : ''}`} role="status" aria-live="polite">
        {message}
      </div>
    </div>
  );
}
