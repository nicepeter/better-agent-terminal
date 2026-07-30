import { useState } from 'react'
import type { TerminalInstance } from '../types'
import { TerminalThumbnail } from './TerminalThumbnail'

interface ThumbnailBarProps {
  terminals: TerminalInstance[]
  focusedTerminalId: string | null
  onFocus: (id: string) => void
  onAddTerminal?: () => void
  onRenameTerminal?: (id: string, alias: string) => void
  onSetTerminalAppearance?: (
    id: string,
    appearance: Pick<TerminalInstance, 'backgroundColor' | 'textColor' | 'tabBackgroundColor' | 'tabTextColor'>
  ) => void
  onReorderTerminals?: (fromIndex: number, toIndex: number) => void
  showAddButton: boolean
}

export function ThumbnailBar({
  terminals,
  focusedTerminalId,
  onFocus,
  onAddTerminal,
  onRenameTerminal,
  onSetTerminalAppearance,
  onReorderTerminals,
  showAddButton
}: ThumbnailBarProps) {
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)

  const label = 'Terminals'

  const handleDragStart = (index: number) => {
    setDraggedIndex(index)
  }

  const handleDragEnd = () => {
    setDraggedIndex(null)
    setDragOverIndex(null)
  }

  const handleDragOver = (index: number) => {
    if (draggedIndex !== null && draggedIndex !== index) {
      setDragOverIndex(index)
    }
  }

  const handleDrop = (toIndex: number) => {
    if (draggedIndex !== null && draggedIndex !== toIndex && onReorderTerminals) {
      onReorderTerminals(draggedIndex, toIndex)
    }
    setDraggedIndex(null)
    setDragOverIndex(null)
  }

  return (
    <div className="thumbnail-bar">
      <div className="thumbnail-bar-header">
        <span>{label}</span>
      </div>
      <div className="thumbnail-list">
        {terminals.map((terminal, index) => (
          <TerminalThumbnail
            key={terminal.id}
            terminal={terminal}
            isActive={terminal.id === focusedTerminalId}
            isDragging={draggedIndex === index}
            isDragOver={dragOverIndex === index}
            onClick={() => onFocus(terminal.id)}
            onRename={onRenameTerminal}
            onSetAppearance={onSetTerminalAppearance}
            onDragStart={() => handleDragStart(index)}
            onDragEnd={handleDragEnd}
            onDragOver={() => handleDragOver(index)}
            onDrop={() => handleDrop(index)}
          />
        ))}
        {showAddButton && onAddTerminal && (
          <button className="add-terminal-btn" onClick={onAddTerminal}>
            +
          </button>
        )}
      </div>
    </div>
  )
}
