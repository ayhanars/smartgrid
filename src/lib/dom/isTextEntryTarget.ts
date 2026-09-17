const NON_TEXT_INPUT_TYPES = new Set(['range', 'checkbox', 'radio', 'color', 'button', 'submit', 'reset', 'file'])

/**
 * Whether a keyboard event originated in something the user is typing into.
 * App-wide shortcuts (undo, delete, zoom…) stay out of the way of text
 * entry, but a focused slider or checkbox has no text to protect, so
 * shortcuts keep working right after dragging the height slider.
 */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  if (target instanceof HTMLTextAreaElement) return true
  if (target instanceof HTMLInputElement) return !NON_TEXT_INPUT_TYPES.has(target.type)
  return false
}
