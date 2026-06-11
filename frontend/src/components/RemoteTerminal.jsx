import { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import api from '../services/api';
import { useSocket } from '../contexts/SocketContext';

/**
 * RemoteTerminal - Interactive terminal component for remote server access
 *
 * Props:
 *   serverId: string - The server ID to connect to
 *   onClose: function - Called when terminal is closed
 */
export default function RemoteTerminal({ serverId, onClose }) {
    const terminalRef = useRef(null);
    const terminalInstance = useRef(null);
    const fitAddon = useRef(null);
    const [sessionId, setSessionId] = useState(null);
    const [connected, setConnected] = useState(false);
    const [error, setError] = useState(null);
    const [shellName, setShellName] = useState('');
    const { socket, connected: socketConnected } = useSocket();

    // Initialize terminal
    useEffect(() => {
        if (!terminalRef.current) return;

        const term = new Terminal({
            cursorBlink: true,
            fontSize: 14,
            fontFamily: 'Menlo, Monaco, "Courier New", monospace',
            // Redesign palette (xterm needs literal hex — keep in sync with
            // the .terminal-content well in _logs-drawer.scss).
            theme: {
                background: '#0a0b0e',
                foreground: '#c4cdda',
                cursor: '#8b93ff',
                cursorAccent: '#0a0b0e',
                selectionBackground: 'rgba(109, 124, 255, 0.35)',
                black: '#1c2029',
                red: '#fb6f6f',
                green: '#3ddc97',
                yellow: '#f5b945',
                blue: '#6d7cff',
                magenta: '#b07bf5',
                cyan: '#49c7f0',
                white: '#c4cdda',
                brightBlack: '#646b7a',
                brightRed: '#ff9292',
                brightGreen: '#6ae8b2',
                brightYellow: '#ffd075',
                brightBlue: '#8b93ff',
                brightMagenta: '#c79bf8',
                brightCyan: '#74d9f5',
                brightWhite: '#e9ebf0'
            },
            allowProposedApi: true
        });

        const fit = new FitAddon();
        const webLinks = new WebLinksAddon();

        term.loadAddon(fit);
        term.loadAddon(webLinks);
        term.open(terminalRef.current);

        // Fit terminal to container
        setTimeout(() => fit.fit(), 0);

        terminalInstance.current = term;
        fitAddon.current = fit;

        // Handle window resize
        const handleResize = () => {
            if (fitAddon.current) {
                fitAddon.current.fit();
            }
        };
        window.addEventListener('resize', handleResize);

        // Write welcome message
        term.writeln('\x1b[1;36mServerKit Remote Terminal\x1b[0m');
        term.writeln('Connecting to server...');
        term.writeln('');

        return () => {
            window.removeEventListener('resize', handleResize);
            term.dispose();
        };
    }, []);

    // Create terminal session
    useEffect(() => {
        if (!terminalInstance.current || !serverId) return;

        const createSession = async () => {
            try {
                const term = terminalInstance.current;
                const cols = term.cols;
                const rows = term.rows;

                const result = await api.createTerminalSession(serverId, cols, rows);

                if (!result.success) {
                    throw new Error(result.error || 'Failed to create terminal session');
                }

                setSessionId(result.session_id);
                setShellName(result.shell || 'shell');
                setConnected(true);

                term.writeln(`\x1b[1;32mConnected to ${result.shell}\x1b[0m`);
                term.writeln('');

            } catch (err) {
                console.error('Failed to create terminal session:', err);
                setError(err.message);
                if (terminalInstance.current) {
                    terminalInstance.current.writeln(`\x1b[1;31mError: ${err.message}\x1b[0m`);
                }
            }
        };

        createSession();
    }, [serverId]);

    // Handle terminal input
    useEffect(() => {
        if (!terminalInstance.current || !sessionId || !connected) return;

        const term = terminalInstance.current;

        // Handle user input
        const inputDisposable = term.onData(async (data) => {
            try {
                // Encode data as base64
                const encoded = btoa(data);
                await api.sendTerminalInput(sessionId, encoded);
            } catch (err) {
                console.error('Failed to send terminal input:', err);
            }
        });

        // Handle resize
        const resizeDisposable = term.onResize(async ({ cols, rows }) => {
            try {
                await api.resizeTerminal(sessionId, cols, rows);
            } catch (err) {
                console.error('Failed to resize terminal:', err);
            }
        });

        return () => {
            inputDisposable.dispose();
            resizeDisposable.dispose();
        };
    }, [sessionId, connected]);

    // Listen for terminal output via WebSocket
    useEffect(() => {
        if (!socket || !sessionId || !socketConnected) return;

        const channel = `terminal:${sessionId}`;

        const handleTerminalData = (data) => {
            if (!terminalInstance.current) return;

            if (data.type === 'output' && data.data) {
                // Decode base64 output
                try {
                    const decoded = atob(data.data);
                    terminalInstance.current.write(decoded);
                } catch (err) {
                    console.error('Failed to decode terminal output:', err);
                }
            } else if (data.type === 'closed') {
                terminalInstance.current.writeln('');
                terminalInstance.current.writeln('\x1b[1;33mSession closed\x1b[0m');
                setConnected(false);
            }
        };

        socket.on(channel, handleTerminalData);

        return () => {
            socket.off(channel, handleTerminalData);
        };
    }, [socket, sessionId, socketConnected]);

    // Cleanup session on unmount
    useEffect(() => {
        return () => {
            if (sessionId) {
                api.closeTerminalSession(sessionId).catch(console.error);
            }
        };
    }, [sessionId]);

    // Handle close button
    const handleClose = useCallback(async () => {
        if (sessionId) {
            try {
                await api.closeTerminalSession(sessionId);
            } catch (err) {
                console.error('Error closing session:', err);
            }
        }
        onClose?.();
    }, [sessionId, onClose]);

    // Focus terminal on click
    const handleClick = () => {
        terminalInstance.current?.focus();
    };

    return (
        <div className="remote-terminal-container">
            <div className="terminal-header">
                <span className="terminal-ico">
                    <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" fill="none" strokeWidth="2">
                        <polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>
                    </svg>
                </span>
                <div className="terminal-titles">
                    <div className="terminal-title">
                        <span className={`terminal-status ${connected ? 'connected' : 'disconnected'}`} />
                        <span>{shellName || 'Terminal'}</span>
                    </div>
                    {sessionId && <span className="session-id">{sessionId}</span>}
                </div>
                <div className="terminal-actions">
                    <button
                        className="terminal-close-btn"
                        onClick={handleClose}
                        title="Close terminal"
                    >
                        <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" fill="none" strokeWidth="2">
                            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                    </button>
                </div>
            </div>
            <div
                ref={terminalRef}
                className="terminal-content"
                onClick={handleClick}
            />
            {error && (
                <div className="terminal-alert">
                    {error}
                </div>
            )}
        </div>
    );
}
