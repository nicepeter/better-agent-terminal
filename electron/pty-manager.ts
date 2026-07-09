import { BrowserWindow } from 'electron'
import { spawn, ChildProcess } from 'child_process'
import type { CreatePtyOptions } from '../src/types'

// Try to import node-pty, fall back to child_process if not available
let pty: typeof import('node-pty') | null = null
let ptyAvailable = false
try {
  pty = require('node-pty')
  // Test if native module works by checking if spawn function exists and module is properly built
  if (pty && typeof pty.spawn === 'function') {
    ptyAvailable = true
  }
} catch (e) {
  console.warn('node-pty not available, falling back to child_process:', e)
}

interface PtyInstance {
  process: any // IPty or ChildProcess
  type: 'terminal' | 'claude-code'
  cwd: string
  usePty: boolean
  // Rolling copy of recent raw output, kept here in the main process so it
  // survives renderer reloads (HMR / full reload) and terminal re-mounts.
  // Replayed into xterm when a panel (re)mounts. See getBuffer().
  outputChunks: string[]
  outputBytes: number
}

// Cap of retained output per terminal. Comfortably covers ~1000 lines of
// scrollback worth of replay while keeping main-process memory bounded.
const MAX_BUFFER_BYTES = 256 * 1024

export class PtyManager {
  private instances: Map<string, PtyInstance> = new Map()
  private window: BrowserWindow

  constructor(window: BrowserWindow) {
    this.window = window
  }

  private getDefaultShell(): string {
    if (process.platform === 'win32') {
      // Prefer PowerShell 7 (pwsh) over Windows PowerShell
      const fs = require('fs')
      const pwshPaths = [
        'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
        'C:\\Program Files (x86)\\PowerShell\\7\\pwsh.exe',
        process.env.LOCALAPPDATA + '\\Microsoft\\WindowsApps\\pwsh.exe'
      ]
      for (const p of pwshPaths) {
        if (fs.existsSync(p)) {
          return p
        }
      }
      return 'powershell.exe'
    } else if (process.platform === 'darwin') {
      return process.env.SHELL || '/bin/zsh'
    } else {
      // Linux - detect available shell
      const fs = require('fs')
      if (process.env.SHELL) {
        return process.env.SHELL
      } else if (fs.existsSync('/bin/bash')) {
        return '/bin/bash'
      } else {
        return '/bin/sh'
      }
    }
  }

