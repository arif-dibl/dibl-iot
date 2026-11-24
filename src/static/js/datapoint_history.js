// ── Constants & Dhaka Timezone (UTC+6, permanent, no DST) ──
const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;
const MAX_HISTORY_DAYS = 180;
const MAX_HISTORY_MS = MAX_HISTORY_DAYS * 24 * 60 * 60 * 1000;
const TABLE_PAGE_SIZE = 100;
const CHART_MAX_POINTS = 500;
const FETCH_CHUNK_MS = 30 * 24 * 60 * 60 * 1000; // 30-day chunk size for reliable OpenRemote queries
const MIN_ADAPTIVE_CHUNK_MS = 3 * 24 * 60 * 60 * 1000; // Minimum split window on dense query-limit errors

const PRESET_DURATIONS_MS = {
    '12h': 12 * 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000,
    '3m': 90 * 24 * 60 * 60 * 1000,
    '6m': 180 * 24 * 60 * 60 * 1000
};

const PRESET_LABELS = {
    '12h': '12 Hours',
    '24h': '24 Hours',
    '7d': '7 Days',
    '30d': '30 Days',
    '3m': '3 Months',
    '6m': '6 Months',
    'custom': 'Custom'
};

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const SERIES_COLORS = [
    '#00af50', '#2563eb', '#f59e0b', '#ef4444', '#8b5cf6',
    '#06b6d4', '#ec4899', '#14b8a6', '#f97316', '#6366f1',
    '#84cc16', '#0ea5e9', '#d946ef', '#eab308', '#10b981'
];

// ── State ──
let currentAssetId = null;
let currentAssetName = '';
let currentAttribute = null;
let currentSubAttribute = '';
let currentAttrKeys = [];
let currentAssetCustomNames = {};
let realm = 'master';

let activePreset = '24h';
let customRange = null; // { startMs, endMs } when activePreset === 'custom'
let currentViewMode = 'table'; // 'table' | 'graph'
let currentData = null; // Array<{x: number, y: any}> | string | null
let tableDisplayLimit = TABLE_PAGE_SIZE;
let chartInstance = null;
let toastTimer = null;
let activeFetchSeq = 0;

// Custom Date-Time Picker Modal Draft State (all stored in Dhaka wall-clock components)
let pickerDraft = {
    startDate: null, // { y, m, d } (m is 0-based)
    endDate: null,   // { y, m, d }
    hoverDate: null,
    pickingPhase: 'start', // 'start' | 'end'
    viewYear: 2026,
    viewMonth: 0,
    startTime: { hour12: 12, minute: 0, ampm: 'AM' },
    endTime: { hour12: 11, minute: 59, ampm: 'PM' }
};

// ── Dhaka Time Helpers ──
function toDhakaParts(tsMs) {
    const d = new Date(tsMs + DHAKA_OFFSET_MS);
    return {
        y: d.getUTCFullYear(),
        m: d.getUTCMonth(),
        d: d.getUTCDate(),
        h: d.getUTCHours(),
        min: d.getUTCMinutes(),
        s: d.getUTCSeconds()
    };
}

function dhakaPartsToMs(y, m, d, h24 = 0, min = 0, sec = 0) {
    return Date.UTC(y, m, d, h24, min, sec, 0) - DHAKA_OFFSET_MS;
}

function compareYmd(a, b) {
    if (!a || !b) return 0;
    if (a.y !== b.y) return a.y - b.y;
    if (a.m !== b.m) return a.m - b.m;
    return a.d - b.d;
}

function sameYmd(a, b) {
    return Boolean(a && b && a.y === b.y && a.m === b.m && a.d === b.d);
}

function to12Hour(h24) {
    const ampm = h24 >= 12 ? 'PM' : 'AM';
    let h12 = h24 % 12;
    if (h12 === 0) h12 = 12;
    return { hour12: h12, ampm };
}

function to24Hour(hour12, ampm) {
    const h = parseInt(hour12, 10) || 12;
    if (ampm === 'AM') return h === 12 ? 0 : h;
    return h === 12 ? 12 : h + 12;
}

function formatDhakaDate(tsMs) {
    const p = toDhakaParts(tsMs);
    return `${String(p.d).padStart(2, '0')} ${MONTHS_SHORT[p.m]} ${p.y}`;
}

function formatDhakaTime(tsMs, withSeconds = false) {
    const p = toDhakaParts(tsMs);
    const { hour12, ampm } = to12Hour(p.h);
    const base = `${String(hour12).padStart(2, '0')}:${String(p.min).padStart(2, '0')}`;
    return withSeconds ? `${base}:${String(p.s).padStart(2, '0')} ${ampm}` : `${base} ${ampm}`;
}

function formatDhakaDateTime(tsMs, withSeconds = false) {
    return `${formatDhakaDate(tsMs)}, ${formatDhakaTime(tsMs, withSeconds)}`;
}

function formatDhakaAxisTick(tsMs, spanMs) {
    const p = toDhakaParts(tsMs);
    if (spanMs <= 36 * 3600 * 1000) {
        return formatDhakaTime(tsMs, false);
    }
    if (spanMs <= 14 * 24 * 3600 * 1000) {
        return `${String(p.d).padStart(2, '0')} ${MONTHS_SHORT[p.m]}, ${formatDhakaTime(tsMs, false)}`;
    }
    return `${String(p.d).padStart(2, '0')} ${MONTHS_SHORT[p.m]}`;
}

function formatDurationHuman(ms) {
    if (!ms || ms <= 0) return '0 min';
    const totalMins = Math.round(ms / 60000);
    const days = Math.floor(totalMins / (60 * 24));
    const hours = Math.floor((totalMins % (60 * 24)) / 60);
    const mins = totalMins % 60;
    const parts = [];
    if (days > 0) parts.push(`${days} ${days === 1 ? 'day' : 'days'}`);
    if (hours > 0) parts.push(`${hours} ${hours === 1 ? 'hr' : 'hrs'}`);
    if (mins > 0 && days === 0) parts.push(`${mins} min`);
    return parts.join(' ') || '< 1 min';
}

// ── Value & State Normalization Helpers ──
/**
 * Parse relay / valve state values:
 * supports true/false, on/off, high/low (case-insensitive).
 * Explicitly does NOT treat numeric 1 / 0 as boolean state values.
 */
function parseStateBool(val) {
    if (typeof val === 'boolean') return val;
    if (typeof val === 'string') {
        const s = val.trim().toLowerCase();
        if (s === 'true' || s === 'on' || s === 'high') return true;
        if (s === 'false' || s === 'off' || s === 'low') return false;
    }
    return null;
}

function isStateValue(val) {
    return parseStateBool(val) !== null;
}

function isHistoryPlaceholder(val) {
    if (val === null || val === undefined || val === '') return true;
    if (typeof val === 'boolean') return false;
    if (typeof val === 'number') return isNaN(val);
    if (typeof isUnrecognizedOrPlaceholder === 'function') {
        return isUnrecognizedOrPlaceholder(val);
    }
    const upper = String(val).trim().toUpperCase();
    return ['', '--', '-', 'N/A', 'NA', 'NONE', 'NULL', 'UNDEFINED', 'NAN'].includes(upper);
}

