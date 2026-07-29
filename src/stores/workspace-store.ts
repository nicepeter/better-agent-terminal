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

  // Remember focused terminal for each workspace (not persisted across restart)
  private workspaceFocusedTerminals: Map<string, string> = new Map()

  // Last output time per terminal id. Kept OUT of the immutable state so that
  // high-frequency output does not rebuild the whole terminals array on every
  // chunk. Read directly by ActivityIndicator on its own polling interval.
  private activityTimes: Map<string, number> = new Map()
  // A newly created/restored shell emits its prompt immediately. That output
  // is startup noise, not evidence that a task is running, so activity
  // tracking starts after a short grace period.
  private activityGraceUntil: Map<string, number> = new Map()

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
    this.state.terminals
      .filter(t => t.workspaceId === id)
      .forEach(t => {
        this.activityTimes.delete(t.id)
        this.activityGraceUntil.delete(t.id)
      })
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

    // Save current workspace's focused terminal
    if (this.state.activeWorkspaceId && this.state.focusedTerminalId) {
      this.workspaceFocusedTerminals.set(this.state.activeWorkspaceId, this.state.focusedTerminalId)
    }

    // Restore target workspace's focused terminal (or null if not remembered)
    const restoredFocusedTerminalId = this.workspaceFocusedTerminals.get(id) || null

    this.state = {
      ...this.state,
      activeWorkspaceId: id,
      focusedTerminalId: restoredFocusedTerminalId
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
      scrollbackBuffer: []
    }
    this.activityGraceUntil.set(terminal.id, Date.now() + 2000)

    // Only auto-focus Claude Code, keep current focus for regular terminals
    const shouldFocus = type === 'claude-code' || !this.state.focusedTerminalId

    this.state = {
      ...this.state,
      terminals: [...this.state.terminals, terminal],
      focusedTerminalId: shouldFocus ? terminal.id : this.state.focusedTerminalId
    }

    this.notify()
    this.save()
    return terminal
  }

  removeTerminal(id: string): void {
    this.activityTimes.delete(id)
    this.activityGraceUntil.delete(id)
    const terminals = this.state.terminals.filter(t => t.id !== id)

    this.state = {
      ...this.state,
      terminals,
      focusedTerminalId: this.state.focusedTerminalId === id
        ? (terminals[0]?.id ?? null)
        : this.state.focusedTerminalId
    }

    this.notify()
    this.save()
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

    // Update workspace focused terminal map
    if (this.state.activeWorkspaceId && id) {
      this.workspaceFocusedTerminals.set(this.state.activeWorkspaceId, id)
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
  //
  // Called for every output chunk of every terminal. Must stay O(1) and must
  // NOT rebuild state or notify — otherwise heavy output (builds, streaming)
  // rebuilds the whole terminals array thousands of times a second. Consumers
  // (ActivityIndicator) read via getTerminalActivity on their own interval.
  updateTerminalActivity(id: string): void {
    const graceUntil = this.activityGraceUntil.get(id)
    if (graceUntil !== undefined) {
      if (Date.now() < graceUntil) return
      this.activityGraceUntil.delete(id)
    }
    this.activityTimes.set(id, Date.now())
  }

  startTerminalActivityGrace(id: string): void {
    this.activityTimes.delete(id)
    this.activityGraceUntil.set(id, Date.now() + 2000)
  }

  getTerminalActivity(id: string): number | null {
    return this.activityTimes.get(id) ?? null
  }

  getWorkspaceLastActivity(workspaceId: string): number | null {
    const terminals = this.getWorkspaceTerminals(workspaceId)
    let max: number | null = null
    for (const t of terminals) {
      const time = this.activityTimes.get(t.id)
      if (time !== undefined && (max === null || time > max)) {
        max = time
      }
    }
    return max
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
          needsRestore: true  // Mark for PTY restoration
        }))
        const graceUntil = Date.now() + 2000
        terminals.forEach(terminal => this.activityGraceUntil.set(terminal.id, graceUntil))

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
