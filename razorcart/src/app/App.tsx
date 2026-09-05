import * as Tooltip from '@radix-ui/react-tooltip';
import gsap from 'gsap';
import Lenis from 'lenis';
import { useEffect, useLayoutEffect } from 'react';
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom';
import { AgentProvider } from '../features/agents/AgentProvider';
import { CartProvider } from '../features/cart/CartProvider';
import { CatalogPage } from '../features/catalog/CatalogPage';
import { AgentSetupPage } from '../pages/AgentSetupPage';
import { AuditPage } from '../pages/AuditPage';
import { CheckoutPage } from '../pages/CheckoutPage';
import { NotFoundPage } from '../pages/NotFoundPage';
import '../styles/components.css';
import '../styles/pages.css';
import { AppShell } from './AppShell';

function Experience() {
  const location = useLocation();

  useEffect(() => {
    const lenis = new Lenis({ duration: 1, smoothWheel: true });
    let frame = 0;
    const raf = (time: number) => {
      lenis.raf(time);
      frame = requestAnimationFrame(raf);
    };
    frame = requestAnimationFrame(raf);
    return () => {
      cancelAnimationFrame(frame);
      lenis.destroy();
    };
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [location.pathname]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)
        return;
      if (location.pathname !== '/') return;
      event.preventDefault();
      document.getElementById('assistant-query')?.focus();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [location.pathname]);

  useLayoutEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const context = gsap.context(() => {
      const headings = document.querySelectorAll('.page-heading h1, .masthead-title');
      const catalogDetails = document.querySelectorAll('.catalog-title-block__top, .catalog-deck');
      if (headings.length) {
        gsap.fromTo(
          headings,
          { y: 34, opacity: 0 },
          { y: 0, opacity: 1, duration: 0.8, ease: 'power3.out' },
        );
      }
      if (catalogDetails.length) {
        gsap.fromTo(catalogDetails, { opacity: 0 }, { opacity: 1, duration: 0.6, delay: 0.25 });
      }
    });
    return () => context.revert();
  }, [location.pathname]);

  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<CatalogPage />} />
        <Route path="/admin" element={<AgentSetupPage />} />
        <Route path="/admin/agent-setup" element={<AgentSetupPage />} />
        <Route path="/checkout" element={<CheckoutPage />} />
        <Route path="/audit" element={<AuditPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </AppShell>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <Tooltip.Provider delayDuration={300}>
        <AgentProvider>
          <CartProvider>
            <Experience />
          </CartProvider>
        </AgentProvider>
      </Tooltip.Provider>
    </BrowserRouter>
  );
}
