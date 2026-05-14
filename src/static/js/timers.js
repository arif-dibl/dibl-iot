const openGroups = new Set();

// Local buffer: pendingTimerData[assetId][attrName] = { ...timerFields }
const pendingTimerData = {};
// Track which cards have unsaved edits
const dirtyTimers = new Set(); // keys like "assetId__attrName"
// Track output type per asset: 'valve' or 'relay'
const assetOutputType = {};

async function loadTimers() {
    try {
        const res = await fetch(`${APP_PREFIX}/api/user/assets`);
        const data = await res.json();
        const assets = Array.isArray(data) ? data : (data.assets || []);

        const container = document.getElementById('assetsList');
        const loading = document.getElementById('loadingText');

        if (loading) loading.style.display = 'none';
        container.innerHTML = '';

        if (assets.length === 0) {
            container.innerHTML = '<div style="padding:2rem; text-align:center; color:var(--text-muted)">No devices found.</div>';
            return;
        }

        let pinnedItems = [];
        try {
            const prefsRes = await fetch(`${APP_PREFIX}/api/user/preferences`);
            const prefs = await prefsRes.json();
            pinnedItems = prefs.pinned || [];
        } catch (e) { console.error("Prefs error", e); }

        let hasTimers = false;

        for (const asset of assets) {
            const timerAttributes = {};
            if (asset.attributes) {
                for (const [key, val] of Object.entries(asset.attributes)) {
                    if (key.toLowerCase().startsWith('timer')) {
                        timerAttributes[key] = val;
                    }
                }
            }

            if (Object.keys(timerAttributes).length > 0) {
                hasTimers = true;
                const assetIdClean = asset.id.replace(/[^a-zA-Z0-9]/g, '');
                const isOpen = openGroups.has(assetIdClean);

                // Detect output type for this asset
                if (asset.attributes?.ValveState !== undefined) {
                    assetOutputType[asset.id] = 'valve';
                } else {
                    assetOutputType[asset.id] = 'relay';
                }
                // Seed the pending buffer with current server values
                if (!pendingTimerData[asset.id]) pendingTimerData[asset.id] = {};
                for (const [key, val] of Object.entries(timerAttributes)) {
                    // Only seed if not already dirty (user hasn't edited yet)
                    const dirtyKey = `${asset.id}__${key}`;
                    if (!dirtyTimers.has(dirtyKey)) {
                        pendingTimerData[asset.id][key] = typeof val === 'object' && val !== null
                            ? JSON.parse(JSON.stringify(val))
                            : val;
                    }
                }

                const sortedKeys = Object.keys(timerAttributes).sort();

                let timersHtml = '';
                for (const key of sortedKeys) {
                    const displayVal = pendingTimerData[asset.id][key] || timerAttributes[key];
                    timersHtml += renderEditableTimer(asset.id, key, displayVal, pinnedItems);
                }

                const html = `
                    <div style="margin-bottom:1.5rem; border:1px solid var(--border); border-radius:8px; overflow:visible;">
                         <div 
                            onclick="toggleAssetGroup('${assetIdClean}', '${asset.id}')" 
                            style="background:#f8f9fa; padding:1rem 1.5rem; cursor:pointer; display:flex; justify-content:space-between; align-items:center; user-select:none;"
                        >
                            <div style="font-weight:600; font-size:1.1rem; color:#333;">
                                ${asset.name} <span style="color:var(--text-muted); font-weight:400; font-size:0.9rem;">(${Object.keys(timerAttributes).length} Timers)</span>
                            </div>
                            <span id="icon-${assetIdClean}" style="transition:transform 0.2s; transform: ${isOpen ? 'rotate(0deg)' : 'rotate(-90deg)'};">▼</span>
                        </div>
                        <div id="${assetIdClean}" class="timer-content-area" style="display:${isOpen ? 'block' : 'none'}; padding:1rem; background:white;">
                             <div style="display:flex; flex-wrap:wrap; gap:1rem; min-width:0;">
                                ${timersHtml}
                             </div>
                        </div>
                    </div>
                `;
                container.insertAdjacentHTML('beforeend', html);
            }
        }

        if (!hasTimers) {
            container.innerHTML = '<div style="padding:2rem; text-align:center; color:var(--text-muted)">No timers found on any devices.</div>';
        }

    } catch (e) {
        console.error(e);
        toast('Failed to load timers');
    }
}

