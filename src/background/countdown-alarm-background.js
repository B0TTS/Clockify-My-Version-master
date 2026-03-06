/**
 * countdown-alarm-background.js
 *
 * Handles countdown alarm logic in the extension's background/service worker.
 * Fires a "5 minutes remaining" warning, a "time's up" alert, and then
 * continues tracking overtime if the user doesn't dismiss the final alarm.
 *
 * HOW IT WORKS
 * ─────────────────────────────────────────────────────────────────────────────
 * 1.  The popup calls startCountdownAlarm(durationMinutes) via chrome.runtime.sendMessage.
 * 2.  Two chrome.alarms are registered:
 *       • "clockify-countdown-warning"  – fires 5 min before the end
 *       • "clockify-countdown-end"      – fires at the exact end
 * 3.  When "clockify-countdown-end" fires the script enters "overtime" mode and
 *     starts a repeating 1-minute alarm ("clockify-countdown-overtime") until the
 *     user dismisses the notification.
 * 4.  All notifications are native OS notifications via chrome.notifications, so
 *     they appear in the Windows Action Centre automatically.
 */

// ─── Constants ───────────────────────────────────────────────────────────────
const ALARM_WARNING  = 'clockify-countdown-warning';
const ALARM_END      = 'clockify-countdown-end';
const ALARM_OVERTIME = 'clockify-countdown-overtime';
const NOTIF_WARNING  = 'clockify-notif-warning';
const NOTIF_END      = 'clockify-notif-end';
const NOTIF_OVERTIME = 'clockify-notif-overtime';
const STORAGE_KEY    = 'clockifyCountdownAlarm';

// ─── Message listener (called from the popup UI) ─────────────────────────────
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    switch (request.type) {
        case 'COUNTDOWN_START':
            startCountdownAlarm(request.durationMinutes);
            sendResponse({ status: 'started' });
            break;

        case 'COUNTDOWN_CANCEL':
            cancelCountdownAlarm();
            sendResponse({ status: 'cancelled' });
            break;

        case 'COUNTDOWN_DISMISS':
            dismissOvertimeAlarm();
            sendResponse({ status: 'dismissed' });
            break;

        case 'COUNTDOWN_GET_STATE':
            chrome.storage.local.get(STORAGE_KEY, (data) => {
                sendResponse(data[STORAGE_KEY] || null);
            });
            return true; // keep channel open for async response
    }
});

// ─── Alarm listener ───────────────────────────────────────────────────────────
chrome.alarms.onAlarm.addListener((alarm) => {
    switch (alarm.name) {
        case ALARM_WARNING:
            handleWarningAlarm();
            break;
        case ALARM_END:
            handleEndAlarm();
            break;
        case ALARM_OVERTIME:
            handleOvertimeAlarm();
            break;
    }
});

// ─── Notification button click listener ──────────────────────────────────────
chrome.notifications.onButtonClicked.addListener((notifId, buttonIndex) => {
    if (notifId === NOTIF_END || notifId === NOTIF_OVERTIME) {
        if (buttonIndex === 0) {
            // "Dismiss" button
            dismissOvertimeAlarm();
        }
    }
});

// ─── Core functions ───────────────────────────────────────────────────────────

/**
 * Start a new countdown alarm.
 * @param {number} durationMinutes  Total countdown duration in minutes.
 */
function startCountdownAlarm(durationMinutes) {
    // Cancel any previous alarm first
    cancelCountdownAlarm();

    const now       = Date.now();
    const endTime   = now + durationMinutes * 60 * 1000;
    const warnTime  = endTime - 5 * 60 * 1000;          // 5 min before end

    // Persist state so the popup can read it
    const state = {
        durationMinutes,
        startedAt : now,
        endTime,
        overtime  : false,
        overtimeStart: null,
    };
    chrome.storage.local.set({ [STORAGE_KEY]: state });

    // Schedule the warning alarm only if there is enough time
    if (warnTime > now) {
        chrome.alarms.create(ALARM_WARNING, { when: warnTime });
    }

    // Schedule the end alarm
    chrome.alarms.create(ALARM_END, { when: endTime });
}

