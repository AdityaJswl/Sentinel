import { zodResolver } from '@hookform/resolvers/zod';
import { Filter, RotateCcw, Search, SlidersHorizontal } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { Button, EmptyState, Input, Skeleton } from '../../components/ui';
import { api } from '../../lib/api';
import { titleCase } from '../../lib/format';
import type { Product } from '../../lib/types';
import { AssistantPanel } from '../assistant/AssistantPanel';
import { ProductCard } from './ProductCard';

const filterSchema = z
  .object({
    search: z.string().max(120),
    category: z.string(),
    minPrice: z.union([z.literal(''), z.coerce.number().nonnegative('Use a positive amount.')]),
    maxPrice: z.union([z.literal(''), z.coerce.number().positive('Use a positive amount.')]),
    sort: z.enum(['featured', 'price-asc', 'price-desc', 'rating']),
  })
  .refine(
    (value) =>
      value.minPrice === '' ||
      value.maxPrice === '' ||
      Number(value.minPrice) <= Number(value.maxPrice),
    { message: 'Maximum must be above minimum.', path: ['maxPrice'] },
  );
type FilterValues = z.infer<typeof filterSchema>;
type Category = { slug: string; count: number };

export function CatalogPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [mobileFilters, setMobileFilters] = useState(false);
  const {
    register,
    control,
    handleSubmit,
    setValue,
    getValues,
    reset,
    formState: { errors },
  } = useForm<FilterValues>({
    resolver: zodResolver(filterSchema),
    defaultValues: { search: '', category: '', minPrice: '', maxPrice: '', sort: 'featured' },
  });
  const activeCategory = useWatch({ control, name: 'category' });
  const catalogTotal = categories.reduce((sum, category) => sum + category.count, 0);

  async function load(values: FilterValues, nextPage = 1, append = false) {
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ page: String(nextPage), limit: '24', sort: values.sort });
    if (values.search) params.set('search', values.search);
    if (values.category) params.set('category', values.category);
    if (values.minPrice !== '') params.set('minPrice', String(values.minPrice));
    if (values.maxPrice !== '') params.set('maxPrice', String(values.maxPrice));
    try {
      const response = await api<{
        products: Product[];
        pagination: { page: number; pages: number; total: number };
      }>(`/api/products?${params}`);
      setProducts((current) => (append ? [...current, ...response.products] : response.products));
      setPage(response.pagination.page);
      setPages(response.pagination.pages);
      setTotal(response.pagination.total);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'The current edit could not be loaded.',
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void Promise.all([
      api<{ categories: Category[] }>('/api/categories').then((response) =>
        setCategories(response.categories),
      ),
      // Initial mount intentionally starts the first remote catalog read.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      load(getValues()),
    ]);
    // Initial values are stable; subsequent loads are form-driven.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function chooseCategory(category: string) {
    setValue('category', category);
    void handleSubmit((values) => load(values))();
  }

  function clearFilters() {
    const values: FilterValues = {
      search: '',
      category: '',
      minPrice: '',
      maxPrice: '',
      sort: 'featured',
    };
    reset(values);
    void load(values);
  }

  return (
    <main className="catalog-page">
      <section className="catalog-masthead">
        <div className="catalog-title-block">
          <div className="catalog-title-block__top">
            <span className="eyebrow">
              The current edit · {catalogTotal ? `${catalogTotal} objects` : 'catalog loading'}
            </span>
            <span className="catalog-date">September / 2026</span>
          </div>
          <h1 className="masthead-title">
            Find less.
            <br />
            <em>Choose well.</em>
          </h1>
          <div className="catalog-deck">
            <p>
              Products selected by fit, not placement. Ask plainly; every recommendation stays
              grounded in the shelf.
            </p>
            <div>
              <span>
                {categories.length ? `${categories.length} categories` : 'A broad catalog'}
              </span>
              <span>One considered cart</span>
            </div>
          </div>
        </div>
        <AssistantPanel />
      </section>

      <section className="catalog-controls" aria-label="Catalog controls">
        <div className="category-rail">
          <button
            className={!activeCategory ? 'is-active' : ''}
            type="button"
            onClick={() => chooseCategory('')}
          >
            All goods <span>{catalogTotal || '—'}</span>
          </button>
          {categories.map((category) => (
            <button
              className={activeCategory === category.slug ? 'is-active' : ''}
              type="button"
              onClick={() => chooseCategory(category.slug)}
              key={category.slug}
            >
              {titleCase(category.slug)} <span>{category.count}</span>
            </button>
          ))}
        </div>
        <button
          className="mobile-filter-button"
          type="button"
          onClick={() => setMobileFilters((open) => !open)}
        >
          <SlidersHorizontal size={16} /> Refine
        </button>
        <form
          className={`filter-form ${mobileFilters ? 'filter-form--open' : ''}`}
          onSubmit={handleSubmit((values) => load(values))}
        >
          <label className="filter-search">
            <Search size={16} aria-hidden="true" />
            <span className="sr-only">Search catalog</span>
            <Input placeholder="Search the edit" {...register('search')} />
          </label>
          <label>
            <span>From ₹</span>
            <Input inputMode="decimal" placeholder="0" {...register('minPrice')} />
          </label>
          <label>
            <span>To ₹</span>
            <Input
              inputMode="decimal"
              placeholder="Any"
              aria-invalid={Boolean(errors.maxPrice)}
              {...register('maxPrice')}
            />
          </label>
          <label>
            <span>Order</span>
            <select {...register('sort')}>
              <option value="featured">Editorial order</option>
              <option value="rating">Highest rated</option>
              <option value="price-asc">Price, low to high</option>
              <option value="price-desc">Price, high to low</option>
            </select>
          </label>
          <Button type="submit" tone="secondary">
            <Filter size={15} /> Apply
          </Button>
          <button className="filter-reset" type="button" onClick={clearFilters}>
            <RotateCcw size={14} /> Reset
          </button>
          {errors.maxPrice ? (
            <span className="filter-form__error">{errors.maxPrice.message}</span>
          ) : null}
        </form>
      </section>

      <section className="catalog-section" aria-busy={loading}>
        <div className="section-marker">
          <div>
            <span className="eyebrow">The shelf</span>
            <h2>{activeCategory ? titleCase(activeCategory) : 'Objects worth a closer look'}</h2>
          </div>
          <span>{total} pieces</span>
        </div>
        {loading && products.length === 0 ? (
          <div className="product-grid" aria-label="Loading products">
            {Array.from({ length: 12 }, (_, index) => (
              <div className="product-card product-skeleton" key={index}>
                <Skeleton className="product-skeleton__image" />
                <Skeleton />
                <Skeleton />
              </div>
            ))}
          </div>
        ) : error ? (
          <EmptyState
            eyebrow="Shelf unavailable"
            title="The catalog did not arrive cleanly."
            body={`${error} Your cart and agent settings are still safe.`}
            action={<Button onClick={() => void load(getValues())}>Try the shelf again</Button>}
          />
        ) : products.length === 0 ? (
          <EmptyState
            eyebrow="No forced matches"
            title="Nothing on this shelf fits those limits."
            body="Widen the budget or clear a category. RazorCart will not dress up an irrelevant product as a recommendation."
            action={<Button onClick={clearFilters}>Clear the constraints</Button>}
          />
        ) : (
          <>
            <div className="product-grid">
              {products.map((product, index) => (
                <ProductCard product={product} index={index} key={product.id} />
              ))}
            </div>
            {page < pages ? (
              <div className="catalog-more">
                <Button
                  tone="secondary"
                  onClick={() => void load(getValues(), page + 1, true)}
                  disabled={loading}
                >
                  {loading ? 'Composing the next shelf…' : 'Show the next shelf'}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </section>
    </main>
  );
}
