// Dashboard JS - Handles Overview, Switches, Sensors, and Timers sections

// --- Main Entry Point ---
async function loadDashboard() {
    try {
        const res = await fetch(`/api/user/assets?t=${Date.now()}`);
        const data = await res.json();
        const assets = Array.isArray(data) ? data : (data.assets || []);

        // Overview Stats
        document.getElementById('totalAssets').textContent = assets.length;

        let online = 0;
        let offline = 0;
        const now = Date.now();

        assets.forEach(a => {
            if (a.lastActivityTimestamp) {
                const diffMinutes = (now - a.lastActivityTimestamp) / (1000 * 60);
                if (diffMinutes <= 1.0) {
                    online++;
                } else {
                    offline++;
                }
            } else {
                offline++;
            }
        });

        document.getElementById('onlineDevices').textContent = online;
        document.getElementById('offlineDevices').textContent = offline;

        // Rules Count
        let totalRules = 0;
        assets.forEach(a => {
            const storedRules = localStorage.getItem(`rules_${a.id}`);
            if (storedRules) {
                try {
                    totalRules += JSON.parse(storedRules).length;
                } catch (e) { }
            }
        });
        document.getElementById('activeRules').textContent = totalRules;

        // Load Fixed Sections
        loadSwitches(assets);

        // Load User-Pinnable Sections
        loadWidgets(assets);

    } catch (e) {
        console.error('Failed to load dashboard:', e);
    }
}

// --- Fixed Section: Switches (RelayData) ---
async function loadSwitches(assets) {
    const container = document.getElementById('switchesContainer');
    if (!container) return;

    let html = '';

    for (const asset of assets) {
        const relayData = asset.attributes?.RelayData;
        if (relayData && typeof relayData === 'object') {
            html += renderSwitchCard(asset.name, asset.id, relayData);
        }
    }

    if (html === '') {
        container.innerHTML = '<div class="empty-placeholder">No switches available.</div>';
    } else {
        container.innerHTML = html;
    }
}

function renderSwitchCard(assetName, assetId, relayData) {
    const keys = Object.keys(relayData).sort();
    let switchesHtml = '<div class="switch-grid">';

    keys.forEach(k => {
        const boolVal = toBool(relayData[k]);
        const storedName = localStorage.getItem(`switch_name_${assetId}_${k}`) || getFriendlyLabel(k);
        // Escape quotes to prevent syntax errors in inline handlers
        const safeAssetId = assetId.replace(/'/g, "\\'");
        const safeKey = k.replace(/'/g, "\\'");

        switchesHtml += `
            <div class="switch-item ${boolVal ? 'switch-on' : 'switch-off'}">
                <div class="switch-info-col">
                    <div class="switch-label">${storedName}</div>
                    <span class="switch-rename-btn" onclick="renameSwitch('${safeAssetId}', '${safeKey}')">RENAME</span>
                </div>
                <div class="switch-toggle-col">
                    <label class="toggle-switch">
                        <input type="checkbox" ${boolVal ? 'checked' : ''} onchange="toggleSwitch('${safeAssetId}', '${safeKey}', this.checked)">
                        <span class="slider"></span>
                    </label>
                </div>
            </div>
        `;
    });

    switchesHtml += '</div>';

    return `
        <div class="widget-card" style="width:100%;">
             <div class="widget-card-header" style="font-size:1rem; border-bottom:1px solid #f0f0f0; margin-bottom:1rem; padding-bottom:0.5rem;">${assetName}</div>
            ${switchesHtml}
        </div>
    `;
}

async function toggleSwitch(assetId, key, newValue) {
    console.log(`[Dashboard] Toggling switch: ${assetId} / ${key} -> ${newValue}`);
    try {
        const res = await fetch(`/api/asset/${assetId}`);
        if (!res.ok) throw new Error(`Failed to fetch asset: ${res.status}`);

        const asset = await res.json();
        let relayData = asset.attributes?.RelayData || {};

        // Ensure relayData is an object
        if (typeof relayData === 'string') {
            try {
                relayData = JSON.parse(relayData);
            } catch (e) {
                console.error('[Dashboard] Error parsing RelayData string:', e);
                relayData = {};
            }
        }

        // Use dictionary directly
        relayData[key] = newValue;

        console.log('[Dashboard] Sending updated RelayData:', relayData);

        const updateRes = await fetch(`/api/asset/${assetId}/attribute/RelayData`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ value: relayData })
        });

        if (!updateRes.ok) throw new Error(`Failed to update attribute: ${updateRes.status}`);

        toast(`${key} turned ${newValue ? 'ON' : 'OFF'}`);
    } catch (e) {
        toast('Failed to toggle switch');
        console.error('[Dashboard] Toggle error:', e);
        // Revert UI if needed (optional, implemented by simple reload or direct manipulation)
        // For now, alerting user via toast is sufficient
    }
}

