import * as Tabs from '@radix-ui/react-tabs';
import {
  Activity,
  Bot,
  Check,
  ChevronDown,
  Clock3,
  RefreshCcw,
  ShieldCheck,
  ShieldX,
  TriangleAlert,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button, EmptyState, Skeleton, StatusPill } from '../components/ui';
import { api } from '../lib/api';
import { relativeTime, shortDate } from '../lib/format';
import type { AuditEvent } from '../lib/types';

type Filter = 'all' | 'ai' | 'authorization';

function EventIcon({ event }: { event: AuditEvent }) {
  if (event.kind === 'ai_action') return <Bot size={17} />;
  if (event.status === 'APPROVE') return <ShieldCheck size={17} />;
  if (event.status === 'ESCALATE') return <TriangleAlert size={17} />;
  return <ShieldX size={17} />;
}

export function AuditPage() {
  const [filter, setFilter] = useState<Filter>('all');
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (type: Filter) => {
    setLoading(true);
    setError('');
    try {
      const response = await api<{ events: AuditEvent[] }>(`/api/audit?type=${type}`);
      setEvents(response.events);
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : 'The audit trail could not be read.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // A filter change intentionally starts the corresponding remote ledger read.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(filter);
  }, [filter, load]);

  const counts = {
    approvals: events.filter((event) => event.status === 'APPROVE').length,
    blocks: events.filter((event) => event.status === 'DENY').length,
    explanations: events.filter((event) => event.kind === 'ai_action').length,
  };

  return (
    <main className="audit-page page-shell">
      <section className="page-heading page-heading--split">
        <div>
          <span className="eyebrow">Internal transparency</span>
          <h1>Every recommendation leaves a receipt.</h1>
        </div>
        <p>
          Shopping intent, recommendations, generated proposals, and Sentinel outcomes appear here
          without exposing delivery-address details.
        </p>
      </section>
      <section className="audit-summary">
        <div>
          <span>Recorded events</span>
          <strong>{events.length.toString().padStart(2, '0')}</strong>
        </div>
        <div>
          <span>Approvals</span>
          <strong>{counts.approvals.toString().padStart(2, '0')}</strong>
        </div>
        <div>
          <span>Prevented</span>
          <strong>{counts.blocks.toString().padStart(2, '0')}</strong>
        </div>
        <div>
          <span>Assistant actions</span>
          <strong>{counts.explanations.toString().padStart(2, '0')}</strong>
        </div>
      </section>
      <section className="audit-ledger">
        <div className="audit-ledger__head">
          <Tabs.Root value={filter} onValueChange={(value) => setFilter(value as Filter)}>
            <Tabs.List className="audit-tabs" aria-label="Audit event filters">
              <Tabs.Trigger value="all">All events</Tabs.Trigger>
              <Tabs.Trigger value="ai">Assistant</Tabs.Trigger>
              <Tabs.Trigger value="authorization">Authorization</Tabs.Trigger>
            </Tabs.List>
          </Tabs.Root>
          <Button tone="quiet" onClick={() => void load(filter)} disabled={loading}>
            <RefreshCcw size={15} /> Refresh
          </Button>
        </div>
        {loading ? (
          <div className="audit-skeleton">
            {[0, 1, 2, 3].map((item) => (
              <div key={item}>
                <Skeleton />
                <Skeleton />
              </div>
            ))}
          </div>
        ) : error ? (
          <EmptyState
            eyebrow="Ledger unavailable"
            title="The record could not be opened."
            body={error}
            action={<Button onClick={() => void load(filter)}>Read it again</Button>}
          />
        ) : !events.length ? (
          <EmptyState
            eyebrow="A clean first page"
            title="No actions have been taken yet."
            body="Ask the shopping desk for a recommendation or submit a purchase proposal; the corresponding record will appear here."
          />
        ) : (
          <div className="audit-events">
            {events.map((event, index) => (
              <article className="audit-event" key={event.id}>
                <div className="audit-event__index">{String(index + 1).padStart(2, '0')}</div>
                <div
                  className={`audit-event__icon audit-event__icon--${event.status.toLowerCase()}`}
                >
                  <EventIcon event={event} />
                </div>
                <div className="audit-event__main">
                  <div className="audit-event__title">
                    <div>
                      <span>
                        {event.kind === 'ai_action' ? 'Assistant action' : 'Sentinel decision'}
                      </span>
                      <h2>{event.action.replace(/_/g, ' ')}</h2>
                    </div>
                    {event.kind === 'authorization' ? (
                      <StatusPill
                        tone={
                          event.status === 'APPROVE'
                            ? 'approved'
                            : event.status === 'ESCALATE'
                              ? 'escalated'
                              : 'denied'
                        }
                      >
                        {event.status}
                      </StatusPill>
                    ) : (
                      <StatusPill tone="neutral">Recorded</StatusPill>
                    )}
                  </div>
                  <dl className="audit-event__copy">
                    <div>
                      <dt>Input summary</dt>
                      <dd>{event.input}</dd>
                    </div>
                    <div>
                      <dt>Output summary</dt>
                      <dd>{event.output}</dd>
                    </div>
                  </dl>
                  {event.metadata ? (
                    <details className="audit-event__details">
                      <summary>
                        Machine-readable context <ChevronDown size={14} />
                      </summary>
                      <pre>{JSON.stringify(event.metadata, null, 2)}</pre>
                    </details>
                  ) : null}
                </div>
                <div className="audit-event__time">
                  <Clock3 size={14} />
                  <span>{relativeTime(event.createdAt)}</span>
                  <small>{shortDate(event.createdAt)}</small>
                </div>
              </article>
            ))}
          </div>
        )}
        <div className="audit-integrity-note">
          <Activity size={17} />
          <p>
            Audit summaries are designed for transparency, not payment settlement. Address values
            are redacted and no card or gateway data is collected.
          </p>
          <span>
            <Check size={14} /> Privacy-aware
          </span>
        </div>
      </section>
    </main>
  );
}
