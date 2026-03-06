/**
 * countdown-alarm.component.js
 *
 * Drop-in React component for the Clockify extension popup.
 * Renders a countdown-alarm panel that lets users set a timer duration,
 * watch it count down, and dismiss overtime alerts.
 *
 * USAGE
 * ─────────────────────────────────────────────────────────────────────────────
 * Import and place <CountdownAlarm /> anywhere inside the popup's component
 * tree, e.g. inside the settings panel or as a new tab.
 *
 *   import CountdownAlarm from './countdown-alarm.component';
 *   // …
 *   <CountdownAlarm />
 *
 * DEPENDENCIES
 * ─────────────────────────────────────────────────────────────────────────────
 * • React (already a dependency of the extension)
 * • countdown-alarm-background.js must be registered in the manifest
 *   (see INTEGRATION.md for instructions)
 */

import React from 'react';

// ─── Helper ───────────────────────────────────────────────────────────────────

/** Format a number of seconds as  mm:ss  or  hh:mm:ss */
function formatDuration(totalSeconds) {
    const absSeconds = Math.abs(totalSeconds);
    const h = Math.floor(absSeconds / 3600);
    const m = Math.floor((absSeconds % 3600) / 60);
    const s = absSeconds % 60;

    const pad = (n) => String(n).padStart(2, '0');

    if (h > 0) return `${pad(h)}:${pad(m)}:${pad(s)}`;
    return `${pad(m)}:${pad(s)}`;
}

// ─── Component ────────────────────────────────────────────────────────────────

