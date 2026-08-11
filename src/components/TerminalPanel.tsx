import { useEffect, useRef, useState, useCallback } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { SearchAddon } from '@xterm/addon-search'
import { WebglAddon } from '@xterm/addon-webgl'
import { settingsStore } from '../stores/settings-store'
import { workspaceStore } from '../stores/workspace-store'
import { ptyOutputRouter } from '../lib/pty-output-router'
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

// Max output retained while a terminal is hidden (older content scrolls off
// anyway). Roughly one scrollback's worth of bytes.
const MAX_PENDING_BYTES = 256 * 1024
// Keep paste writes large enough that a big clipboard does not create thousands
// of timers/IPC calls, but bounded so the PTY gets a chance to drain between
// writes. 16 KiB is also comfortably below Electron's IPC message limits.
const PASTE_CHUNK_SIZE = 16 * 1024

export function TerminalPanel({ terminalId, isActive = true, workspaceIsActive = true, backgroundColor, textColor }: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const webglAddonRef = useRef<WebglAddon | null>(null)
  const searchAddonRef = useRef<SearchAddon | null>(null)
  // While a terminal is hidden we buffer its output instead of writing it to
  // xterm, so hidden terminals (e.g. background Claude sessions redrawing their
  // TUI) don't parse+render on the main thread. Flushed when it becomes visible.
  const visibleRef = useRef(false)
  const pendingWritesRef = useRef<string[]>([])
  const pendingBytesRef = useRef(0)
  const pasteQueueRef = useRef<Promise<void>>(Promise.resolve())
  const pasteGenerationRef = useRef(0)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [searchText, setSearchText] = useState('')

  const writeToPty = useCallback((data: string) => {
    workspaceStore.markTerminalInteraction(terminalId)
    return window.electronAPI.pty.write(terminalId, data)
  }, [terminalId])

  // Serialize large pastes. The old implementation eagerly allocated one
  // setTimeout per 1,000 characters and delayed each one by 50 ms, making a
  // 1 MB paste take about 50 seconds while thousands of callbacks and echoed
  // output accumulated in the renderer.
  const handlePasteText = useCallback((text: string) => {
    if (!text) return
    const terminal = terminalRef.current
    // Match xterm's native paste behavior: normalize browser/Windows newlines
    // and preserve bracketed-paste mode so multiline logs are inserted as one
    // edit instead of being executed line-by-line by shells that support it.
    const normalizedText = text.replace(/\r?\n/g, '\r')
    const pasteText = terminal?.modes.bracketedPasteMode
      ? `\x1b[200~${normalizedText}\x1b[201~`
      : normalizedText
    const generation = pasteGenerationRef.current

    pasteQueueRef.current = pasteQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        for (let start = 0; start < pasteText.length;) {
          if (generation !== pasteGenerationRef.current) return

          let end = Math.min(start + PASTE_CHUNK_SIZE, pasteText.length)
          // Do not split a UTF-16 surrogate pair across two IPC writes.
          if (end < pasteText.length && /[\uD800-\uDBFF]/.test(pasteText[end - 1])) end++
          await writeToPty(pasteText.slice(start, end))
          start = end

          // Yield between chunks so echoed PTY output, painting and user input
          // can run even when the main-process write acknowledgement is fast.
          if (start < pasteText.length) {
            await new Promise<void>((resolve) => setTimeout(resolve, 0))
          }
        }
      })
  }, [writeToPty])

  // Cancel queued paste work when this panel changes identity or unmounts.
  useEffect(() => {
    pasteGenerationRef.current++
    return () => {
      pasteGenerationRef.current++
    }
  }, [terminalId])

  // Handle context menu actions
  const handleCopy = () => {
    if (terminalRef.current) {
      const selection = terminalRef.current.getSelection()
      if (selection) {
        window.electronAPI.clipboard.writeText(selection)
      }
    }
    setContextMenu(null)
  }

  const handlePaste = async () => {
    try {
      const text = await window.electronAPI.clipboard.readText()
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
      writeToPty(pathString)
    }
  }, [writeToPty])

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

  // Handle system wake from standby - refit terminal when page becomes visible
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && isActive && fitAddonRef.current && terminalRef.current && containerRef.current) {
        setTimeout(() => {
          if (fitAddonRef.current && terminalRef.current && containerRef.current) {
            const terminal = terminalRef.current

            // 1. First show cursor (before any refresh)
            terminal.write('\x1b[?25h')

            // 2. Fit terminal and resize PTY
            fitAddonRef.current.fit()
            const { cols, rows } = terminal
            window.electronAPI.pty.resize(terminalId, cols, rows)

            // 3. Fix IME textarea position
            const textarea = containerRef.current.querySelector('.xterm-helper-textarea') as HTMLTextAreaElement
            if (textarea) {
              textarea.blur()
              textarea.style.position = 'fixed'
              textarea.style.bottom = '80px'
              textarea.style.left = '220px'
              textarea.style.top = 'auto'
            }

            // 4. Trigger resize event to force xterm.js recalculate positions
            window.dispatchEvent(new Event('resize'))

            // 5. Focus terminal and refresh display
            setTimeout(() => {
              terminal.focus()
              // Force refresh after focus to ensure cursor is rendered
              terminal.refresh(0, terminal.rows - 1)
              // Send cursor show command again after refresh
              terminal.write('\x1b[?25h')
            }, 50)
          }
        }, 100)
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [isActive, terminalId])

  // Listen for custom focus event (triggered by clicking activity indicator)
  useEffect(() => {
    const handleFocusRequest = (e: CustomEvent) => {
      if (e.detail === terminalId && terminalRef.current && fitAddonRef.current && containerRef.current) {
        const terminal = terminalRef.current
        // Refit to ensure proper dimensions
        fitAddonRef.current.fit()
        // Refresh display to update cursor position
        terminal.refresh(0, terminal.rows - 1)
        // Scroll to bottom to ensure cursor is visible
        terminal.scrollToBottom()
        // Fix IME textarea position before focus
        const textarea = containerRef.current.querySelector('.xterm-helper-textarea') as HTMLTextAreaElement
        if (textarea) {
          // Blur first to reset IME state
          textarea.blur()
          textarea.style.position = 'fixed'
          textarea.style.bottom = '80px'
          textarea.style.left = '220px'
          textarea.style.top = 'auto'
        }
        // Trigger resize event to force xterm.js recalculate positions
        window.dispatchEvent(new Event('resize'))
        // Focus the terminal after a short delay to allow IME reset
        setTimeout(() => {
          terminal.focus()
        }, 50)
      }
    }
    window.addEventListener('focus-terminal', handleFocusRequest as EventListener)
    return () => window.removeEventListener('focus-terminal', handleFocusRequest as EventListener)
  }, [terminalId])

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
      scrollback: 1000,
      convertEol: true,
      allowProposedApi: true,
      // Background is an opaque solid colour, so transparency (per-cell alpha
      // blending) is unnecessary overhead — costly on every render incl. scroll.
      allowTransparency: false,
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

    // Fix IME textarea position - force it to bottom left.
    // Only write a property when it actually differs from the target value.
    // xterm re-applies inline styles as the cursor moves; writing identical
    // values would still create style mutations that re-trigger the observer
    // below, so the guard keeps this from churning every keystroke.
    const IME_STYLE: Record<string, string> = {
      position: 'fixed',
      bottom: '80px',
      left: '220px',
      top: 'auto',
      width: '1px',
      height: '20px',
      opacity: '0',
      zIndex: '10'
    }
    const fixImePosition = () => {
      const textarea = containerRef.current?.querySelector('.xterm-helper-textarea') as HTMLTextAreaElement
      if (!textarea) return
      const style = textarea.style as unknown as Record<string, string>
      for (const prop in IME_STYLE) {
        if (style[prop] !== IME_STYLE[prop]) {
          style[prop] = IME_STYLE[prop]
        }
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
      writeToPty(data)
    })

    // Handle copy and paste shortcuts
    terminal.attachCustomKeyEventHandler((event) => {
      // Shift+Enter for newline (instead of Option+Enter)
      // Only handle keydown to prevent double trigger
      if (event.type === 'keydown' && event.shiftKey && event.key === 'Enter') {
        event.preventDefault()
        writeToPty('\n')
        return false
      }
      // Cmd+F (Mac) or Ctrl+F (Windows/Linux) for search
      // On Mac, only use Cmd+F so Ctrl+F can be used for readline forward-char
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0
      // Cmd+1 (Mac) to scroll to bottom and focus terminal
      if (isMac && event.metaKey && event.key === '1') {
        event.preventDefault()
        fitAddonRef.current?.fit()
        terminal.refresh(0, terminal.rows - 1)
        terminal.scrollToBottom()
        terminal.focus()
        return false
      }
      if ((isMac ? event.metaKey : event.ctrlKey) && event.key === 'f') {
        event.preventDefault()
        setShowSearch(true)
        return false
      }
      // Ctrl+Shift+C for copy
      if (event.ctrlKey && event.shiftKey && event.key === 'C') {
        const selection = terminal.getSelection()
        if (selection) {
          window.electronAPI.clipboard.writeText(selection)
        }
        return false
      }
      // Ctrl+Shift+V for paste
      if (event.type === 'keydown' && event.ctrlKey && event.shiftKey && event.key === 'V') {
        event.preventDefault()
        window.electronAPI.clipboard.readText().then((text) => {
          handlePasteText(text)
        })
        return false
      }
      // Cmd+V (Mac) / Ctrl+V (others) for paste
      if (event.type === 'keydown' && (isMac ? event.metaKey : event.ctrlKey) && !event.shiftKey && event.key === 'v') {
        event.preventDefault()
        window.electronAPI.clipboard.readText().then((text) => {
          handlePasteText(text)
        })
        return false
      }
      // Cmd+C (Mac) / Ctrl+C (others) for copy when there's a selection
      if (event.type === 'keydown' && (isMac ? event.metaKey : event.ctrlKey) && !event.shiftKey && event.key === 'c') {
        const selection = terminal.getSelection()
        if (selection) {
          window.electronAPI.clipboard.writeText(selection)
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

    // Replay buffered history (held in the main process, so it survives
    // renderer reloads / re-mounts) BEFORE subscribing to live output, so the
    // restored scrollback stays in order ahead of new data. Live chunks that
    // arrive during the short fetch are preserved in the main-process buffer
    // and will be present on the next mount.
    let unsubscribeOutput = () => {}
    let disposed = false
    ;(async () => {
      try {
        const history = await window.electronAPI.pty.getBuffer(terminalId)
        if (disposed) return
        if (history) terminal.write(history)
      } catch (err) {
        console.error('Failed to restore terminal buffer:', err)
      }
      if (disposed) return
      // Routed by id so only this terminal's handler runs per chunk (activity
      // is updated once, globally, in App). Only the VISIBLE terminal writes to
      // xterm; hidden ones buffer, so background output (e.g. Claude TUIs
      // redrawing) doesn't parse+render on the main thread. Flushed on show.
      unsubscribeOutput = ptyOutputRouter.onId(terminalId, (data) => {
        if (visibleRef.current) {
          terminal.write(data)
          return
        }
        pendingWritesRef.current.push(data)
        pendingBytesRef.current += data.length
        while (pendingBytesRef.current > MAX_PENDING_BYTES && pendingWritesRef.current.length > 1) {
          const removed = pendingWritesRef.current.shift()!
          pendingBytesRef.current -= removed.length
        }
      })
    })()

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
      disposed = true
      unsubscribeOutput()
      unsubscribeExit()
      resizeObserver.disconnect()
      observer.disconnect()
      container.removeEventListener('dragenter', handleDragEnter, true)
      container.removeEventListener('dragover', handleDragOver, true)
      container.removeEventListener('dragleave', handleDragLeave, true)
      container.removeEventListener('drop', handleDrop, true)
      terminal.dispose() // also disposes the WebGL addon if attached
      webglAddonRef.current = null
      pendingWritesRef.current = []
      pendingBytesRef.current = 0
    }
  }, [terminalId, handleDragEnter, handleDragOver, handleDragLeave, handleDrop])

  // Update only the live xterm theme. Keeping colors out of the initialization
  // effect prevents a color change from disposing/recreating xterm or replaying
  // its buffer.
  useEffect(() => {
    const terminal = terminalRef.current
    if (!terminal) return
    const bgColor = backgroundColor || '#1f1d1a'
    const fgColor = textColor || '#dfdbc3'
    terminal.options.theme = {
      ...terminal.options.theme,
      background: bgColor,
      foreground: fgColor,
      cursor: fgColor
    }
  }, [backgroundColor, textColor])

  // GPU (WebGL) renderer, attached ONLY to the currently-visible terminal.
  // The DOM renderer re-lays-out every row on the main thread each scroll tick;
  // WebGL batches the whole viewport into GPU draw calls so scroll is cheap and
  // stays off the main thread. We can't give all ~20 mounted terminals a WebGL
  // context (Chromium caps live contexts at ~16 -> context loss/thrash), but
  // only one terminal is visible at a time, so load WebGL on show and dispose
  // on hide — at most one context exists. Disposing reverts to the DOM renderer.
  useEffect(() => {
    const terminal = terminalRef.current
    if (!terminal) return
    const visible = isActive && workspaceIsActive
    if (visible) {
      // Attach the GPU renderer for the now-visible terminal.
      if (!webglAddonRef.current) {
        try {
          const addon = new WebglAddon()
          // If the GPU context is lost, drop back to DOM cleanly instead of
          // freezing; next show will try WebGL again.
          addon.onContextLoss(() => {
            addon.dispose()
            if (webglAddonRef.current === addon) webglAddonRef.current = null
          })
          terminal.loadAddon(addon)
          webglAddonRef.current = addon
        } catch (err) {
          console.warn('WebglAddon failed, staying on DOM renderer:', err)
        }
      }
      // Flush output that was buffered while hidden, then resume live writes.
      if (pendingWritesRef.current.length > 0) {
        const pending = pendingWritesRef.current.join('')
        pendingWritesRef.current = []
        pendingBytesRef.current = 0
        terminal.write(pending)
      }
      visibleRef.current = true
      fitAddonRef.current?.fit()
      terminal.refresh(0, terminal.rows - 1)
    } else {
      // Hidden: buffer further output (see onId handler) and drop the GPU
      // context so at most one WebGL context exists.
      visibleRef.current = false
      if (webglAddonRef.current) {
        webglAddonRef.current.dispose()
        webglAddonRef.current = null
      }
    }
  }, [isActive, workspaceIsActive])

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

  // Listen for clipboard IPC events from main process
  useEffect(() => {
    if (!isActive || !workspaceIsActive) return

    const unsubscribeCopy = window.electronAPI.clipboard.onCopy(() => {
      const terminal = terminalRef.current
      if (terminal) {
        const selection = terminal.getSelection()
        if (selection) {
          window.electronAPI.clipboard.writeText(selection)
        }
      }
    })

    const unsubscribePaste = window.electronAPI.clipboard.onPaste(() => {
      window.electronAPI.clipboard.readText().then((text) => {
        if (text) {
          handlePasteText(text)
        }
      })
    })

    return () => {
      unsubscribeCopy()
      unsubscribePaste()
    }
  }, [isActive, workspaceIsActive, handlePasteText])

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
