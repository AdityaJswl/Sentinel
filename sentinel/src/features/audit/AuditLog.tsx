import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api, dateTime, label } from '../../lib/api';
import type { AuditEvent, Agent } from '../../lib/types';
import {
  EmptyState,
  ErrorNotice,
  JsonDetails,
  LoadingRows,
  VerdictBadge,
} from '../../components/Primitives';

const filterSchema = z
  .object({
    agentId: z.string(),
    verdict: z.enum(['', 'APPROVE', 'DENY', 'ESCALATE']),
    from: z.string(),
    to: z.string(),
  })
  .refine((values) => !values.from || !values.to || values.from <= values.to, {
    message: 'End date must be on or after the start date.',
    path: ['to'],
  });

type Filters = z.infer<typeof filterSchema>;
const emptyFilters: Filters = { agentId: '', verdict: '', from: '', to: '' };

export function AuditLog({ initialAgentId = '' }: { initialAgentId?: string }) {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [filters, setFilters] = useState<Filters>({ ...emptyFilters, agentId: initialAgentId });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<Filters>({ resolver: zodResolver(filterSchema), defaultValues: filters });

  useEffect(() => {
    let active = true;
    api<{ agents: Agent[] }>('/api/agents')
      .then((result) => {
        if (active) setAgents(result.agents);
      })
      .catch(() => {
        /* Audit remains usable when registry lookup is unavailable. */
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    const query = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value) query.set(key, value);
    });
    api<{ events: AuditEvent[] }>(`/api/audit?${query.toString()}`)
      .then((result) => {
        if (active) {
          setEvents(result.events);
          setError('');
        }
      })
      .catch((cause) => {
        if (active)
          setError(cause instanceof Error ? cause.message : 'The audit log could not be loaded.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [filters]);

  return (
    <>
      <header className="page-heading">
        <div>
          <p className="eyebrow">Recorded without revision</p>
          <h1>The evidence stays.</h1>
          <p>Registrations, checks, decisions, and artifact activity in one audit trail.</p>
        </div>
        <span className="neutral-tag">Append-only log</span>
      </header>
      <section className="panel">
        <form className="audit-filters" onSubmit={handleSubmit(setFilters)} noValidate>
          <label className="field">
            Agent
            <select {...register('agentId')}>
              <option value="">All accessible agents</option>
              {agents.map((agent) => (
                <option key={agent.agentId} value={agent.agentId}>
                  {agent.name}
                </option>
              ))}
              {initialAgentId && !agents.some((agent) => agent.agentId === initialAgentId) && (
                <option value={initialAgentId}>{initialAgentId}</option>
              )}
            </select>
          </label>
          <label className="field">
            Verdict
            <select {...register('verdict')}>
              <option value="">All verdicts</option>
              <option value="APPROVE">Approved</option>
              <option value="DENY">Denied</option>
              <option value="ESCALATE">Escalated</option>
            </select>
          </label>
          <label className="field">
            From
            <input type="date" {...register('from')} />
          </label>
          <label className="field">
            Through
            <input type="date" {...register('to')} aria-invalid={Boolean(errors.to)} />
            {errors.to && <span className="field-error">{errors.to.message}</span>}
          </label>
          <div className="filter-actions">
            <button className="button button--primary" type="submit">
              Apply
            </button>
            <button
              className="button button--quiet"
              type="button"
              onClick={() => {
                reset(emptyFilters);
                setFilters({ ...emptyFilters });
              }}
            >
              Clear
            </button>
          </div>
        </form>
        {error && <ErrorNotice message={error} />}
        {loading ? (
          <LoadingRows count={7} />
        ) : events.length ? (
          <div className="audit-events">
            {events.map((event) => (
              <article className="audit-event" key={event.id}>
                <div className="audit-event-time">
                  <time dateTime={event.createdAt}>{dateTime(event.createdAt)}</time>
                  <span className="mono">{event.id.slice(0, 12)}</span>
                </div>
                <div className="audit-event-body">
                  <div className="audit-event-title">
                    <h3>{label(event.eventType)}</h3>
                    {event.verdict && <VerdictBadge verdict={event.verdict} />}
                  </div>
                  <p>
                    <span>Actor</span> {event.actor}
                    {event.agentId && (
                      <>
                        {' '}
                        <span>· Agent</span> <span className="mono">{event.agentId}</span>
                      </>
                    )}
                  </p>
                  <JsonDetails title="Recorded context" value={event.context} />
                </div>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState title="No events match these filters.">
            Adjust the agent, verdict, or dates. New authorization activity is recorded here as it
            happens.
          </EmptyState>
        )}
        <div className="panel-footer">
          <span>{events.length} events in this view</span>
          <span>Read-only record</span>
        </div>
      </section>
    </>
  );
}
