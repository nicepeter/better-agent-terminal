import { useCallback, useEffect, useMemo, useState } from 'react'
import type { TerminalInstance, Workspace } from '../types'
import { workspaceStore } from '../stores/workspace-store'
import { activityTicker } from '../lib/ticker'

interface TerminalOverviewProps {
  workspaces: Workspace[]
  terminals: TerminalInstance[]
  onClose: () => void
  onSelectTerminal: (workspaceId: string, terminalId: string) => void
}

type ActivityFilter = 'all' | 'active' | 'quiet'

interface TerminalSnapshot {
  text: string
  updatedAt: number
}

const ACTIVE_WINDOW_MS = 10_000

function stripTerminalFormatting(value: string): string {
  return value
    .replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, '')
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\r/g, '')
}

function summarizeBuffer(value: string): string {
  const lines = stripTerminalFormatting(value)
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)

  return lines.slice(-2).join(' · ').slice(0, 240)
}

function formatTime(value: number | null): string {
  if (!value) return '尚無活動'
  const seconds = Math.max(0, Math.floor((Date.now() - value) / 1000))
  if (seconds < 10) return '剛剛'
  if (seconds < 60) return `${seconds} 秒前`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} 分前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小時前`
  return new Date(value).toLocaleDateString()
}

export function TerminalOverview({
  workspaces,
  terminals,
  onClose,
  onSelectTerminal
}: TerminalOverviewProps) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<ActivityFilter>('all')
  const [now, setNow] = useState(Date.now())
  const [snapshots, setSnapshots] = useState<Record<string, TerminalSnapshot>>({})
  const [refreshing, setRefreshing] = useState<Set<string>>(new Set())

  // The overview has one shared tick only while it is mounted/open.
  useEffect(() => activityTicker.subscribe(() => setNow(Date.now())), [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const isActive = useCallback((terminalId: string) => {
    const lastActivity = workspaceStore.getTerminalActivity(terminalId)
    return lastActivity !== null && now - lastActivity <= ACTIVE_WINDOW_MS
  }, [now])

  const refreshOne = useCallback(async (terminalId: string) => {
    setRefreshing(current => new Set(current).add(terminalId))
    try {
      const buffer = await window.electronAPI.pty.getBuffer(terminalId)
      setSnapshots(current => ({
        ...current,
        [terminalId]: {
          text: summarizeBuffer(buffer) || '目前沒有可顯示的近期輸出',
          updatedAt: Date.now()
        }
      }))
    } finally {
      setRefreshing(current => {
        const next = new Set(current)
        next.delete(terminalId)
        return next
      })
    }
  }, [])

  const refreshAll = useCallback(async () => {
    await Promise.all(terminals.map(terminal => refreshOne(terminal.id)))
  }, [refreshOne, terminals])

  const normalizedQuery = query.trim().toLowerCase()
  const groups = useMemo(() => workspaces.map(workspace => {
    const workspaceTerminals = terminals.filter(terminal => {
      if (terminal.workspaceId !== workspace.id) return false
      const active = isActive(terminal.id)
      if (filter === 'active' && !active) return false
      if (filter === 'quiet' && active) return false
      if (!normalizedQuery) return true
      const terminalName = terminal.alias || terminal.title
      const workspaceName = workspace.alias || workspace.name
      return `${terminalName} ${workspaceName} ${workspace.folderPath}`
        .toLowerCase()
        .includes(normalizedQuery)
    })
    return { workspace, terminals: workspaceTerminals }
  }).filter(group => group.terminals.length > 0), [
    filter,
    isActive,
    normalizedQuery,
    terminals,
    workspaces
  ])

  const activeCount = terminals.filter(terminal => isActive(terminal.id)).length
  const isRefreshingAll = terminals.length > 0 && refreshing.size === terminals.length

  return (
    <aside className="terminal-overview" aria-label="所有 Terminal 總覽">
      <div className="overview-header">
        <div>
          <h2>所有 Terminal</h2>
          <div className="overview-counts">
            {terminals.length} 個 · <span>{activeCount} 個活躍</span>
          </div>
        </div>
        <button className="close-btn" onClick={onClose} title="關閉總覽">×</button>
      </div>

      <div className="overview-toolbar">
        <input
          type="search"
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="搜尋 terminal 或 workspace"
          aria-label="搜尋 terminal"
        />
        <div className="overview-filters">
          {([
            ['all', '全部'],
            ['active', '活躍'],
            ['quiet', '安靜']
          ] as const).map(([value, label]) => (
            <button
              key={value}
              className={filter === value ? 'active' : ''}
              onClick={() => setFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          className="overview-refresh-all"
          onClick={refreshAll}
          disabled={terminals.length === 0 || isRefreshingAll}
          title="只讀取各 terminal 現有的近期輸出，不會向 Agent 發送訊息"
        >
          {isRefreshingAll ? '讀取中…' : '更新所有快照'}
        </button>
      </div>

      <div className="overview-list">
        {groups.map(({ workspace, terminals: groupTerminals }) => (
          <section className="overview-workspace" key={workspace.id}>
            <div className="overview-workspace-title">
              <span>{workspace.alias || workspace.name}</span>
              <span>{groupTerminals.length}</span>
            </div>
            {groupTerminals.map(terminal => {
              const active = isActive(terminal.id)
              const activityTime = workspaceStore.getTerminalActivity(terminal.id)
              const snapshot = snapshots[terminal.id]
              const isLoading = refreshing.has(terminal.id)
              return (
                <div
                  className="overview-terminal"
                  key={terminal.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelectTerminal(workspace.id, terminal.id)}
                  onKeyDown={event => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      onSelectTerminal(workspace.id, terminal.id)
                    }
                  }}
                >
                  <span className={`overview-status-dot ${active ? 'active' : 'quiet'}`} />
                  <div className="overview-terminal-info">
                    <div className="overview-terminal-row">
                      <span className="overview-terminal-name">
                        {terminal.alias || terminal.title}
                      </span>
                      <span className={`overview-status-label ${active ? 'active' : ''}`}>
                        {active ? '活躍' : '安靜'}
                      </span>
                    </div>
                    <div className="overview-terminal-meta">
                      {formatTime(activityTime)}
                      {snapshot && ` · 快照 ${formatTime(snapshot.updatedAt)}`}
                    </div>
                    {snapshot && <div className="overview-snapshot">{snapshot.text}</div>}
                  </div>
                  <button
                    className="overview-refresh-one"
                    disabled={isLoading}
                    title="更新近期輸出快照"
                    onClick={event => {
                      event.stopPropagation()
                      refreshOne(terminal.id)
                    }}
                  >
                    {isLoading ? '…' : '↻'}
                  </button>
                </div>
              )
            })}
          </section>
        ))}
        {groups.length === 0 && (
          <div className="overview-empty">沒有符合條件的 terminal</div>
        )}
      </div>
    </aside>
  )
}
