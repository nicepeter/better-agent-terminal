import { useEffect, useCallback, useState, useRef } from 'react'
import type { Workspace, TerminalInstance } from '../types'
import { workspaceStore } from '../stores/workspace-store'
import { settingsStore } from '../stores/settings-store'
import { TerminalPanel } from './TerminalPanel'
import { ThumbnailBar } from './ThumbnailBar'
import { CloseConfirmDialog } from './CloseConfirmDialog'
import { ActivityIndicator } from './ActivityIndicator'

interface WorkspaceViewProps {
  workspace: Workspace
  terminals: TerminalInstance[]
  focusedTerminalId: string | null
}

// Helper to get shell path from settings
async function getShellFromSettings(): Promise<string | undefined> {
  const settings = settingsStore.getSettings()
  if (settings.shell === 'custom' && settings.customShellPath) {
    return settings.customShellPath
  }
  return window.electronAPI.settings.getShellPath(settings.shell)
}

export function WorkspaceView({ workspace, terminals, focusedTerminalId }: WorkspaceViewProps) {
  const [showCloseConfirm, setShowCloseConfirm] = useState<string | null>(null)
  const [editingTerminalId, setEditingTerminalId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const claudeCode = terminals.find(t => t.type === 'claude-code')
  const regularTerminals = terminals.filter(t => t.type === 'terminal')

  const focusedTerminal = terminals.find(t => t.id === focusedTerminalId)
  const isClaudeCodeFocused = focusedTerminal?.type === 'claude-code'

  // Initialize Claude Code terminal when workspace loads
  useEffect(() => {
    if (!claudeCode) {
      const createClaudeCode = async () => {
        const terminal = workspaceStore.addTerminal(workspace.id, 'claude-code')
        const shell = await getShellFromSettings()
        window.electronAPI.pty.create({
          id: terminal.id,
          cwd: workspace.folderPath,
          type: 'claude-code',
          shell
        })
      }
      createClaudeCode()
    }
  }, [workspace.id, claudeCode])

  // Auto-create first terminal if none exists
  useEffect(() => {
    if (regularTerminals.length === 0 && claudeCode) {
      const createTerminal = async () => {
        const terminal = workspaceStore.addTerminal(workspace.id, 'terminal')
        const shell = await getShellFromSettings()
        window.electronAPI.pty.create({
          id: terminal.id,
          cwd: workspace.folderPath,
          type: 'terminal',
          shell
        })
      }
      createTerminal()
    }
  }, [workspace.id, regularTerminals.length, claudeCode])

  // Restore PTY for terminals that need it (after app restart)
  useEffect(() => {
    const terminalsToRestore = terminals.filter(t => t.needsRestore)

    terminalsToRestore.forEach(async (terminal) => {
      const shell = await getShellFromSettings()
      window.electronAPI.pty.create({
        id: terminal.id,
        cwd: terminal.cwd,
        type: terminal.type,
        shell
      })
      workspaceStore.markTerminalRestored(terminal.id)
    })
  }, [terminals])

  // Set default focus
  useEffect(() => {
    if (!focusedTerminalId && claudeCode) {
      workspaceStore.setFocusedTerminal(claudeCode.id)
    }
  }, [focusedTerminalId, claudeCode])

  const handleAddTerminal = useCallback(async () => {
    const terminal = workspaceStore.addTerminal(workspace.id, 'terminal')
    const shell = await getShellFromSettings()
    window.electronAPI.pty.create({
      id: terminal.id,
      cwd: workspace.folderPath,
      type: 'terminal',
      shell
    })
  }, [workspace.id, workspace.folderPath])

  const handleCloseTerminal = useCallback((id: string) => {
    const terminal = terminals.find(t => t.id === id)
    if (terminal?.type === 'claude-code') {
      setShowCloseConfirm(id)
    } else {
      window.electronAPI.pty.kill(id)
      workspaceStore.removeTerminal(id)
    }
  }, [terminals])

  const handleConfirmClose = useCallback(() => {
    if (showCloseConfirm) {
      window.electronAPI.pty.kill(showCloseConfirm)
      workspaceStore.removeTerminal(showCloseConfirm)
      setShowCloseConfirm(null)
    }
  }, [showCloseConfirm])

  const handleRestart = useCallback(async (id: string) => {
    const terminal = terminals.find(t => t.id === id)
    if (terminal) {
      const cwd = await window.electronAPI.pty.getCwd(id) || terminal.cwd
      const shell = await getShellFromSettings()
      await window.electronAPI.pty.restart(id, cwd, shell)
      workspaceStore.updateTerminalCwd(id, cwd)
    }
  }, [terminals])

  const handleFocus = useCallback((id: string) => {
    workspaceStore.setFocusedTerminal(id)
  }, [])

  const handleRenameTerminal = useCallback((id: string, alias: string) => {
    workspaceStore.renameTerminal(id, alias)
  }, [])

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

  // Determine what to show in thumbnail bar
  const mainTerminal = focusedTerminal || claudeCode
  const thumbnailTerminals = isClaudeCodeFocused
    ? regularTerminals
    : (claudeCode ? [claudeCode] : [])

  return (
    <div className="workspace-view">
      {/* Render ALL terminals, show/hide with CSS - keeps processes running */}
      <div className="terminals-container">
        {terminals.map(terminal => (
          <div
            key={terminal.id}
            className={`terminal-wrapper ${terminal.id === mainTerminal?.id ? 'active' : 'hidden'}`}
          >
            <div className="main-panel">
              <div className="main-panel-header">
                <div
                  className={`main-panel-title ${terminal.type === 'claude-code' ? 'claude-code' : ''}`}
                  onDoubleClick={(e) => handleTitleDoubleClick(terminal, e)}
                >
                  {terminal.type === 'claude-code' && <span>✦</span>}
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
                  backgroundColor={workspace.backgroundColor}
                  textColor={workspace.textColor}
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      <ThumbnailBar
        terminals={thumbnailTerminals}
        focusedTerminalId={focusedTerminalId}
        onFocus={handleFocus}
        onAddTerminal={isClaudeCodeFocused ? handleAddTerminal : undefined}
        onRenameTerminal={handleRenameTerminal}
        showAddButton={isClaudeCodeFocused}
      />

      {showCloseConfirm && (
        <CloseConfirmDialog
          onConfirm={handleConfirmClose}
          onCancel={() => setShowCloseConfirm(null)}
        />
      )}
    </div>
  )
}
