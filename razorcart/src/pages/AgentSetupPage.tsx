import { zodResolver } from '@hookform/resolvers/zod';
import * as Checkbox from '@radix-ui/react-checkbox';
import { Check, Clock3, KeyRound, ShieldCheck } from 'lucide-react';
import React from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button, Field, Input, Skeleton } from '../components/ui';
import { api } from '../lib/api';
import { money, shortDate, titleCase } from '../lib/format';
import { useAgents } from '../features/agents/AgentProvider';
import type { AgentDelegation } from '../lib/types';

const schema = z
  .object({
    name: z.string().trim().min(3, 'Use a name that will be recognizable at checkout.'),
    totalLimit: z.coerce.number().positive('Enter a total limit above zero.'),
    perTransactionLimit: z.coerce.number().positive('Enter a per-transaction limit.'),
    transactionCountLimit: z.coerce.number().int().positive('Allow at least one transaction.'),
    frequencyCount: z.coerce.number().int().positive('Choose a positive frequency.'),
    frequencyUnit: z.enum(['day', 'week', 'month']),
    allowedCategories: z.array(z.string()).min(1, 'Choose at least one catalog category.'),
    merchantAllowed: z.literal(true, {
      errorMap: () => ({ message: 'The demo merchant must be allowed.' }),
    }),
    expiresAt: z.string().min(1, 'Choose an expiry time.'),
    adminKey: z.string().max(300).default(''),
  })
  .refine((value) => value.perTransactionLimit <= value.totalLimit, {
    message: 'This cannot exceed the total spending limit.',
    path: ['perTransactionLimit'],
  })
  .refine((value) => new Date(value.expiresAt) > new Date(), {
    message: 'Choose a future expiry time.',
    path: ['expiresAt'],
  });
type Values = z.infer<typeof schema>;
type Category = { slug: string; count: number };

