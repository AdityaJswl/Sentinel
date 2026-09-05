import { ArrowLeft, Compass } from 'lucide-react';
import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <main className="not-found page-shell">
      <span className="not-found__number">404</span>
      <div className="not-found__copy">
        <Compass size={28} />
        <span className="eyebrow">Off the current shelf</span>
        <h1>This aisle was never stocked.</h1>
        <p>
          The address may have changed, but the catalog and your cart are right where you left them.
        </p>
        <Link to="/" className="button button--primary">
          <ArrowLeft size={16} /> Return to the edit
        </Link>
      </div>
    </main>
  );
}
