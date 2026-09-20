import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, CheckCheck } from 'lucide-react'
import { useNotifications } from '../../state/notificationsStore'
import { relativeTime } from '../projects/ProjectCards'
import '../layers/LayerContextMenu.css'
import './notifications.css'

/** Bell with the unread count; opens the notification list. */
export function NotificationBell() {
  const navigate = useNavigate()
  const items = useNotifications((s) => s.items)
  const unread = useNotifications((s) => s.unread)
  const refresh = useNotifications((s) => s.refresh)
  const markRead = useNotifications((s) => s.markRead)
  const markAllRead = useNotifications((s) => s.markAllRead)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    void refresh()
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', key)
    }
  }, [open, refresh])

  const openItem = (id: string, link: string | null, read: boolean) => {
    if (!read) void markRead([id])
    setOpen(false)
    if (link) navigate(link)
  }

  return (
    <div className="notif" ref={ref}>
      <button type="button" className="notif__bell" aria-label={unread ? `${unread} unread notifications` : 'Notifications'} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Bell size={17} />
        {unread > 0 && <span className="notif__count">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="layer-context-menu notif__panel" role="menu">
          <div className="notif__head">
            <strong>Notifications</strong>
            {unread > 0 && (
              <button type="button" className="notif__all" onClick={() => void markAllRead()}>
                <CheckCheck size={13} />
                Mark all read
              </button>
            )}
          </div>
          <div className="notif__list">
            {items.length === 0 ? (
              <div className="notif__empty">Nothing yet. Reviews, replies, mentions and level-ups show up here.</div>
            ) : (
              items.map((n) => (
                <button key={n.id} type="button" className={`notif__item ${n.read ? '' : 'notif__item--unread'}`} onClick={() => openItem(n.id, n.link, n.read)}>
                  <span className={`notif__dot notif__dot--${n.kind}`} />
                  <span className="notif__text">
                    <strong>{n.title}</strong>
                    {n.body && <span>{n.body}</span>}
                    <time>{relativeTime(n.createdAt)}</time>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