function tryParseJsonObject(val) {
    if (val && typeof val === 'object' && !Array.isArray(val)) return val;
    if (typeof val !== 'string') return null;
    const s = val.trim();
    if (!s.startsWith('{') && !s.startsWith('"')) return null;
    try {
        let parsed = JSON.parse(s);
        if (typeof parsed === 'string' && parsed.trim().startsWith('{')) {
            parsed = JSON.parse(parsed);
        }
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed;
        }
    } catch (e) {
        return null;
    }
    return null;
}

function naturalSortKeys(keys) {
    return [...keys].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
}

function resolveHistoryLabel(key, isAttribute = false) {
    if (!key) return '';
    if (currentAssetCustomNames && currentAssetCustomNames[key]) {
        return currentAssetCustomNames[key];
    }
    if (currentAssetId) {
        const isSwitchOrValve = /^(r\d+|switch|valvestate)/i.test(key);
        const localKey = isSwitchOrValve
            ? `switch_name_${currentAssetId}_${key}`
            : `sensor_name_${currentAssetId}_${key}`;
        const localName = localStorage.getItem(localKey);
        if (localName) return localName;
    }
    return typeof getFriendlyLabel === 'function' ? getFriendlyLabel(key, isAttribute) : key;
}

function safeEscape(text) {
    if (typeof escapeHtml === 'function') return escapeHtml(text);
    return String(text ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function showHistoryToast(msg) {
    const el = document.getElementById('historyToast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

// ── Initialization ──
document.addEventListener('DOMContentLoaded', async () => {
    realm = window.USER_REALM || 'master';

    if (typeof fetchFriendlyNames === 'function') {
        await fetchFriendlyNames();
    }

    initCustomPickerTimeOptions();
    selectTimePreset('24h', false);

    await loadAssets();

    const subSelect = document.getElementById('subAttributeSelect');
    subSelect.onchange = () => {
        currentSubAttribute = subSelect.value;
    };

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeCustomRangeModal();
        }
    });
});

// ── Time Preset & Range Logic ──
function getTimeRange() {
    const now = Date.now();
    if (activePreset === 'custom' && customRange) {
        let start = customRange.startMs;
        let end = customRange.endMs;
        if (start > end) [start, end] = [end, start];
        return { start, end };
    }
    const duration = PRESET_DURATIONS_MS[activePreset] || PRESET_DURATIONS_MS['24h'];
    return {
        start: now - duration,
        end: now
    };
}

function updateActiveRangeDisplay() {
    const { start, end } = getTimeRange();
    const labelEl = document.getElementById('activeRangeText');
    if (!labelEl) return;
    const tag = activePreset === 'custom'
        ? `Custom (${formatDurationHuman(end - start)})`
        : PRESET_LABELS[activePreset] || '24 Hours';
    labelEl.textContent = `${formatDhakaDateTime(start)}  →  ${formatDhakaDateTime(end)}  •  ${tag}`;
}

function selectTimePreset(presetKey, autoFetch = true) {
    if (!PRESET_DURATIONS_MS[presetKey]) return;
    activePreset = presetKey;
    document.querySelectorAll('.preset-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.preset === presetKey);
    });
    updateActiveRangeDisplay();
    if (autoFetch && currentAssetId && currentAttribute && Array.isArray(currentData) && currentData.length > 0) {
        fetchDatapoints();
    }
}

// ── Custom Date & Time Range Picker Modal ──
function initCustomPickerTimeOptions() {
    const hourIds = ['startHourSelect', 'endHourSelect'];
    const minIds = ['startMinSelect', 'endMinSelect'];

    hourIds.forEach(id => {
        const sel = document.getElementById(id);
        if (!sel) return;
        sel.innerHTML = '';
        for (let h = 1; h <= 12; h++) {
            const opt = document.createElement('option');
            opt.value = String(h);
            opt.textContent = String(h).padStart(2, '0');
            sel.appendChild(opt);
        }
    });

    minIds.forEach(id => {
        const sel = document.getElementById(id);
        if (!sel) return;
        sel.innerHTML = '';
        for (let m = 0; m < 60; m++) {
            const opt = document.createElement('option');
            opt.value = String(m);
            opt.textContent = String(m).padStart(2, '0');
            sel.appendChild(opt);
        }
    });
}

function getDhakaMinMaxYmd() {
    const now = Date.now();
    const maxP = toDhakaParts(now);
    const minP = toDhakaParts(now - MAX_HISTORY_MS);
    return {
        minYmd: { y: minP.y, m: minP.m, d: minP.d },
        maxYmd: { y: maxP.y, m: maxP.m, d: maxP.d }
    };
}

function openCustomRangeModal() {
    const { start, end } = getTimeRange();
    const sP = toDhakaParts(start);
    const eP = toDhakaParts(end);
    const s12 = to12Hour(sP.h);
    const e12 = to12Hour(eP.h);

    pickerDraft.startDate = { y: sP.y, m: sP.m, d: sP.d };
    pickerDraft.endDate = { y: eP.y, m: eP.m, d: eP.d };
    pickerDraft.hoverDate = null;
    pickerDraft.pickingPhase = 'start';
    pickerDraft.viewYear = eP.y;
    pickerDraft.viewMonth = eP.m;
    pickerDraft.startTime = { hour12: s12.hour12, minute: sP.min, ampm: s12.ampm };
    pickerDraft.endTime = { hour12: e12.hour12, minute: eP.min, ampm: e12.ampm };

    syncTimeControlsFromDraft();
    renderPickerCalendar();
    updatePickerPreviews();

    document.getElementById('customRangeBackdrop').style.display = 'block';
    document.getElementById('customRangeModal').style.display = 'block';
}

function closeCustomRangeModal() {
    const backdrop = document.getElementById('customRangeBackdrop');
    const modal = document.getElementById('customRangeModal');
    if (backdrop) backdrop.style.display = 'none';
    if (modal) modal.style.display = 'none';
}

function setPickerPickingPhase(phase) {
    pickerDraft.pickingPhase = phase;
    updatePickerPreviews();
}

function syncTimeControlsFromDraft() {
    document.getElementById('startHourSelect').value = String(pickerDraft.startTime.hour12);
    document.getElementById('startMinSelect').value = String(pickerDraft.startTime.minute);
    document.getElementById('startAmBtn').classList.toggle('active', pickerDraft.startTime.ampm === 'AM');
    document.getElementById('startPmBtn').classList.toggle('active', pickerDraft.startTime.ampm === 'PM');

    document.getElementById('endHourSelect').value = String(pickerDraft.endTime.hour12);
    document.getElementById('endMinSelect').value = String(pickerDraft.endTime.minute);
    document.getElementById('endAmBtn').classList.toggle('active', pickerDraft.endTime.ampm === 'AM');
    document.getElementById('endPmBtn').classList.toggle('active', pickerDraft.endTime.ampm === 'PM');
}

