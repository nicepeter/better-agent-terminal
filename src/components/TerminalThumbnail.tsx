import { useEffect, useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { TerminalInstance } from '../types'
import { ActivityIndicator } from './ActivityIndicator'

interface TerminalThumbnailProps {
  terminal: TerminalInstance
  isActive: boolean
  isDragging?: boolean
  isDragOver?: boolean
  onClick: () => void
  onRename?: (id: string, alias: string) => void
  onSetAppearance?: (
    id: string,
    appearance: Pick<TerminalInstance, 'backgroundColor' | 'textColor' | 'tabBackgroundColor' | 'tabTextColor'>
  ) => void
  onDragStart?: () => void
  onDragEnd?: () => void
  onDragOver?: () => void
  onDrop?: () => void
}

function isValidColor(value: string): boolean {
  return value === '' || /^#[0-9a-fA-F]{6}$/.test(value)
}

export function TerminalThumbnail({
  terminal,
  isActive,
  isDragging,
  isDragOver,
  onClick,
  onRename,
  onSetAppearance,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop
}: TerminalThumbnailProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState('')
  const [appearanceMenu, setAppearanceMenu] = useState<{ x: number; y: number } | null>(null)
  const [contentBackground, setContentBackground] = useState('')
  const [contentText, setContentText] = useState('')
  const [tabBackground, setTabBackground] = useState('')
  const [tabText, setTabText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const appearanceMenuRef = useRef<HTMLDivElement>(null)
  const isClaudeCode = terminal.type === 'claude-code'

  // Auto focus and select input when editing
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  useEffect(() => {
    if (!appearanceMenu) return
    const close = (event: MouseEvent) => {
      if (!appearanceMenuRef.current?.contains(event.target as Node)) {
        setAppearanceMenu(null)
      }
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setAppearanceMenu(null)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [appearanceMenu])

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!onRename) return
    setEditValue(terminal.alias || terminal.title)
    setIsEditing(true)
  }

  const handleRenameSubmit = () => {
    if (onRename) {
      onRename(terminal.id, editValue)
    }
    setIsEditing(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleRenameSubmit()
    } else if (e.key === 'Escape') {
      setIsEditing(false)
    }
  }

  const displayName = terminal.alias || terminal.title

  const handleAppearanceMenu = (event: React.MouseEvent) => {
    if (!onSetAppearance) return
    event.preventDefault()
    event.stopPropagation()
    setContentBackground(terminal.backgroundColor || '')
    setContentText(terminal.textColor || '')
    setTabBackground(terminal.tabBackgroundColor || '')
    setTabText(terminal.tabTextColor || '')
    setAppearanceMenu({
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - 292)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - 390))
    })
  }

  const handleAppearanceApply = () => {
    onSetAppearance?.(terminal.id, {
      backgroundColor: contentBackground || undefined,
      textColor: contentText || undefined,
      tabBackgroundColor: tabBackground || undefined,
      tabTextColor: tabText || undefined
    })
    setAppearanceMenu(null)
  }

  const hasInvalidColor = [contentBackground, contentText, tabBackground, tabText]
    .some(value => !isValidColor(value))

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', terminal.id)
    onDragStart?.()
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    onDragOver?.()
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    onDrop?.()
  }

  return (
    <div
      className={`thumbnail ${isActive ? 'active' : ''} ${isClaudeCode ? 'claude-code' : ''} ${isDragging ? 'dragging' : ''} ${isDragOver ? 'drag-over' : ''}`}
      onClick={onClick}
      onContextMenu={handleAppearanceMenu}
      style={{
        backgroundColor: terminal.tabBackgroundColor,
        color: terminal.tabTextColor
      }}
      draggable
      onDragStart={handleDragStart}
      onDragEnd={onDragEnd}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <div
        className="thumbnail-header"
        style={{
          backgroundColor: terminal.tabBackgroundColor,
          color: terminal.tabTextColor
        }}
      >
        <div
          className={`thumbnail-title ${isClaudeCode && !terminal.tabTextColor ? 'claude-code' : ''}`}
          onDoubleClick={handleDoubleClick}
        >
          {isClaudeCode && <span>✦</span>}
          {isEditing ? (
            <input
              ref={inputRef}
              type="text"
              className="terminal-rename-input"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={handleRenameSubmit}
              onKeyDown={handleKeyDown}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span>{displayName}</span>
          )}
        </div>
        <ActivityIndicator terminalId={terminal.id} size="small" />
      </div>
      {appearanceMenu && createPortal((
        <div
          ref={appearanceMenuRef}
          className="terminal-appearance-menu"
          style={{ left: appearanceMenu.x, top: appearanceMenu.y }}
          onClick={event => event.stopPropagation()}
          onContextMenu={event => event.preventDefault()}
        >
          <div className="terminal-appearance-title">{displayName} 外觀</div>

          <div className="terminal-appearance-section">
            <div className="terminal-appearance-section-title">
              <span>Terminal 內容區</span>
              <button
                onClick={() => {
                  setContentBackground('')
                  setContentText('')
                }}
              >
                沿用 Project
              </button>
            </div>
            <ColorField
              label="背景"
              value={contentBackground}
              fallback="#1f1d1a"
              onChange={setContentBackground}
            />
            <ColorField
              label="文字"
              value={contentText}
              fallback="#dfdbc3"
              onChange={setContentText}
            />
          </div>

          <div className="terminal-appearance-section">
            <div className="terminal-appearance-section-title">
              <span>底部名字區</span>
              <button
                onClick={() => {
                  setTabBackground('')
                  setTabText('')
                }}
              >
                恢復預設
              </button>
            </div>
            <ColorField
              label="背景"
              value={tabBackground}
              fallback="#2d2d2d"
              onChange={setTabBackground}
            />
            <ColorField
              label="文字"
              value={tabText}
              fallback="#cccccc"
              onChange={setTabText}
            />
          </div>

          <div className="terminal-appearance-actions">
            <button onClick={() => setAppearanceMenu(null)}>取消</button>
            <button
              className="primary"
              disabled={hasInvalidColor}
              title={hasInvalidColor ? '顏色格式必須是 #RRGGBB' : undefined}
              onClick={handleAppearanceApply}
            >
              套用
            </button>
          </div>
        </div>
      ), document.body)}
    </div>
  )
}

interface ColorFieldProps {
  label: string
  value: string
  fallback: string
  onChange: (value: string) => void
}

function ColorField({ label, value, fallback, onChange }: ColorFieldProps) {
  return (
    <label className="terminal-color-field">
      <span>{label}</span>
      <input
        type="color"
        value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback}
        onChange={event => onChange(event.target.value)}
      />
      <input
        type="text"
        value={value}
        placeholder="沿用預設"
        maxLength={7}
        onChange={event => onChange(event.target.value)}
      />
    </label>
  )
}