function renameSwitch(assetId, key) {
    const currentName = localStorage.getItem(`switch_name_${assetId}_${key}`) || getFriendlyLabel(key);
    const newName = prompt('Enter new name for this switch:', currentName);
    if (newName && newName.trim()) {
        localStorage.setItem(`switch_name_${assetId}_${key}`, newName.trim());
        toast('Switch renamed');
        loadDashboard(); // Reload to show updated name
    }
}

// --- User-Pinnable Section: Sensors & Timers ---
async function loadWidgets(assets = []) {
    const sensorsContainer = document.getElementById('sensorsContainer');
    const timersContainer = document.getElementById('timersContainer');
    const rulesContainer = document.getElementById('rulesContainer');

    try {
        const res = await fetch(`/api/user/dashboard/widgets?t=${Date.now()}`);
        let widgets = await res.json();

        // Apply local overrides for names
        widgets = widgets.map(w => {
            const localName = localStorage.getItem(`widget_name_${w.id}`);
            if (localName) w.displayName = localName;
            return w;
        });

        // Filter out RelayData and Thresholds
        widgets = widgets.filter(w =>
            !w.attributeName.toLowerCase().includes('threshold') &&
            !w.attributeName.toLowerCase().includes('relaydata') &&
            !(w.displayName && w.displayName.toLowerCase().includes('threshold'))
        );

        const sensors = widgets.filter(w => {
            const attr = w.attributeName.toLowerCase();
            return attr === 'envdata' || attr === 'moisturedata' || attr === 'npkdata';
        });

        const timers = widgets.filter(w => w.attributeName.toLowerCase().startsWith('timer'));
        const rules = widgets.filter(w => w.attributeName.toLowerCase() === 'ruletargets');

        // Render Sensors
        if (sensors.length === 0) {
            sensorsContainer.innerHTML = '<div class="empty-placeholder">No sensors pinned. Go to Device Details to pin some!</div>';
        } else {
            sensorsContainer.innerHTML = sensors.map(w => renderSensorCard(w)).join('');
        }

        // Render Timers
        if (timers.length === 0) {
            timersContainer.innerHTML = '<div class="empty-placeholder">No timers pinned. Go to Device Details to pin some!</div>';
        } else {
            timersContainer.innerHTML = timers.map(w => renderTimerCard(w)).join('');
        }

        // Render Rules
        if (rulesContainer) { // Ensure container exists
            if (rules.length === 0) {
                rulesContainer.innerHTML = '<div class="empty-placeholder">No rules pinned. Go to Device Details to pin some!</div>';
            } else {
                rulesContainer.innerHTML = rules.map(w => {
                    const asset = assets.find(a => a.id === w.assetId);
                    return renderRuleCard(w, asset ? asset.attributes : null);
                }).join('');
            }
        }

    } catch (e) {
        console.error('Failed to load widgets:', e);
        if (sensorsContainer) sensorsContainer.innerHTML = '<div class="empty-placeholder">Failed to load sensors.</div>';
        if (timersContainer) timersContainer.innerHTML = '<div class="empty-placeholder">Failed to load timers.</div>';
        if (rulesContainer) rulesContainer.innerHTML = '<div class="empty-placeholder">Failed to load rules.</div>';
    }
}

