import { zodResolver } from '@hookform/resolvers/zod';
import { Command } from 'cmdk';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight, CornerDownLeft, Plus, Search, Sparkles } from 'lucide-react';
import React from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '../../components/ui';
import { api } from '../../lib/api';
import { money, titleCase } from '../../lib/format';
import type { AssistantResponse } from '../../lib/types';
import { AgentSelector } from '../agents/AgentSelector';
import { useCart } from '../cart/CartProvider';

const schema = z.object({
  query: z.string().trim().min(2, 'Write at least two characters.').max(600),
});
type Values = z.infer<typeof schema>;
type ChatTurn = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  context: string;
  response?: AssistantResponse;
};

const suggestions = [
  'A well-rated work laptop under ₹50,000',
  'A fragrance gift under ₹1,500',
  'Compact furniture for a reading corner',
];

export function AssistantPanel() {
  const { addItem } = useCart();
  const {
    control,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { query: '' } });
  const [turns, setTurns] = React.useState<ChatTurn[]>([]);
  const [requestError, setRequestError] = React.useState('');

  async function submit(values: Values) {
    setRequestError('');
    const query = values.query.trim();
    const history = turns.slice(-8).map(({ role, context }) => ({ role, content: context }));
    const userTurn: ChatTurn = {
      id: crypto.randomUUID(),
      role: 'user',
      content: query,
      context: query,
    };
    setTurns((current) => [...current, userTurn]);
    setValue('query', '');
    try {
      const next = await api<AssistantResponse>('/api/assistant/recommend', {
        method: 'POST',
        body: JSON.stringify({ query, history }),
      });
      const catalogContext = next.results
        .map(
          ({ product, explanation }) =>
            `${product.name} (${product.category}, ₹${product.price}, rating ${product.rating}, stock ${product.stock}): ${explanation}`,
        )
        .join('\n');
      setTurns((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: next.message,
          context: catalogContext ? `${next.message}\nCatalog context:\n${catalogContext}` : next.message,
          response: next,
        },
      ]);
    } catch (error) {
      setTurns((current) => current.filter((turn) => turn.id !== userTurn.id));
      setRequestError(error instanceof Error ? error.message : 'The shopping desk is unavailable.');
    }
  }

  function runSuggestion(value: string) {
    setValue('query', value, { shouldValidate: true });
    void handleSubmit(submit)();
  }

  return (
    <aside className="assistant-panel" id="shopping-desk">
      <div className="assistant-panel__head">
        <div>
          <span className="eyebrow">Shopping desk</span>
          <h2>Say what the shelf should solve.</h2>
        </div>
        <span className="assistant-panel__issue">Desk 01</span>
      </div>
      <p className="assistant-panel__intro">
        Describe the use, budget, or trade-off. The desk filters hard constraints first, then ranks
        only what is actually stocked.
      </p>
      <AgentSelector />
      <form onSubmit={handleSubmit(submit)} className="assistant-form">
        <Command className="assistant-command" shouldFilter={false}>
          <Search size={19} aria-hidden="true" />
          <Controller
            name="query"
            control={control}
            render={({ field }) => (
              <Command.Input
                ref={field.ref}
                value={field.value}
                onValueChange={field.onChange}
                onBlur={field.onBlur}
                name={field.name}
                id="assistant-query"
                placeholder="e.g. a reliable laptop for hybrid work under ₹50,000"
                aria-invalid={Boolean(errors.query)}
              />
            )}
          />
          <button type="submit" disabled={isSubmitting} aria-label="Search with the shopping desk">
            {isSubmitting ? <span className="button-dots">•••</span> : <CornerDownLeft size={17} />}
          </button>
        </Command>
        {errors.query ? <span className="field__error">{errors.query.message}</span> : null}
      </form>
      {turns.length === 0 && !isSubmitting ? (
        <div className="assistant-suggestions">
          <span>Good starting points</span>
          {suggestions.map((suggestion) => (
            <button type="button" onClick={() => runSuggestion(suggestion)} key={suggestion}>
              {suggestion} <ArrowRight size={14} />
            </button>
          ))}
        </div>
      ) : null}
      {isSubmitting ? (
        <div className="assistant-thinking" role="status">
          <span className="assistant-thinking__mark" />
          <div>
            <strong>Reading the current shelf</strong>
            <span>Checking constraints, then relevance.</span>
          </div>
        </div>
      ) : null}
      {requestError ? (
        <div className="assistant-error">{requestError} Try again in a moment.</div>
      ) : null}
      <div className="assistant-transcript" aria-live="polite">
        <AnimatePresence initial={false}>
          {turns.map((turn) => {
            if (turn.role === 'user') {
              return (
                <motion.div
                  className="assistant-turn assistant-turn--user"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  key={turn.id}
                >
                  <span>You</span>
                  <p>{turn.content}</p>
                </motion.div>
              );
            }
            const response = turn.response!;
            return (
              <motion.div
                className="assistant-response assistant-turn assistant-turn--assistant"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                key={turn.id}
              >
                <div className={`assistant-response__note ${response.isFallback ? 'is-fallback' : ''}`}>
                  <Sparkles size={15} aria-hidden="true" />
                  <p>{turn.content}</p>
                </div>
                {response.results.length > 0 ? (
                  <>
                    <div className="intent-strip" aria-label="Parsed shopping intent">
                      {response.intent.category ? <span>{titleCase(response.intent.category)}</span> : null}
                      {response.intent.maxPrice ? <span>≤ {money.format(response.intent.maxPrice)}</span> : null}
                      {response.intent.attributes.slice(0, 2).map((attribute) => (
                        <span key={attribute}>{attribute}</span>
                      ))}
                    </div>
                    <div className="assistant-results">
                      {response.results.slice(0, 4).map((result, index) => (
                        <article key={result.product.id}>
                          <span className="assistant-result__rank">0{index + 1}</span>
                          <img src={result.product.imageUrl} alt="" />
                          <div>
                            <span>{result.product.brand || titleCase(result.product.category)}</span>
                            <h3>{result.product.name}</h3>
                            <p>{result.explanation}</p>
                            <strong>{money.format(result.product.price)}</strong>
                          </div>
                          <Button
                            tone="secondary"
                            className="assistant-result__add"
                            aria-label={`Add ${result.product.name} to cart`}
                            onClick={() => void addItem(result.product.id)}
                          >
                            <Plus size={15} /> <span>Add</span>
                          </Button>
                        </article>
                      ))}
                    </div>
                  </>
                ) : null}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </aside>
  );
}
