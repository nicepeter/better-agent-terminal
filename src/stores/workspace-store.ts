import { v4 as uuidv4 } from 'uuid'
import type { Workspace, TerminalInstance, AppState } from '../types'

type Listener = () => void

class WorkspaceStore {
  private state: AppState = {
    workspaces: [],
    activeWorkspaceId: null,
    terminals: [],
    activeTerminalId: null,
    focusedTerminalId: null
  }

  private listeners: Set<Listener> = new Set()

  getState(): AppState {
    return this.state
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notify(): void {
    this.listeners.forEach(listener => listener())
  }

  // Workspace actions
  addWorkspace(name: string, folderPath: string): Workspace {
    const workspace: Workspace = {
      id: uuidv4(),
      name,
      folderPath,
      createdAt: Date.now()
    }

    this.state = {
      ...this.state,
      workspaces: [...this.state.workspaces, workspace],
      activeWorkspaceId: workspace.id
    }

    this.notify()
    return workspace
  }

  removeWorkspace(id: string): void {
    const terminals = this.state.terminals.filter(t => t.workspaceId !== id)
    const workspaces = this.state.workspaces.filter(w => w.id !== id)

    this.state = {
      ...this.state,
      workspaces,
      terminals,
      activeWorkspaceId: this.state.activeWorkspaceId === id
        ? (workspaces[0]?.id ?? null)
        : this.state.activeWorkspaceId
    }

    this.notify()
  }

  setActiveWorkspace(id: string): void {
    if (this.state.activeWorkspaceId === id) return

    this.state = {
      ...this.state,
      activeWorkspaceId: id,
      focusedTerminalId: null
    }

    this.notify()
  }

  renameWorkspace(id: string, alias: string): void {
    this.state = {
      ...this.state,
      workspaces: this.state.workspaces.map(w =>
        w.id === id ? { ...w, alias: alias.trim() || undefined } : w
      )
    }

    this.notify()
  }

  setWorkspaceRole(id: string, role: string): void {
    this.state = {
      ...this.state,
      workspaces: this.state.workspaces.map(w =>
        w.id === id ? { ...w, role: role.trim() || undefined } : w
      )
    }

    this.notify()
    this.save()
  }

  setWorkspaceColors(id: string, backgroundColor?: string, textColor?: string): void {
    this.state = {
      ...this.state,
      workspaces: this.state.workspaces.map(w =>
        w.id === id ? { ...w, backgroundColor, textColor } : w
      )
    }

    this.notify()
    this.save()
  }

  reorderWorkspaces(fromIndex: number, toIndex: number): void {
    const workspaces = [...this.state.workspaces]
    const [removed] = workspaces.splice(fromIndex, 1)
    workspaces.splice(toIndex, 0, removed)

    this.state = {
      ...this.state,
      workspaces
    }

    this.notify()
    this.save()
  }

  // Terminal actions
  addTerminal(workspaceId: string, type: 'terminal' | 'claude-code'): TerminalInstance {
    const workspace = this.state.workspaces.find(w => w.id === workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const existingTerminals = this.state.terminals.filter(
      t => t.workspaceId === workspaceId && t.type === 'terminal'
    )

    const terminal: TerminalInstance = {
      id: uuidv4(),
      workspaceId,
      type,
      title: type === 'claude-code' ? 'Code Agent' : `Terminal ${existingTerminals.length + 1}`,
      cwd: workspace.folderPath,
      scrollbackBuffer: [],
      lastActivityTime: Date.now()
    }

    // Only auto-focus Claude Code, keep current focus for regular terminals
    const shouldFocus = type === 'claude-code' || !this.state.focusedTerminalId

    this.state = {
      ...this.state,
      terminals: [...this.state.terminals, terminal],
      focusedTerminalId: shouldFocus ? terminal.id : this.state.focusedTerminalId
    }

    this.notify()
    return terminal
  }

  removeTerminal(id: string): void {
    const terminals = this.state.terminals.filter(t => t.id !== id)

    this.state = {
      ...this.state,
      terminals,
      focusedTerminalId: this.state.focusedTerminalId === id
        ? (terminals[0]?.id ?? null)
        : this.state.focusedTerminalId
    }

    this.notify()
  }

  renameTerminal(id: string, alias: string): void {
    this.state = {
      ...this.state,
      terminals: this.state.terminals.map(t =>
        t.id === id ? { ...t, alias: alias.trim() || undefined } : t
      )
    }

    this.notify()
    this.save()
  }

  reorderTerminals(workspaceId: string, fromIndex: number, toIndex: number): void {
    // Get only regular terminals for this workspace (matching what ThumbnailBar shows)
    const regularTerminals = this.state.terminals.filter(
      t => t.workspaceId === workspaceId && t.type === 'terminal'
    )

    if (fromIndex < 0 || fromIndex >= regularTerminals.length ||
        toIndex < 0 || toIndex >= regularTerminals.length ||
        fromIndex === toIndex) {
      return
    }

    // Reorder the regular terminals
    const reordered = [...regularTerminals]
    const [removed] = reordered.splice(fromIndex, 1)
    reordered.splice(toIndex, 0, removed)

    // Get all other terminals (different workspace or claude-code type)
    const otherTerminals = this.state.terminals.filter(
      t => t.workspaceId !== workspaceId || t.type !== 'terminal'
    )

    this.state = {
      ...this.state,
      terminals: [...otherTerminals, ...reordered]
    }

    this.notify()
    this.save()
  }

  setFocusedTerminal(id: string | null): void {
    if (this.state.focusedTerminalId === id) return

    this.state = {
      ...this.state,
      focusedTerminalId: id
    }

    this.notify()
  }

  updateTerminalCwd(id: string, cwd: string): void {
    this.state = {
      ...this.state,
      terminals: this.state.terminals.map(t =>
        t.id === id ? { ...t, cwd } : t
      )
    }

    this.notify()
  }

  appendScrollback(id: string, data: string): void {
    this.state = {
      ...this.state,
      terminals: this.state.terminals.map(t =>
        t.id === id ? { ...t, scrollbackBuffer: [...t.scrollbackBuffer, data] } : t
      )
    }
    // Don't notify for scrollback updates to avoid re-renders
  }

  clearScrollback(id: string): void {
    this.state = {
      ...this.state,
      terminals: this.state.terminals.map(t =>
        t.id === id ? { ...t, scrollbackBuffer: [] } : t
      )
    }

    this.notify()
  }

  // Get terminals for current workspace
  getWorkspaceTerminals(workspaceId: string): TerminalInstance[] {
    return this.state.terminals.filter(t => t.workspaceId === workspaceId)
  }

  getClaudeCodeTerminal(workspaceId: string): TerminalInstance | undefined {
    return this.state.terminals.find(
      t => t.workspaceId === workspaceId && t.type === 'claude-code'
    )
  }

  getRegularTerminals(workspaceId: string): TerminalInstance[] {
    return this.state.terminals.filter(
      t => t.workspaceId === workspaceId && t.type === 'terminal'
    )
  }

  // Activity tracking
  private lastActivityNotify: number = 0

  updateTerminalActivity(id: string): void {
    const now = Date.now()
    this.state = {
      ...this.state,
      terminals: this.state.terminals.map(t =>
        t.id === id ? { ...t, lastActivityTime: now } : t
      )
    }
    // Throttle notifications to avoid excessive re-renders (max once per 500ms)
    if (now - this.lastActivityNotify > 500) {
      this.lastActivityNotify = now
      this.notify()
    }
  }

  getWorkspaceLastActivity(workspaceId: string): number | null {
    const terminals = this.getWorkspaceTerminals(workspaceId)
    const lastActivities = terminals
      .map(t => t.lastActivityTime)
      .filter((time): time is number => time !== undefined)

    return lastActivities.length > 0 ? Math.max(...lastActivities) : null
  }

  // Persistence
  async save(): Promise<void> {
    // Save terminals without scrollbackBuffer (too large)
    const terminalsToSave = this.state.terminals.map(t => ({
      id: t.id,
      workspaceId: t.workspaceId,
      type: t.type,
      title: t.title,
      alias: t.alias,
      cwd: t.cwd
    }))

    const data = JSON.stringify({
      workspaces: this.state.workspaces,
      activeWorkspaceId: this.state.activeWorkspaceId,
      terminals: terminalsToSave,
      focusedTerminalId: this.state.focusedTerminalId
    })
    await window.electronAPI.workspace.save(data)
  }

  async load(): Promise<void> {
    const data = await window.electronAPI.workspace.load()
    if (data) {
      try {
        const parsed = JSON.parse(data)
        // Restore terminals with empty scrollbackBuffer
        const terminals: TerminalInstance[] = (parsed.terminals || []).map((t: Partial<TerminalInstance>) => ({
          id: t.id,
          workspaceId: t.workspaceId,
          type: t.type,
          title: t.title,
          alias: t.alias,
          cwd: t.cwd,
          scrollbackBuffer: [],
          lastActivityTime: undefined,
          needsRestore: true  // Mark for PTY restoration
        }))

        this.state = {
          ...this.state,
          workspaces: parsed.workspaces || [],
          activeWorkspaceId: parsed.activeWorkspaceId || null,
          terminals,
          focusedTerminalId: parsed.focusedTerminalId || null
        }
        this.notify()
      } catch (e) {
        console.error('Failed to parse workspace data:', e)
      }
    }
  }

  // Mark terminal as restored (PTY created)
  markTerminalRestored(id: string): void {
    this.state = {
      ...this.state,
      terminals: this.state.terminals.map(t =>
        t.id === id ? { ...t, needsRestore: false } : t
      )
    }
  }

  // Get terminals that need PTY restoration
  getTerminalsNeedingRestore(workspaceId: string): TerminalInstance[] {
    return this.state.terminals.filter(
      t => t.workspaceId === workspaceId && (t as TerminalInstance & { needsRestore?: boolean }).needsRestore
    )
  }
}

export const workspaceStore = new WorkspaceStore()