function renderSensorCard(w) {
    const attr = w.attributeName.toLowerCase();
    if (attr === 'npkdata') return renderNPKCard(w);
    if (attr === 'envdata') return renderEnvCard(w);
    if (attr === 'moisturedata') return renderMoistureCard(w);
    if (attr === 'ruletargets') return renderRuleCard(w);
    return renderGenericCard(w);
}

// --- Specialized Renderers ---

function renderNPKCard(w) {
    if (!w.value || typeof w.value !== 'object') return renderGenericCard(w);

    const keys = Object.keys(w.value);
    const zones = {};

    keys.forEach(k => {
        const match = k.match(/([a-zA-Z]+)(\d+)/);
        if (match) {
            const idx = match[2];
            if (!zones[idx]) zones[idx] = [];
            zones[idx].push({ k, v: w.value[k] });
        } else {
            if (!zones['Other']) zones['Other'] = [];
            zones['Other'].push({ k, v: w.value[k] });
        }
    });

    const sortedZones = Object.keys(zones).sort();
    let content = '<div class="npk-zones">';

    sortedZones.forEach(zone => {
        const sortOrder = ['m', 't', 'ec', 'ph', 'n', 'p', 'k'];
        const items = zones[zone];
        items.sort((a, b) => {
            const pA = a.k.replace(/[0-9]/g, '').toLowerCase();
            const pB = b.k.replace(/[0-9]/g, '').toLowerCase();
            return sortOrder.indexOf(pA) - sortOrder.indexOf(pB);
        });

        const zoneLabel = zone === 'Other' ? 'General' : `Zone ${parseInt(zone)}`;

        content += `<div class="npk-zone">
            <div class="npk-zone-label">${zoneLabel}</div>
            <div class="npk-metrics">`;

        items.forEach(item => {
            let label = getFriendlyLabel(item.k).replace(/NPK\s+/i, '').replace(/\s+\d+$/, '');
            if (label.toLowerCase().includes('moisture')) label = 'Moist';
            if (label.toLowerCase().includes('temp')) label = 'Temp';
            if (label.toLowerCase().includes('nitrogen')) label = 'N';
            if (label.toLowerCase().includes('phosphorus')) label = 'P';
            if (label.toLowerCase().includes('potassium')) label = 'K';

            content += `<div class="npk-metric">
                <div class="metric-label">${label}</div>
                <div class="metric-value">${item.v === '' ? '-' : item.v}</div>
            </div>`;
        });

        content += '</div></div>';
    });

    content += '</div>';
    return wrapWidgetCard(w, 'NPK Sensor Data', content);
}

