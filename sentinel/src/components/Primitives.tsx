import type { ReactNode } from 'react';
import { Check, Minus, X } from 'lucide-react';
import type { Verdict } from '../lib/types';

export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  const Icon = verdict === 'APPROVE' ? Check : verdict === 'DENY' ? X : Minus;
  return (
    <span className={`verdict verdict--${verdict.toLowerCase()}`}>
      <Icon size={12} strokeWidth={2.5} aria-hidden="true" />
      {verdict === 'APPROVE' ? 'Approved' : verdict === 'DENY' ? 'Denied' : 'Escalated'}
    </span>
  );
}

export function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="empty-state">
      <span className="ledger-mark" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}

export function LoadingRows({ count = 5 }: { count?: number }) {
  return (
    <div className="loading-rows" aria-label="Loading records" role="status">
      {Array.from({ length: count }, (_, i) => (
        <div className="loading-row" key={i}>
          <span />
          <span />
          <span />
        </div>
      ))}
      <span className="sr-only">Loading records…</span>
    </div>
  );
}

export function ErrorNotice({ message }: { message: string }) {
  return (
    <div className="error-notice" role="alert">
      {message}
    </div>
  );
}

export function JsonDetails({ title, value }: { title: string; value: unknown }) {
  return (
    <details className="json-details">
      <summary>{title}</summary>
      <pre>{JSON.stringify(value, null, 2)}</pre>
    </details>
  );
}
