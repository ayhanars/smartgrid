import { Bookmark, Clock, Lock, XCircle } from 'lucide-react'
import type { Collection } from '../../lib/supabase/collections'
import '../../pages/HomeLayout.css'

/** 16:9 card: the uploaded cover, or the three most recently added
 * models side by side. */
export function CollectionCard({ collection, onOpen }: { collection: Collection; onOpen: () => void }) {
  const covers = collection.covers
  return (
    <div className="collection-card" role="button" tabIndex={0} onClick={onOpen} onKeyDown={(e) => e.key === 'Enter' && onOpen()}>
      <div className={`collection-card__cover ${collection.coverUrl ? 'collection-card__cover--single' : covers.length === 0 ? 'collection-card__cover--empty' : ''}`} style={{ gridTemplateColumns: collection.coverUrl ? '1fr' : `repeat(${Math.max(1, covers.length)}, 1fr)` }}>
        {collection.coverUrl ? <img src={collection.coverUrl} alt="" loading="lazy" /> : covers.length === 0 ? <Bookmark size={28} /> : covers.map((src, i) => <img key={i} src={src} alt="" loading="lazy" />)}
        {collection.approval === 'pending' && (
          <span className="collection-card__badge">
            <Clock size={10} /> review
          </span>
        )}
        {collection.approval === 'rejected' && (
          <span className="collection-card__badge collection-card__badge--danger">
            <XCircle size={10} /> not approved
          </span>
        )}
      </div>
      <div className="collection-card__body">
        <span className="collection-card__name">{collection.name}</span>
        <span className="collection-card__meta">
          {collection.count} model{collection.count === 1 ? '' : 's'}
          {' · '}
          {collection.isPublic ? (
            'public'
          ) : (
            <>
              <Lock size={10} style={{ verticalAlign: '-1px' }} /> private
            </>
          )}
          {' · by '}
          {collection.owner.displayName}
        </span>
      </div>
    </div>
  )
}