function renderEditableTimer(assetId, key, val, pinnedItems = []) {
    let friendlyName = typeof getFriendlyLabel === 'function' ? getFriendlyLabel(key, true) : key.replace(/(\d+)/, ' $1');

    if (typeof val !== 'object' || val === null) {
        return `<div style="padding:1rem; border:1px solid #eee;">${key}: ${val}</div>`;
    }

    const items = val;

    const status = items['Status'] || 'OFF';
    const isActive = String(status).toUpperCase() === 'ON' || String(status).toUpperCase() === 'ACTIVE';
    const activeColor = isActive ? 'var(--primary)' : 'var(--text-muted)';

    let innerHtml = '';

    innerHtml += `
        <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #eee; padding-bottom:0.5rem; margin-bottom:0.5rem;">
            <div style="font-weight:600; color:#555;">Status</div>
            <div style="display:flex; align-items:center; gap:8px;">
                 <label class="toggle-switch" style="transform:scale(0.8);">
                    <input type="checkbox" ${isActive ? 'checked' : ''} onchange="bufferNestedChange(event, '${assetId}', '${key}', 'Status', this.checked)">
                    <span class="slider"></span>
                </label>
                <span id="status-label-${assetId}-${key}" style="font-weight:700; color:${activeColor}; font-size:0.9rem; min-width:30px;">${isActive ? 'ON' : 'OFF'}</span>
            </div>
        </div>
    `;

    const onHour = items['OnHour'] !== undefined ? items['OnHour'] : 0;
    const onMinute = items['OnMinute'] !== undefined ? items['OnMinute'] : 0;
    const offHour = items['OffHour'] !== undefined ? items['OffHour'] : 0;
    const offMinute = items['OffMinute'] !== undefined ? items['OffMinute'] : 0;

    innerHtml += `
        <div style="display:flex; justify-content:space-between; margin-bottom:0.5rem;">
            <div style="text-align:center;">
                <div style="font-size:0.7rem; color:#999; margin-bottom:2px;">START TIME</div>
                <div style="display:flex; align-items:center; gap:2px;">
                     ${renderWheelTrigger(assetId, key, 'OnHour', onHour, 23)}
                     <span style="font-weight:700;">:</span>
                     ${renderWheelTrigger(assetId, key, 'OnMinute', onMinute, 59)}
                </div>
            </div>
            <div style="text-align:center;">
                <div style="font-size:0.7rem; color:#999; margin-bottom:2px;">END TIME</div>
                <div style="display:flex; align-items:center; gap:2px;">
                     ${renderWheelTrigger(assetId, key, 'OffHour', offHour, 23)}
                     <span style="font-weight:700;">:</span>
                     ${renderWheelTrigger(assetId, key, 'OffMinute', offMinute, 59)}
                </div>
            </div>
        </div>
    `;

    const daysVal = items['Days'] || '';
    innerHtml += `
        <div style="margin-bottom:0.5rem;">
            <div style="font-size:0.7rem; color:#999; margin-bottom:4px;">SCHEDULE</div>
            ${renderDaysSelector(assetId, key, 'Days', daysVal)}
        </div>
        `;

    const outputsVal = items['Outputs'] || '';
    innerHtml += `
        <div style="margin-bottom:0.25rem;">
            <div style="font-size:0.7rem; color:#999; margin-bottom:4px;">TARGET SWITCHES</div>
            ${renderOutputsSelector(assetId, key, 'Outputs', outputsVal)}
        </div>
    `;

    const dirtyKey = `${assetId}__${key}`;
    const isDirty = dirtyTimers.has(dirtyKey);

    return `
        <div class="timer-card-mobile-fix" id="timer-card-${assetId}-${key}" style="flex: 1 1 250px; min-width:0; border:1px solid #e0e0e0; border-radius:6px; padding:1rem; background:#fafafa; max-width: 100%;">
            <div style="font-weight:700; margin-bottom:0.75rem; color:#333; font-size:1rem; border-bottom:1px solid #ddd; padding-bottom:0.5rem; display:flex; justify-content:space-between; align-items:center;">
                <span>${friendlyName}</span>
                <span onclick="event.stopPropagation(); pinWidget('${assetId}', '${key}', null, '${friendlyName}')" 
                      title="Pin to Dashboard"
                      style="cursor:pointer; font-size:1.1rem; color:${pinnedItems.some(p => p.assetId === assetId && p.attributeName === key) ? '#f1c40f' : '#ccc'}; transition:color 0.2s;">
                    ${pinnedItems.some(p => p.assetId === assetId && p.attributeName === key) ? '★' : '☆'}
                </span>
            </div>
            ${items._timestamp ? `<div style="font-size:0.75rem; color:#999; margin-bottom:1rem; text-align:right;">Last modified: ${new Date(items._timestamp).toLocaleString()}</div>` : ''}
            ${innerHtml}
            <button id="save-btn-${assetId}-${key}"
                onclick="saveTimerCard('${assetId}', '${key}')"
                style="display:${isDirty ? 'block' : 'none'}; width:100%; margin-top:0.75rem; padding:10px; background:var(--primary); color:white; border:none; border-radius:6px; font-weight:700; font-size:0.9rem; cursor:pointer; transition:opacity 0.2s;">
                SAVE
            </button>
        </div>
    `;
}

