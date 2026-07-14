import { useEffect, useState, useRef } from 'react'
import type { TerminalInstance } from '../types'
import { ActivityIndicator } from './ActivityIndicator'

interface TerminalThumbnailProps {
  terminal: TerminalInstance
  isActive: boolean
  isDragging?: boolean
  isDragOver?: boolean
  onClick: () => void
  onRename?: (id: string, alias: string) => void
  onDragStart?: () => void
  onDragEnd?: () => void
  onDragOver?: () => void
  onDrop?: () => void
}

export function TerminalThumbnail({
  terminal,
  isActive,
  isDragging,
  isDragOver,
  onClick,
  onRename,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop
}: TerminalThumbnailProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const isClaudeCode = terminal.type === 'claude-code'

  // Auto focus and select input when editing
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

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
      draggable
      onDragStart={handleDragStart}
      onDragEnd={onDragEnd}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <div className="thumbnail-header">
        <div
          className={`thumbnail-title ${isClaudeCode ? 'claude-code' : ''}`}
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
    </div>
  )
}