function onCustomTimeChange() {
    pickerDraft.startTime.hour12 = parseInt(document.getElementById('startHourSelect').value, 10);
    pickerDraft.startTime.minute = parseInt(document.getElementById('startMinSelect').value, 10);
    pickerDraft.endTime.hour12 = parseInt(document.getElementById('endHourSelect').value, 10);
    pickerDraft.endTime.minute = parseInt(document.getElementById('endMinSelect').value, 10);
    updatePickerPreviews();
}

function setAmPm(which, ampm) {
    if (which === 'start') {
        pickerDraft.startTime.ampm = ampm;
    } else {
        pickerDraft.endTime.ampm = ampm;
    }
    syncTimeControlsFromDraft();
    updatePickerPreviews();
}

function setQuickTime(which, h24, min) {
    const t12 = to12Hour(h24);
    if (which === 'start') {
        pickerDraft.startTime = { hour12: t12.hour12, minute: min, ampm: t12.ampm };
    } else {
        pickerDraft.endTime = { hour12: t12.hour12, minute: min, ampm: t12.ampm };
    }
    syncTimeControlsFromDraft();
    updatePickerPreviews();
}

function setQuickEndNow() {
    const nowP = toDhakaParts(Date.now());
    const t12 = to12Hour(nowP.h);
    pickerDraft.endDate = { y: nowP.y, m: nowP.m, d: nowP.d };
    pickerDraft.endTime = { hour12: t12.hour12, minute: nowP.min, ampm: t12.ampm };
    if (compareYmd(pickerDraft.startDate, pickerDraft.endDate) > 0) {
        pickerDraft.startDate = { ...pickerDraft.endDate };
    }
    pickerDraft.viewYear = nowP.y;
    pickerDraft.viewMonth = nowP.m;
    syncTimeControlsFromDraft();
    renderPickerCalendar();
    updatePickerPreviews();
}

function shiftCalendarMonth(delta) {
    let m = pickerDraft.viewMonth + delta;
    let y = pickerDraft.viewYear;
    if (m < 0) { m = 11; y -= 1; }
    if (m > 11) { m = 0; y += 1; }
    pickerDraft.viewYear = y;
    pickerDraft.viewMonth = m;
    renderPickerCalendar();
}

function getDraftRangeMs() {
    const sDate = pickerDraft.startDate;
    const eDate = pickerDraft.endDate || pickerDraft.startDate;
    const startH24 = to24Hour(pickerDraft.startTime.hour12, pickerDraft.startTime.ampm);
    const endH24 = to24Hour(pickerDraft.endTime.hour12, pickerDraft.endTime.ampm);

    let startMs = dhakaPartsToMs(sDate.y, sDate.m, sDate.d, startH24, pickerDraft.startTime.minute, 0);
    let endMs = dhakaPartsToMs(eDate.y, eDate.m, eDate.d, endH24, pickerDraft.endTime.minute, 59);

    const now = Date.now();
    const minAllowed = now - MAX_HISTORY_MS;
    if (startMs < minAllowed) startMs = minAllowed;
    if (endMs > now) endMs = now;
    if (startMs > endMs) [startMs, endMs] = [endMs, startMs];
    return { startMs, endMs };
}

function updatePickerPreviews() {
    const startPill = document.getElementById('pickerStartPill');
    const endPill = document.getElementById('pickerEndPill');
    startPill.classList.toggle('active', pickerDraft.pickingPhase === 'start');
    endPill.classList.toggle('active', pickerDraft.pickingPhase === 'end');

    const sDate = pickerDraft.startDate;
    const eDate = pickerDraft.endDate || pickerDraft.startDate;
    const sTimeStr = `${String(pickerDraft.startTime.hour12).padStart(2, '0')}:${String(pickerDraft.startTime.minute).padStart(2, '0')} ${pickerDraft.startTime.ampm}`;
    const eTimeStr = `${String(pickerDraft.endTime.hour12).padStart(2, '0')}:${String(pickerDraft.endTime.minute).padStart(2, '0')} ${pickerDraft.endTime.ampm}`;

    document.getElementById('pickerStartPreview').textContent =
        `${String(sDate.d).padStart(2, '0')} ${MONTHS_SHORT[sDate.m]} ${sDate.y}, ${sTimeStr}`;
    document.getElementById('pickerEndPreview').textContent =
        `${String(eDate.d).padStart(2, '0')} ${MONTHS_SHORT[eDate.m]} ${eDate.y}, ${eTimeStr}`;

    const { startMs, endMs } = getDraftRangeMs();
    document.getElementById('pickerDurationText').textContent = `Duration: ${formatDurationHuman(endMs - startMs)}`;
}

function updateCalendarRangeClasses() {
    let rangeA = pickerDraft.startDate;
    let rangeB = pickerDraft.pickingPhase === 'end' && pickerDraft.hoverDate
        ? pickerDraft.hoverDate
        : (pickerDraft.endDate || pickerDraft.startDate);
    if (rangeA && rangeB && compareYmd(rangeA, rangeB) > 0) {
        [rangeA, rangeB] = [rangeB, rangeA];
    }

    document.querySelectorAll('#calDaysGrid .cal-day').forEach(btn => {
        btn.classList.remove('selected-start', 'selected-end', 'in-range');
        if (btn.disabled || !rangeA || !rangeB) return;
        const cellYmd = {
            y: parseInt(btn.dataset.y, 10),
            m: parseInt(btn.dataset.m, 10),
            d: parseInt(btn.dataset.d, 10)
        };
        if (sameYmd(cellYmd, rangeA)) btn.classList.add('selected-start');
        if (sameYmd(cellYmd, rangeB)) btn.classList.add('selected-end');
        if (compareYmd(cellYmd, rangeA) > 0 && compareYmd(cellYmd, rangeB) < 0) {
            btn.classList.add('in-range');
        }
    });
}

function renderPickerCalendar() {
    const grid = document.getElementById('calDaysGrid');
    const monthLabel = document.getElementById('calMonthLabel');
    const prevBtn = document.getElementById('calPrevBtn');
    const nextBtn = document.getElementById('calNextBtn');

    const y = pickerDraft.viewYear;
    const m = pickerDraft.viewMonth;
    monthLabel.textContent = `${MONTHS_FULL[m]} ${y}`;

    const { minYmd, maxYmd } = getDhakaMinMaxYmd();
    const minYm = minYmd.y * 12 + minYmd.m;
    const maxYm = maxYmd.y * 12 + maxYmd.m;
    const curYm = y * 12 + m;

    prevBtn.disabled = curYm <= minYm;
    nextBtn.disabled = curYm >= maxYm;

    const firstWeekday = new Date(Date.UTC(y, m, 1)).getUTCDay();
    const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

    grid.innerHTML = '';

    for (let i = 0; i < firstWeekday; i++) {
        const empty = document.createElement('div');
        empty.className = 'cal-day-empty';
        grid.appendChild(empty);
    }

    for (let d = 1; d <= daysInMonth; d++) {
        const cellYmd = { y, m, d };
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'cal-day';
        btn.textContent = String(d);
        btn.dataset.y = String(y);
        btn.dataset.m = String(m);
        btn.dataset.d = String(d);

        const isDisabled = compareYmd(cellYmd, minYmd) < 0 || compareYmd(cellYmd, maxYmd) > 0;
        btn.disabled = isDisabled;

        if (sameYmd(cellYmd, maxYmd)) btn.classList.add('today');

        if (!isDisabled) {
            btn.onclick = () => onCalendarDayClick(cellYmd);
            btn.onmouseenter = () => {
                if (pickerDraft.pickingPhase === 'end') {
                    pickerDraft.hoverDate = cellYmd;
                    updateCalendarRangeClasses();
                }
            };
        }

        grid.appendChild(btn);
    }

    updateCalendarRangeClasses();
}

