import { Bookmark, Lock } from 'lucide-react'
import type { Collection } from '../../lib/supabase/collections'
import '../../pages/HomeLayout.css'

export function CollectionCard({ collection, onOpen }: { collection: Collection; onOpen: () => void }) {
  const covers = collection.covers
  return (
    <div className="collection-card" role="button" tabIndex={0} onClick={onOpen} onKeyDown={(e) => e.key === 'Enter' && onOpen()}>
      <div className={`collection-card__cover ${covers.length === 0 ? 'collection-card__cover--empty' : covers.length === 1 ? 'collection-card__cover--one' : ''}`}>
        {covers.length === 0 ? <Bookmark size={26} /> : covers.map((src, i) => <img key={i} src={src} alt="" loading="lazy" />)}
        {covers.length > 1 && covers.length < 4 && Array.from({ length: 4 - covers.length }).map((_, i) => <span key={`pad-${i}`} />)}
      </div>
      <div className="collection-card__body">
        <span className="collection-card__name">{collection.name}</span>
        <span className="collection-card__meta">
          {collection.count} model{collection.count === 1 ? '' : 's'}
          {!collection.isPublic && (
            <>
              {' · '}
              <Lock size={10} style={{ verticalAlign: '-1px' }} /> private
            </>
          )}
        </span>
      </div>
    </div>
  )
}
