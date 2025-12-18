import { useState, useRef, useEffect } from 'react'
import type { Workspace } from '../types'
import { PRESET_ROLES } from '../types'
import { ActivityIndicator } from './ActivityIndicator'

interface SidebarProps {
  workspaces: Workspace[]
  activeWorkspaceId: string | null
  onSelectWorkspace: (id: string) => void
  onAddWorkspace: () => void
  onAddWorkspaceFromPath: (folderPath: string) => void
  onRemoveWorkspace: (id: string) => void
  onRenameWorkspace: (id: string, alias: string) => void
  onSetWorkspaceRole: (id: string, role: string) => void
  onSetWorkspaceColors: (id: string, backgroundColor?: string, textColor?: string) => void
  onOpenSettings: () => void
  onOpenAbout: () => void
}

const PRESET_COLORS = [
  { id: 'default', label: 'Default', bg: undefined, text: undefined },
  { id: 'dark', label: 'Dark', bg: '#1a1a2e', text: '#eaeaea' },
  { id: 'midnight', label: 'Midnight', bg: '#0f0f23', text: '#cccccc' },
  { id: 'forest', label: 'Forest', bg: '#1a2f1a', text: '#b8d4b8' },
  { id: 'ocean', label: 'Ocean', bg: '#0d253f', text: '#a8d4f0' },
  { id: 'sunset', label: 'Sunset', bg: '#2d1b1b', text: '#f0c8a8' },
  { id: 'purple', label: 'Purple', bg: '#1e1a2e', text: '#d4b8f0' },
  { id: 'coffee', label: 'Coffee', bg: '#1f1814', text: '#d4c4b0' },
] as const

function getRoleColor(role?: string): string {
  if (!role) return 'transparent'
  const preset = PRESET_ROLES.find(r => r.name.toLowerCase() === role.toLowerCase() || r.id === role.toLowerCase())
  return preset?.color || '#dfdbc3'
}