function onCalendarDayClick(clickedYmd) {
    if (pickerDraft.pickingPhase === 'start') {
        pickerDraft.startDate = clickedYmd;
        pickerDraft.endDate = clickedYmd;
        pickerDraft.hoverDate = null;
        pickerDraft.pickingPhase = 'end';
    } else {
        if (compareYmd(clickedYmd, pickerDraft.startDate) < 0) {
            pickerDraft.endDate = pickerDraft.startDate;
            pickerDraft.startDate = clickedYmd;
        } else {
            pickerDraft.endDate = clickedYmd;
        }
        pickerDraft.hoverDate = null;
        pickerDraft.pickingPhase = 'start';
    }
    renderPickerCalendar();
    updatePickerPreviews();
}

function applyCustomRange() {
    const { startMs, endMs } = getDraftRangeMs();
    if (endMs <= startMs) {
        showHistoryToast('End time must be after Start time.');
        return;
    }
    activePreset = 'custom';
    customRange = { startMs, endMs };
    document.querySelectorAll('.preset-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.preset === 'custom');
    });
    updateActiveRangeDisplay();
    closeCustomRangeModal();

    if (currentAssetId && currentAttribute && Array.isArray(currentData) && currentData.length > 0) {
        fetchDatapoints();
    }
}

// ── Assets & Attributes Loading ──
async function loadAssets() {
    const select = document.getElementById('assetSelect');
    select.innerHTML = '<option value="">Loading...</option>';

    try {
        const res = await fetch(`${APP_PREFIX}/api/user/assets`);
        const data = await res.json();

        if (data.error) {
            select.innerHTML = '<option value="">Unable to load devices</option>';
            return;
        }

        const assets = Array.isArray(data) ? data : (data.assets || []);

        if (assets.length === 0) {
            select.innerHTML = '<option value="">No linked devices</option>';
            return;
        }

        select.innerHTML = '<option value="">Select device...</option>';
        assets.forEach(a => {
            const opt = document.createElement('option');
            opt.value = a.id;
            opt.textContent = a.name || a.id;
            select.appendChild(opt);
        });
    } catch (e) {
        console.error(e);
        select.innerHTML = '<option value="">Error loading devices</option>';
    }
}

async function loadAttributes(assetId) {
    const assetSelect = document.getElementById('assetSelect');
    const select = document.getElementById('attributeSelect');
    const subGroup = document.getElementById('subAttributeGroup');
    const subSelect = document.getElementById('subAttributeSelect');

    select.innerHTML = '<option value="">Loading...</option>';
    select.disabled = true;
    subGroup.style.display = 'none';
    currentAssetId = assetId || null;
    currentAssetName = assetId && assetSelect.selectedIndex >= 0
        ? assetSelect.options[assetSelect.selectedIndex].textContent
        : '';
    currentAttribute = null;
    currentSubAttribute = '';
    currentAttrKeys = [];

    if (!assetId) {
        select.innerHTML = '<option value="">Select a device first...</option>';
        return;
    }

    try {
        const res = await fetch(`${APP_PREFIX}/api/asset/${assetId}`);
        const asset = await res.json();
        const attrs = asset.attributes || {};
        currentAssetName = asset.name || currentAssetName || assetId;
        currentAssetCustomNames = typeof parseCustomNames === 'function' ? parseCustomNames(asset) : {};

        select.innerHTML = '<option value="">Select group / attribute...</option>';

        // Exclude non-history metadata/config attributes (storeDataPoints: false in templates)
        naturalSortKeys(
            Object.keys(attrs).filter(key =>
                key !== 'RuleTargets' &&
                key !== 'CustomNames' &&
                !key.toLowerCase().startsWith('timer') &&
                key.toLowerCase() !== 'systemdata' &&
                key.toLowerCase() !== 'location' &&
                key.toLowerCase() !== 'notes'
            )
        ).forEach(key => {
            const el = document.createElement('option');
            el.value = key;
            el.textContent = resolveHistoryLabel(key, true);
            select.appendChild(el);
        });

        select.disabled = false;

        select.onchange = () => {
            currentAttribute = select.value;
            currentSubAttribute = '';
            currentAttrKeys = [];

            const attr = attrs[currentAttribute];
            let keys = [];
            let isJsonAttribute = false;

            if (attr !== undefined) {
                let val = (attr && typeof attr === 'object' && 'value' in attr) ? attr.value : attr;
                const parsedObj = tryParseJsonObject(val);
                if (parsedObj) {
                    keys = naturalSortKeys(Object.keys(parsedObj));
                    isJsonAttribute = keys.length > 0;
                }
            }

            currentAttrKeys = keys;

            if (isJsonAttribute) {
                subGroup.style.display = 'flex';
                subSelect.innerHTML = '<option value="">(All Elements)</option>';
                keys.forEach(k => {
                    const opt = document.createElement('option');
                    opt.value = k;
                    opt.textContent = resolveHistoryLabel(k, false);
                    subSelect.appendChild(opt);
                });
            } else {
                subGroup.style.display = 'none';
            }
        };
    } catch (e) {
        console.error(e);
        select.innerHTML = '<option value="">Error loading groups</option>';
    }
}

// ── View Mode Toggle (Table | Chart) ──
function setViewMode(mode) {
    if (mode !== 'table' && mode !== 'graph') return;
    currentViewMode = mode;
    document.querySelectorAll('.view-tab').forEach(tab => {
        const isActive = tab.dataset.view === mode;
        tab.classList.toggle('active', isActive);
        tab.setAttribute('aria-selected', String(isActive));
    });
    updateView();
}