function renderWheelTrigger(assetId, attrName, nestedKey, val, max) {
    const currentVal = String(val || '0').padStart(2, '0');
    return `
        <div onclick="openWheelPicker(event, '${assetId}', '${attrName}', '${nestedKey}', ${val || 0}, ${max})"
            style="width:40px; padding:4px 0; border:1px solid #ccc; border-radius:4px; font-size:0.9rem; font-weight:700; text-align:center; cursor:pointer; background:white; color:var(--primary);">
            ${currentVal}
        </div>
    `;
}

function renderDaysSelector(assetId, attrName, nestedKey, val) {
    const daysOrder = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    const currentDays = (val || '').toUpperCase();
    const isEveryday = currentDays === 'EVERYDAY';

    let html = '<div style="display:flex; gap:4px; flex-wrap:wrap;">';
    daysOrder.forEach(d => {
        const active = isEveryday || currentDays.includes(d);
        html += `
            <div onclick="bufferDayToggle(event, '${assetId}', '${attrName}', '${nestedKey}', '${d}')"
                title="${d}"
                style="width:24px; height:24px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:0.6rem; font-weight:700; cursor:pointer; transition:all 0.2s;
                background:${active ? 'var(--primary)' : '#e0e0e0'}; 
                color:${active ? 'white' : '#777'};">
                ${d[0]}
            </div>
        `;
    });
    html += '</div>';
    return html;
}

function renderOutputsSelector(assetId, attrName, nestedKey, val) {
    const outputType = assetOutputType[assetId] || 'relay';
    const isValve = outputType === 'valve';
    const outputOptions = isValve ? ['valve'] : ['r1', 'r2', 'r3', 'r4'];
    const currentOutputs = (val || '').toLowerCase();

    const isActive = (rLabel) => {
        if (isValve) {
            return currentOutputs.includes('valve');
        }
        const num = rLabel.replace('r', '');
        const target = `out 0${num}`;
        if (currentOutputs.includes(target) || currentOutputs.includes(rLabel)) return true;
        return currentOutputs.includes(`out ${num}`) || currentOutputs.includes(`out 0${num}`);
    };

    let html = '<div style="display:flex; gap:4px; flex-wrap:wrap;">';
    outputOptions.forEach(r => {
        const active = isActive(r);
        const label = isValve ? 'V' : r.replace('r', '');
        const title = isValve ? 'Valve' : `Switch ${label}`;
        html += `
            <div onclick="bufferOutputToggle(event, '${assetId}', '${attrName}', '${nestedKey}', '${r}')"
                title="${title}"
                style="width:24px; height:24px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:0.6rem; font-weight:700; cursor:pointer; transition:all 0.2s;
                background:${active ? 'var(--primary)' : '#e0e0e0'}; 
                color:${active ? 'white' : '#777'};">
                ${label}
            </div>
        `;
    });
    html += '</div>';
    return html;
}

