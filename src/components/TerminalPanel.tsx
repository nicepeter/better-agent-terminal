import { useEffect, useRef, useState, useCallback } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { SearchAddon } from '@xterm/addon-search'
import { workspaceStore } from '../stores/workspace-store'
import { settingsStore } from '../stores/settings-store'
import '@xterm/xterm/css/xterm.css'

interface TerminalPanelProps {
  terminalId: string
  isActive?: boolean
  workspaceIsActive?: boolean  // When workspace becomes active, auto-focus terminal
  backgroundColor?: string
  textColor?: string
}

interface ContextMenu {
  x: number
  y: number
  hasSelection: boolean
}

export function TerminalPanel({ terminalId, isActive = true, workspaceIsActive = true, backgroundColor, textColor }: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const searchAddonRef = useRef<SearchAddon | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [searchText, setSearchText] = useState('')

  // Handle paste with text size checking
  const handlePasteText = (text: string) => {
    if (!text) return

    // For very long text (> 2000 chars), split into smaller chunks
    if (text.length > 2000) {
      const chunks = []
      for (let i = 0; i < text.length; i += 1000) {
        chunks.push(text.slice(i, i + 1000))
      }

      // Send chunks with small delays to prevent overwhelming the terminal
      chunks.forEach((chunk, index) => {
        setTimeout(() => {
          window.electronAPI.pty.write(terminalId, chunk)
        }, index * 50) // 50ms delay between chunks
      })
    } else {
      // Normal sized text, send directly
      window.electronAPI.pty.write(terminalId, text)
    }
  }

  // Handle context menu actions
  const handleCopy = () => {
    if (terminalRef.current) {
      const selection = terminalRef.current.getSelection()
      if (selection) {
        navigator.clipboard.writeText(selection)
      }
    }
    setContextMenu(null)
  }

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text) {
        handlePasteText(text)
      }
    } catch (err) {
      console.error('Failed to read clipboard:', err)
    }
    setContextMenu(null)
  }

  // Close context menu when clicking outside
  useEffect(() => {
    const handleClickOutside = () => setContextMenu(null)
    document.addEventListener('click', handleClickOutside)
    return () => document.removeEventListener('click', handleClickOutside)
  }, [])

  // Track drag counter to properly handle dragenter/dragleave on child elements
  const dragCounterRef = useRef(0)

  // Handle drag and drop files - use refs for callbacks to avoid stale closures
  const handleDragEnter = useCallback((e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current++
    if (dragCounterRef.current === 1) {
      setIsDragging(true)
    }
  }, [])

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy'
    }
  }, [])

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current--
    if (dragCounterRef.current === 0) {
      setIsDragging(false)
    }
  }, [])

  const handleDrop = useCallback((e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current = 0
    setIsDragging(false)

    const files = e.dataTransfer?.files
    if (files && files.length > 0) {
      // Get file paths and escape spaces for shell
      const paths = Array.from(files).map(file => {
        // Use the path property from Electron's File object
        const filePath = (file as File & { path?: string }).path || file.name
        // Escape spaces and special characters for shell
        if (filePath.includes(' ') || filePath.includes('(') || filePath.includes(')')) {
          return `"${filePath}"`
        }
        return filePath
      })

      // Write paths to terminal (joined by space for multiple files)
      const pathString = paths.join(' ')
      window.electronAPI.pty.write(terminalId, pathString)
    }
  }, [terminalId])

  // Handle terminal resize and focus when becoming active
  useEffect(() => {
    if (isActive && workspaceIsActive && fitAddonRef.current && terminalRef.current) {
      // Small delay to ensure DOM is updated
      const timeoutId = setTimeout(() => {
        if (fitAddonRef.current && terminalRef.current) {
          fitAddonRef.current.fit()
          const { cols, rows } = terminalRef.current
          window.electronAPI.pty.resize(terminalId, cols, rows)
          terminalRef.current.focus()
        }
      }, 100)

      return () => clearTimeout(timeoutId)
    }
  }, [isActive, workspaceIsActive, terminalId])

  // Add intersection observer to detect when terminal becomes visible
  useEffect(() => {
    if (!containerRef.current || !fitAddonRef.current || !terminalRef.current) return

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && isActive && fitAddonRef.current && terminalRef.current) {
            // Terminal became visible, resize it
            setTimeout(() => {
              if (fitAddonRef.current && terminalRef.current) {
                fitAddonRef.current.fit()
                const { cols, rows } = terminalRef.current
                window.electronAPI.pty.resize(terminalId, cols, rows)
              }
            }, 50)
          }
        })
      },
      { threshold: 0.1 }
    )

    observer.observe(containerRef.current)

    return () => observer.disconnect()
  }, [isActive, terminalId])

  useEffect(() => {
    if (!containerRef.current) return

    // Create terminal instance
    // Novel theme (macOS Terminal.app inspired), with custom colors override
    const bgColor = backgroundColor || '#1f1d1a'
    const fgColor = textColor || '#dfdbc3'
    const terminal = new Terminal({
      theme: {
        background: bgColor,
        foreground: fgColor,
        cursor: fgColor,
        cursorAccent: bgColor,
        selectionBackground: '#5c5142',
        black: '#3b3228',
        red: '#cb6077',
        green: '#beb55b',
        yellow: '#f4bc87',
        blue: '#8ab3b5',
        magenta: '#a89bb9',
        cyan: '#7bbda4',
        white: '#d0c8c6',
        brightBlack: '#554d46',
        brightRed: '#cb6077',
        brightGreen: '#beb55b',
        brightYellow: '#f4bc87',
        brightBlue: '#8ab3b5',
        brightMagenta: '#a89bb9',
        brightCyan: '#7bbda4',
        brightWhite: '#f5f1e6'
      },
      fontSize: settingsStore.getSettings().fontSize,
      fontFamily: '"SF Mono", Menlo, Monaco, "Courier New", monospace',
      cursorBlink: true,
      scrollback: 10000,
      convertEol: true,
      allowProposedApi: true,
      allowTransparency: true,
      scrollOnOutput: true
    })

    const fitAddon = new FitAddon()
    const unicode11Addon = new Unicode11Addon()
    const searchAddon = new SearchAddon()
    terminal.loadAddon(fitAddon)
    terminal.loadAddon(searchAddon)
    terminal.open(containerRef.current)

    // Load unicode11 addon after terminal is open
    terminal.loadAddon(unicode11Addon)
    terminal.unicode.activeVersion = '11'

    searchAddonRef.current = searchAddon

    // Delay fit to ensure terminal is fully initialized
    requestAnimationFrame(() => {
      fitAddon.fit()
    })

    // Fix IME textarea position - force it to bottom left
    const fixImePosition = () => {
      const textarea = containerRef.current?.querySelector('.xterm-helper-textarea') as HTMLTextAreaElement
      if (textarea) {
        textarea.style.position = 'fixed'
        textarea.style.bottom = '80px'
        textarea.style.left = '220px'
        textarea.style.top = 'auto'
        textarea.style.width = '1px'
        textarea.style.height = '20px'
        textarea.style.opacity = '0'
        textarea.style.zIndex = '10'
      }
    }

    // Use MutationObserver to keep fixing position when xterm.js changes it
    const observer = new MutationObserver(() => {
      fixImePosition()
    })

    const textarea = containerRef.current?.querySelector('.xterm-helper-textarea')
    if (textarea) {
      observer.observe(textarea, { attributes: true, attributeFilter: ['style'] })
      fixImePosition()
    }

    terminalRef.current = terminal
    fitAddonRef.current = fitAddon

    // Handle terminal input
    terminal.onData((data) => {
      window.electronAPI.pty.write(terminalId, data)
    })

    // Handle copy and paste shortcuts
    terminal.attachCustomKeyEventHandler((event) => {
      // Cmd+F (Mac) or Ctrl+F (Windows/Linux) for search
      // On Mac, only use Cmd+F so Ctrl+F can be used for readline forward-char
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0
      if ((isMac ? event.metaKey : event.ctrlKey) && event.key === 'f') {
        event.preventDefault()
        setShowSearch(true)
        return false
      }
      // Ctrl+Shift+C for copy
      if (event.ctrlKey && event.shiftKey && event.key === 'C') {
        const selection = terminal.getSelection()
        if (selection) {
          navigator.clipboard.writeText(selection)
        }
        return false
      }
      // Ctrl+Shift+V for paste
      if (event.ctrlKey && event.shiftKey && event.key === 'V') {
        navigator.clipboard.readText().then((text) => {
          handlePasteText(text)
        })
        return false
      }
      // Ctrl+V for paste (standard shortcut)
      if (event.ctrlKey && !event.shiftKey && event.key === 'v') {
        event.preventDefault()
        navigator.clipboard.readText().then((text) => {
          handlePasteText(text)
        })
        return false
      }
      // Ctrl+C for copy when there's a selection
      if (event.ctrlKey && !event.shiftKey && event.key === 'c') {
        const selection = terminal.getSelection()
        if (selection) {
          navigator.clipboard.writeText(selection)
          return false
        }
        // If no selection, let Ctrl+C pass through for interrupt signal
        return true
      }
      return true
    })

    // Right-click context menu for copy/paste
    containerRef.current.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      const selection = terminal.getSelection()
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        hasSelection: !!selection
      })
    })

    // Handle terminal output
    const unsubscribeOutput = window.electronAPI.pty.onOutput((id, data) => {
      if (id === terminalId) {
        terminal.write(data)
        // Update activity time when there's output
        workspaceStore.updateTerminalActivity(terminalId)
      }
    })

    // Handle terminal exit
    const unsubscribeExit = window.electronAPI.pty.onExit((id, exitCode) => {
      if (id === terminalId) {
        terminal.write(`\r\n\x1b[90m[Process exited with code ${exitCode}]\x1b[0m\r\n`)
      }
    })

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      // Only resize if terminal is currently active
      if (isActive) {
        fitAddon.fit()
        const { cols, rows } = terminal
        window.electronAPI.pty.resize(terminalId, cols, rows)
      }
    })
    resizeObserver.observe(containerRef.current)

    // Initial resize
    setTimeout(() => {
      fitAddon.fit()
      const { cols, rows } = terminal
      window.electronAPI.pty.resize(terminalId, cols, rows)
    }, 100)

    // Add native DOM event listeners for drag and drop with capture phase
    // This ensures we capture events before xterm.js internal elements can handle them
    const container = containerRef.current
    container.addEventListener('dragenter', handleDragEnter, true)
    container.addEventListener('dragover', handleDragOver, true)
    container.addEventListener('dragleave', handleDragLeave, true)
    container.addEventListener('drop', handleDrop, true)

    return () => {
      unsubscribeOutput()
      unsubscribeExit()
      resizeObserver.disconnect()
      observer.disconnect()
      container.removeEventListener('dragenter', handleDragEnter, true)
      container.removeEventListener('dragover', handleDragOver, true)
      container.removeEventListener('dragleave', handleDragLeave, true)
      container.removeEventListener('drop', handleDrop, true)
      terminal.dispose()
    }
  }, [terminalId, backgroundColor, textColor, handleDragEnter, handleDragOver, handleDragLeave, handleDrop])

  // Listen for font size changes from settings
  useEffect(() => {
    const unsubscribe = settingsStore.subscribe(() => {
      const terminal = terminalRef.current
      const fitAddon = fitAddonRef.current
      if (terminal && fitAddon) {
        const newFontSize = settingsStore.getSettings().fontSize
        terminal.options.fontSize = newFontSize
        fitAddon.fit()
      }
    })
    return () => unsubscribe()
  }, [])

  // Focus search input when search is shown
  useEffect(() => {
    if (showSearch && searchInputRef.current) {
      searchInputRef.current.focus()
    }
  }, [showSearch])

  // Search handlers
  const handleSearch = (direction: 'next' | 'prev') => {
    if (!searchAddonRef.current || !searchText) return
    if (direction === 'next') {
      searchAddonRef.current.findNext(searchText)
    } else {
      searchAddonRef.current.findPrevious(searchText)
    }
  }

  const closeSearch = () => {
    setShowSearch(false)
    setSearchText('')
    terminalRef.current?.focus()
  }

  return (
    <div
      ref={containerRef}
      className={`terminal-panel ${isDragging ? 'dragging' : ''}`}
    >
      {showSearch && (
        <div className="terminal-search-bar">
          <input
            ref={searchInputRef}
            type="text"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                handleSearch(e.shiftKey ? 'prev' : 'next')
              }
              if (e.key === 'Escape') {
                e.preventDefault()
                closeSearch()
              }
            }}
            placeholder="Search..."
          />
          <button onClick={() => handleSearch('prev')} title="Previous (Shift+Enter)">▲</button>
          <button onClick={() => handleSearch('next')} title="Next (Enter)">▼</button>
          <button onClick={closeSearch} title="Close (Esc)">✕</button>
        </div>
      )}
      {isDragging && (
        <div className="drop-overlay">
          <div className="drop-message">Drop files here to paste path</div>
        </div>
      )}
      {contextMenu && (
        <div
          className="context-menu"
          style={{
            position: 'fixed',
            left: contextMenu.x,
            top: contextMenu.y,
            zIndex: 1000
          }}
        >
          {contextMenu.hasSelection && (
            <button onClick={handleCopy} className="context-menu-item">
              複製
            </button>
          )}
          <button onClick={handlePaste} className="context-menu-item">
            貼上
          </button>
        </div>
      )}
    </div>
  )
}