function updateView() {
    const initialMsg = document.getElementById('initialMessage');
    const statsBar = document.getElementById('statsSummary');
    const tableWrapper = document.getElementById('tableWrapper');
    const graphOutput = document.getElementById('graphOutput');

    initialMsg.style.display = 'none';
    statsBar.style.display = 'none';
    tableWrapper.style.display = 'none';
    graphOutput.style.display = 'none';

    if (!currentData || (Array.isArray(currentData) && currentData.length === 0)) {
        initialMsg.style.display = 'block';
        if (typeof currentData === 'string') {
            initialMsg.textContent = currentData;
        } else {
            initialMsg.innerHTML = 'Choose a device and group above, then click <strong>Fetch Data</strong> to see the history.';
        }
        return;
    }

    renderStatsSummary(currentData);

    if (currentViewMode === 'table') {
        tableWrapper.style.display = 'block';
        renderTable(currentData);
    } else {
        graphOutput.style.display = 'block';
        renderGraph(currentData);
    }
}

// ── Summary Stats Bar ──
function renderStatsSummary(data) {
    const statsBar = document.getElementById('statsSummary');
    if (!Array.isArray(data) || data.length === 0) {
        statsBar.style.display = 'none';
        return;
    }

    const chips = [
        `<div class="stat-chip">Records: <strong>${data.length.toLocaleString()}</strong></div>`
    ];

    const isScalar = !data.some(pt => pt.y && typeof pt.y === 'object');
    if (isScalar) {
        let onCount = 0;
        let offCount = 0;
        let stateCount = 0;
        const nums = [];

        data.forEach(pt => {
            const st = parseStateBool(pt.y);
            if (st !== null) {
                stateCount++;
                if (st) onCount++;
                else offCount++;
            } else {
                const n = Number(pt.y);
                if (!isNaN(n) && String(pt.y).trim() !== '') nums.push(n);
            }
        });

        if (stateCount > 0 && stateCount >= nums.length) {
            chips.push(`<div class="stat-chip stat-on">ON: <strong>${onCount.toLocaleString()}</strong></div>`);
            chips.push(`<div class="stat-chip stat-off">OFF: <strong>${offCount.toLocaleString()}</strong></div>`);
        } else if (nums.length > 0) {
            const min = Math.min(...nums);
            const max = Math.max(...nums);
            const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
            const unitKey = currentSubAttribute || currentAttribute;
            const unit = typeof getSensorUnit === 'function' ? getSensorUnit(unitKey, currentAttribute) : '';
            const suffix = unit ? ` ${safeEscape(unit)}` : '';
            chips.push(`<div class="stat-chip">Min: <strong>${min.toFixed(1)}${suffix}</strong></div>`);
            chips.push(`<div class="stat-chip">Avg: <strong>${avg.toFixed(1)}${suffix}</strong></div>`);
            chips.push(`<div class="stat-chip">Max: <strong>${max.toFixed(1)}${suffix}</strong></div>`);
        }
    } else {
        const activeKeys = new Set();
        data.forEach(pt => {
            if (pt.y && typeof pt.y === 'object') {
                Object.keys(pt.y).forEach(k => activeKeys.add(k));
            }
        });
        chips.push(`<div class="stat-chip">Active Elements: <strong>${activeKeys.size}</strong></div>`);
    }

    statsBar.innerHTML = chips.join('');
    statsBar.style.display = 'flex';
}

// ── Table Rendering with Load More Pagination ──
function formatTableScalarValue(val, key, attrName) {
    const state = parseStateBool(val);
    if (state !== null) {
        return state
            ? '<span class="state-badge state-badge-on">ON</span>'
            : '<span class="state-badge state-badge-off">OFF</span>';
    }
    const unit = typeof getSensorUnit === 'function' ? getSensorUnit(key, attrName) : '';
    const num = Number(val);
    if (!isNaN(num) && String(val).trim() !== '') {
        return unit ? `${safeEscape(val)} ${safeEscape(unit)}` : safeEscape(val);
    }
    return safeEscape(val);
}

function renderTable(data) {
    const container = document.getElementById('tableOutput');
    const loadMoreBar = document.getElementById('tableLoadMoreBar');

    if (!Array.isArray(data)) {
        container.innerHTML = '<div style="padding:12px; color:#dc2626;">Unable to display data in table format.</div>';
        loadMoreBar.style.display = 'none';
        return;
    }

    const sorted = [...data].sort((a, b) => b.x - a.x);
    const visibleRows = sorted.slice(0, tableDisplayLimit);

    let displayText = resolveHistoryLabel(currentAttribute, true);
    if (currentSubAttribute) {
        displayText += ` (${resolveHistoryLabel(currentSubAttribute, false)})`;
    } else if (currentAttrKeys.length > 0) {
        displayText += ' (All)';
    }
    const safeDisplayText = safeEscape(displayText);

    let html = '<table class="data-table"><thead><tr><th>Attribute</th><th>Date (Dhaka)</th><th>Time (Dhaka)</th><th>Value</th></tr></thead><tbody>';

    visibleRows.forEach(pt => {
        const dateStr = formatDhakaDate(pt.x);
        const timeStr = formatDhakaTime(pt.x, true);
        const val = pt.y;
        let displayVal = '';

        if (val && typeof val === 'object' && !Array.isArray(val)) {
            const keys = naturalSortKeys(Object.keys(val));
            displayVal = '<div class="val-object">';
            keys.forEach(k => {
                const labelK = safeEscape(resolveHistoryLabel(k, false));
                const formattedV = formatTableScalarValue(val[k], k, currentAttribute);
                displayVal += `<span class="val-pill"><span class="val-key">${labelK}:</span> ${formattedV}</span>`;
            });
            displayVal += '</div>';
        } else {
            displayVal = formatTableScalarValue(val, currentSubAttribute || currentAttribute, currentAttribute);
        }

        html += `<tr>
            <td class="td-nowrap"><strong>${safeDisplayText}</strong></td>
            <td class="td-nowrap">${dateStr}</td>
            <td class="td-nowrap">${timeStr}</td>
            <td>${displayVal}</td>
        </tr>`;
    });

    html += '</tbody></table>';
    container.innerHTML = html;

    // Load More Pagination Controls
    if (sorted.length > visibleRows.length) {
        const remaining = sorted.length - visibleRows.length;
        const nextChunk = Math.min(TABLE_PAGE_SIZE, remaining);
        loadMoreBar.innerHTML = `
            <span>Showing <strong>${visibleRows.length.toLocaleString()}</strong> of <strong>${sorted.length.toLocaleString()}</strong> records</span>
            <div class="load-more-btns">
                <button type="button" class="load-more-btn" onclick="loadMoreTableRows(${TABLE_PAGE_SIZE})">Load ${nextChunk} More</button>
                ${remaining <= 1000 ? `<button type="button" class="load-more-btn load-more-btn-muted" onclick="loadMoreTableRows(${remaining})">Show All (${sorted.length.toLocaleString()})</button>` : ''}
            </div>
        `;
        loadMoreBar.style.display = 'flex';
    } else if (sorted.length > TABLE_PAGE_SIZE) {
        loadMoreBar.innerHTML = `<span>Showing all <strong>${sorted.length.toLocaleString()}</strong> records</span>`;
        loadMoreBar.style.display = 'flex';
    } else {
        loadMoreBar.style.display = 'none';
    }
}

function loadMoreTableRows(count) {
    tableDisplayLimit += count;
    if (Array.isArray(currentData)) {
        renderTable(currentData);
    }
}

