// Shared interval tickers.
//
// Previously every ActivityIndicator ran its own setInterval(1s) and every
// TerminalThumbnail its own setInterval(500ms). With many terminals that is
// dozens of independent timers all firing and doing work. A single shared
// ticker per interval fans out to all subscribers from ONE timer, and stops
// the timer entirely when nobody is listening.

type TickHandler = () => void

class Ticker {
  private handlers = new Set<TickHandler>()
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(private intervalMs: number) {}

  subscribe(handler: TickHandler): () => void {
    this.handlers.add(handler)
    if (this.timer === null) {
      this.timer = setInterval(() => {
        this.handlers.forEach(h => h())
      }, this.intervalMs)
    }
    return () => {
      this.handlers.delete(handler)
      if (this.handlers.size === 0 && this.timer !== null) {
        clearInterval(this.timer)
        this.timer = null
      }
    }
  }
}

// One shared timer drives all activity dots.
export const activityTicker = new Ticker(1000)
