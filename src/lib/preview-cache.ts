// Rolling last-8-lines preview for each terminal, shown in thumbnails.
//
// Lives in its own module (not inside TerminalThumbnail) so the store can
// evict entries when a terminal is closed — otherwise the cache grew by one
// dead entry per closed terminal for the life of the session.

import { ptyOutputRouter } from './pty-output-router'

const cache = new Map<string, string>()
let started = false

function start(): void {
  if (started) return
  started = true
  ptyOutputRouter.onAny((id, data) => {
    const prev = cache.get(id) || ''
    const combined = prev + data
    // Strip SGR color codes, keep the last 8 lines for readability.
    const cleaned = combined.replace(/\x1b\[[0-9;]*m/g, '')
    const lines = cleaned.split('\n').slice(-8)
    cache.set(id, lines.join('\n'))
  })
}

export function getPreview(id: string): string {
  start()
  return cache.get(id) || ''
}

export function deletePreview(id: string): void {
  cache.delete(id)
}
