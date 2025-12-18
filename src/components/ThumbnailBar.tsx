import type { TerminalInstance } from '../types'
import { TerminalThumbnail } from './TerminalThumbnail'

interface ThumbnailBarProps {
  terminals: TerminalInstance[]
  focusedTerminalId: string | null
  onFocus: (id: string) => void
  onAddTerminal?: () => void
  onRenameTerminal?: (id: string, alias: string) => void
  showAddButton: boolean
}

export function ThumbnailBar({
  terminals,
  focusedTerminalId,
  onFocus,
  onAddTerminal,
  onRenameTerminal,
  showAddButton
}: ThumbnailBarProps) {
  const label = 'Terminals'

  return (
    <div className="thumbnail-bar">
      <div className="thumbnail-bar-header">
        <span>{label}</span>
      </div>
      <div className="thumbnail-list">
        {terminals.map(terminal => (
          <TerminalThumbnail
            key={terminal.id}
            terminal={terminal}
            isActive={terminal.id === focusedTerminalId}
            onClick={() => onFocus(terminal.id)}
            onRename={onRenameTerminal}
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
