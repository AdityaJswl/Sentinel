import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { api } from '../../lib/api';
import type { Cart } from '../../lib/types';

type CartContextValue = {
  cart: Cart | null;
  loading: boolean;
  message: string;
  drawerOpen: boolean;
  setDrawerOpen: (open: boolean) => void;
  addItem: (productId: string, quantity?: number) => Promise<Cart>;
  updateItem: (productId: string, quantity: number) => Promise<void>;
  removeItem: (productId: string) => Promise<void>;
  refreshCart: () => Promise<void>;
};

const CartContext = createContext<CartContextValue | null>(null);
const storageKey = 'razorcart-cart-id';
const snapshotKey = 'razorcart-cart-snapshot';

function getCartId() {
  let id = localStorage.getItem(storageKey);
  if (!id) {
    id = `cart_${crypto.randomUUID()}`;
    localStorage.setItem(storageKey, id);
  }
  return id;
}

function cachedCart() {
  try {
    const value = localStorage.getItem(snapshotKey);
    if (!value) return null;
    const parsed = JSON.parse(value) as Cart;
    return Array.isArray(parsed.items) ? parsed : null;
  } catch {
    return null;
  }
}

function saveCart(cart: Cart) {
  localStorage.setItem(snapshotKey, JSON.stringify(cart));
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<Cart | null>(null);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [message, setMessage] = useState('');

  const refreshCart = useCallback(async () => {
    try {
      const response = await api<{ cart: Cart }>(`/api/cart/${getCartId()}`);
      const cached = cachedCart();
      // Vercel's demo database is intentionally per-instance. Retain the browser's
      // cart snapshot when a cold instance cannot see its prior temporary write.
      const nextCart = response.cart.items.length || !cached?.items.length ? response.cart : cached;
      setCart(nextCart);
      saveCart(nextCart);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshCart();
  }, [refreshCart]);

  const announce = useCallback((value: string) => {
    setMessage(value);
    window.setTimeout(() => setMessage(''), 2600);
  }, []);

  const addItem = useCallback(
    async (productId: string, quantity = 1) => {
      const response = await api<{ cart: Cart; message: string }>(
        `/api/cart/${getCartId()}/items`,
        {
          method: 'POST',
          body: JSON.stringify({ productId, quantity }),
        },
      );
      setCart(response.cart);
      saveCart(response.cart);
      announce(response.message);
      return response.cart;
    },
    [announce],
  );

  const updateItem = useCallback(async (productId: string, quantity: number) => {
    const response = await api<{ cart: Cart }>(`/api/cart/${getCartId()}/items/${productId}`, {
      method: 'PATCH',
      body: JSON.stringify({ quantity }),
    });
    setCart(response.cart);
    saveCart(response.cart);
  }, []);

  const removeItem = useCallback(
    async (productId: string) => {
      const response = await api<{ cart: Cart }>(`/api/cart/${getCartId()}/items/${productId}`, {
        method: 'DELETE',
      });
      setCart(response.cart);
      saveCart(response.cart);
      announce('Removed. Your cart has been recalculated.');
    },
    [announce],
  );

  useEffect(() => {
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const report = (error: unknown) => {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      console.warn('[webmcp]', error);
    };
    try {
      void Promise.resolve(
        context.registerTool(
          {
            name: 'search_catalog',
            title: 'Search RazorCart catalog',
            description:
              'Search the live RazorCart catalog by text or exact category without changing cart state.',
            inputSchema: {
              type: 'object',
              properties: {
                search: { type: 'string' },
                category: { type: 'string' },
              },
              additionalProperties: false,
            },
            annotations: { readOnlyHint: true, untrustedContentHint: true },
            async execute(input: unknown) {
              const value = (input ?? {}) as { search?: string; category?: string };
              const params = new URLSearchParams({ limit: '8' });
              if (value.search) params.set('search', value.search.slice(0, 120));
              if (value.category) params.set('category', value.category.slice(0, 80));
              const result = await api<{
                products: Array<{ id: string; name: string; price: number; category: string }>;
              }>(`/api/products?${params}`);
              return {
                products: result.products.map(({ id, name, price, category }) => ({
                  id,
                  name,
                  price,
                  category,
                })),
              };
            },
          },
          { signal: lifecycle.signal },
        ),
      ).catch(report);
      void Promise.resolve(
        context.registerTool(
          {
            name: 'add_product_to_cart',
            title: 'Add product to RazorCart',
            description: 'Add a known RazorCart product ID to the visible shopping cart.',
            inputSchema: {
              type: 'object',
              properties: {
                productId: { type: 'string' },
                quantity: { type: 'integer', minimum: 1, maximum: 20 },
              },
              required: ['productId'],
              additionalProperties: false,
            },
            annotations: { readOnlyHint: false, untrustedContentHint: false },
            async execute(input: unknown) {
              const value = input as { productId?: string; quantity?: number };
              if (
                !value.productId ||
                (value.quantity !== undefined &&
                  (!Number.isInteger(value.quantity) || value.quantity < 1))
              ) {
                throw new Error('A valid productId and positive integer quantity are required.');
              }
              const updated = await addItem(value.productId, value.quantity ?? 1);
              return { cartId: updated.id, itemCount: updated.itemCount, total: updated.total };
            },
          },
          { signal: lifecycle.signal },
        ),
      ).catch(report);
    } catch (error) {
      report(error);
    }
    return () => lifecycle.abort();
  }, [addItem]);

  const value = useMemo(
    () => ({
      cart,
      loading,
      message,
      drawerOpen,
      setDrawerOpen,
      addItem,
      updateItem,
      removeItem,
      refreshCart,
    }),
    [cart, loading, message, drawerOpen, addItem, updateItem, removeItem, refreshCart],
  );
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) throw new Error('useCart must be used inside CartProvider');
  return context;
}