export function Sidebar({
  workspaces,
  activeWorkspaceId,
  onSelectWorkspace,
  onAddWorkspace,
  onAddWorkspaceFromPath,
  onRemoveWorkspace,
  onRenameWorkspace,
  onSetWorkspaceRole,
  onSetWorkspaceColors,
  onOpenSettings,
  onOpenAbout
}: SidebarProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [roleMenuId, setRoleMenuId] = useState<string | null>(null)
  const [colorMenuId, setColorMenuId] = useState<string | null>(null)
  const [customRoleInput, setCustomRoleInput] = useState('')
  const [customBgColor, setCustomBgColor] = useState('')
  const [customTextColor, setCustomTextColor] = useState('')
  const [isDragOver, setIsDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const roleMenuRef = useRef<HTMLDivElement>(null)
  const colorMenuRef = useRef<HTMLDivElement>(null)
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dragCounterRef = useRef(0)

  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editingId])

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (clickTimerRef.current) {
        clearTimeout(clickTimerRef.current)
      }
    }
  }, [])

  // Close role menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (roleMenuRef.current && !roleMenuRef.current.contains(e.target as Node)) {
        setRoleMenuId(null)
        setCustomRoleInput('')
      }
    }
    if (roleMenuId) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [roleMenuId])

  // Close color menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (colorMenuRef.current && !colorMenuRef.current.contains(e.target as Node)) {
        setColorMenuId(null)
        setCustomBgColor('')
        setCustomTextColor('')
      }
    }
    if (colorMenuId) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [colorMenuId])

  const handleRoleClick = (workspaceId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setRoleMenuId(roleMenuId === workspaceId ? null : workspaceId)
    setCustomRoleInput('')
  }

  const handleSelectRole = (workspaceId: string, role: string) => {
    if (role === 'custom') {
      // Show custom input instead
      return
    }
    onSetWorkspaceRole(workspaceId, role)
    setRoleMenuId(null)
  }

  const handleCustomRoleSubmit = (workspaceId: string) => {
    if (customRoleInput.trim()) {
      onSetWorkspaceRole(workspaceId, customRoleInput.trim())
    }
    setRoleMenuId(null)
    setCustomRoleInput('')
  }

  const handleColorClick = (workspaceId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setColorMenuId(colorMenuId === workspaceId ? null : workspaceId)
    const workspace = workspaces.find(w => w.id === workspaceId)
    setCustomBgColor(workspace?.backgroundColor || '')
    setCustomTextColor(workspace?.textColor || '')
  }

  const handleSelectColor = (workspaceId: string, bg?: string, text?: string) => {
    onSetWorkspaceColors(workspaceId, bg, text)
    setColorMenuId(null)
    setCustomBgColor('')
    setCustomTextColor('')
  }

  const handleCustomColorSubmit = (workspaceId: string) => {
    onSetWorkspaceColors(
      workspaceId,
      customBgColor.trim() || undefined,
      customTextColor.trim() || undefined
    )
    setColorMenuId(null)
    setCustomBgColor('')
    setCustomTextColor('')
  }

  const handleWorkspaceClick = (workspace: Workspace) => {
    // If already editing, don't switch
    if (editingId) return

    // Clear any pending click timer
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current)
      clickTimerRef.current = null
    }

    // Delay the selection to allow double-click to cancel it
    clickTimerRef.current = setTimeout(() => {
      clickTimerRef.current = null
      onSelectWorkspace(workspace.id)
    }, 250)
  }

  const handleDoubleClick = (workspace: Workspace, e: React.MouseEvent) => {
    e.stopPropagation()

    // Cancel the pending single-click selection
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current)
      clickTimerRef.current = null
    }

    setEditingId(workspace.id)
    setEditValue(workspace.alias || workspace.name)
  }

  const handleRenameSubmit = (id: string) => {
    onRenameWorkspace(id, editValue)
    setEditingId(null)
  }

  const handleKeyDown = (id: string, e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleRenameSubmit(id)
    } else if (e.key === 'Escape') {
      setEditingId(null)
    }
  }

  // Drag and drop handlers for adding folders
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current++
    if (e.dataTransfer.types.includes('Files')) {
      setIsDragOver(true)
    }
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current--
    if (dragCounterRef.current === 0) {
      setIsDragOver(false)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
    dragCounterRef.current = 0

    const files = e.dataTransfer.files
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      // Get the path from the file
      const path = (file as any).path
      if (path) {
        onAddWorkspaceFromPath(path)
      }
    }
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header">Workspaces</div>
      <div
        className={`workspace-list ${isDragOver ? 'drag-over' : ''}`}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {isDragOver && (
          <div className="drop-overlay">
            <span>Drop folder here</span>
          </div>
        )}
        {workspaces.map(workspace => (
          <div
            key={workspace.id}
            className={`workspace-item ${workspace.id === activeWorkspaceId ? 'active' : ''}`}
            onClick={() => handleWorkspaceClick(workspace)}
          >
            <div className="workspace-item-content">
              <div
                className="workspace-item-info"
                onDoubleClick={(e) => handleDoubleClick(workspace, e)}
              >
                {editingId === workspace.id ? (
                  <input
                    ref={inputRef}
                    type="text"
                    className="workspace-rename-input"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onBlur={() => handleRenameSubmit(workspace.id)}
                    onKeyDown={(e) => handleKeyDown(workspace.id, e)}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <>
                    <div className="workspace-name-row">
                      <span className="workspace-alias">{workspace.alias || workspace.name}</span>
                      <span
                        className="workspace-role-badge"
                        style={{
                          backgroundColor: getRoleColor(workspace.role),
                          opacity: workspace.role ? 1 : 0.3
                        }}
                        onClick={(e) => handleRoleClick(workspace.id, e)}
                        title={workspace.role || 'Click to set role'}
                      >
                        {workspace.role || '＋'}
                      </span>
                      <span
                        className="workspace-color-badge"
                        style={{
                          backgroundColor: workspace.backgroundColor || '#1e1e1e',
                          borderColor: workspace.textColor || '#cccccc'
                        }}
                        onClick={(e) => handleColorClick(workspace.id, e)}
                        title="Set terminal colors"
                      />
                    </div>
                    <span className="workspace-folder">{workspace.name}</span>
                  </>
                )}
              </div>
              {roleMenuId === workspace.id && (
                <div className="role-selector-menu" ref={roleMenuRef} onClick={(e) => e.stopPropagation()}>
                  <div className="role-menu-title">Select Role</div>
                  {PRESET_ROLES.filter(r => r.id !== 'custom').map(role => (
                    <div
                      key={role.id}
                      className={`role-menu-item ${workspace.role === role.name ? 'selected' : ''}`}
                      onClick={() => handleSelectRole(workspace.id, role.name)}
                    >
                      <span className="role-color-dot" style={{ backgroundColor: role.color }} />
                      {role.name}
                    </div>
                  ))}
                  <div className="role-menu-divider" />
                  <div className="role-menu-custom">
                    <input
                      type="text"
                      placeholder="Custom role..."
                      value={customRoleInput}
                      onChange={(e) => setCustomRoleInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleCustomRoleSubmit(workspace.id)
                        if (e.key === 'Escape') setRoleMenuId(null)
                      }}
                      autoFocus
                    />
                    <button onClick={() => handleCustomRoleSubmit(workspace.id)}>OK</button>
                  </div>
                  {workspace.role && (
                    <>
                      <div className="role-menu-divider" />
                      <div
                        className="role-menu-item role-menu-clear"
                        onClick={() => handleSelectRole(workspace.id, '')}
                      >
                        Clear Role
                      </div>
                    </>
                  )}
                </div>
              )}
              {colorMenuId === workspace.id && (
                <div className="color-selector-menu" ref={colorMenuRef} onClick={(e) => e.stopPropagation()}>
                  <div className="color-menu-title">Terminal Colors</div>
                  <div className="color-presets">
                    {PRESET_COLORS.map(color => (
                      <div
                        key={color.id}
                        className={`color-preset-item ${
                          workspace.backgroundColor === color.bg && workspace.textColor === color.text ? 'selected' : ''
                        }`}
                        onClick={() => handleSelectColor(workspace.id, color.bg, color.text)}
                        title={color.label}
                      >
                        <span
                          className="color-preview"
                          style={{
                            backgroundColor: color.bg || '#1e1e1e',
                            color: color.text || '#cccccc'
                          }}
                        >
                          Aa
                        </span>
                        <span className="color-label">{color.label}</span>
                      </div>
                    ))}
                  </div>
                  <div className="color-menu-divider" />
                  <div className="color-menu-custom">
                    <div className="color-input-row">
                      <label>Background</label>
                      <input
                        type="color"
                        value={customBgColor || '#1e1e1e'}
                        onChange={(e) => setCustomBgColor(e.target.value)}
                      />
                      <input
                        type="text"
                        placeholder="#1e1e1e"
                        value={customBgColor}
                        onChange={(e) => setCustomBgColor(e.target.value)}
                      />
                    </div>
                    <div className="color-input-row">
                      <label>Text</label>
                      <input
                        type="color"
                        value={customTextColor || '#cccccc'}
                        onChange={(e) => setCustomTextColor(e.target.value)}
                      />
                      <input
                        type="text"
                        placeholder="#cccccc"
                        value={customTextColor}
                        onChange={(e) => setCustomTextColor(e.target.value)}
                      />
                    </div>
                    <button
                      className="color-apply-btn"
                      onClick={() => handleCustomColorSubmit(workspace.id)}
                    >
                      Apply
                    </button>
                  </div>
                </div>
              )}
              <div className="workspace-item-actions">
                <ActivityIndicator
                  workspaceId={workspace.id}
                  size="small"
                />
                <button
                    className="remove-btn"
                    onClick={(e) => {
                      e.stopPropagation()
                      onRemoveWorkspace(workspace.id)
                    }}
                  >
                    ×
                  </button>
                </div>
              </div>
            </div>
          )
        )}
      </div>
      <div className="sidebar-footer">
        <button className="add-workspace-btn" onClick={onAddWorkspace}>
          + Add Workspace
        </button>
        <div className="sidebar-footer-buttons">
          <button className="settings-btn" onClick={onOpenSettings}>
            Settings
          </button>
          <button className="settings-btn" onClick={onOpenAbout}>
            About
          </button>
        </div>
      </div>
    </aside>
  )
}
