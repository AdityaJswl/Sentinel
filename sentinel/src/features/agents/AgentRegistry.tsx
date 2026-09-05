import { useEffect, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { api, dateTime, label, money } from '../../lib/api';
import type { Agent } from '../../lib/types';
import { EmptyState, ErrorNotice, LoadingRows } from '../../components/Primitives';

export function AgentRegistry({ isAdmin }: { isAdmin: boolean }) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let active = true;
    api<{ agents: Agent[] }>('/api/agents')
      .then((result) => {
        if (active) {
          setAgents(result.agents);
          setError('');
        }
      })
      .catch((cause) => {
        if (active)
          setError(cause instanceof Error ? cause.message : 'Agent records could not be loaded.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [refresh]);

  async function revoke(agentId: string) {
    setBusy(agentId);
    setError('');
    try {
      await api(`/api/agents/${encodeURIComponent(agentId)}/revoke`, {
        method: 'POST',
        body: '{}',
      });
      setConfirming(null);
      setRefresh((value) => value + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'This agent could not be revoked.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <header className="page-heading">
        <div>
          <p className="eyebrow">Delegated authority</p>
          <h1>Agents & their limits.</h1>
          <p>A separate scope and spending allowance for every buying agent.</p>
        </div>
        <button
          className="button button--quiet"
          onClick={() => setRefresh((value) => value + 1)}
          type="button"
        >
          Refresh registry
        </button>
      </header>
      {error && <ErrorNotice message={error} />}
      {loading ? (
        <div className="panel">
          <LoadingRows />
        </div>
      ) : agents.length ? (
        <div className="agent-list">
          {agents.map((agent) => {
            const used = agent.spent + agent.reserved;
            const percent =
              agent.totalLimit > 0
                ? Math.min(100, Math.max(0, (used / agent.totalLimit) * 100))
                : 0;
            const expired = new Date(agent.expiresAt).getTime() < Date.now();
            const active = agent.status.toUpperCase() === 'ACTIVE' && !expired;
            return (
              <article className="agent-card" key={agent.agentId}>
                <div className="agent-card-header">
                  <div>
                    <span className={`agent-status ${active ? 'agent-status--active' : ''}`}>
                      <span />
                      {expired && agent.status.toUpperCase() === 'ACTIVE'
                        ? 'Expired'
                        : label(agent.status)}
                    </span>
                    <h2>{agent.name}</h2>
                    <p className="mono muted">{agent.agentId}</p>
                  </div>
                  <a
                    className="text-link"
                    href={`#audit?agentId=${encodeURIComponent(agent.agentId)}`}
                  >
                    View history
                    <ArrowUpRight size={16} />
                  </a>
                </div>
                <div className="agent-budget">
                  <div>
                    <span>Committed budget</span>
                    <strong>
                      {money(used)} <span>/ {money(agent.totalLimit)}</span>
                    </strong>
                  </div>
                  <div
                    className="budget-track"
                    role="meter"
                    aria-label={`${agent.name} budget used`}
                    aria-valuemin={0}
                    aria-valuemax={agent.totalLimit}
                    aria-valuenow={Math.min(used, agent.totalLimit)}
                  >
                    <span style={{ width: `${percent}%` }} />
                  </div>
                  <p>
                    <span>{money(agent.spent)} spent</span>
                    <span>{money(agent.reserved)} reserved</span>
                    <span>{money(Math.max(0, agent.totalLimit - used))} available</span>
                  </p>
                </div>
                <dl className="agent-limits">
                  <div>
                    <dt>Per transaction</dt>
                    <dd>{money(agent.perTransactionLimit)}</dd>
                  </div>
                  <div>
                    <dt>Transactions</dt>
                    <dd>
                      {agent.transactionCount} / {agent.transactionCountLimit}
                    </dd>
                  </div>
                  <div>
                    <dt>Delegation expires</dt>
                    <dd>{dateTime(agent.expiresAt)}</dd>
                  </div>
                </dl>
                <div className="agent-scope">
                  <div>
                    <span className="scope-label">Categories</span>
                    <div className="scope-tags">
                      {agent.allowedCategories.length ? (
                        agent.allowedCategories.map((category) => (
                          <span key={category}>{label(category)}</span>
                        ))
                      ) : (
                        <span>None allowed</span>
                      )}
                    </div>
                  </div>
                  <div>
                    <span className="scope-label">Merchants</span>
                    <div className="scope-tags">
                      {agent.allowedMerchants.length ? (
                        agent.allowedMerchants.map((merchant) => (
                          <span key={merchant}>{merchant}</span>
                        ))
                      ) : (
                        <span>None allowed</span>
                      )}
                    </div>
                  </div>
                </div>
                {isAdmin && agent.status.toUpperCase() === 'ACTIVE' && (
                  <div className="agent-actions">
                    {confirming === agent.agentId ? (
                      <>
                        <p>Revoke authority for this agent? Future requests will be denied.</p>
                        <div>
                          <button
                            type="button"
                            className="button button--quiet"
                            disabled={busy !== null}
                            onClick={() => setConfirming(null)}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            className="button button--danger"
                            disabled={busy !== null}
                            onClick={() => void revoke(agent.agentId)}
                          >
                            {busy === agent.agentId ? 'Revoking…' : 'Confirm revocation'}
                          </button>
                        </div>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="text-button text-button--danger"
                        onClick={() => setConfirming(agent.agentId)}
                      >
                        Revoke delegation
                      </button>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      ) : (
        <div className="panel">
          <EmptyState title="No delegated agents yet.">
            Create an agent from RazorCart’s admin page. Its registered limits and authorization
            history will appear here.
          </EmptyState>
        </div>
      )}
    </>
  );
}