function toggleAssetGroup(id, realAssetId) {
    const el = document.getElementById(id);
    const icon = document.getElementById('icon-' + id);
    if (el.style.display === 'none') {
        el.style.display = 'block';
        icon.style.transform = 'rotate(0deg)';
        openGroups.add(id);

        // Publish all timers for this device once on open
        if (realAssetId) {
            publishAllTimers(realAssetId);
        }
    } else {
        el.style.display = 'none';
        icon.style.transform = 'rotate(-90deg)';
        openGroups.delete(id);
    }
}

// Publish all timer attributes for the given asset to the server
async function publishAllTimers(assetId) {
    try {
        const res = await fetch(`${APP_PREFIX}/api/asset/${assetId}`);
        if (!res.ok) return;
        const asset = await res.json();
        const attrs = asset.attributes || {};

        let count = 0;
        for (const [key, val] of Object.entries(attrs)) {
            if (!key.toLowerCase().startsWith('timer')) continue;

            let timerVal = val;
            if (val && typeof val === 'object' && 'value' in val) {
                timerVal = val.value;
            }
            if (typeof timerVal === 'string') {
                try { timerVal = JSON.parse(timerVal); } catch (e) { }
            }
            if (typeof timerVal !== 'object' || timerVal === null) continue;

            // Remove internal metadata before publishing
            const cleaned = { ...timerVal };
            delete cleaned._timestamp;

            await saveAttribute(assetId, key, cleaned, true);
            count++;
        }
        if (count > 0) toast(`Published ${count} timer(s) to server`);
    } catch (e) {
        console.error('[Timers] Publish all error:', e);
        toast('Failed to publish timers');
    }
}

// Mark a timer card as dirty (has unsaved changes) and show the Save button
function markDirty(assetId, attrName) {
    const dirtyKey = `${assetId}__${attrName}`;
    dirtyTimers.add(dirtyKey);
    const btn = document.getElementById(`save-btn-${assetId}-${attrName}`);
    if (btn) btn.style.display = 'block';
}

// Buffer a nested change locally without saving to server
function bufferNestedChange(event, assetId, attrName, nestedKey, newValue) {
    if (event) event.stopPropagation();

    // Update status label in UI
    if (nestedKey === 'Status') {
        const label = document.getElementById(`status-label-${assetId}-${attrName}`);
        if (label) {
            label.textContent = newValue ? 'ON' : 'OFF';
            label.style.color = newValue ? 'var(--primary)' : 'var(--text-muted)';
        }
    }

    // Update buffer
    if (!pendingTimerData[assetId]) pendingTimerData[assetId] = {};
    if (!pendingTimerData[assetId][attrName]) pendingTimerData[assetId][attrName] = {};

    if (nestedKey === 'Status') {
        pendingTimerData[assetId][attrName][nestedKey] = newValue ? 'ON' : 'OFF';
    } else {
        pendingTimerData[assetId][attrName][nestedKey] = newValue;
    }

    markDirty(assetId, attrName);
}

// Buffer a wheel picker value change locally
function bufferNestedValue(assetId, attrName, nestedKey, newValue) {
    if (!pendingTimerData[assetId]) pendingTimerData[assetId] = {};
    if (!pendingTimerData[assetId][attrName]) pendingTimerData[assetId][attrName] = {};

    pendingTimerData[assetId][attrName][nestedKey] = String(newValue);

    // Update the trigger display text
    const trigger = document.querySelector(`[onclick*="openWheelPicker(event, '${assetId}', '${attrName}', '${nestedKey}'"]`);
    if (trigger) {
        trigger.textContent = String(newValue).padStart(2, '0');
    }

    markDirty(assetId, attrName);
}

