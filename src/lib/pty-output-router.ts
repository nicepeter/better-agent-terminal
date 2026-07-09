// Single renderer-side dispatcher for `pty:output`.
//
// Previously every TerminalPanel (plus a few globals) registered its own
// ipcRenderer listener on the shared `pty:output` channel, so each output
// chunk was delivered to N+2 callbacks and every one re-checked the id.
// With all workspaces kept mounted, that cost grew with the number of
// terminals and made the app slower the longer it ran.
//
// This router registers exactly ONE underlying listener and dispatches each
// chunk to the single matching terminal (O(1) Map lookup) plus any global
// subscribers.

type OutputHandler = (data: string) => void
type GlobalHandler = (id: string, data: string) => void

class PtyOutputRouter {
  private byId = new Map<string, Set<OutputHandler>>()
  private global = new Set<GlobalHandler>()
  private started = false

  private start(): void {
    if (this.started) return
    this.started = true
    window.electronAPI.pty.onOutput((id, data) => {
      const handlers = this.byId.get(id)
      if (handlers) {
        handlers.forEach(h => h(data))
      }
      if (this.global.size > 0) {
        this.global.forEach(h => h(id, data))
      }
    })
  }

  // Subscribe to output for a single terminal id.
  onId(id: string, handler: OutputHandler): () => void {
    this.start()
    let set = this.byId.get(id)
    if (!set) {
      set = new Set()
      this.byId.set(id, set)
    }
    set.add(handler)
    return () => {
      const s = this.byId.get(id)
      if (s) {
        s.delete(handler)
        if (s.size === 0) this.byId.delete(id)
      }
    }
  }

  // Subscribe to output for every terminal (used for activity + thumbnails).
  onAny(handler: GlobalHandler): () => void {
    this.start()
    this.global.add(handler)
    return () => this.global.delete(handler)
  }
}

export const ptyOutputRouter = new PtyOutputRouter()
