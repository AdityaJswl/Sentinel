import { motion } from 'framer-motion';
import { ArrowUpRight, Plus, Star } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../components/ui';
import { money, titleCase } from '../../lib/format';
import type { Product } from '../../lib/types';
import { useCart } from '../cart/CartProvider';

export function ProductImage({ product, eager = false }: { product: Product; eager?: boolean }) {
  const choices = [...new Set([product.imageUrl, ...product.images])];
  const [index, setIndex] = useState(0);
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div
        className="product-image__unavailable"
        role="img"
        aria-label={`Photography unavailable for ${product.name}`}
      >
        <span>Photography temporarily unavailable</span>
        <b>{product.name}</b>
      </div>
    );
  }
  return (
    <img
      src={choices[index]}
      alt={product.name}
      loading={eager ? 'eager' : 'lazy'}
      onError={() => {
        if (index < choices.length - 1) setIndex(index + 1);
        else setFailed(true);
      }}
    />
  );
}

export function ProductCard({ product, index = 0 }: { product: Product; index?: number }) {
  const { addItem } = useCart();
  const [adding, setAdding] = useState(false);
  async function add() {
    setAdding(true);
    try {
      await addItem(product.id);
    } finally {
      setAdding(false);
    }
  }
  return (
    <motion.article
      className={`product-card product-card--${(index % 7) + 1}`}
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.45, delay: Math.min(index, 6) * 0.035 }}
    >
      <div className="product-card__media">
        <ProductImage product={product} eager={index < 4} />
        {product.discountPercentage && product.discountPercentage >= 10 ? (
          <span className="product-card__discount">
            {Math.round(product.discountPercentage)}% less
          </span>
        ) : null}
        <button
          type="button"
          className="product-card__quick-add"
          onClick={() => void add()}
          disabled={adding}
        >
          {adding ? <span className="button-dots">•••</span> : <Plus size={18} />}
          <span className="sr-only">Add {product.name} to cart</span>
        </button>
      </div>
      <div className="product-card__meta">
        <div>
          <span>{product.brand || titleCase(product.category)}</span>
          <span className="product-card__rating">
            <Star size={12} fill="currentColor" /> {product.rating.toFixed(1)}
          </span>
        </div>
        <h3>{product.name}</h3>
        <div className="product-card__price-line">
          <strong>{money.format(product.price)}</strong>
          <span>{product.stock < 10 ? `${product.stock} left` : 'In stock'}</span>
        </div>
      </div>
      <Button
        tone="quiet"
        className="product-card__button"
        onClick={() => void add()}
        disabled={adding}
      >
        {adding ? 'Adding' : 'Add to cart'} <ArrowUpRight size={15} />
      </Button>
    </motion.article>
  );
}
