import type { Bubble, BubbleScene, SetItem } from './bubbleScene'
import type { NumericTheme } from '../lib/types'

export interface QuizUi {
  /** Replace the masthead's headline and line under it. */
  setHeadline(title: string, line: string): void
  /** Show a card in the middle of the glass; `null` hides it. */
  setCard(card: HTMLElement | null): void
  onCorrect(b: Bubble): void
  onWrong(b: Bubble): void
  onFinish(score: number, rounds: number, best: number): void
}

export interface QuizState {
  round: number
  score: number
  streak: number
  best: number
}

const ROUNDS = 8

/**
 * "Which is bigger?" Two countries drop in at the same size with only their
 * names. Tap the one you think has the higher number; the bubbles then grow and
 * shrink to their true sizes and the numbers appear. Streaks earn extra points.
 */
export class Quiz {
  private theme!: NumericTheme
  private pairs: [SetItem, SetItem][] = []
  private state: QuizState = { round: 0, score: 0, streak: 0, best: 0 }
  private answered = false
  private timer = 0
  active = false

  constructor(
    private scene: BubbleScene,
    private ui: QuizUi,
  ) {}

  start(theme: NumericTheme): void {
    this.theme = theme
    this.active = true
    this.scene.allowPop = false
    this.state = { round: 0, score: 0, streak: 0, best: 0 }
    this.pairs = this.pickPairs(this.scene.ranked(), ROUNDS)
    this.scene.showSet([])
    this.ui.setCard(this.introCard())
    this.ui.setHeadline('Which is bigger?', `${ROUNDS} rounds · tap the bubble with the higher number`)
  }

  stop(): void {
    this.active = false
    clearTimeout(this.timer)
    this.scene.allowPop = true
    this.ui.setCard(null)
  }

  /** The scene's selection, when a round is open, is the player's answer. */
  answer(b: Bubble | null): void {
    if (!this.active || this.answered || !b) return
    const pair = this.pairs[this.state.round - 1]
    if (!pair) return
    this.answered = true
    const correct = pair[0].value >= pair[1].value ? pair[0] : pair[1]
    const right = b.country.id === correct.country.id
    if (right) {
      this.state.streak++
      this.state.best = Math.max(this.state.best, this.state.streak)
      this.state.score += 1 + Math.min(2, Math.floor(this.state.streak / 3)) // a bonus every third in a row
      this.ui.onCorrect(b)
    } else {
      this.state.streak = 0
      this.ui.onWrong(b)
    }
    this.scene.revealValues()
    this.scene.select(this.scene.bubbleOf(correct.country.id))
    this.ui.setHeadline(right ? 'Yes.' : 'No.', this.scoreLine())
    this.timer = window.setTimeout(() => this.next(), 2200)
  }

  getState(): QuizState {
    return this.state
  }

  private next(): void {
    if (!this.active) return
    if (this.state.round >= this.pairs.length) {
      this.finish()
      return
    }
    this.state.round++
    this.answered = false
    const pair = this.pairs[this.state.round - 1]
    const box = this.scene.canvas.getBoundingClientRect()
    const R = Math.max(44, Math.min(110, Math.min(box.width, box.height) * 0.17))
    this.scene.select(null)
    this.scene.showSet(pair, { radius: R, hideValues: true, stagger: 160 })
    this.ui.setHeadline(this.theme.quiz?.question ?? `Which is higher: ${this.theme.unit}?`, this.scoreLine())
  }

  private finish(): void {
    this.active = false
    this.scene.allowPop = true
    this.ui.onFinish(this.state.score, this.pairs.length, this.state.best)
  }

  private scoreLine(): string {
    const s = this.state
    const streak = s.streak >= 2 ? ` · streak ${s.streak}` : ''
    return `Round ${s.round} of ${this.pairs.length} · score ${s.score}${streak}`
  }

  /** Pairs with a clear but not obvious gap, spread over the ranking, no country twice in a row. */
  private pickPairs(items: SetItem[], n: number): [SetItem, SetItem][] {
    const pool = items.filter((i) => i.value > 0)
    const out: [SetItem, SetItem][] = []
    const used = new Set<string>()
    let guard = 0
    while (out.length < n && guard++ < 400) {
      const a = pool[Math.floor(Math.random() * pool.length)]
      const candidates = pool.filter((b) => {
        if (b === a) return false
        const ratio = Math.max(a.value, b.value) / Math.min(a.value, b.value)
        return ratio >= 1.25 && ratio <= 6
      })
      const b = candidates[Math.floor(Math.random() * candidates.length)] ?? pool.find((x) => x !== a)
      if (!b) break
      const key = [a.country.id, b.country.id].sort().join('|')
      const last = out[out.length - 1]
      const repeat = last && (last[0] === a || last[1] === a || last[0] === b || last[1] === b)
      if (used.has(key) || repeat) continue
      used.add(key)
      out.push(Math.random() < 0.5 ? [a, b] : [b, a])
    }
    return out
  }

  private introCard(): HTMLElement {
    const card = document.createElement('div')
    card.className = 'glass quiz-card'
    const h = document.createElement('h2')
    h.textContent = 'Trivia'
    const p = document.createElement('p')
    p.textContent = `${this.theme.quiz?.question ?? 'Which is bigger?'} Two countries drop in at the same size. Tap the one with the higher number. ${ROUNDS} rounds; three right in a row earn a bonus.`
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'btn'
    btn.textContent = 'Play'
    btn.addEventListener('click', () => {
      this.ui.setCard(null)
      this.next()
    })
    card.append(h, p, btn)
    return card
  }
}
