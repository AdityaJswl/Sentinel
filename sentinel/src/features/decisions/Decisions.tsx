import { useEffect, useState } from 'react';
import { ArrowUpRight, RefreshCw } from 'lucide-react';
import { api, dateTime, money } from '../../lib/api';
import type { Decision, Verdict } from '../../lib/types';
import { EmptyState, ErrorNotice, LoadingRows, VerdictBadge } from '../../components/Primitives';
import { DecisionDetail } from './DecisionDetail';

export function Decisions() {
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState<Verdict | 'ALL'>('ALL');
  const [updated, setUpdated] = useState<Date | null>(null);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let active = true;
    let pending = false;
    async function load() {
      if (pending) return;
      pending = true;
      try {
        const result = await api<{ decisions: Decision[] }>('/api/decisions');
        if (active) {
          setDecisions(result.decisions);
          setUpdated(new Date());
          setError('');
        }
      } catch (cause) {
        if (active)
          setError(cause instanceof Error ? cause.message : 'The feed could not be refreshed.');
      } finally {
        pending = false;
        if (active) setLoading(false);
      }
    }
    void load();
    const interval = window.setInterval(() => {
      if (!document.hidden) void load();
    }, 5000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [refresh]);

  const visible = decisions.filter((decision) => filter === 'ALL' || decision.verdict === filter);
  const counts = { APPROVE: 0, DENY: 0, ESCALATE: 0 };
  decisions.forEach((decision) => {
    counts[decision.verdict] += 1;
  });

  return (
    <>
      <header className="page-heading">
        <div>
          <p className="eyebrow">Authorization operations</p>
          <h1>The decision ledger.</h1>
          <p>Every request, its authority, and the reason behind the outcome.</p>
        </div>
        <span className={`connection-state ${error ? 'connection-state--stale' : ''}`}>
          <span />
          {error ? 'Connection interrupted' : loading ? 'Connecting' : 'Live · refreshes every 5s'}
        </span>
      </header>
      <div className="metric-strip">
        <div>
          <span>Recent decisions</span>
          <strong>{loading ? '—' : decisions.length.toString().padStart(2, '0')}</strong>
        </div>
        <div>
          <span>Approved</span>
          <strong>{loading ? '—' : counts.APPROVE.toString().padStart(2, '0')}</strong>
        </div>
        <div>
          <span>Denied</span>
          <strong>{loading ? '—' : counts.DENY.toString().padStart(2, '0')}</strong>
        </div>
        <div>
          <span>Needs review</span>
          <strong>{loading ? '—' : counts.ESCALATE.toString().padStart(2, '0')}</strong>
        </div>
      </div>
      <section className="panel">
        <div className="panel-toolbar">
          <div className="segmented-control" aria-label="Filter decisions">
            {(['ALL', 'APPROVE', 'DENY', 'ESCALATE'] as const).map((verdict) => (
              <button
                key={verdict}
                type="button"
                aria-pressed={filter === verdict}
                onClick={() => setFilter(verdict)}
              >
                {verdict === 'ALL'
                  ? 'All requests'
                  : verdict === 'APPROVE'
                    ? 'Approved'
                    : verdict === 'DENY'
                      ? 'Denied'
                      : 'Escalated'}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={() => setRefresh((value) => value + 1)}
            aria-label="Refresh decisions"
          >
            <RefreshCw size={16} />
          </button>
        </div>
        {error && <ErrorNotice message={error} />}
        {loading ? (
          <LoadingRows />
        ) : visible.length ? (
          <div className="table-scroll">
            <table className="data-table decisions-table">
              <thead>
                <tr>
                  <th>Agent / merchant</th>
                  <th>Amount</th>
                  <th>Decision</th>
                  <th>Reason</th>
                  <th>Time</th>
                  <th>
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((decision) => (
                  <tr key={decision.id}>
                    <td>
                      <button
                        type="button"
                        className="record-link"
                        onClick={() => setSelected(decision.id)}
                      >
                        {decision.agentName || decision.agentId}
                      </button>
                      <span className="cell-secondary">{decision.merchant}</span>
                    </td>
                    <td className="amount-cell">{money(decision.amount, decision.currency)}</td>
                    <td>
                      <VerdictBadge verdict={decision.verdict} />
                    </td>
                    <td>
                      <span className="reason-code">{decision.reason_code}</span>
                      <span className="cell-secondary reason-preview" title={decision.reason_text}>
                        {decision.reason_text}
                      </span>
                    </td>
                    <td className="time-cell">{dateTime(decision.createdAt)}</td>
                    <td>
                      <button
                        type="button"
                        className="icon-button"
                        onClick={() => setSelected(decision.id)}
                        aria-label={`View decision ${decision.requestId}`}
                      >
                        <ArrowUpRight size={17} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title={decisions.length ? 'No decisions in this view.' : 'Ready for the first request.'}
          >
            {decisions.length
              ? 'Choose another verdict to see its authorization records.'
              : 'Submit a purchase for authorization in RazorCart. Its checks and outcome will appear here as soon as Sentinel decides.'}
          </EmptyState>
        )}
        <div className="panel-footer">
          <span>{visible.length} records in this view</span>
          <span>
            {updated ? `Updated ${updated.toLocaleTimeString('en-IN')}` : 'Awaiting connection'}
          </span>
        </div>
      </section>
      <div className="control-note">
        <span className="eyebrow">Order of authority</span>
        <p>
          Identity & delegation <span>→</span> Hard controls <span>→</span> Risk reasoning{' '}
          <span>→</span> Signed artifact
        </p>
      </div>
      {selected && <DecisionDetail key={selected} id={selected} close={() => setSelected(null)} />}
    </>
  );
}
