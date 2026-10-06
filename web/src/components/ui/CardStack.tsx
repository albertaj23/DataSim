import { motion, useReducedMotion } from 'motion/react';
import { useState, type MouseEvent, type ReactNode } from 'react';
import { cx } from '../ui';

export interface CardStackItem<T> { id: string; value: T }

/**
 * Expandable stack for collections of related workbench objects. The collapsed
 * pose keeps the catalog compact; expanding fans the same cards out for review.
 */
export function CardStack<T>({
  items,
  renderItem,
  label = 'Expand cards',
  className,
}: {
  items: CardStackItem<T>[];
  renderItem: (value: T, index: number, expanded: boolean) => ReactNode;
  label?: string;
  className?: string;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const reducedMotion = useReducedMotion() ?? false;

  if (!items.length) return null;

  return (
    <section className={cx('card-stack', expandedId && 'card-stack-expanded', className)} aria-label={label}>
      <div className="card-stack-stage">
        {items.map((item, index) => {
          const expanded = expandedId === item.id;
          const toggle = (event: MouseEvent) => {
            if ((event.target as HTMLElement).closest('a,button,input,select,textarea')) return;
            setExpandedId((current) => current === item.id ? null : item.id);
          };
          return (
            <motion.div
              key={item.id}
              layout
              className={cx('card-stack-card', expanded && 'card-stack-card-expanded')}
              tabIndex={0}
              role="button"
              aria-expanded={expanded}
              onClick={toggle}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setExpandedId((current) => current === item.id ? null : item.id); }
              }}
              transition={reducedMotion ? { duration: .12 } : { type: 'spring', stiffness: 220, damping: 26 }}
            >
              {renderItem(item.value, index, expanded)}
            </motion.div>
          );
        })}
      </div>
      <button
        type="button"
        className="card-stack-toggle"
        aria-expanded={Boolean(expandedId)}
        onClick={() => setExpandedId(null)}
      >
        <span className="card-stack-toggle-dot" aria-hidden />
        {expandedId ? 'Back to grid' : `${label} · ${items.length}`}
      </button>
    </section>
  );
}