function renderRuleCard(w, assetAttributes = null) {
    let rulesList = [];
    if (w.value && typeof w.value === 'object') {
        rulesList = Object.entries(w.value);
    }

    let content;
    if (rulesList.length === 0) {
        content = '<div style="color:#999; font-style:italic; padding:1rem;">No active rule targets</div>';
    } else {
        content = `<div style="padding:1rem; display:flex; flex-direction:column; gap:0.5rem;">`;

        rulesList.forEach(([ruleKey, ruleRaw]) => {
            // Parse logic (inlined for dashboard.js context)
            let parsed = null;
            if (ruleRaw && typeof ruleRaw === 'string') {
                const parts = ruleRaw.split(':');
                if (parts.length >= 4) {
                    const opMap = { '<': 'Less Than', '>': 'Greater Than', '==': 'Equal To', '!=': 'Not' };
                    parsed = {
                        op: opMap[parts[0]] || parts[0],
                        codeOp: parts[0],
                        threshold: parseFloat(parts[1]),
                        targetName: getFriendlyLabel(parts[2]),
                        targetVal: parts[3] === '1' ? 'ON' : 'OFF',
                        ruleName: parts.length > 4 ? parts[4] : null
                    };
                }
            }

            if (parsed) {
                // Extract sensor key from ruleKey
                const sensorKey = ruleKey.split('_')[0]; // Simple split on first underscore part
                const sensorName = getFriendlyLabel(sensorKey);

                // Determine if rule is active
                let isActive = false;
                let currentVal = null;
                if (assetAttributes) {
                    // Try to find sensor value in EnvData, MoistureData, NPKData
                    const sensorBags = ['EnvData', 'MoistureData', 'NPKData'];
                    for (const bag of sensorBags) {
                        if (assetAttributes[bag] && typeof assetAttributes[bag] === 'object') {
                            if (assetAttributes[bag][sensorKey] !== undefined) {
                                currentVal = parseFloat(assetAttributes[bag][sensorKey]);
                                break;
                            }
                        }
                    }
                }

                if (currentVal !== null && !isNaN(currentVal)) {
                    switch (parsed.codeOp) {
                        case '>': isActive = currentVal > parsed.threshold; break;
                        case '<': isActive = currentVal < parsed.threshold; break;
                        case '==': isActive = currentVal == parsed.threshold; break;
                        case '!=': isActive = currentVal != parsed.threshold; break;
                    }
                }

                // Use custom name if available, else friendlify key
                const displayTitle = parsed.ruleName || getFriendlyLabel(ruleKey);

                // Operator Colors
                const opColors = {
                    'Greater Than': '#e67e22', // Orange
                    'Less Than': '#3498db',    // Blue
                    'Equal To': '#2ecc71',     // Green
                    'Not': '#e74c3c'           // Red
                };
                const opColor = opColors[parsed.op] || '#8e44ad';

                // Switch Colors 
                const switchColors = ['#9b59b6', '#d35400', '#009688', '#e91e63', '#795548', '#2c3e50', '#16a085', '#5f27cd'];
                const getSwitchColor = (str) => {
                    let hash = 0;
                    for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
                    return switchColors[Math.abs(hash) % switchColors.length];
                };
                const switchColor = getSwitchColor(parsed.targetName);

                // Styling for active state
                const activeStyle = isActive
                    ? `border-left: 6px solid #2ecc71; background: #e8f8f5; box-shadow: 0 4px 6px rgba(46, 204, 113, 0.2); transform: scale(1.02);`
                    : `border-left: 4px solid var(--primary); background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,0.05);`;

                const activeIndicator = isActive
                    ? `<span style="float:right; font-size:0.7rem; background:#2ecc71; color:white; padding:2px 6px; border-radius:4px; font-weight:bold;">ACTIVE</span>`
                    : ``;

                content += `
                    <div style="${activeStyle} padding:0.75rem; border-radius:4px; font-size:0.9rem; color:#444; transition: all 0.3s ease;">
                        <div style="font-weight:700; color:${isActive ? '#27ae60' : '#999'}; margin-bottom:4px; text-transform:uppercase; font-size:0.65rem; letter-spacing:0.5px;">
                            ${displayTitle} ${activeIndicator}
                        </div>
                        <div style="line-height:1.5;">
                            <span style="font-weight:bold; color:#555;">If</span> 
                            <span style="color:#2980b9; font-weight:700;">${sensorName}</span> 
                            <span style="color:#555;">is</span> 
                            <span style="color:${opColor}; font-weight:800;">${parsed.op}</span> 
                            <span style="color:#c0392b; font-weight:700;">${parsed.threshold}</span>,
                            <br>
                            <span style="font-weight:bold; color:#555;">Set</span> 
                            <span style="color:${switchColor}; font-weight:700;">${parsed.targetName}</span> 
                            <span style="color:#555;">to</span> 
                            <span style="color:${parsed.targetVal === 'ON' ? '#27ae60' : '#c0392b'}; font-weight:700;">${parsed.targetVal}</span>
                        </div>
                    </div>
                 `;
            } else {
                content += `<div style="background:#eee; padding:0.5rem; border-radius:4px; font-size:0.8rem; color:#666;">${ruleKey}: ${ruleRaw}</div>`;
            }
        });

        content += `</div>`;
    }

    return wrapWidgetCard(w, w.assetName || 'Rule Targets', content);
}


