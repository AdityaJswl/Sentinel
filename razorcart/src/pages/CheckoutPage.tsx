import { zodResolver } from '@hookform/resolvers/zod';
import * as Tabs from '@radix-ui/react-tabs';
import {
  Check,
  ChevronRight,
  CircleAlert,
  FlaskConical,
  MapPin,
  ShieldCheck,
  ShieldX,
  TriangleAlert,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { Button, EmptyState, Field, StatusPill } from '../components/ui';
import { AgentSelector } from '../features/agents/AgentSelector';
import { useAgents } from '../features/agents/AgentProvider';
import { useCart } from '../features/cart/CartProvider';
import { api } from '../lib/api';
import { money, titleCase } from '../lib/format';
import type { CheckoutResponse, SentinelVerdict } from '../lib/types';

const schema = z.object({
  deliveryAddress: z
    .string()
    .trim()
    .min(12, 'Add a complete delivery address so the proposal can be evaluated.')
    .max(300),
  scenario: z.enum(['normal', 'price_tampering', 'replay', 'budget_breach', 'merchant_mismatch']),
});
type Values = z.infer<typeof schema>;

const scenarios: Array<{ value: Values['scenario']; label: string; detail: string }> = [
  { value: 'normal', label: 'Normal', detail: 'Send the clean proposal exactly as shown.' },
  {
    value: 'price_tampering',
    label: 'Price tampering',
    detail: 'Change the amount by ₹1 after the quote is formed.',
  },
  { value: 'replay', label: 'Replay', detail: 'Reuse a request ID Sentinel has already seen.' },
  {
    value: 'budget_breach',
    label: 'Budget breach',
    detail: 'Inflate the amount past this agent’s limit.',
  },
  {
    value: 'merchant_mismatch',
    label: 'Merchant mismatch',
    detail: 'Swap in an untrusted merchant identifier.',
  },
];

function VerdictIcon({ verdict }: { verdict: SentinelVerdict['verdict'] }) {
  if (verdict === 'APPROVE') return <ShieldCheck size={30} />;
  if (verdict === 'ESCALATE') return <TriangleAlert size={30} />;
  return <ShieldX size={30} />;
}

function prettyProposal(value: Record<string, unknown>) {
  return JSON.stringify(value, null, 2);
}

export function CheckoutPage() {
  const { cart, loading: cartLoading } = useCart();
  const { activeAgent, loading: agentLoading } = useAgents();
  const [result, setResult] = useState<CheckoutResponse | null>(null);
  const [requestError, setRequestError] = useState('');
  const [demoMode, setDemoMode] = useState(true);
  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { deliveryAddress: '', scenario: 'normal' },
  });
  const scenario = useWatch({ control, name: 'scenario' });
  const scenarioDetail = scenarios.find((item) => item.value === scenario)?.detail;

  useEffect(() => {
    void api<{ demoMode: boolean }>('/api/health').then((response) =>
      setDemoMode(response.demoMode),
    );
  }, []);

  async function submit(values: Values) {
    if (!cart || !activeAgent) return;
    setRequestError('');
    setResult(null);
    try {
      const response = await api<CheckoutResponse>('/api/checkout/authorize', {
        method: 'POST',
        body: JSON.stringify({
          cartId: cart.id,
          items: cart.items.map((item) => ({
            productId: item.product.id,
            quantity: item.quantity,
          })),
          agentId: activeAgent.agentId,
          deliveryAddress: values.deliveryAddress,
          scenario: demoMode ? values.scenario : 'normal',
        }),
      });
      setResult(response);
    } catch (error) {
      setRequestError(
        error instanceof Error ? error.message : 'Sentinel could not evaluate the proposal.',
      );
    }
  }

  if (cartLoading || agentLoading) {
    return (
      <main className="checkout-page page-shell">
        <div className="checkout-loading">
          <span />
          <p>Assembling the purchase proposal…</p>
        </div>
      </main>
    );
  }

  if (!cart?.items.length) {
    return (
      <main className="checkout-page page-shell">
        <EmptyState
          eyebrow="No proposal yet"
          title="Authorization starts with a real cart."
          body="Choose something from the current catalog or ask the shopping desk. Sentinel only evaluates concrete, priced proposals."
          action={
            <Link to="/" className="button button--primary">
              Return to the catalog <ChevronRight size={16} />
            </Link>
          }
        />
      </main>
    );
  }

  if (!activeAgent) {
    return (
      <main className="checkout-page page-shell">
        <EmptyState
          eyebrow="Delegation required"
          title="Choose who is allowed to ask."
          body="Register a buying agent before creating a purchase proposal."
          action={
            <Link to="/admin/agent-setup" className="button button--primary">
              Set up an agent
            </Link>
          }
        />
      </main>
    );
  }

  return (
    <main className="checkout-page page-shell">
      <section className="page-heading checkout-heading">
        <div>
          <span className="eyebrow">Authorization desk</span>
          <h1>One cart. One scoped proposal.</h1>
        </div>
        <p>
          RazorCart prepares the request; Sentinel decides whether this agent has the authority. No
          payment gateway is connected here.
        </p>
      </section>

      <div className="checkout-layout">
        <section className="checkout-review">
          <div className="checkout-section-head">
            <span>01</span>
            <div>
              <span className="eyebrow">Review</span>
              <h2>The quoted cart</h2>
            </div>
          </div>
          <div className="checkout-items">
            {cart.items.map((item) => (
              <article key={item.product.id}>
                <img src={item.product.imageUrl} alt="" />
                <div>
                  <span>{titleCase(item.product.category)}</span>
                  <h3>{item.product.name}</h3>
                  <p>
                    {item.product.sku} · Qty {item.quantity}
                  </p>
                </div>
                <strong>{money.format(item.lineTotal)}</strong>
              </article>
            ))}
          </div>
          <div className="checkout-total">
            <span>
              Catalog total <small>Price locked into the proposal evidence</small>
            </span>
            <strong>{money.format(cart.total)}</strong>
          </div>

          <div className="checkout-section-head checkout-section-head--agent">
            <span>02</span>
            <div>
              <span className="eyebrow">Delegation</span>
              <h2>Choose the active buyer</h2>
            </div>
          </div>
          <AgentSelector />
          <div className="active-agent-card">
            <div className="active-agent-card__top">
              <div>
                <span className="eyebrow">{activeAgent.agentId}</span>
                <h3>{activeAgent.name}</h3>
              </div>
              <StatusPill
                tone={new Date(activeAgent.expiresAt) > new Date() ? 'approved' : 'denied'}
              >
                {new Date(activeAgent.expiresAt) > new Date() ? 'Active' : 'Expired'}
              </StatusPill>
            </div>
            <dl>
              <div>
                <dt>Total authority</dt>
                <dd>{money.format(activeAgent.totalLimit)}</dd>
              </div>
              <div>
                <dt>Per transaction</dt>
                <dd>{money.format(activeAgent.perTransactionLimit)}</dd>
              </div>
              <div>
                <dt>Frequency</dt>
                <dd>
                  {activeAgent.frequencyCount} / {activeAgent.frequencyUnit}
                </dd>
              </div>
            </dl>
            <div className="active-agent-card__scope">
              {activeAgent.allowedCategories.slice(0, 6).map((category) => (
                <span key={category}>{titleCase(category)}</span>
              ))}
              {activeAgent.allowedCategories.length > 6 ? (
                <b>+{activeAgent.allowedCategories.length - 6}</b>
              ) : null}
            </div>
          </div>

          <form className="checkout-form" onSubmit={handleSubmit(submit)}>
            <div className="checkout-section-head">
              <span>03</span>
              <div>
                <span className="eyebrow">Proposal details</span>
                <h2>Complete the request</h2>
              </div>
            </div>
            <Field
              label="Delivery address"
              error={errors.deliveryAddress?.message}
              hint="Stored audit summaries redact this value."
            >
              <div className="textarea-wrap">
                <MapPin size={17} aria-hidden="true" />
                <textarea
                  rows={3}
                  placeholder="Flat / building, street, city, state, PIN"
                  {...register('deliveryAddress')}
                />
              </div>
            </Field>
            {demoMode ? (
              <Field
                label="Demo scenario"
                hint={scenarioDetail}
                error={errors.scenario?.message}
                className="demo-field"
              >
                <div className="demo-select-wrap">
                  <FlaskConical size={17} aria-hidden="true" />
                  <select {...register('scenario')}>
                    {scenarios.map((item) => (
                      <option value={item.value} key={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </div>
              </Field>
            ) : null}
            <div className="checkout-callout">
              <CircleAlert size={17} />
              <p>
                The authorization request is generated server-side from current catalog prices.
                Browser values are never trusted.
              </p>
            </div>
            {requestError ? (
              <div className="form-notice form-notice--error">{requestError}</div>
            ) : null}
            <Button type="submit" arrow disabled={isSubmitting}>
              {isSubmitting ? 'Sentinel is evaluating…' : 'Send for authorization'}
            </Button>
          </form>
        </section>

        <aside
          className={`verdict-panel ${result ? `verdict-panel--${result.verdict.verdict.toLowerCase()}` : ''}`}
        >
          {!result ? (
            <div className="verdict-idle">
              <span className="verdict-idle__seal">
                <ShieldCheck size={34} />
              </span>
              <span className="eyebrow">Awaiting proposal</span>
              <h2>The answer is deliberately separate from the ask.</h2>
              <p>
                Sentinel checks agent identity, replay history, expiry, merchant, category, price
                integrity, frequency, and budget—in that order.
              </p>
              <div className="verdict-idle__rules">
                {['Agent-scoped limits', 'Catalog-price integrity', 'Single-use request ID'].map(
                  (rule) => (
                    <span key={rule}>
                      <Check size={14} /> {rule}
                    </span>
                  ),
                )}
              </div>
            </div>
          ) : (
            <Tabs.Root defaultValue="decision">
              <Tabs.List className="verdict-tabs" aria-label="Authorization result views">
                <Tabs.Trigger value="decision">Decision</Tabs.Trigger>
                <Tabs.Trigger value="proposal">Proposal</Tabs.Trigger>
              </Tabs.List>
              <Tabs.Content value="decision" className="verdict-content">
                <div className="verdict-stamp">
                  <VerdictIcon verdict={result.verdict.verdict} />
                  <span>{result.verdict.verdict}</span>
                </div>
                <span className="eyebrow">{result.verdict.reason_code}</span>
                <h2>
                  {result.verdict.verdict === 'APPROVE'
                    ? 'Authority confirmed.'
                    : result.verdict.verdict === 'ESCALATE'
                      ? 'A human needs to confirm.'
                      : 'The purchase stays stopped.'}
                </h2>
                <p className="verdict-reason">{result.verdict.reason}</p>
                <dl className="verdict-metrics">
                  <div>
                    <dt>Evaluated</dt>
                    <dd>{money.format(result.verdict.evaluated_amount)}</dd>
                  </div>
                  <div>
                    <dt>Remaining</dt>
                    <dd>{money.format(result.verdict.remaining_budget)}</dd>
                  </div>
                </dl>
                <div className="verdict-checks">
                  {result.verdict.checks.map((check) => (
                    <div
                      className={check.passed ? 'is-passed' : 'is-failed'}
                      key={`${check.rule}-${String(check.actual)}`}
                    >
                      {check.passed ? <Check size={14} /> : <ShieldX size={14} />}
                      <span>{check.rule.replace(/_/g, ' ')}</span>
                      <b>{check.passed ? 'passed' : 'blocked'}</b>
                    </div>
                  ))}
                </div>
                <code className="authorization-id">{result.verdict.authorization_id}</code>
                {result.verdict.verdict === 'APPROVE' ? (
                  <div className="authorization-next authorization-next--approved">
                    <ShieldCheck size={18} />
                    <p>
                      Approved for downstream payment handoff. Payment execution is intentionally
                      not connected in RazorCart.
                    </p>
                  </div>
                ) : result.verdict.verdict === 'ESCALATE' ? (
                  <div className="authorization-next authorization-next--escalated">
                    <TriangleAlert size={18} />
                    <p>No budget is consumed until an explicit human-confirmation flow is added.</p>
                  </div>
                ) : null}
              </Tabs.Content>
              <Tabs.Content value="proposal" className="proposal-view">
                <div className="proposal-view__meta">
                  <span>Sent as · {result.scenario.replace(/_/g, ' ')}</span>
                  <b>{String(result.proposal.request_id)}</b>
                </div>
                <pre>{prettyProposal(result.proposal)}</pre>
                {result.scenario !== 'normal' ? (
                  <details>
                    <summary>Compare with the clean proposal</summary>
                    <pre>{prettyProposal(result.originalProposal)}</pre>
                  </details>
                ) : null}
              </Tabs.Content>
            </Tabs.Root>
          )}
        </aside>
      </div>
    </main>
  );
}
