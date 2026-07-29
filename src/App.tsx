import { useEffect, useState, useCallback } from 'react'
import { workspaceStore } from './stores/workspace-store'
import { settingsStore } from './stores/settings-store'
import { ptyOutputRouter } from './lib/pty-output-router'
import { Sidebar } from './components/Sidebar'
import { WorkspaceView } from './components/WorkspaceView'
import { SettingsPanel } from './components/SettingsPanel'
import { AboutPanel } from './components/AboutPanel'
import { TerminalOverview } from './components/TerminalOverview'
import type { AppState } from './types'

export default function App() {
  const [state, setState] = useState<AppState>(workspaceStore.getState())
  const [showSettings, setShowSettings] = useState(false)
  const [showAbout, setShowAbout] = useState(false)
  const [showTerminalOverview, setShowTerminalOverview] = useState(false)

  useEffect(() => {
    const unsubscribe = workspaceStore.subscribe(() => {
      setState(workspaceStore.getState())
    })

    // Single global subscriber that records activity for ALL terminals.
    // This is the ONLY place activity is updated (TerminalPanel no longer
    // duplicates it), routed through the shared dispatcher so output is not
    // fanned out to every panel's listener.
    const unsubscribeOutput = ptyOutputRouter.onAny((id) => {
      workspaceStore.updateTerminalActivity(id)
    })

    // Load saved workspaces and settings on startup
    workspaceStore.load()
    settingsStore.load()

    return () => {
      unsubscribe()
      unsubscribeOutput()
    }
  }, [])

  const handleAddWorkspace = useCallback(async () => {
    const folderPath = await window.electronAPI.dialog.selectFolder()
    if (folderPath) {
      const name = folderPath.split(/[/\\]/).pop() || 'Workspace'
      workspaceStore.addWorkspace(name, folderPath)
      workspaceStore.save()
    }
  }, [])

  const handleAddWorkspaceFromPath = useCallback((folderPath: string) => {
    const name = folderPath.split(/[/\\]/).pop() || 'Workspace'
    workspaceStore.addWorkspace(name, folderPath)
    workspaceStore.save()
  }, [])

  const activeWorkspace = state.workspaces.find(w => w.id === state.activeWorkspaceId)

  return (
    <div className="app">
      <Sidebar
        workspaces={state.workspaces}
        activeWorkspaceId={state.activeWorkspaceId}
        onSelectWorkspace={(id) => workspaceStore.setActiveWorkspace(id)}
        onAddWorkspace={handleAddWorkspace}
        onAddWorkspaceFromPath={handleAddWorkspaceFromPath}
        onRemoveWorkspace={(id) => {
          workspaceStore.removeWorkspace(id)
          workspaceStore.save()
        }}
        onRenameWorkspace={(id, alias) => {
          workspaceStore.renameWorkspace(id, alias)
          workspaceStore.save()
        }}
        onSetWorkspaceRole={(id, role) => {
          workspaceStore.setWorkspaceRole(id, role)
        }}
        onSetWorkspaceColors={(id, backgroundColor, textColor) => {
          workspaceStore.setWorkspaceColors(id, backgroundColor, textColor)
        }}
        onReorderWorkspaces={(fromIndex, toIndex) => {
          workspaceStore.reorderWorkspaces(fromIndex, toIndex)
        }}
        onOpenSettings={() => setShowSettings(true)}
        onOpenAbout={() => setShowAbout(true)}
        onToggleTerminalOverview={() => setShowTerminalOverview(current => !current)}
        isTerminalOverviewOpen={showTerminalOverview}
        terminalCount={state.terminals.length}
      />
      <main className="main-content">
        {state.workspaces.length > 0 ? (
          // Render ALL workspaces but hide inactive ones with CSS
          // This keeps terminal instances alive when switching workspaces
          state.workspaces.map(workspace => (
            <div
              key={workspace.id}
              className={`workspace-container ${workspace.id === state.activeWorkspaceId ? 'active' : 'hidden'}`}
            >
              <WorkspaceView
                workspace={workspace}
                terminals={workspaceStore.getWorkspaceTerminals(workspace.id)}
                focusedTerminalId={workspace.id === state.activeWorkspaceId ? state.focusedTerminalId : null}
                isActive={workspace.id === state.activeWorkspaceId}
              />
            </div>
          ))
        ) : (
          <div className="empty-state">
            <h2>Welcome to Better Agent Terminal</h2>
            <p>Click "+ Add Workspace" to get started</p>
          </div>
        )}
      </main>
      {showTerminalOverview && (
        <TerminalOverview
          workspaces={state.workspaces}
          terminals={state.terminals}
          onClose={() => setShowTerminalOverview(false)}
          onSelectTerminal={(workspaceId, terminalId) => {
            workspaceStore.setActiveWorkspace(workspaceId)
            workspaceStore.setFocusedTerminal(terminalId)
            setShowTerminalOverview(false)
          }}
        />
      )}
      {showSettings && (
        <SettingsPanel onClose={() => setShowSettings(false)} />
      )}
      {showAbout && (
        <AboutPanel onClose={() => setShowAbout(false)} />
      )}
    </div>
  )
}