// ── Downsampling Algorithms (for 3m / 6m Smooth Charts) ──
/**
 * Largest-Triangle-Three-Buckets (LTTB) downsampling for numeric time-series [{x, y}].
 * Preserves visual peaks and valleys while capping rendered points.
 */
function downsampleLTTB(points, threshold) {
    const len = points.length;
    if (threshold >= len || threshold <= 2) return points;

    const sampled = [points[0]];
    const every = (len - 2) / (threshold - 2);
    let a = 0;

    for (let i = 0; i < threshold - 2; i++) {
        let avgX = 0;
        let avgY = 0;
        let avgRangeStart = Math.floor((i + 1) * every) + 1;
        let avgRangeEnd = Math.floor((i + 2) * every) + 1;
        if (avgRangeEnd > len) avgRangeEnd = len;

        const avgRangeLen = avgRangeEnd - avgRangeStart;
        for (let j = avgRangeStart; j < avgRangeEnd; j++) {
            avgX += points[j].x;
            avgY += points[j].y;
        }
        if (avgRangeLen > 0) {
            avgX /= avgRangeLen;
            avgY /= avgRangeLen;
        }

        const rangeOffs = Math.floor(i * every) + 1;
        const rangeTo = Math.floor((i + 1) * every) + 1;
        const pointAX = points[a].x;
        const pointAY = points[a].y;

        let maxArea = -1;
        let nextA = rangeOffs;
        for (let j = rangeOffs; j < rangeTo; j++) {
            const area = Math.abs(
                (pointAX - avgX) * (points[j].y - pointAY) -
                (pointAX - points[j].x) * (avgY - pointAY)
            ) * 0.5;
            if (area > maxArea) {
                maxArea = area;
                nextA = j;
            }
        }
        sampled.push(points[nextA]);
        a = nextA;
    }

    sampled.push(points[len - 1]);
    return sampled;
}

/**
 * State-change compression for boolean/relay/valve time-series [{x, y: 0|1}].
 * Preserves every ON<->OFF transition point and range endpoints.
 */
function compressStateSeries(points, maxPoints) {
    if (points.length <= maxPoints) return points;
    const compressed = [points[0]];
    for (let i = 1; i < points.length - 1; i++) {
        if (points[i].y !== points[i - 1].y) {
            compressed.push(points[i]);
        }
    }
    compressed.push(points[points.length - 1]);
    if (compressed.length <= maxPoints) return compressed;

    // Fallback uniform stride if still above threshold
    const step = Math.ceil(compressed.length / maxPoints);
    const trimmed = compressed.filter((_, idx) => idx === 0 || idx === compressed.length - 1 || idx % step === 0);
    return trimmed;
}

// ── Chart Rendering (Multi-Line + Stepped ON/OFF + Light Theme) ──
function renderGraph(data) {
    const canvas = document.getElementById('datapointChart');
    const hintBar = document.getElementById('chartHintBar');
    const ctx = canvas.getContext('2d');

    if (chartInstance) {
        chartInstance.destroy();
        chartInstance = null;
    }

    if (!Array.isArray(data) || data.length === 0) {
        hintBar.style.display = 'none';
        return;
    }

    const sorted = [...data].sort((a, b) => a.x - b.x);
    const minTs = sorted[0].x;
    const maxTs = sorted[sorted.length - 1].x;
    const spanMs = Math.max(1, maxTs - minTs);

    const isGroupedObjects = sorted.some(pt => pt.y && typeof pt.y === 'object' && !Array.isArray(pt.y));
    const datasets = [];
    let isStateChart = false;
    let wasSampled = false;
    let totalRawPoints = sorted.length;

    if (isGroupedObjects) {
        // Discover all active keys present in cleaned data
        const keySet = new Set();
        sorted.forEach(pt => {
            if (pt.y && typeof pt.y === 'object') {
                Object.keys(pt.y).forEach(k => keySet.add(k));
            }
        });
        const orderedKeys = currentAttrKeys.filter(k => keySet.has(k));
        const extraKeys = naturalSortKeys([...keySet].filter(k => !orderedKeys.includes(k)));
        const activeKeys = [...orderedKeys, ...extraKeys];

        // Check if this grouped attribute represents boolean/state relays (true/false, on/off, high/low)
        let stateSamples = 0;
        let numericSamples = 0;
        sorted.forEach(pt => {
            if (pt.y && typeof pt.y === 'object') {
                Object.values(pt.y).forEach(v => {
                    if (isStateValue(v)) stateSamples++;
                    else if (!isNaN(Number(v)) && String(v).trim() !== '') numericSamples++;
                });
            }
        });
        isStateChart = stateSamples > 0 && stateSamples >= numericSamples;

        activeKeys.forEach((k, idx) => {
            const color = SERIES_COLORS[idx % SERIES_COLORS.length];
            const rawSeries = [];

            sorted.forEach(pt => {
                if (!pt.y || typeof pt.y !== 'object' || !(k in pt.y)) return;
                const v = pt.y[k];
                if (isStateChart) {
                    const st = parseStateBool(v);
                    if (st !== null) rawSeries.push({ x: pt.x, y: st ? 1 : 0 });
                } else {
                    const num = Number(v);
                    if (!isNaN(num) && String(v).trim() !== '') {
                        rawSeries.push({ x: pt.x, y: num });
                    }
                }
            });

            if (rawSeries.length === 0) return;

            let plotted = rawSeries;
            if (rawSeries.length > CHART_MAX_POINTS) {
                wasSampled = true;
                plotted = isStateChart
                    ? compressStateSeries(rawSeries, CHART_MAX_POINTS)
                    : downsampleLTTB(rawSeries, CHART_MAX_POINTS);
            }

            const unit = (!isStateChart && typeof getSensorUnit === 'function')
                ? getSensorUnit(k, currentAttribute)
                : '';
            const label = resolveHistoryLabel(k, false) + (unit ? ` (${unit})` : '');

            datasets.push({
                label,
                data: plotted,
                unit,
                isState: isStateChart,
                borderColor: color,
                backgroundColor: color + '22',
                borderWidth: 2,
                pointRadius: plotted.length > 120 ? 0 : 2.5,
                pointHoverRadius: 5,
                stepped: isStateChart ? true : false,
                tension: isStateChart ? 0 : 0.15,
                fill: false
            });
        });
    } else {
        // Single element or standalone attribute (e.g. t1, ValveState1)
        let stateSamples = 0;
        let numericSamples = 0;
        sorted.forEach(pt => {
            if (isStateValue(pt.y)) stateSamples++;
            else if (!isNaN(Number(pt.y)) && String(pt.y).trim() !== '') numericSamples++;
        });
        isStateChart = stateSamples > 0 && stateSamples >= numericSamples;

        const rawSeries = [];
        sorted.forEach(pt => {
            if (isStateChart) {
                const st = parseStateBool(pt.y);
                if (st !== null) rawSeries.push({ x: pt.x, y: st ? 1 : 0 });
            } else {
                const num = Number(pt.y);
                if (!isNaN(num) && String(pt.y).trim() !== '') {
                    rawSeries.push({ x: pt.x, y: num });
                }
            }
        });

        let plotted = rawSeries;
        if (rawSeries.length > CHART_MAX_POINTS) {
            wasSampled = true;
            plotted = isStateChart
                ? compressStateSeries(rawSeries, CHART_MAX_POINTS)
                : downsampleLTTB(rawSeries, CHART_MAX_POINTS);
        }

        const unitKey = currentSubAttribute || currentAttribute;
        const unit = (!isStateChart && typeof getSensorUnit === 'function')
            ? getSensorUnit(unitKey, currentAttribute)
            : '';
        const baseLabel = currentSubAttribute
            ? `${resolveHistoryLabel(currentAttribute, true)} (${resolveHistoryLabel(currentSubAttribute, false)})`
            : resolveHistoryLabel(currentAttribute, true);

        datasets.push({
            label: unit ? `${baseLabel} (${unit})` : baseLabel,
            data: plotted,
            unit,
            isState: isStateChart,
            borderColor: '#00af50',
            backgroundColor: 'rgba(0, 175, 80, 0.14)',
            borderWidth: 2.2,
            pointRadius: plotted.length > 120 ? 0 : 3,
            pointHoverRadius: 5,
            stepped: isStateChart ? true : false,
            tension: isStateChart ? 0 : 0.15,
            fill: !isStateChart
        });
    }

    // Hint bar for multi-series legend toggle or downsampling notice
    const hintParts = [];
    if (datasets.length > 1) {
        hintParts.push('<span>Tip: Click any legend item below to show or hide a line.</span>');
    }
    if (wasSampled) {
        hintParts.push(`<span class="sampled-badge">Optimized chart view (~${CHART_MAX_POINTS} points from ${totalRawPoints.toLocaleString()} records)</span>`);
    }
    if (hintParts.length > 0) {
        hintBar.innerHTML = hintParts.join('');
        hintBar.style.display = 'flex';
    } else {
        hintBar.style.display = 'none';
    }

    chartInstance = new Chart(ctx, {
        type: 'line',
        data: { datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            parsing: false,
            normalized: true,
            interaction: {
                mode: 'nearest',
                axis: 'x',
                intersect: false
            },
            scales: {
                x: {
                    type: 'linear',
                    min: minTs,
                    max: maxTs === minTs ? maxTs + 60000 : maxTs,
                    ticks: {
                        color: '#475569',
                        maxTicksLimit: 8,
                        callback: (value) => formatDhakaAxisTick(value, spanMs)
                    },
                    grid: { color: '#e2e8f0' }
                },
                y: isStateChart
                    ? {
                        min: -0.1,
                        max: 1.1,
                        ticks: {
                            color: '#334155',
                            stepSize: 1,
                            callback: (val) => (val === 1 ? 'ON' : val === 0 ? 'OFF' : '')
                        },
                        grid: { color: '#e2e8f0' }
                    }
                    : {
                        ticks: { color: '#475569' },
                        grid: { color: '#e2e8f0' }
                    }
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    labels: {
                        color: '#1e293b',
                        usePointStyle: true,
                        boxWidth: 8,
                        padding: 14,
                        font: { size: 12, weight: '600' }
                    }
                },
                tooltip: {
                    enabled: true,
                    backgroundColor: 'rgba(15, 23, 42, 0.92)',
                    titleColor: '#f8fafc',
                    bodyColor: '#f1f5f9',
                    padding: 10,
                    cornerRadius: 8,
                    callbacks: {
                        title: (items) => {
                            if (!items || !items.length) return '';
                            return `${formatDhakaDateTime(items[0].parsed.x, true)} (Dhaka)`;
                        },
                        label: (item) => {
                            const ds = item.dataset;
                            if (ds.isState) {
                                return `${ds.label}: ${item.parsed.y === 1 ? 'ON' : 'OFF'}`;
                            }
                            const suffix = ds.unit ? ` ${ds.unit}` : '';
                            return `${ds.label}: ${item.parsed.y}${suffix}`;
                        }
                    }
                }
            }
        }
    });
}