function renderEnvCard(w) {
    if (!w.value || typeof w.value !== 'object') return renderGenericCard(w);

    const keys = Object.keys(w.value).sort();
    let content = '<div class="sensor-grid">';

    keys.forEach(k => {
        content += `<div class="sensor-item">
            <span class="sensor-label">${getFriendlyLabel(k)}</span>
            <span class="sensor-value">${w.value[k] === '' ? '-' : w.value[k]}</span>
        </div>`;
    });

    content += '</div>';
    return wrapWidgetCard(w, 'Environment', content);
}

function renderMoistureCard(w) {
    if (!w.value || typeof w.value !== 'object') return renderGenericCard(w);

    const keys = Object.keys(w.value).sort();
    let content = '<div class="sensor-grid">';

    keys.forEach(k => {
        content += `<div class="sensor-item">
            <span class="sensor-label">${getFriendlyLabel(k)}</span>
            <span class="sensor-value">${w.value[k] === '' ? '-' : w.value[k]}</span>
        </div>`;
    });

    content += '</div>';
    return wrapWidgetCard(w, 'Moisture Levels', content);
}

function renderTimerCard(w) {
    // Basic Timer display, similar to generic for now
    if (!w.value || typeof w.value !== 'object') return renderGenericCard(w);

    // Check for Status
    let status = w.value['Status'] || 'Unknown';
    if (typeof status === 'string') status = status.toUpperCase();
    const isActive = status === 'ACTIVE' || status === 'ON';

    // Build mini summary
    let content = `
        <div style="padding:1rem; display:flex; flex-direction:column; gap:0.5rem;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <span style="font-weight:600; color:#555;">Status</span>
                <span style="font-weight:700; color:${isActive ? 'var(--success)' : '#999'}">${isActive ? 'ACTIVE' : 'INACTIVE'}</span>
            </div>
    `;

    // Show schedule summary
    if (w.value['OnHour'] !== undefined && w.value['OffHour'] !== undefined) {
        const onTime = `${String(w.value['OnHour']).padStart(2, '0')}:${String(w.value['OnMinute'] || 0).padStart(2, '0')}`;
        const offTime = `${String(w.value['OffHour']).padStart(2, '0')}:${String(w.value['OffMinute'] || 0).padStart(2, '0')}`;

        content += `
            <div style="display:flex; justify-content:space-between; border-top:1px solid #eee; padding-top:0.5rem; margin-top:0.25rem;">
                <div style="text-align:center;">
                    <div style="font-size:0.7rem; color:#999;">START</div>
                    <div style="font-weight:700; color:#333;">${onTime}</div>
                </div>
                <div style="text-align:center;">
                    <div style="font-size:0.7rem; color:#999;">END</div>
                    <div style="font-weight:700; color:#333;">${offTime}</div>
                </div>
            </div>
        `;
    }

    content += '</div>';

    // Show Days
    if (w.value['Days']) {
        content += `
            <div style="padding:0 1rem 1rem 1rem;">
                <div style="font-size:0.7rem; color:#999; margin-bottom:2px;">DAYS</div>
                <div style="font-size:0.85rem; color:#333; font-weight:600;">${w.value['Days']}</div>
            </div>
         `;
    }

    // Show Outputs
    if (w.value['Outputs']) {
        // Clean up output string "OUT 01, OUT 02" -> "1, 2"
        let outStr = w.value['Outputs'].replace(/OUT\s0?/g, '');
        content += `
            <div style="padding:0 1rem 1rem 1rem;">
                <div style="font-size:0.7rem; color:#999; margin-bottom:2px;">SWITCHES</div>
                <div style="font-size:0.85rem; color:#333; font-weight:600;">${outStr}</div>
            </div>
         `;
    }

    content += '</div>';
    return wrapWidgetCard(w, w.displayName || 'Timer', content);
}