class CountdownAlarm extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            // User input
            inputHours   : 0,
            inputMinutes : 25,

            // Runtime state
            phase        : 'idle',   // 'idle' | 'running' | 'warning' | 'overtime' | 'dismissed'
            remainingMs  : 0,
            overtimeMs   : 0,
        };

        this._tickInterval = null;
    }

    // ── Lifecycle ──────────────────────────────────────────────────────────────

    componentDidMount() {
        // Restore state from background (e.g. if popup was closed and reopened)
        this._syncFromBackground();
        // Poll every second so the countdown display stays accurate
        this._tickInterval = setInterval(() => this._tick(), 1000);
    }

    componentWillUnmount() {
        clearInterval(this._tickInterval);
    }

    // ── Background communication ───────────────────────────────────────────────

    _sendMessage(msg) {
        return new Promise((resolve) => {
            chrome.runtime.sendMessage(msg, resolve);
        });
    }

    /** Pull persisted alarm state from the background script */
    async _syncFromBackground() {
        const state = await this._sendMessage({ type: 'COUNTDOWN_GET_STATE' });
        if (!state) {
            this.setState({ phase: 'idle' });
            return;
        }

        const now = Date.now();

        if (state.dismissed) {
            this.setState({ phase: 'dismissed' });
            return;
        }

        if (state.overtime) {
            this.setState({
                phase      : 'overtime',
                overtimeMs : now - state.overtimeStart,
            });
            return;
        }

        const remainingMs = state.endTime - now;
        if (remainingMs <= 0) {
            this.setState({ phase: 'overtime', overtimeMs: 0 });
        } else if (remainingMs <= 5 * 60 * 1000) {
            this.setState({ phase: 'warning', remainingMs });
        } else {
            this.setState({ phase: 'running', remainingMs });
        }
    }

    /** Called every second to update the display */
    _tick() {
        const { phase } = this.state;
        if (phase === 'idle' || phase === 'dismissed') return;

        this.setState((prev) => {
            if (prev.phase === 'overtime') {
                return { overtimeMs: prev.overtimeMs + 1000 };
            }

            const newRemaining = prev.remainingMs - 1000;

            if (newRemaining <= 0) {
                // Transition to overtime locally (background fires the notification)
                return { phase: 'overtime', remainingMs: 0, overtimeMs: 0 };
            }

            const nextPhase = newRemaining <= 5 * 60 * 1000 ? 'warning' : 'running';
            return { phase: nextPhase, remainingMs: newRemaining };
        });
    }

    // ── Actions ───────────────────────────────────────────────────────────────

    async handleStart() {
        const { inputHours, inputMinutes } = this.state;
        const totalMinutes = inputHours * 60 + inputMinutes;

        if (totalMinutes <= 0) {
            alert('Please set a duration greater than 0 minutes.');
            return;
        }

        await this._sendMessage({ type: 'COUNTDOWN_START', durationMinutes: totalMinutes });

        this.setState({
            phase      : totalMinutes <= 5 ? 'warning' : 'running',
            remainingMs: totalMinutes * 60 * 1000,
            overtimeMs : 0,
        });
    }

    async handleCancel() {
        await this._sendMessage({ type: 'COUNTDOWN_CANCEL' });
        this.setState({ phase: 'idle', remainingMs: 0, overtimeMs: 0 });
    }

    async handleDismiss() {
        await this._sendMessage({ type: 'COUNTDOWN_DISMISS' });
        this.setState({ phase: 'dismissed' });
    }

    handleReset() {
        this._sendMessage({ type: 'COUNTDOWN_CANCEL' });
        this.setState({
            phase        : 'idle',
            remainingMs  : 0,
            overtimeMs   : 0,
            inputHours   : 0,
            inputMinutes : 25,
        });
    }

    // ── Render helpers ────────────────────────────────────────────────────────

    renderIdleForm() {
        const { inputHours, inputMinutes } = this.state;
        return (
            <div className="countdown-alarm__form">
                <p className="countdown-alarm__label">Set countdown duration</p>
                <div className="countdown-alarm__inputs">
                    <label>
                        <span>Hours</span>
                        <input
                            type="number"
                            min="0"
                            max="23"
                            value={inputHours}
                            onChange={(e) =>
                                this.setState({ inputHours: Math.max(0, parseInt(e.target.value, 10) || 0) })
                            }
                        />
                    </label>
                    <span className="countdown-alarm__colon">:</span>
                    <label>
                        <span>Minutes</span>
                        <input
                            type="number"
                            min="0"
                            max="59"
                            value={inputMinutes}
                            onChange={(e) =>
                                this.setState({ inputMinutes: Math.max(0, parseInt(e.target.value, 10) || 0) })
                            }
                        />
                    </label>
                </div>
                <button
                    className="countdown-alarm__btn countdown-alarm__btn--start"
                    onClick={() => this.handleStart()}
                >
                    Start Countdown
                </button>
                <p className="countdown-alarm__hint">
                    You'll get a Windows notification 5 min before the end and when it expires.
                </p>
            </div>
        );
    }

    renderRunning() {
        const { remainingMs, phase } = this.state;
        const seconds = Math.max(0, Math.round(remainingMs / 1000));
        const isWarning = phase === 'warning';

        return (
            <div className={`countdown-alarm__display ${isWarning ? 'countdown-alarm__display--warning' : ''}`}>
                <p className="countdown-alarm__phase-label">
                    {isWarning ? '⚠️ Less than 5 minutes left!' : '⏳ Countdown running'}
                </p>
                <div className="countdown-alarm__timer">{formatDuration(seconds)}</div>
                <button
                    className="countdown-alarm__btn countdown-alarm__btn--cancel"
                    onClick={() => this.handleCancel()}
                >
                    Cancel
                </button>
            </div>
        );
    }

    renderOvertime() {
        const { overtimeMs } = this.state;
        const seconds = Math.round(overtimeMs / 1000);

        return (
            <div className="countdown-alarm__display countdown-alarm__display--overtime">
                <p className="countdown-alarm__phase-label">🔴 Time's up — still tracking</p>
                <div className="countdown-alarm__timer countdown-alarm__timer--overtime">
                    +{formatDuration(seconds)}
                </div>
                <p className="countdown-alarm__hint">
                    Your timer is still running. Dismiss the alarm or stop your Clockify timer.
                </p>
                <div className="countdown-alarm__actions">
                    <button
                        className="countdown-alarm__btn countdown-alarm__btn--dismiss"
                        onClick={() => this.handleDismiss()}
                    >
                        Dismiss Alarm
                    </button>
                    <button
                        className="countdown-alarm__btn countdown-alarm__btn--cancel"
                        onClick={() => this.handleCancel()}
                    >
                        Cancel &amp; Reset
                    </button>
                </div>
            </div>
        );
    }

    renderDismissed() {
        return (
            <div className="countdown-alarm__display countdown-alarm__display--done">
                <p className="countdown-alarm__phase-label">✅ Alarm dismissed</p>
                <p className="countdown-alarm__hint">
                    Your Clockify timer is still running if you haven't stopped it.
                </p>
                <button
                    className="countdown-alarm__btn countdown-alarm__btn--start"
                    onClick={() => this.handleReset()}
                >
                    New Countdown
                </button>
            </div>
        );
    }

    render() {
        const { phase } = this.state;

        return (
            <div className="countdown-alarm">
                <h3 className="countdown-alarm__title">⏱ Countdown Alarm</h3>

                {phase === 'idle'                   && this.renderIdleForm()}
                {(phase === 'running' || phase === 'warning') && this.renderRunning()}
                {phase === 'overtime'               && this.renderOvertime()}
                {phase === 'dismissed'              && this.renderDismissed()}
            </div>
        );
    }
}

export default CountdownAlarm;
