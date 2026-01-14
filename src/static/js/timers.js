const openGroups = new Set();

async function loadTimers() {
    try {
        const res = await fetch('/api/user/assets');
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
            const prefsRes = await fetch('/api/user/preferences');
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

                const sortedKeys = Object.keys(timerAttributes).sort();

                let timersHtml = '';
                for (const key of sortedKeys) {
                    const val = timerAttributes[key];
                    timersHtml += renderEditableTimer(asset.id, key, val, pinnedItems);
                }

                const html = `
                    <div style="margin-bottom:1.5rem; border:1px solid var(--border); border-radius:8px; overflow:hidden;">
                         <div 
                            onclick="toggleAssetGroup('${assetIdClean}')" 
                            style="background:#f8f9fa; padding:1rem 1.5rem; cursor:pointer; display:flex; justify-content:space-between; align-items:center; user-select:none;"
                        >
                            <div style="font-weight:600; font-size:1.1rem; color:#333;">
                                ${asset.name} <span style="color:var(--text-muted; font-weight:400; font-size:0.9rem;) (${Object.keys(timerAttributes).length} Timers)</span>
                            </div>
                            <span id="icon-${assetIdClean}" style="transition:transform 0.2s; transform: ${isOpen ? 'rotate(0deg)' : 'rotate(-90deg)'};">▼</span>
                        </div>
                        <div id="${assetIdClean}" style="display:${isOpen ? 'block' : 'none'}; padding:1rem; background:white;">
                             <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap:1rem;">
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
    let friendlyName = key;
    friendlyName = key.replace(/(\d+)/, ' $1');

    if (typeof val !== 'object' || val === null) {
        return `<div style="padding:1rem; border:1px solid #eee;">${key}: ${val}</div>`;
    }

    const items = val;

    const status = items['Status'] || 'OFF';
    const isActive = String(status).toUpperCase() === 'ON' || String(status).toUpperCase() === 'ACTIVE';
    const activeColor = isActive ? 'var(--primary)' : 'var(--text-muted)';

    const sortedInnerKeys = Object.keys(items).sort((a, b) => {
        return a.localeCompare(b);
    });

    let innerHtml = '';

    innerHtml += `
        <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #eee; padding-bottom:0.5rem; margin-bottom:0.5rem;">
            <div style="font-weight:600; color:#555;">Status</div>
            <div style="display:flex; align-items:center; gap:8px;">
                 <label class="toggle-switch" style="transform:scale(0.8);">
                    <input type="checkbox" ${isActive ? 'checked' : ''} onchange="toggleNestedAttribute('${assetId}', '${key}', 'Status', this.checked)">
                    <span class="slider"></span>
                </label>
                <span style="font-weight:700; color:${activeColor}; font-size:0.9rem; min-width:30px;">${isActive ? 'ON' : 'OFF'}</span>
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

    return `
        <div style="border:1px solid #e0e0e0; border-radius:6px; padding:1rem; background:#fafafa;">
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
            <div onclick="toggleDay('${assetId}', '${attrName}', '${nestedKey}', '${d}')"
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
    const relayOptions = ['r1', 'r2', 'r3', 'r4'];
    const currentOutputs = (val || '').toLowerCase();

    const isActive = (rLabel) => {
        const num = rLabel.replace('r', '');
        const target = `out 0${num}`;
        if (currentOutputs.includes(target) || currentOutputs.includes(rLabel)) return true;
        return currentOutputs.includes(`out ${num}`) || currentOutputs.includes(`out 0${num}`);
    };

    let html = '<div style="display:flex; gap:4px; flex-wrap:wrap;">';
    relayOptions.forEach(r => {
        const active = isActive(r);
        const label = r.replace('r', '');
        html += `
            <div onclick="toggleTimerOutput('${assetId}', '${attrName}', '${nestedKey}', '${r}')"
                title="Switch ${label}"
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

function toggleAssetGroup(id) {
    const el = document.getElementById(id);
    const icon = document.getElementById('icon-' + id);
    if (el.style.display === 'none') {
        el.style.display = 'block';
        icon.style.transform = 'rotate(0deg)';
        openGroups.add(id);
    } else {
        el.style.display = 'none';
        icon.style.transform = 'rotate(-90deg)';
        openGroups.delete(id);
    }
}

async function toggleNestedAttribute(assetId, attrName, nestedKey, newValue) {
    try {
        const res = await fetch(`/api/asset/${assetId}`);
        const asset = await res.json();

        let currentVal = asset.attributes[attrName]?.value || asset.attributes[attrName];
        if (typeof currentVal === 'string') {
            try { currentVal = JSON.parse(currentVal); } catch (e) { }
        }

        if (typeof currentVal === 'object') {
            if (nestedKey === 'Status') {
                currentVal[nestedKey] = newValue ? 'ON' : 'OFF';
            } else {
                currentVal[nestedKey] = newValue;
            }
            await saveAttribute(assetId, attrName, currentVal);
        }
    } catch (e) {
        console.error(e);
        toast('Error updating');
    }
}

async function updateNestedValue(assetId, attrName, nestedKey, newValue) {
    try {
        const res = await fetch(`/api/asset/${assetId}`);
        const asset = await res.json();
        let currentVal = asset.attributes[attrName]?.value || asset.attributes[attrName];
        if (typeof currentVal === 'string') {
            try { currentVal = JSON.parse(currentVal); } catch (e) { }
        }

        if (typeof currentVal === 'object') {
            currentVal[nestedKey] = String(newValue);
            await saveAttribute(assetId, attrName, currentVal);
        }
    } catch (e) {
        console.error(e);
    }
}


async function toggleDay(assetId, attrName, nestedKey, day) {
    try {
        const res = await fetch(`/api/asset/${assetId}`);
        const asset = await res.json();
        let currentVal = asset.attributes[attrName]?.value || asset.attributes[attrName];
        if (typeof currentVal === 'string') {
            try { currentVal = JSON.parse(currentVal); } catch (e) { }
        }

        if (typeof currentVal === 'object') {
            let currentDaysStr = (currentVal[nestedKey] || '').toUpperCase();
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

            currentVal[nestedKey] = newValue;
            await saveAttribute(assetId, attrName, currentVal);
        }
    } catch (e) { console.error(e); }
}

async function toggleTimerOutput(assetId, attrName, nestedKey, relay) {
    try {
        const res = await fetch(`/api/asset/${assetId}`);
        const asset = await res.json();
        let currentVal = asset.attributes[attrName]?.value || asset.attributes[attrName];
        if (typeof currentVal === 'string') {
            try { currentVal = JSON.parse(currentVal); } catch (e) { }
        }

        if (typeof currentVal === 'object') {
            let currentOutputsStr = (currentVal[nestedKey] || '').toUpperCase();

            const mapOutToR = (str) => {
                const parts = str.split(',').map(s => s.trim());
                return parts.map(p => {
                    if (p.startsWith('OUT')) {
                        const num = parseInt(p.replace('OUT', '').trim());
                        return `r\${num}`;
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
                    return `OUT \${String(num).padStart(2, '0')}`;
                });
            };

            currentVal[nestedKey] = mapRToOut(sorted).join(',');
            await saveAttribute(assetId, attrName, currentVal);
        }
    } catch (e) { console.error(e); }
}


async function saveAttribute(assetId, attrName, value) {
    const res = await fetch(`/api/asset/${assetId}/attribute/${attrName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: value })
    });
    const data = await res.json();
    if (data.status === 'success') {
        toast('Updated');
        loadTimers();
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
            html += `<div class="wheel-item" data-value="\${i}">\${String(i).padStart(2, '0')}</div>`;
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
        updateNestedValue(currentPickerTarget.assetId, currentPickerTarget.attrName, currentPickerTarget.nestedKey, currentPickerValue);
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

document.addEventListener('DOMContentLoaded', loadTimers);
