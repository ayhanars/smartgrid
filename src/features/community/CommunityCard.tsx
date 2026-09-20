import { Box, Download, Heart, Star } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { CommunityItem } from '../../lib/supabase/community'
import './community.css'

export function Avatar({ name, url, large }: { name: string; url: string | null; large?: boolean }) {
  return <span className={`community-avatar ${large ? 'community-avatar--lg' : ''}`}>{url ? <img src={url} alt="" referrerPolicy="no-referrer" /> : name.slice(0, 1)}</span>
}

/** One shared model in a grid; `showStatus` marks hidden / removed items
 * for their owner and staff. */
export function CommunityCard({ item, onOpen, showStatus }: { item: CommunityItem; onOpen: () => void; showStatus?: boolean }) {
  const navigate = useNavigate()
  return (
    <div className="community-card" role="button" tabIndex={0} onClick={onOpen} onKeyDown={(e) => e.key === 'Enter' && onOpen()}>
      <div className="community-card__thumb">
        {item.thumbnail ? <img src={item.thumbnail} alt="" loading="lazy" /> : <Box size={28} />}
        {item.featured && (
          <span className="community-card__badge">
            <Star size={9} /> featured
          </span>
        )}
        {showStatus && item.status !== 'published' && <span className="community-card__badge community-card__badge--status">{item.status}</span>}
        {showStatus && item.approval !== 'approved' && <span className="community-card__badge community-card__badge--status">{item.approval === 'pending' ? 'in review' : 'not approved'}</span>}
      </div>
      <div className="community-card__body">
        <span className="community-card__title">{item.title}</span>
        <span className="community-card__meta">
          <span
            className="community-card__author"
            role="link"
            tabIndex={0}
            title={`${item.author.displayName} · level ${item.author.level}`}
            onClick={(e) => {
              e.stopPropagation()
              navigate(`/u/${item.ownerId}`)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.stopPropagation()
                navigate(`/u/${item.ownerId}`)
              }
            }}
          >
            <Avatar name={item.author.displayName} url={item.author.avatarUrl} />
            <span>{item.author.displayName}</span>
          </span>
          <span className="community-card__downloads" title="Copies opened">
            <Download size={11} />
            {item.downloads}
          </span>
          <span className="community-card__likes" title="Likes">
            <Heart size={11} />
            {item.likes}
          </span>
        </span>
      </div>
    </div>
  )
}
