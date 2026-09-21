import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, Sparkles, Wand2 } from 'lucide-react'
import { isNewCard, listGeneratorCards, type GeneratorCard } from '../../lib/supabase/generators'
import { GeneratorArt } from './GeneratorArt'
import './GeneratorCards.css'

let cache: GeneratorCard[] | null = null

/** The enabled generator cards, cached for the session. */
export function useGeneratorCards(): GeneratorCard[] | null {
  const [cards, setCards] = useState<GeneratorCard[] | null>(cache)
  useEffect(() => {
    let cancelled = false
    listGeneratorCards()
      .then((list) => {
        cache = list
        if (!cancelled) setCards(list)
      })
      .catch(() => !cancelled && setCards([]))
    return () => {
      cancelled = true
    }
  }, [])
  return cards
}

/**
 * "Make one now": the Create panel's products as cards on the home and
 * community pages. A card opens a new project with the Create panel
 * already on that product, so the first thing the person does is set
 * the sizes.
 */
export function GeneratorsSection({ limit, compact = false }: { limit?: number; compact?: boolean }) {
  const navigate = useNavigate()
  const cards = useGeneratorCards()
  const shown = (cards ?? []).filter((c) => c.enabled)
  if (cards && shown.length === 0) return null
  const list = limit ? shown.slice(0, limit) : shown
  return (
    <section className="page__section">
      <div className="page__section-header">
        <h2>
          <Wand2 size={16} className="generators__title-icon" /> Make one now
        </h2>
        <span className="home__hint">Ready-made organizers: set your sizes, print. Everything stays editable.</span>
        {limit && shown.length > limit && (
          <button type="button" className="home__see-all" onClick={() => navigate('/community#generators')}>
            All generators
            <ArrowRight size={13} />
          </button>
        )}
      </div>
      <div className={`generators ${compact ? 'generators--compact' : ''}`}>
        {!cards && <div className="community-empty">Loading…</div>}
        {list.map((c) => (
          <GeneratorCardView key={c.template} card={c} onOpen={() => navigate(`/new?create=${encodeURIComponent(c.template)}`)} />
        ))}
      </div>
    </section>
  )
}

export function GeneratorCardView({ card, onOpen }: { card: GeneratorCard; onOpen: () => void }) {
  const { product } = card
  return (
    <div className="generator-card" role="button" tabIndex={0} onClick={onOpen} onKeyDown={(e) => e.key === 'Enter' && onOpen()}>
      <div className="generator-card__thumb">
        {card.thumbnailUrl ? <img src={card.thumbnailUrl} alt="" /> : <GeneratorArt template={product.id} />}
        {isNewCard(card) && (
          <span className="generator-card__new">
            <Sparkles size={10} /> New
          </span>
        )}
        <span className="generator-card__cat">{product.category}</span>
      </div>
      <div className="generator-card__body">
        <strong>{product.name}</strong>
        <span>{product.tagline}</span>
      </div>
    </div>
  )
}
