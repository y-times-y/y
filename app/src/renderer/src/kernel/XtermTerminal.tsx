import * as React from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'

type XtermTerminalProps = {
  id: string
  running: boolean
  initialText?: string
  fontSize?: number
}

function XtermTerminal({ id, running, initialText, fontSize = 12 }: XtermTerminalProps): React.JSX.Element {
  const hostRef = React.useRef<HTMLDivElement | null>(null)
  const termRef = React.useRef<Terminal | null>(null)
  const fitRef = React.useRef<FitAddon | null>(null)
  const lastInitialRef = React.useRef('')
  const runningRef = React.useRef(running)

  React.useEffect(() => {
    runningRef.current = running
  }, [running])

  React.useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const term = new Terminal({
      cursorBlink: true,
      convertEol: true,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      fontSize,
      lineHeight: 1.35,
      scrollback: 5000,
      theme: {
        background: '#050506',
        foreground: 'rgba(238,238,238,0.9)',
        cursor: '#ffffff',
        selectionBackground: 'rgba(255,255,255,0.22)',
        black: '#000000',
        red: '#ff7b72',
        green: '#56d364',
        yellow: '#d29922',
        blue: '#58a6ff',
        magenta: '#bc8cff',
        cyan: '#39c5cf',
        white: '#f0f0f0',
        brightBlack: '#6e7681',
        brightRed: '#ff7b72',
        brightGreen: '#56d364',
        brightYellow: '#e3b341',
        brightBlue: '#79c0ff',
        brightMagenta: '#d2a8ff',
        brightCyan: '#56d4dd',
        brightWhite: '#ffffff'
      }
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)
    termRef.current = term
    fitRef.current = fit

    const fitNow = (): void => {
      try {
        fit.fit()
        if (window.y.terminal) void window.y.terminal.resize(id, term.cols, term.rows)
      } catch {
        // Ignore fit races while the element is hidden or resizing.
      }
    }
    const resizeObserver = new ResizeObserver(fitNow)
    resizeObserver.observe(host)
    requestAnimationFrame(fitNow)

    const inputDisposable = term.onData((data) => {
      if (runningRef.current && window.y.terminal) void window.y.terminal.write(id, data)
    })
    const off = window.y.terminal?.onEvent((event) => {
      if (event.id !== id) return
      if (event.kind === 'data') {
        term.write(event.data ?? '')
        return
      }
      if (event.kind === 'exit') {
        runningRef.current = false
        term.write(`\r\n[process exited${typeof event.exitCode === 'number' ? ` with code ${event.exitCode}` : ''}]\r\n`)
        return
      }
      if (event.kind === 'error') {
        runningRef.current = false
        term.write(`\r\n[terminal error: ${event.message}]\r\n`)
      }
    })
    if (initialText) {
      lastInitialRef.current = initialText
      term.write(initialText)
    }

    return () => {
      off?.()
      inputDisposable.dispose()
      resizeObserver.disconnect()
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
  }, [id])

  React.useEffect(() => {
    const term = termRef.current
    if (!term) return
    term.options.fontSize = fontSize
    try {
      fitRef.current?.fit()
      if (window.y.terminal) void window.y.terminal.resize(id, term.cols, term.rows)
    } catch {
      // The terminal may be collapsed while this setting changes.
    }
  }, [fontSize, id])

  React.useEffect(() => {
    const term = termRef.current
    if (!term || !initialText || initialText === lastInitialRef.current) return
    lastInitialRef.current = initialText
    term.write(initialText)
  }, [initialText])

  return <div className="y-xterm" ref={hostRef} onWheel={(event) => event.stopPropagation()} />
}

export default XtermTerminal