function localDateTime(days = 30) {
  const date = new Date(Date.now() + days * 86_400_000);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

export function AgentSetupPage() {
  const { agents, loading, refreshAgents } = useAgents();
  const [categories, setCategories] = React.useState<Category[]>([]);
  const [notice, setNotice] = React.useState('');
  const [requestError, setRequestError] = React.useState('');
  const [editingAgentId, setEditingAgentId] = React.useState<string | null>(null);
  const [adminConfig, setAdminConfig] = React.useState({
    sentinelConnected: false,
    requiresAdminKey: false,
  });
  const {
    register,
    control,
    handleSubmit,
    reset,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      totalLimit: 50_000,
      perTransactionLimit: 15_000,
      transactionCountLimit: 10,
      frequencyCount: 3,
      frequencyUnit: 'day',
      allowedCategories: [],
      merchantAllowed: true,
      expiresAt: localDateTime(),
      adminKey: '',
    },
  });

  React.useEffect(() => {
    void Promise.all([
      api<{ categories: Category[] }>('/api/categories'),
      api<{ sentinelConnected: boolean; requiresAdminKey: boolean }>('/api/admin/config'),
    ])
      .then(([catalog, config]) => {
        setCategories(catalog.categories);
        setAdminConfig(config);
      })
      .catch(() =>
        setRequestError('Agent setup could not load. Refresh before saving a delegation.'),
      );
  }, []);

  function editAgent(agent: AgentDelegation) {
    const expiry = new Date(agent.expiresAt);
    expiry.setMinutes(expiry.getMinutes() - expiry.getTimezoneOffset());
    setEditingAgentId(agent.agentId);
    setRequestError('');
    setNotice('');
    reset({
      name: agent.name,
      totalLimit: agent.totalLimit,
      perTransactionLimit: agent.perTransactionLimit,
      transactionCountLimit: agent.transactionCountLimit,
      frequencyCount: agent.frequencyCount,
      frequencyUnit: agent.frequencyUnit,
      allowedCategories: agent.allowedCategories,
      merchantAllowed: true,
      expiresAt: expiry.toISOString().slice(0, 16),
      adminKey: '',
    });
    document
      .getElementById('delegation-form')
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function submit(values: Values) {
    setRequestError('');
    setNotice('');
    if (adminConfig.requiresAdminKey && !values.adminKey) {
      setRequestError('Enter the RazorCart owner key before saving this delegation.');
      return;
    }
    try {
      const { adminKey, ...delegation } = values;
      await api(
        editingAgentId ? `/api/agents/${encodeURIComponent(editingAgentId)}` : '/api/agents',
        {
          method: editingAgentId ? 'PATCH' : 'POST',
          headers: adminKey ? { 'x-admin-key': adminKey } : {},
          body: JSON.stringify({
            ...delegation,
            expiresAt: new Date(values.expiresAt).toISOString(),
            allowedMerchants: ['razorcart-demo-store'],
          }),
        },
      );
      await refreshAgents();
      setNotice(
        `${values.name} ${editingAgentId ? 'was updated' : 'is registered'}${adminConfig.sentinelConnected ? ' in Sentinel' : ''} and is ready to use at checkout.`,
      );
      setEditingAgentId(null);
      reset({
        name: '',
        totalLimit: 50_000,
        perTransactionLimit: 15_000,
        transactionCountLimit: 10,
        frequencyCount: 3,
        frequencyUnit: 'day',
        allowedCategories: [],
        merchantAllowed: true,
        expiresAt: localDateTime(),
        adminKey: '',
      });
    } catch (error) {
      setRequestError(
        error instanceof Error ? error.message : 'The delegation could not be saved.',
      );
    }
  }

  return (
    <main className="admin-page page-shell">
      <section className="page-heading page-heading--split">
        <div>
          <span className="eyebrow">Human-owned controls</span>
          <h1>Set the boundary before the agent shops.</h1>
        </div>
        <p>
          Each buying agent carries its own merchant, category, timing, and spending scope. These
          are standing permissions—not assistant suggestions.
        </p>
      </section>

      <section className="agent-roster">
        <div className="section-marker">
          <div>
            <span className="eyebrow">Registered delegations</span>
            <h2>{agents.length} independently scoped agents</h2>
          </div>
          <span>
            {adminConfig.sentinelConnected ? 'Sentinel delegation registry' : 'Local demo registry'}
          </span>
        </div>
        {loading ? (
          <div className="agent-table agent-table--loading">
            {[0, 1].map((item) => (
              <Skeleton key={item} />
            ))}
          </div>
        ) : (
          <div className="agent-table" role="table" aria-label="Registered buying agents">
            <div className="agent-table__header" role="row">
              <span>Agent</span>
              <span>Spend authority</span>
              <span>Category scope</span>
              <span>Expiry</span>
            </div>
            {agents.map((agent) => (
              <article className="agent-row" role="row" key={agent.agentId}>
                <div className="agent-row__identity" role="cell">
                  <span className="agent-row__mark">
                    <KeyRound size={16} />
                  </span>
                  <div>
                    <h3>{agent.name}</h3>
                    <code>{agent.agentId}</code>
                    {adminConfig.sentinelConnected ? (
                      <small>
                        {agent.sentinelRegistered
                          ? 'Registered with Sentinel'
                          : 'Needs Sentinel registration'}
                      </small>
                    ) : null}
                    <Button type="button" tone="quiet" onClick={() => editAgent(agent)}>
                      Edit delegation
                    </Button>
                  </div>
                </div>
                <div className="agent-row__limit" role="cell">
                  <strong>{money.format(agent.totalLimit)}</strong>
                  <span>{money.format(agent.perTransactionLimit)} / transaction</span>
                  {agent.spent ? <small>{money.format(agent.spent)} used</small> : null}
                </div>
                <div className="agent-row__scope" role="cell">
                  {agent.allowedCategories.slice(0, 3).map((category) => (
                    <span key={category}>{titleCase(category)}</span>
                  ))}
                  {agent.allowedCategories.length > 3 ? (
                    <b>+{agent.allowedCategories.length - 3}</b>
                  ) : null}
                </div>
                <div className="agent-row__expiry" role="cell">
                  <Clock3 size={15} />
                  <div>
                    <span>{shortDate(agent.expiresAt)}</span>
                    <small>
                      {agent.frequencyCount} / {agent.frequencyUnit}
                    </small>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="delegation-builder">
        <div className="delegation-builder__aside">
          <span className="eyebrow">{editingAgentId ? 'Edit agent' : 'Add agent'}</span>
          <h2>Write the room it may move in.</h2>
          <p>
            The same cart can receive different outcomes when you switch agents. That difference is
            the point: authority belongs to a delegation, never to the storefront globally.
          </p>
          <div className="delegation-principle">
            <ShieldCheck size={20} />
            <span>Only approved authorizations consume the agent’s limit.</span>
          </div>
        </div>
        <form id="delegation-form" className="delegation-form" onSubmit={handleSubmit(submit)}>
          {editingAgentId ? (
            <div className="form-notice">
              Editing <code>{editingAgentId}</code>. Existing authorization history stays with this
              agent.
              <Button
                type="button"
                tone="quiet"
                onClick={() => {
                  setEditingAgentId(null);
                  reset();
                }}
              >
                Cancel edit
              </Button>
            </div>
          ) : null}
          {adminConfig.requiresAdminKey ? (
            <Field
              label="RazorCart owner key"
              hint="Required to change standing permissions. This key is not stored in your browser."
              error={errors.adminKey?.message}
            >
              <Input type="password" autoComplete="off" {...register('adminKey')} />
            </Field>
          ) : null}
          <Field
            label="Agent name"
            error={errors.name?.message}
            hint="Use its job, not a person’s name."
          >
            <Input placeholder="e.g. Workspace Equipment Bot" {...register('name')} />
          </Field>
          <div className="form-pair">
            <Field label="Total spending limit · INR" error={errors.totalLimit?.message}>
              <Input type="number" min="1" step="1" {...register('totalLimit')} />
            </Field>
            <Field label="Per-transaction limit · INR" error={errors.perTransactionLimit?.message}>
              <Input type="number" min="1" step="1" {...register('perTransactionLimit')} />
            </Field>
          </div>
          <div className="form-pair form-pair--frequency">
            <Field label="Transaction count limit" error={errors.transactionCountLimit?.message}>
              <Input type="number" min="1" step="1" {...register('transactionCountLimit')} />
            </Field>
            <Field label="Frequency" error={errors.frequencyCount?.message}>
              <div className="compound-input">
                <Input type="number" min="1" step="1" {...register('frequencyCount')} />
                <select aria-label="Frequency unit" {...register('frequencyUnit')}>
                  <option value="day">per day</option>
                  <option value="week">per week</option>
                  <option value="month">per month</option>
                </select>
              </div>
            </Field>
          </div>
          <Field label="Delegation expiry" error={errors.expiresAt?.message}>
            <Input type="datetime-local" {...register('expiresAt')} />
          </Field>
          <fieldset className="category-fieldset">
            <legend>
              Allowed categories <span>from the live catalog</span>
            </legend>
            <Controller
              name="allowedCategories"
              control={control}
              render={({ field }) => (
                <>
                  <div className="category-toolbar">
                    <button
                      type="button"
                      onClick={() =>
                        setValue(
                          'allowedCategories',
                          categories.map(({ slug }) => slug),
                        )
                      }
                    >
                      Select all
                    </button>
                    <button type="button" onClick={() => setValue('allowedCategories', [])}>
                      Clear
                    </button>
                  </div>
                  <div className="category-checkboxes">
                    {categories.map((category) => {
                      const checked = field.value.includes(category.slug);
                      return (
                        <label key={category.slug}>
                          <Checkbox.Root
                            className="checkbox-root"
                            checked={checked}
                            onCheckedChange={(next) => {
                              field.onChange(
                                next
                                  ? [...field.value, category.slug]
                                  : field.value.filter((value) => value !== category.slug),
                              );
                            }}
                          >
                            <Checkbox.Indicator>
                              <Check size={13} />
                            </Checkbox.Indicator>
                          </Checkbox.Root>
                          <span>{titleCase(category.slug)}</span>
                          <small>{category.count}</small>
                        </label>
                      );
                    })}
                  </div>
                </>
              )}
            />
            {errors.allowedCategories ? (
              <span className="field__error">{errors.allowedCategories.message}</span>
            ) : null}
          </fieldset>
          <Controller
            name="merchantAllowed"
            control={control}
            render={({ field }) => (
              <label className="merchant-checkbox">
                <Checkbox.Root
                  className="checkbox-root"
                  checked={field.value}
                  onCheckedChange={field.onChange}
                >
                  <Checkbox.Indicator>
                    <Check size={13} />
                  </Checkbox.Indicator>
                </Checkbox.Root>
                <span>
                  Allow <strong>razorcart-demo-store</strong>
                  <small>The merchant list is structured for future additions.</small>
                </span>
              </label>
            )}
          />
          {errors.merchantAllowed ? (
            <span className="field__error">{errors.merchantAllowed.message}</span>
          ) : null}
          {notice ? <div className="form-notice form-notice--success">{notice}</div> : null}
          {requestError ? (
            <div className="form-notice form-notice--error">{requestError}</div>
          ) : null}
          <Button type="submit" arrow disabled={isSubmitting}>
            {isSubmitting
              ? 'Saving delegation…'
              : editingAgentId
                ? 'Save delegation'
                : 'Register delegation'}
          </Button>
        </form>
      </section>
    </main>
  );
}