// ── Fetch Datapoints from OpenRemote Manager (30-Day Chunked + Adaptive Split) ──
function buildTimeChunks(start, end, chunkMs = FETCH_CHUNK_MS) {
    const chunks = [];
    let cursor = start;
    while (cursor <= end) {
        const chunkEnd = Math.min(cursor + chunkMs, end);
        chunks.push({ start: cursor, end: chunkEnd });
        if (chunkEnd >= end) break;
        cursor = chunkEnd + 1;
    }
    return chunks;
}

function cleanClientDatapoints(rawData, subAttr) {
    const cleaned = [];
    if (!Array.isArray(rawData)) return cleaned;

    if (subAttr) {
        rawData.forEach(pt => {
            if (!pt || pt.x === undefined) return;
            const obj = tryParseJsonObject(pt.y);
            if (obj) {
                if (!(subAttr in obj)) return;
                const subVal = obj[subAttr];
                if (isHistoryPlaceholder(subVal)) return;
                cleaned.push({ x: pt.x, y: subVal });
            } else if (!isHistoryPlaceholder(pt.y)) {
                // Already extracted server-side via filterOptions
                cleaned.push({ x: pt.x, y: pt.y });
            }
        });
    } else {
        rawData.forEach(pt => {
            if (!pt || pt.x === undefined) return;
            const obj = tryParseJsonObject(pt.y);
            if (obj) {
                const filteredObj = {};
                Object.keys(obj).forEach(k => {
                    if (!isHistoryPlaceholder(obj[k])) {
                        filteredObj[k] = obj[k];
                    }
                });
                if (Object.keys(filteredObj).length > 0) {
                    cleaned.push({ x: pt.x, y: filteredObj });
                }
            } else if (!isHistoryPlaceholder(pt.y)) {
                cleaned.push({ x: pt.x, y: pt.y });
            }
        });
    }
    return cleaned;
}