  create(options: CreatePtyOptions): boolean {
    const { id, cwd, type, shell: shellOverride, workspacePath } = options

    // Prevent duplicate creation - if instance already exists, skip
    if (this.instances.has(id)) {
      console.log(`PTY ${id} already exists, skipping create`)
      return true
    }

    const shell = shellOverride || this.getDefaultShell()
    let args: string[] = []

    // For PowerShell (pwsh or powershell), bypass execution policy to allow unsigned scripts
    if (shell.includes('powershell') || shell.includes('pwsh')) {
      args = ['-ExecutionPolicy', 'Bypass', '-NoLogo']
    } else if (shell.endsWith('/zsh') || shell.endsWith('/bash') || shell.endsWith('/sh')) {
      // Use login shell to ensure ~/.zshrc or ~/.bashrc is loaded
      args = ['-l']
    }

    // Build history environment variables for per-workspace history
    let historyEnv: Record<string, string> = {}
    if (workspacePath) {
      const path = require('path')
      const historyFile = path.join(workspacePath, '.terminal_history')
      historyEnv = {
        HISTFILE: historyFile,
        HISTSIZE: '10000',
        SAVEHIST: '10000',      // zsh
        HISTFILESIZE: '10000',  // bash
      }
    }

    // Try node-pty first, fallback to child_process if it fails
    let usedPty = false

    if (ptyAvailable && pty) {
      try {
        // Set UTF-8 environment variables
        const envWithUtf8 = {
          ...process.env,
          LANG: 'en_US.UTF-8',
          LC_ALL: 'en_US.UTF-8',
          PYTHONIOENCODING: 'utf-8',
          PYTHONUTF8: '1',
          ...historyEnv
        }

        const ptyProcess = pty.spawn(shell, args, {
          name: 'xterm-256color',
          cols: 120,
          rows: 30,
          cwd,
          env: envWithUtf8 as { [key: string]: string }
        })

        ptyProcess.onData((data: string) => {
          this.appendOutput(id, data)
          if (!this.window.isDestroyed()) {
            this.window.webContents.send('pty:output', id, data)
          }
        })

        ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
          console.log(`PTY ${id} exited with code: ${exitCode}`)
          if (!this.window.isDestroyed()) {
            this.window.webContents.send('pty:exit', id, exitCode)
          }
          this.instances.delete(id)
        })

        this.instances.set(id, { process: ptyProcess, type, cwd, usePty: true, outputChunks: [], outputBytes: 0 })
        usedPty = true
        console.log('Created terminal using node-pty')
      } catch (e) {
        console.warn('node-pty spawn failed, falling back to child_process:', e)
        ptyAvailable = false // Don't try again
      }
    }

    if (!usedPty) {
      try {
        // Fallback to child_process with proper stdio
        // For PowerShell, add -NoExit and UTF-8 command
        let shellArgs = [...args]
        if (shell.includes('powershell') || shell.includes('pwsh')) {
          shellArgs.push(
            '-NoExit',
            '-Command',
            '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; [Console]::InputEncoding = [System.Text.Encoding]::UTF8; $OutputEncoding = [System.Text.Encoding]::UTF8'
          )
        }

        // Set UTF-8 environment variables
        const envWithUtf8 = {
          ...process.env,
          LANG: 'en_US.UTF-8',
          LC_ALL: 'en_US.UTF-8',
          PYTHONIOENCODING: 'utf-8',
          PYTHONUTF8: '1',
          ...historyEnv
        }

        const childProcess = spawn(shell, shellArgs, {
          cwd,
          env: envWithUtf8 as NodeJS.ProcessEnv,
          stdio: ['pipe', 'pipe', 'pipe'],
          shell: false
        })

        childProcess.stdout?.on('data', (data: Buffer) => {
          const text = data.toString()
          this.appendOutput(id, text)
          if (!this.window.isDestroyed()) {
            this.window.webContents.send('pty:output', id, text)
          }
        })

        childProcess.stderr?.on('data', (data: Buffer) => {
          const text = data.toString()
          this.appendOutput(id, text)
          if (!this.window.isDestroyed()) {
            this.window.webContents.send('pty:output', id, text)
          }
        })

        childProcess.on('exit', (exitCode: number | null) => {
          console.log(`PTY ${id} exited with code: ${exitCode ?? 0}`)
          if (!this.window.isDestroyed()) {
            this.window.webContents.send('pty:exit', id, exitCode ?? 0)
          }
          this.instances.delete(id)
        })

        childProcess.on('error', (error) => {
          console.error('Child process error:', error)
          if (!this.window.isDestroyed()) {
            this.window.webContents.send('pty:output', id, `\r\n[Error: ${error.message}]\r\n`)
          }
        })

        // Send initial message
        if (!this.window.isDestroyed()) {
          this.window.webContents.send('pty:output', id, `[Terminal - child_process mode]\r\n`)
        }

        this.instances.set(id, { process: childProcess, type, cwd, usePty: false, outputChunks: [], outputBytes: 0 })
        console.log('Created terminal using child_process fallback')
      } catch (error) {
        console.error('Failed to create terminal:', error)
        return false
      }
    }

    return true
  }

  write(id: string, data: string): void {
    const instance = this.instances.get(id)
    if (instance) {
      if (instance.usePty) {
        instance.process.write(data)
      } else {
        // For child_process, write to stdin only (shell handles echo)
        const cp = instance.process as ChildProcess
        cp.stdin?.write(data)
      }
    }
  }

  resize(id: string, cols: number, rows: number): void {
    const instance = this.instances.get(id)
    if (instance && instance.usePty) {
      instance.process.resize(cols, rows)
    }
  }

  kill(id: string): boolean {
    const instance = this.instances.get(id)
    if (instance) {
      if (instance.usePty) {
        instance.process.kill()
      } else {
        (instance.process as ChildProcess).kill()
      }
      this.instances.delete(id)
      return true
    }
    return false
  }

  restart(id: string, cwd: string, shell?: string, workspacePath?: string): boolean {
    const instance = this.instances.get(id)
    if (instance) {
      const type = instance.type
      this.kill(id)
      return this.create({ id, cwd, type, shell, workspacePath })
    }
    return false
  }

  private appendOutput(id: string, data: string): void {
    const instance = this.instances.get(id)
    if (!instance) return
    instance.outputChunks.push(data)
    instance.outputBytes += data.length
    // Drop whole chunks from the front until back under the cap. Keeping at
    // least one chunk avoids an empty buffer when a single chunk exceeds the cap.
    while (instance.outputBytes > MAX_BUFFER_BYTES && instance.outputChunks.length > 1) {
      const removed = instance.outputChunks.shift()!
      instance.outputBytes -= removed.length
    }
  }

  // Recent raw output for replay when a renderer (re)mounts a terminal.
  getBuffer(id: string): string {
    const instance = this.instances.get(id)
    return instance ? instance.outputChunks.join('') : ''
  }

  getCwd(id: string): string | null {
    const instance = this.instances.get(id)
    if (instance) {
      return instance.cwd
    }
    return null
  }

  dispose(): void {
    for (const [id] of this.instances) {
      this.kill(id)
    }
  }
}