/** Cancel all countdown alarms and clean up state. */
function cancelCountdownAlarm() {
    chrome.alarms.clear(ALARM_WARNING);
    chrome.alarms.clear(ALARM_END);
    chrome.alarms.clear(ALARM_OVERTIME);
    chrome.notifications.clear(NOTIF_WARNING);
    chrome.notifications.clear(NOTIF_END);
    chrome.notifications.clear(NOTIF_OVERTIME);
    chrome.storage.local.remove(STORAGE_KEY);
}

/** Called when the "5 minutes remaining" alarm fires. */
function handleWarningAlarm() {
    showNotification(
        NOTIF_WARNING,
        '⏰ 5 Minutes Remaining',
        'Your Clockify countdown timer is almost up — 5 minutes left!',
        []   // no action buttons needed for the warning
    );
}

/** Called when the main countdown reaches zero. */
function handleEndAlarm() {
    // Update persisted state to "overtime"
    chrome.storage.local.get(STORAGE_KEY, (data) => {
        const state = data[STORAGE_KEY];
        if (!state) return;
        state.overtime      = true;
        state.overtimeStart = Date.now();
        chrome.storage.local.set({ [STORAGE_KEY]: state });
    });

    showNotification(
        NOTIF_END,
        '⏱️ Time\'s Up!',
        'Your Clockify countdown has ended. Time is still being tracked.',
        [{ title: 'Dismiss' }]
    );

    // Start repeating overtime reminders every minute
    chrome.alarms.create(ALARM_OVERTIME, { periodInMinutes: 1 });
}

/** Called every minute while the user hasn't dismissed the end alarm. */
function handleOvertimeAlarm() {
    chrome.storage.local.get(STORAGE_KEY, (data) => {
        const state = data[STORAGE_KEY];
        if (!state || !state.overtime) return;

        const overtimeMinutes = Math.floor(
            (Date.now() - state.overtimeStart) / 60000
        );

        showNotification(
            NOTIF_OVERTIME,
            '🔴 Still Tracking — Overtime',
            `You are ${overtimeMinutes} minute(s) over your planned time. Tap Dismiss to stop the alarm.`,
            [{ title: 'Dismiss' }]
        );
    });
}

/** User clicked "Dismiss" on the end/overtime notification. */
function dismissOvertimeAlarm() {
    chrome.alarms.clear(ALARM_OVERTIME);
    chrome.notifications.clear(NOTIF_END);
    chrome.notifications.clear(NOTIF_OVERTIME);

    // Mark overtime as dismissed but keep startedAt/endTime for the popup display
    chrome.storage.local.get(STORAGE_KEY, (data) => {
        const state = data[STORAGE_KEY];
        if (!state) return;
        state.dismissed = true;
        chrome.storage.local.set({ [STORAGE_KEY]: state });
    });
}

/**
 * Helper: show (or replace) a Chrome notification.
 * These appear in the Windows Action Centre automatically.
 *
 * @param {string}   id       Notification ID (replacing previous with the same ID)
 * @param {string}   title    Bold heading text
 * @param {string}   message  Body text
 * @param {Array}    buttons  Array of {title} objects (max 2 on Chrome)
 */
function showNotification(id, title, message, buttons) {
    const options = {
        type    : 'basic',
        iconUrl : chrome.runtime.getURL('assets/images/logo.png'),
        title,
        message,
        priority: 2,          // high priority → shows even when Do-Not-Disturb is partially active
        requireInteraction: buttons.length > 0,  // keep visible until user interacts
    };

    if (buttons.length > 0) {
        options.buttons = buttons;
    }

    // Clear first to force a re-show even if a notification with this ID already exists
    chrome.notifications.clear(id, () => {
        chrome.notifications.create(id, options);
    });
}