async function fetchSingleChunk(endpoint, chunkStart, chunkEnd, subAttr, queryType = 'all') {
    const res = await fetch(`${APP_PREFIX}/api/debug/proxy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            method: 'POST',
            endpoint,
            body: {
                fromTimestamp: chunkStart,
                toTimestamp: chunkEnd,
                type: queryType
            },
            filterOptions: {
                mode: 'clean_datapoints',
                subAttribute: subAttr || ''
            }
        })
    });
    const data = await res.json();
    return data;
}

async function fetchDatapoints() {
    if (!currentAssetId || !currentAttribute) {
        currentData = 'Please select a device and group / attribute first.';
        updateView();
        return;
    }

    const fetchSeq = ++activeFetchSeq;
    updateActiveRangeDisplay();

    const fetchBtn = document.getElementById('fetchBtn');
    const initialMsg = document.getElementById('initialMessage');
    initialMsg.textContent = 'Fetching history from OpenRemote...';
    initialMsg.style.display = 'block';
    document.getElementById('statsSummary').style.display = 'none';
    document.getElementById('tableWrapper').style.display = 'none';
    document.getElementById('graphOutput').style.display = 'none';

    if (fetchBtn) fetchBtn.disabled = true;

    const { start, end } = getTimeRange();
    const endpoint = `/api/${realm}/asset/datapoint/${currentAssetId}/${currentAttribute}`;
    const subAttr = currentSubAttribute || '';
    const queue = buildTimeChunks(start, end, FETCH_CHUNK_MS);

    let completedChunks = 0;
    let totalChunks = queue.length;
    let preferredQueryType = 'all';
    const mergedByTs = new Map();
    let failedError = null;

    try {
        while (queue.length > 0) {
            if (fetchSeq !== activeFetchSeq) return; // Superseded by a newer fetch

            const chunk = queue.shift();
            if (totalChunks > 1) {
                initialMsg.textContent = `Fetching history from OpenRemote... (Part ${completedChunks + 1} of ${totalChunks})`;
            }

            let data = await fetchSingleChunk(endpoint, chunk.start, chunk.end, subAttr, preferredQueryType);

            if (fetchSeq !== activeFetchSeq) return;

            // Compatibility fallback: if an older OpenRemote build rejects type='all', retry with type='json'
            if (data.status === 400 && preferredQueryType === 'all' && (chunk.end - chunk.start) <= FETCH_CHUNK_MS) {
                const retry = await fetchSingleChunk(endpoint, chunk.start, chunk.end, subAttr, 'json');
                if (fetchSeq !== activeFetchSeq) return;
                if (!retry.status || retry.status < 400) {
                    preferredQueryType = 'json';
                    data = retry;
                }
            }

            // Adaptive split: if a dense chunk exceeds OpenRemote's per-query point limit, split in half and retry
            if (data.status >= 400) {
                const span = chunk.end - chunk.start;
                if (span > MIN_ADAPTIVE_CHUNK_MS && data.status !== 401 && data.status !== 403 && data.status !== 404) {
                    const mid = Math.floor((chunk.start + chunk.end) / 2);
                    queue.unshift({ start: mid + 1, end: chunk.end });
                    queue.unshift({ start: chunk.start, end: mid });
                    totalChunks += 1;
                    continue;
                }
                failedError = data.detail
                    ? `Unable to fetch history data (${data.status}: ${data.detail}).`
                    : 'Unable to fetch history data. Please try again later.';
                break;
            }

            completedChunks += 1;
            let rawData = data.data !== undefined ? data.data : data;
            if (data.status === 200 && Array.isArray(data.data)) {
                rawData = data.data;
            }

            if (Array.isArray(rawData)) {
                const cleanedChunk = cleanClientDatapoints(rawData, subAttr);
                cleanedChunk.forEach(pt => {
                    mergedByTs.set(pt.x, pt);
                });
            }
        }

        if (fetchSeq !== activeFetchSeq) return;

        if (failedError && mergedByTs.size === 0) {
            currentData = failedError;
        } else {
            const merged = Array.from(mergedByTs.values());
            tableDisplayLimit = TABLE_PAGE_SIZE;
            currentData = merged.length > 0
                ? merged
                : 'No valid sensor readings found for the selected time range.';
            if (failedError && merged.length > 0) {
                showHistoryToast('Loaded partial history; some dense segments could not be fetched.');
            }
        }
    } catch (e) {
        if (fetchSeq !== activeFetchSeq) return;
        console.error(e);
        currentData = 'Unable to connect to server. Please try again later.';
    } finally {
        if (fetchSeq === activeFetchSeq && fetchBtn) {
            fetchBtn.disabled = false;
        }
    }

    updateView();
}

// ── Export Clean CSV via OpenRemote Manager /asset/datapoint/export ──
async function exportDatapoints() {
    if (!currentAssetId || !currentAttribute) {
        showHistoryToast('Please select a device and group / attribute first.');
        return;
    }

    updateActiveRangeDisplay();
    const { start, end } = getTimeRange();
    const refs = JSON.stringify([{ id: currentAssetId, name: currentAttribute }]);
    const encodedRefs = encodeURIComponent(refs);
    const endpoint = `/api/${realm}/asset/datapoint/export?attributeRefs=${encodedRefs}&fromTimestamp=${start}&toTimestamp=${end}`;

    // Resolve CustomNames + localStorage + friendlyNames + sensor units for backend CSV headers
    const labels = {};
    const units = {};
    labels[currentAttribute] = resolveHistoryLabel(currentAttribute, true);
    if (typeof getSensorUnit === 'function') {
        const attrUnit = getSensorUnit(currentAttribute, currentAttribute);
        if (attrUnit) units[currentAttribute] = attrUnit;
    }
    currentAttrKeys.forEach(k => {
        labels[k] = resolveHistoryLabel(k, false);
        if (typeof getSensorUnit === 'function') {
            const u = getSensorUnit(k, currentAttribute);
            if (u) units[k] = u;
        }
    });

    const btn = document.getElementById('exportBtn');
    const originalHtml = btn.innerHTML;
    btn.textContent = 'Exporting...';
    btn.disabled = true;

    try {
        const res = await fetch(`${APP_PREFIX}/api/debug/proxy`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                method: 'GET',
                endpoint,
                exportOptions: {
                    mode: 'clean_csv',
                    deviceName: currentAssetName || currentAssetId,
                    attributeName: currentAttribute,
                    subAttribute: currentSubAttribute || '',
                    keyOrder: currentAttrKeys,
                    labels,
                    units,
                    rangeLabel: activePreset
                }
            })
        });

        if (res.ok) {
            const contentType = res.headers.get('Content-Type') || '';
            if (contentType.includes('application/json')) {
                const data = await res.json();
                if (data.empty) {
                    showHistoryToast(data.data || 'No valid sensor readings found for the selected time range.');
                } else if (data.status >= 400) {
                    showHistoryToast('Export failed. Please try again later.');
                } else {
                    showHistoryToast('No exportable data available for this range.');
                }
            } else {
                const blob = await res.blob();
                const cd = res.headers.get('Content-Disposition') || '';
                let filename = `${currentAttribute}${currentSubAttribute ? '_' + currentSubAttribute : ''}_${activePreset}.csv`;
                const match = cd.match(/filename="?([^"]+)"?/i);
                if (match && match[1]) filename = match[1];

                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                a.remove();
                window.URL.revokeObjectURL(url);

                const rowCount = res.headers.get('X-Export-Row-Count');
                showHistoryToast(rowCount ? `Exported ${Number(rowCount).toLocaleString()} rows to CSV.` : 'CSV downloaded.');
            }
        } else {
            showHistoryToast('Export request failed. Please try again.');
        }
    } catch (e) {
        console.error(e);
        showHistoryToast('Export failed. Please check your connection and try again.');
    } finally {
        btn.innerHTML = originalHtml;
        btn.disabled = false;
    }
}