function bufferDayToggle(event, assetId, attrName, nestedKey, day) {
    if (event) event.stopPropagation();
    const el = event.currentTarget;
    const isActive = el.style.background === 'var(--primary)';

    // Optimistic UI update
    el.style.background = isActive ? '#e0e0e0' : 'var(--primary)';
    el.style.color = isActive ? '#777' : 'white';

    // Update buffer
    if (!pendingTimerData[assetId]) pendingTimerData[assetId] = {};
    if (!pendingTimerData[assetId][attrName]) pendingTimerData[assetId][attrName] = {};

    let currentDaysStr = (pendingTimerData[assetId][attrName][nestedKey] || '').toUpperCase();
    const daysOrder = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    let activeDays = [];
    if (currentDaysStr === 'EVERYDAY') activeDays = [...daysOrder];
    else activeDays = currentDaysStr.split(',').map(d => d.trim()).filter(d => daysOrder.includes(d));

    if (activeDays.includes(day)) activeDays = activeDays.filter(d => d !== day);
    else activeDays.push(day);

    activeDays.sort((a, b) => daysOrder.indexOf(a) - daysOrder.indexOf(b));
    let newValue = activeDays.join(',');
    if (activeDays.length === 7) newValue = 'EVERYDAY';
    if (activeDays.length === 0) newValue = 'NONE';

    pendingTimerData[assetId][attrName][nestedKey] = newValue;
    markDirty(assetId, attrName);
}

function bufferOutputToggle(event, assetId, attrName, nestedKey, relay) {
    if (event) event.stopPropagation();
    const el = event.currentTarget;
    const isActive = el.style.background === 'var(--primary)';

    // Optimistic UI update
    el.style.background = isActive ? '#e0e0e0' : 'var(--primary)';
    el.style.color = isActive ? '#777' : 'white';

    // Update buffer
    if (!pendingTimerData[assetId]) pendingTimerData[assetId] = {};
    if (!pendingTimerData[assetId][attrName]) pendingTimerData[assetId][attrName] = {};

    const outputType = assetOutputType[assetId] || 'relay';
    const isValve = outputType === 'valve';

    if (isValve) {
        // For valve: toggle between 'valve' and empty
        pendingTimerData[assetId][attrName][nestedKey] = isActive ? '' : 'valve';
    } else {
        // For relay: existing OUT format logic
        let currentOutputsStr = (pendingTimerData[assetId][attrName][nestedKey] || '').toUpperCase();

        const mapOutToR = (str) => {
            const parts = str.split(',').map(s => s.trim());
            return parts.map(p => {
                if (p.startsWith('OUT')) {
                    const num = parseInt(p.replace('OUT', '').trim());
                    return `r${num}`;
                }
                return p.toLowerCase();
            }).filter(p => p.startsWith('r'));
        };

        let activeOutputs = mapOutToR(currentOutputsStr);
        if (activeOutputs.includes(relay)) activeOutputs = activeOutputs.filter(r => r !== relay);
        else activeOutputs.push(relay);

        const sorted = activeOutputs.sort();
        const mapRToOut = (rFormatList) => {
            return rFormatList.map(r => {
                const num = parseInt(r.replace('r', ''));
                return `OUT ${String(num).padStart(2, '0')}`;
            });
        };

        pendingTimerData[assetId][attrName][nestedKey] = mapRToOut(sorted).join(',');
    }
    markDirty(assetId, attrName);
}

// Save a single timer card's buffered data to the server
async function saveTimerCard(assetId, attrName) {
    const btn = document.getElementById(`save-btn-${assetId}-${attrName}`);
    if (btn) {
        btn.textContent = 'SAVING...';
        btn.disabled = true;
        btn.style.opacity = '0.6';
    }

    try {
        // Fetch current server state first
        const res = await fetch(`${APP_PREFIX}/api/asset/${assetId}`);
        const asset = await res.json();
        let serverVal = asset.attributes[attrName]?.value || asset.attributes[attrName];
        if (typeof serverVal === 'string') {
            try { serverVal = JSON.parse(serverVal); } catch (e) { }
        }

        // Merge pending changes on top of server state
        const pending = (pendingTimerData[assetId] && pendingTimerData[assetId][attrName]) || {};
        const merged = { ...(typeof serverVal === 'object' ? serverVal : {}), ...pending };

        // Remove internal metadata
        delete merged._timestamp;

        await saveAttribute(assetId, attrName, merged);

        // Clear dirty state
        const dirtyKey = `${assetId}__${attrName}`;
        dirtyTimers.delete(dirtyKey);

        if (btn) {
            btn.textContent = 'SAVED ✓';
            btn.style.background = '#27ae60';
            setTimeout(() => {
                btn.style.display = 'none';
                btn.textContent = 'SAVE';
                btn.style.background = 'var(--primary)';
                btn.disabled = false;
                btn.style.opacity = '1';
            }, 1500);
        }
    } catch (e) {
        console.error(e);
        toast('Failed to save timer');
        if (btn) {
            btn.textContent = 'SAVE';
            btn.disabled = false;
            btn.style.opacity = '1';
        }
    }
}


