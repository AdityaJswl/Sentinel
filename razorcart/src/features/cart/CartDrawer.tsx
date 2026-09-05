import * as Dialog from '@radix-ui/react-dialog';
import { Minus, Plus, ShoppingBag, Trash2, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button, EmptyState, Skeleton } from '../../components/ui';
import { money } from '../../lib/format';
import { useCart } from './CartProvider';

export function CartDrawer() {
  const { cart, loading, drawerOpen, setDrawerOpen, updateItem, removeItem } = useCart();
  return (
    <Dialog.Root open={drawerOpen} onOpenChange={setDrawerOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="cart-drawer">
          <div className="cart-drawer__head">
            <div>
              <span className="eyebrow">Current selection</span>
              <Dialog.Title>Your cart</Dialog.Title>
            </div>
            <Dialog.Close className="icon-button" aria-label="Close cart">
              <X size={20} />
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">
            Review products, change quantities, and continue to agent authorization.
          </Dialog.Description>

          {loading ? (
            <div className="cart-list">
              {[0, 1, 2].map((item) => (
                <div className="cart-line" key={item}>
                  <Skeleton className="cart-line__skeleton-image" />
                  <div className="cart-line__skeleton-copy">
                    <Skeleton />
                    <Skeleton />
                  </div>
                </div>
              ))}
            </div>
          ) : !cart?.items.length ? (
            <EmptyState
              eyebrow="Nothing held"
              title="Your shortlist is still open."
              body="Browse the edit or ask the shopping desk for a considered recommendation."
              action={
                <Dialog.Close asChild>
                  <Link to="/" className="text-link">
                    Return to the catalog
                  </Link>
                </Dialog.Close>
              }
            />
          ) : (
            <>
              <div className="cart-list">
                {cart.items.map((item) => (
                  <article className="cart-line" key={item.product.id}>
                    <img src={item.product.imageUrl} alt="" />
                    <div className="cart-line__body">
                      <span className="cart-line__category">
                        {item.product.category.replace(/-/g, ' ')}
                      </span>
                      <h3>{item.product.name}</h3>
                      <span>{money.format(item.lineTotal)}</span>
                      <div className="cart-line__actions">
                        <div className="stepper" aria-label={`Quantity for ${item.product.name}`}>
                          <button
                            type="button"
                            aria-label="Decrease quantity"
                            onClick={() =>
                              void updateItem(item.product.id, Math.max(0, item.quantity - 1))
                            }
                          >
                            <Minus size={14} />
                          </button>
                          <span>{item.quantity}</span>
                          <button
                            type="button"
                            aria-label="Increase quantity"
                            onClick={() => void updateItem(item.product.id, item.quantity + 1)}
                            disabled={item.quantity >= Math.min(item.product.stock, 20)}
                          >
                            <Plus size={14} />
                          </button>
                        </div>
                        <button
                          className="cart-line__remove"
                          type="button"
                          onClick={() => void removeItem(item.product.id)}
                          aria-label={`Remove ${item.product.name}`}
                        >
                          <Trash2 size={15} /> Remove
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
              <div className="cart-drawer__footer">
                <div className="cart-total">
                  <span>Estimated total</span>
                  <strong>{money.format(cart.total)}</strong>
                </div>
                <p>Final authorization is checked against the active agent’s standing limits.</p>
                <Dialog.Close asChild>
                  <Link to="/checkout" className="button button--primary button--wide">
                    <span>Review authorization</span>
                    <ShoppingBag size={17} />
                  </Link>
                </Dialog.Close>
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function CartButton() {
  const { cart, setDrawerOpen } = useCart();
  return (
    <Button
      tone="quiet"
      className="cart-button"
      onClick={() => setDrawerOpen(true)}
      aria-label="Open cart"
    >
      <ShoppingBag size={18} aria-hidden="true" />
      <span>Cart</span>
      <b>{cart?.itemCount ?? 0}</b>
    </Button>
  );
}
