import type { MapTheme } from '../lib/types'
import { cheese } from './cheese'
import { iceCream } from './ice-cream'
import { travel } from './travel'

/**
 * Every infographic theme the viewer page can show. Add a file per theme and
 * list it here; the page's theme switcher and `#<id>` deep links pick it up.
 */
export const themes: MapTheme[] = [iceCream, cheese, travel]

export function themeById(id: string | undefined): MapTheme | undefined {
  return themes.find((t) => t.id === id)
}