async function saveAttribute(assetId, attrName, value, silent = false) {
    const res = await fetch(`${APP_PREFIX}/api/asset/${assetId}/attribute/${attrName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: value })
    });
    const data = await res.json();
    if (data.status === 'success') {
        if (!silent) toast('Updated');
    } else {
        toast('Failed to update');
    }
}


let currentPickerTarget = null;
function openWheelPicker(e, assetId, attrName, nestedKey, currentVal, maxVal) {
    e.stopPropagation();
    const picker = document.getElementById('wheelPicker');
    const overlay = document.getElementById('wheelPickerOverlay');
    const list = document.getElementById('wheelPickerList');
    const title = document.getElementById('wheelPickerTitle');

    currentPickerTarget = { assetId, attrName, nestedKey };
    currentPickerValue = currentVal;
    title.textContent = nestedKey;

    let html = '';
    const addRange = () => {
        for (let i = 0; i <= maxVal; i++) {
            html += `<div class="wheel-item" data-value="${i}">${String(i).padStart(2, '0')}</div>`;
        }
    };
    addRange(); addRange(); addRange();
    list.innerHTML = html;

    picker.style.display = 'block';
    overlay.style.display = 'block';

    const itemHeight = 50;
    const middleOffset = (maxVal + 1) * itemHeight;
    list.scrollTop = middleOffset + (currentVal * itemHeight);

    updatePickerSelection(list, currentVal);

    list.onscroll = () => {
        const topLimit = itemHeight * (maxVal + 1) * 0.5;
        const bottomLimit = itemHeight * (maxVal + 1) * 2.5;

        if (list.scrollTop < topLimit) {
            list.scrollTop += (maxVal + 1) * itemHeight;
        } else if (list.scrollTop > bottomLimit) {
            list.scrollTop -= (maxVal + 1) * itemHeight;
        }

        const centeredIdx = Math.round((list.scrollTop - middleOffset) / itemHeight);
        const normalizedIdx = (centeredIdx + (maxVal + 1)) % (maxVal + 1);
        currentPickerValue = normalizedIdx;
        updatePickerSelection(list, normalizedIdx);
    };

    overlay.onclick = closeWheelPicker;
    list.onclick = (event) => {
        const item = event.target.closest('.wheel-item');
        if (item) {
            const val = item.getAttribute('data-value');
            const targetScroll = middleOffset + (val * itemHeight);
            list.scrollTo({ top: targetScroll, behavior: 'smooth' });
        }
    };
}
function updatePickerSelection(list, val) {
    list.querySelectorAll('.wheel-item').forEach(el => {
        if (el.getAttribute('data-value') == val) el.classList.add('selected');
        else el.classList.remove('selected');
    });
}
function closeWheelPicker() {
    document.getElementById('wheelPicker').style.display = 'none';
    document.getElementById('wheelPickerOverlay').style.display = 'none';
}
function confirmWheelSelection() {
    if (currentPickerTarget) {
        // Buffer locally instead of saving immediately
        bufferNestedValue(currentPickerTarget.assetId, currentPickerTarget.attrName, currentPickerTarget.nestedKey, currentPickerValue);
    }
    closeWheelPicker();
}


function toast(msg) {
    const div = document.createElement('div');
    div.textContent = msg;
    div.style.position = 'fixed';
    div.style.bottom = '20px';
    div.style.right = '20px';
    div.style.background = '#333';
    div.style.color = '#fff';
    div.style.padding = '10px 20px';
    div.style.borderRadius = '5px';
    div.style.zIndex = '9999';
    document.body.appendChild(div);
    setTimeout(() => div.remove(), 3000);
}

document.addEventListener('DOMContentLoaded', async () => {
    if (typeof ensureFriendlyNames === 'function') await ensureFriendlyNames();
    loadTimers();
});