function renderGenericCard(w) {
    let content = '<div class="generic-content">';
    if (typeof w.value === 'object' && w.value !== null) {
        content += '<pre>' + JSON.stringify(w.value, null, 2) + '</pre>';
    } else {
        content += `<div>${w.value}</div>`;
    }
    content += '</div>';
    return wrapWidgetCard(w, w.displayName || w.attributeName, content);
}

function wrapWidgetCard(w, title, contentHtml) {
    const isFixed = !w.id; // If no widget ID, it's likely a fixed card or handled differently (but our API widgets always have ID if from DB)
    // Actually, w object comes from API, so it has .id (the db id of the widget)
    // w: { id, assetId, attributeName, ... }

    const isRuleParams = w.attributeName && w.attributeName === 'RuleTargets';

    return `
        <div class="widget-card">
            <div class="widget-card-header" style="display:flex; justify-content:space-between; align-items:center;">
                <span>${title}</span>
                <div style="display:flex; gap:8px;">
                    ${!isRuleParams ? `<span onclick="renameWidget('${w.id}', '${title.replace(/'/g, "\\'")}')" style="cursor:pointer; color:#777; font-size:0.8rem; font-weight:600;">RENAME</span>` : ''}
                    <span onclick="unpinWidget('${w.id}')" style="cursor:pointer; color:#999; font-weight:bold;">✕</span>
                </div>
            </div>
            ${contentHtml}
        </div>
    `;
}

// Widget Actions

async function unpinWidget(widgetId) {
    if (!confirm('Remove this widget from dashboard?')) return;
    try {
        const res = await fetch(`/api/user/dashboard/widgets/${widgetId}`, { method: 'DELETE' });
        if (res.ok) {
            toast('Widget removed');
            loadWidgets();
        } else {
            toast('Failed to remove widget');
        }
    } catch (e) {
        console.error(e);
    }
}

async function renameWidget(widgetId, currentName) {
    const newName = prompt('Enter new name for widget:', currentName);
    if (newName && newName.trim()) {
        try {

            localStorage.setItem(`widget_name_${widgetId}`, newName.trim());

            toast('Widget renamed');
            loadWidgets();
        } catch (e) {
            console.error(e);
        }
    }
}

// Utils
function getFriendlyLabel(key) {
    // Try to get from global friendly names loaded in main.js
    const names = window.friendlyNames || {};
    if (names.keys && names.keys[key]) {
        return names.keys[key];
    }
    if (names.attributes && names.attributes[key]) {
        return names.attributes[key];
    }

    // Fallback patterns (Temperature, Humidity, Moisture, Switch)
    if (/^t(\d+)?$/i.test(key)) return key.replace(/t/i, 'Temperature');
    if (/^h(\d+)?$/i.test(key)) return key.replace(/h/i, 'Humidity');
    if (/^m(\d+)?$/i.test(key)) return key.replace(/m/i, 'Moisture');
    if (/^r(\d+)?$/i.test(key)) return key.replace(/r/i, 'Switch');

    // Very basic fallback
    return key.replace(/([A-Z])/g, ' $1').trim();
}

function toBool(val) {
    if (typeof val === 'boolean') return val;
    if (typeof val === 'string') return val.toLowerCase() === 'true' || val === '1' || val === 'on';
    if (typeof val === 'number') return val === 1;
    return false;
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

// Init
// Init
document.addEventListener('DOMContentLoaded', () => {
    loadDashboard();
    // Auto-update every 1 second
    setInterval(loadDashboard, 1000);
});
