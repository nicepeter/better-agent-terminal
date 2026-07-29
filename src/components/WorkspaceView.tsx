import { useEffect, useCallback, useState, useRef, useMemo } from 'react'
import type { Workspace, TerminalInstance } from '../types'
import { workspaceStore } from '../stores/workspace-store'
import { settingsStore } from '../stores/settings-store'
import { TerminalPanel } from './TerminalPanel'
import { ThumbnailBar } from './ThumbnailBar'
import { ActivityIndicator } from './ActivityIndicator'

interface WorkspaceViewProps {
  workspace: Workspace
  terminals: TerminalInstance[]
  focusedTerminalId: string | null
  isActive: boolean
}

// Helper to get shell path from settings
async function getShellFromSettings(): Promise<string | undefined> {
  const settings = settingsStore.getSettings()
  if (settings.shell === 'custom') {
    const customPath = settings.customShellPath.trim()
    if (customPath) return customPath
    // A selected "custom" option without a path must never be passed to
    // node-pty as the literal executable name "custom".
    return window.electronAPI.settings.getShellPath('auto')
  }
  return window.electronAPI.settings.getShellPath(settings.shell)
}

export function WorkspaceView({ workspace, terminals, focusedTerminalId, isActive }: WorkspaceViewProps) {
  const [editingTerminalId, setEditingTerminalId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const focusedTerminal = terminals.find(t => t.id === focusedTerminalId)

  // Filter to get only regular terminals (memoized to prevent infinite loops)
  const regularTerminals = useMemo(
    () => terminals.filter(t => t.type === 'terminal'),
    [terminals]
  )

  // Auto-create first terminal if no regular terminals exist
  useEffect(() => {
    if (regularTerminals.length === 0) {
      const createTerminal = async () => {
        const terminal = workspaceStore.addTerminal(workspace.id, 'terminal')
        const shell = await getShellFromSettings()
        window.electronAPI.pty.create({
          id: terminal.id,
          cwd: workspace.folderPath,
          type: 'terminal',
          shell,
          workspacePath: workspace.folderPath
        })
        // Focus the new terminal
        workspaceStore.setFocusedTerminal(terminal.id)
      }
      createTerminal()
    }
  }, [workspace.id, regularTerminals.length])

  // Restore PTY for terminals that need it (after app restart)
  const terminalsNeedingRestore = useMemo(
    () => terminals.filter(t => t.needsRestore),
    [terminals]
  )
  useEffect(() => {
    terminalsNeedingRestore.forEach(async (terminal) => {
      const shell = await getShellFromSettings()
      window.electronAPI.pty.create({
        id: terminal.id,
        cwd: terminal.cwd,
        type: terminal.type,
        shell,
        workspacePath: workspace.folderPath
      })
      workspaceStore.markTerminalRestored(terminal.id)
    })
  }, [terminalsNeedingRestore, workspace.folderPath])

  // Set default focus to first regular terminal (only for active workspace)
  const firstRegularTerminalId = regularTerminals[0]?.id
  useEffect(() => {
    if (isActive && !focusedTerminalId && firstRegularTerminalId) {
      workspaceStore.setFocusedTerminal(firstRegularTerminalId)
    }
  }, [isActive, focusedTerminalId, firstRegularTerminalId])

  const handleAddTerminal = useCallback(async () => {
    const terminal = workspaceStore.addTerminal(workspace.id, 'terminal')
    const shell = await getShellFromSettings()
    window.electronAPI.pty.create({
      id: terminal.id,
      cwd: workspace.folderPath,
      type: 'terminal',
      shell,
      workspacePath: workspace.folderPath
    })
    // Focus the new terminal
    workspaceStore.setFocusedTerminal(terminal.id)
  }, [workspace.id, workspace.folderPath])

  const handleCloseTerminal = useCallback((id: string) => {
    window.electronAPI.pty.kill(id)
    workspaceStore.removeTerminal(id)
  }, [])

  const handleRestart = useCallback(async (id: string) => {
    const terminal = terminals.find(t => t.id === id)
    if (terminal) {
      const cwd = await window.electronAPI.pty.getCwd(id) || terminal.cwd
      const shell = await getShellFromSettings()
      workspaceStore.startTerminalActivityGrace(id)
      await window.electronAPI.pty.restart(id, cwd, shell, workspace.folderPath)
      workspaceStore.updateTerminalCwd(id, cwd)
    }
  }, [terminals, workspace.folderPath])

  const handleFocus = useCallback((id: string) => {
    workspaceStore.setFocusedTerminal(id)
  }, [])

  const handleRenameTerminal = useCallback((id: string, alias: string) => {
    workspaceStore.renameTerminal(id, alias)
  }, [])

  const handleReorderTerminals = useCallback((fromIndex: number, toIndex: number) => {
    workspaceStore.reorderTerminals(workspace.id, fromIndex, toIndex)
  }, [workspace.id])

  // Focus input when editing
  useEffect(() => {
    if (editingTerminalId && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editingTerminalId])

  const handleTitleDoubleClick = useCallback((terminal: TerminalInstance, e: React.MouseEvent) => {
    e.stopPropagation()
    setEditValue(terminal.alias || terminal.title)
    setEditingTerminalId(terminal.id)
  }, [])

  const handleTitleRenameSubmit = useCallback(() => {
    if (editingTerminalId) {
      workspaceStore.renameTerminal(editingTerminalId, editValue)
    }
    setEditingTerminalId(null)
  }, [editingTerminalId, editValue])

  const handleTitleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleTitleRenameSubmit()
    } else if (e.key === 'Escape') {
      setEditingTerminalId(null)
    }
  }, [handleTitleRenameSubmit])

  // Main terminal is the focused one, or first regular terminal
  const mainTerminal = focusedTerminal || regularTerminals[0]

  return (
    <div className="workspace-view">
      {/* Render regular terminals only, show/hide with CSS - keeps processes running */}
      <div className="terminals-container">
        {regularTerminals.map(terminal => (
          <div
            key={terminal.id}
            className={`terminal-wrapper ${terminal.id === mainTerminal?.id ? 'active' : 'hidden'}`}
          >
            <div className="main-panel">
              <div className="main-panel-header">
                <div
                  className="main-panel-title"
                  onDoubleClick={(e) => handleTitleDoubleClick(terminal, e)}
                >
                  {editingTerminalId === terminal.id ? (
                    <input
                      ref={inputRef}
                      type="text"
                      className="terminal-rename-input main-panel-rename"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={handleTitleRenameSubmit}
                      onKeyDown={handleTitleKeyDown}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <span>{terminal.alias || terminal.title}</span>
                  )}
                </div>
                <div className="main-panel-actions">
                  <ActivityIndicator
                    terminalId={terminal.id}
                    size="small"
                    onClick={() => window.dispatchEvent(new CustomEvent('focus-terminal', { detail: terminal.id }))}
                  />
                  <button
                    className="action-btn"
                    onClick={() => handleRestart(terminal.id)}
                    title="Restart terminal"
                  >
                    ⟳
                  </button>
                  <button
                    className="action-btn danger"
                    onClick={() => handleCloseTerminal(terminal.id)}
                    title="Close terminal"
                  >
                    ×
                  </button>
                </div>
              </div>
              <div className="main-panel-content">
                <TerminalPanel
                  terminalId={terminal.id}
                  isActive={terminal.id === mainTerminal?.id}
                  workspaceIsActive={isActive}
                  backgroundColor={workspace.backgroundColor}
                  textColor={workspace.textColor}
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      <ThumbnailBar
        terminals={regularTerminals}
        focusedTerminalId={focusedTerminalId}
        onFocus={handleFocus}
        onAddTerminal={handleAddTerminal}
        onRenameTerminal={handleRenameTerminal}
        onReorderTerminals={handleReorderTerminals}
        showAddButton={true}
      />
    </div>
  )
}
