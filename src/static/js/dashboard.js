const recentToggles = {};
const clearedAssets = new Set();

async function loadDashboard() {
    try {
        const res = await fetch(`${APP_PREFIX}/api/user/assets?t=${Date.now()}`);
        const data = await res.json();
        const assets = Array.isArray(data) ? data : (data.assets || []);

        document.getElementById('totalAssets').textContent = assets.length;

        let online = 0;
        let offline = 0;
        // eslint-disable-next-line
        const now = Date.now();

        assets.forEach(a => {
            const status = getAssetStatus(a.lastActivityTimestamp);
            if (status.isOffline) {
                offline++;
            } else {
                online++;
            }
        });

        document.getElementById('onlineDevices').textContent = online;
        document.getElementById('offlineDevices').textContent = offline;

        let totalRules = 0;
        assets.forEach(a => {
            const ruleTargets = a.attributes?.RuleTargets;
            if (ruleTargets && typeof ruleTargets === 'object') {
                // Count only real rule keys, skip metadata keys starting with '_'
                totalRules += Object.keys(ruleTargets).filter(k => !k.startsWith('_')).length;
            }
        });
        document.getElementById('activeRules').textContent = totalRules;

        loadSwitches(assets);
        loadWidgets(assets);
        // handleOfflineClearing(assets); // Disabled: Keep last known values and timestamp when offline

    } catch (e) {
        console.error('Failed to load dashboard:', e);
    }
}

async function handleOfflineClearing(assets) {
    for (const asset of assets) {
        const status = getAssetStatus(asset.lastActivityTimestamp);
        if (status.isOffline) {
            if (!clearedAssets.has(asset.id)) {
                await autoClearSensors(asset);
                clearedAssets.add(asset.id);
            }
        } else {
            // Back online, allow clearing again next time it goes offline
            clearedAssets.delete(asset.id);
        }
    }
}

async function autoClearSensors(asset) {
    const sensorAttrs = ['EnvData', 'MoistureData', 'NPKData'];
    for (const attrName of sensorAttrs) {
        let val = asset.attributes?.[attrName];
        if (!val) continue;

        if (typeof val === 'string') {
            try { val = JSON.parse(val); } catch (e) { continue; }
        }

        if (typeof val === 'object' && val !== null) {
            const cleared = {};
            let hasData = false;
            for (const k in val) {
                if (val[k] !== null && val[k] !== '--' && val[k] !== '') {
                    hasData = true;
                }
                cleared[k] = '--';
            }

            if (hasData) {
                console.log(`[Dashboard] Auto-clearing ${attrName} for offline asset ${asset.id}`);
                try {
                    await fetch(`${APP_PREFIX}/api/asset/${asset.id}/attribute/${attrName}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ value: cleared })
                    });
                } catch (e) {
                    console.error(`[Dashboard] Failed to auto-clear ${attrName}:`, e);
                }
            }
        }
    }
}

async function loadSwitches(assets) {
    const container = document.getElementById('switchesContainer');
    if (!container) return;

    let html = '';

    for (const asset of assets) {
        const relayData = asset.attributes?.RelayData;
        const valveState = asset.attributes?.ValveState;
        if (relayData && typeof relayData === 'object') {
            const status = getAssetStatus(asset.lastActivityTimestamp);
            html += renderSwitchCard(asset.name, asset.id, relayData, status.isOffline);
        }
        if (valveState !== undefined) {
            const status = getAssetStatus(asset.lastActivityTimestamp);
            html += renderValveCard(asset.name, asset.id, valveState, status.isOffline);
        }
    }

    if (html === '') {
        container.innerHTML = '<div class="empty-placeholder">No switches available.</div>';
    } else {
        container.innerHTML = html;
    }
}

function renderSwitchCard(assetName, assetId, relayData, isIdle = false) {
    const keys = Object.keys(relayData).sort();
    let switchesHtml = '<div class="switch-grid">';

    keys.forEach(k => {
        const toggleKey = `${assetId}_${k}`;
        const isRecent = recentToggles[toggleKey] && (Date.now() - recentToggles[toggleKey] < 5000);
        const boolVal = isRecent ? recentToggles[`${toggleKey}_val`] : toBool(relayData[k]);
        const storedName = localStorage.getItem(`switch_name_${assetId}_${k}`) || getFriendlyLabel(k);
        const safeAssetId = assetId.replace(/'/g, "\\'");
        const safeKey = k.replace(/'/g, "\\'");

        switchesHtml += `
            <div class="switch-item ${boolVal ? 'switch-on' : 'switch-off'} ${isIdle ? 'idle' : ''}">
                <div class="switch-info-col">
                    <div class="switch-label">${storedName}</div>
                    <span class="switch-rename-btn" onclick="renameSwitch('${safeAssetId}', '${safeKey}')">RENAME</span>
                </div>
                <div class="switch-toggle-col">
                    <label class="toggle-switch">
                        <input type="checkbox" ${boolVal ? 'checked' : ''} ${isIdle ? 'disabled' : ''} onchange="toggleSwitch('${safeAssetId}', '${safeKey}', this.checked)">
                        <span class="slider"></span>
                    </label>
                </div>
            </div>
        `;
    });

    switchesHtml += '</div>';

    return `
        <div class="switch-card-wrapper" data-asset-id="${assetId}">
            <div class="switch-loading-layer"></div>
            <div class="widget-card" style="width:100%;">
                 <div class="widget-card-header" style="font-size:1rem; border-bottom:1px solid #f0f0f0; margin-bottom:1rem; padding-bottom:0.5rem;">${assetName}</div>
                ${switchesHtml}
            </div>
        </div>
    `;
}

async function toggleSwitch(assetId, key, newValue) {
    console.log(`[Dashboard] Toggling switch: ${assetId} / ${key} -> ${newValue}`);

    // Frosted-overlay lock: prevent spamming
    const wrapper = document.querySelector(`.switch-card-wrapper[data-asset-id="${assetId}"]`);
    if (wrapper) {
        if (wrapper.classList.contains('locked')) {
            // Card is still locked, revert the checkbox and bail out
            const cb = wrapper.querySelector(`input[onchange*="'${key}'"]`);
            if (cb) cb.checked = !newValue;
            return;
        }
        // Lock the card and (re)start the overlay animation
        wrapper.classList.add('locked');
        const layer = wrapper.querySelector('.switch-loading-layer');
        if (layer) {
            layer.style.animation = 'none';
            void layer.offsetWidth;          // force reflow
            layer.style.animation = '';
        }
        setTimeout(() => { wrapper.classList.remove('locked'); }, 1500);
    }

    try {
        const res = await fetch(`${APP_PREFIX}/api/asset/${assetId}`);
        if (!res.ok) throw new Error(`Failed to fetch asset: ${res.status}`);

        const asset = await res.json();
        let relayData = asset.attributes?.RelayData || {};

        if (typeof relayData === 'string') {
            try {
                relayData = JSON.parse(relayData);
            } catch (e) {
                console.error('[Dashboard] Error parsing RelayData string:', e);
                relayData = {};
            }
        }

        relayData[key] = newValue;

        // UI cooldown: prevent poll from reverting this toggle for 5s
        const toggleKey = `${assetId}_${key}`;
        recentToggles[toggleKey] = Date.now();
        recentToggles[`${toggleKey}_val`] = newValue;
        setTimeout(() => { delete recentToggles[toggleKey]; delete recentToggles[`${toggleKey}_val`]; }, 5000);

        console.log('[Dashboard] Sending updated RelayData:', relayData);

        const updateRes = await fetch(`${APP_PREFIX}/api/asset/${assetId}/attribute/RelayData`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ value: relayData })
        });

        if (!updateRes.ok) throw new Error(`Failed to update attribute: ${updateRes.status}`);

        toast(`${key} turned ${newValue ? 'ON' : 'OFF'}`);
    } catch (e) {
        toast('Failed to toggle switch');
        console.error('[Dashboard] Toggle error:', e);
    }
}

function renameSwitch(assetId, key) {
    const currentName = localStorage.getItem(`switch_name_${assetId}_${key}`) || getFriendlyLabel(key);
    const newName = prompt('Enter new name for this switch:', currentName);
    if (newName && newName.trim()) {
        localStorage.setItem(`switch_name_${assetId}_${key}`, newName.trim());
        toast('Switch renamed');
        loadDashboard();
    }
}

function renderValveCard(assetName, assetId, valveState, isIdle = false) {
    const toggleKey = `${assetId}_ValveState`;
    const isRecent = recentToggles[toggleKey] && (Date.now() - recentToggles[toggleKey] < 5000);
    const boolVal = isRecent ? recentToggles[`${toggleKey}_val`] : toBool(valveState);
    const storedName = localStorage.getItem(`switch_name_${assetId}_ValveState`) || 'Valve';
    const safeAssetId = assetId.replace(/'/g, "\\'");

    return `
        <div class="switch-card-wrapper" data-asset-id="${assetId}">
            <div class="switch-loading-layer"></div>
            <div class="widget-card" style="width:100%;">
                <div class="widget-card-header" style="font-size:1rem; border-bottom:1px solid #f0f0f0; margin-bottom:1rem; padding-bottom:0.5rem;">${assetName}</div>
                <div class="switch-grid">
                    <div class="switch-item ${boolVal ? 'switch-on' : 'switch-off'} ${isIdle ? 'idle' : ''}">
                        <div class="switch-info-col">
                            <div class="switch-label">${storedName}</div>
                            <span class="switch-rename-btn" onclick="renameSwitch('${safeAssetId}', 'ValveState')">RENAME</span>
                        </div>
                        <div class="switch-toggle-col">
                            <label class="toggle-switch">
                                <input type="checkbox" ${boolVal ? 'checked' : ''} ${isIdle ? 'disabled' : ''} onchange="toggleValve('${safeAssetId}', this.checked)">
                                <span class="slider"></span>
                            </label>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
}

async function toggleValve(assetId, newValue) {
    console.log(`[Dashboard] Toggling valve: ${assetId} -> ${newValue}`);

    const wrapper = document.querySelector(`.switch-card-wrapper[data-asset-id="${assetId}"]`);
    if (wrapper) {
        if (wrapper.classList.contains('locked')) {
            const cb = wrapper.querySelector('input[onchange*="toggleValve"]');
            if (cb) cb.checked = !newValue;
            return;
        }
        wrapper.classList.add('locked');
        const layer = wrapper.querySelector('.switch-loading-layer');
        if (layer) {
            layer.style.animation = 'none';
            void layer.offsetWidth;
            layer.style.animation = '';
        }
        setTimeout(() => { wrapper.classList.remove('locked'); }, 1500);
    }

    try {
        const toggleKey = `${assetId}_ValveState`;
        recentToggles[toggleKey] = Date.now();
        recentToggles[`${toggleKey}_val`] = newValue;
        setTimeout(() => { delete recentToggles[toggleKey]; delete recentToggles[`${toggleKey}_val`]; }, 5000);

        console.log('[Dashboard] Sending ValveState:', newValue);

        const updateRes = await fetch(`${APP_PREFIX}/api/asset/${assetId}/attribute/ValveState`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ value: newValue })
        });

        if (!updateRes.ok) throw new Error(`Failed to update attribute: ${updateRes.status}`);

        toast(`Valve turned ${newValue ? 'ON' : 'OFF'}`);
    } catch (e) {
        toast('Failed to toggle valve');
        console.error('[Dashboard] Valve toggle error:', e);
    }
}

async function loadWidgets(assets = []) {
    const sensorsContainer = document.getElementById('sensorsContainer');
    const timersContainer = document.getElementById('timersContainer');
    const rulesContainer = document.getElementById('rulesContainer');

    try {
        const res = await fetch(`${APP_PREFIX}/api/user/dashboard/widgets?t=${Date.now()}`);
        let widgets = await res.json();

        widgets.forEach(w => {
            if (!w.id) w.id = `${w.assetId}_${w.attributeName}_${w.key || ''}`;
        });

        widgets = widgets.map(w => {
            const localName = localStorage.getItem(`widget_name_${w.id}`);
            if (localName) w.displayName = localName;
            return w;
        });

        widgets = widgets.filter(w =>
            !w.attributeName.toLowerCase().includes('threshold') &&
            !w.attributeName.toLowerCase().includes('relaydata') &&
            !w.attributeName.toLowerCase().includes('systemdata') &&
            !(w.displayName && w.displayName.toLowerCase().includes('threshold'))
        );

        const sensors = widgets.filter(w => {
            const attr = w.attributeName.toLowerCase();
            return attr === 'envdata' || attr === 'moisturedata' || attr === 'npkdata';
        });

        const timers = widgets.filter(w => w.attributeName.toLowerCase().startsWith('timer'));
        const rules = widgets.filter(w => w.attributeName.toLowerCase() === 'ruletargets');

        if (sensors.length === 0) {
            sensorsContainer.innerHTML = '<div class="empty-placeholder">No sensors pinned. Go to Device Details to pin some!</div>';
        } else {
            sensorsContainer.innerHTML = sensors.map(w => {
                const asset = assets.find(a => a.id === w.assetId);
                const isOffline = asset ? getAssetStatus(asset.lastActivityTimestamp).isOffline : false;
                return renderSensorCard(w, isOffline, assets);
            }).join('');
        }

        // ── Timers Rendering (Highlights + Device Groups) ──
        const timerHighlightsSection = document.getElementById('timerHighlightsSection');
        const timerHighlightsGrid = document.getElementById('timerHighlightsGrid');
        const timerDeviceGroups = document.getElementById('timerDeviceGroups');
        const timerEmptyState = document.getElementById('timerEmptyState');
        
        if (timers.length === 0) {
            timerHighlightsSection.style.display = 'none';
            timerDeviceGroups.innerHTML = '';
            timerEmptyState.style.display = 'block';
        } else {
            timerEmptyState.style.display = 'none';
            
            // Fetch highlighted timer keys
            let highlightedKeys = [];
            try {
                const hlRes = await fetch(`${APP_PREFIX}/api/user/preferences/highlights`);
                highlightedKeys = await hlRes.json();
            } catch (e) { console.error('Failed to load highlights', e); }

            // Split into Highlights and Groups
            const highlightHtmls = [];
            const deviceGroups = {}; // { assetId: { name: '', htmls: [] } }

            timers.forEach(w => {
                const asset = assets.find(a => a.id === w.assetId);
                const assetName = asset ? asset.name : (w.assetName || 'Unknown Device');
                const isOffline = asset ? getAssetStatus(asset.lastActivityTimestamp).isOffline : false;
                
                const hlKey = `${w.assetId}__${w.attributeName}`;
                const isHighlighted = highlightedKeys.includes(hlKey);
                
                // Render for device group (no device name in title)
                if (!deviceGroups[w.assetId]) {
                    deviceGroups[w.assetId] = { name: assetName, htmls: [] };
                }
                deviceGroups[w.assetId].htmls.push(renderTimerCard(w, assetName, isOffline, false, isHighlighted));

                // If highlighted, render again for Highlights section (with device name in title)
                if (isHighlighted) {
                    highlightHtmls.push(renderTimerCard(w, assetName, isOffline, true, isHighlighted));
                }
            });

            // Populate Highlights Section
            if (highlightHtmls.length > 0) {
                timerHighlightsGrid.innerHTML = highlightHtmls.join('');
                timerHighlightsSection.style.display = 'block';
            } else {
                timerHighlightsSection.style.display = 'none';
                timerHighlightsGrid.innerHTML = '';
            }

            // Populate Device Groups
            let groupsHtml = '';
            for (const [assetId, group] of Object.entries(deviceGroups)) {
                // Remove non-alphanumeric chars for valid IDs
                const cleanId = assetId.replace(/[^a-zA-Z0-9]/g, '');
                groupsHtml += `
                    <div class="timer-device-group">
                        <div class="timer-device-divider" onclick="toggleTimerDeviceGroup('${cleanId}')">
                            <span class="timer-device-name">${group.name}</span>
                            <span class="timer-device-toggle" id="timer-toggle-${cleanId}">▼</span>
                        </div>
                        <div class="timer-device-grid widget-grid-4" id="timer-grid-${cleanId}">
                            ${group.htmls.join('')}
                        </div>
                    </div>
                `;
            }
            timerDeviceGroups.innerHTML = groupsHtml;
        }

        if (rulesContainer) {
            if (rules.length === 0) {
                rulesContainer.innerHTML = '<div class="empty-placeholder">No rules pinned. Go to Device Details to pin some!</div>';
            } else {
                rulesContainer.innerHTML = rules.map(w => {
                    const asset = assets.find(a => a.id === w.assetId);
                    const assetName = asset ? asset.name : (w.assetName || '');
                    const isOffline = asset ? getAssetStatus(asset.lastActivityTimestamp).isOffline : false;
                    return renderRuleCard(w, asset ? asset.attributes : null, assetName, isOffline, assets);
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

function renderSensorCard(w, isOffline = false, allAssets = []) {
    // If a specific key is pinned, render it with a high-visibility layout
    if (w.key) {
        const val = w.value;
        const valueDisplay = formatSensorValue(val, w.key, w.attributeName);
        const label = w.displayName || getFriendlyLabel(w.key);

        const content = `
            <div class="sensor-grid" style="grid-template-columns: 1fr; padding: 0.5rem 1rem 1rem 1rem;">
                <div class="sensor-item" style="border-bottom:none; flex-direction:column; align-items:flex-start; gap:4px;">
                    <span class="sensor-value" style="font-size:1.75rem; font-weight:800; color:var(--primary); line-height:1.2;">${valueDisplay}</span>
                </div>
            </div>
        `;
        return wrapWidgetCard(w, label, content, isOffline);
    }

    const attr = w.attributeName.toLowerCase();
    if (attr === 'npkdata') return renderNPKCard(w, isOffline);
    if (attr === 'envdata') return renderEnvCard(w, isOffline);
    if (attr === 'moisturedata') return renderMoistureCard(w, isOffline);
    if (attr === 'ruletargets') return renderRuleCard(w, null, '', isOffline, allAssets);
    return renderGenericCard(w, isOffline);
}

function renderNPKCard(w, isOffline = false) {
    if (!w.value || typeof w.value !== 'object') return renderGenericCard(w, isOffline);

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
                <div class="metric-value">${formatSensorValue(item.v, item.k, 'NPKData')}</div>
            </div>`;
        });

        content += '</div></div>';
    });

    content += '</div>';
    return wrapWidgetCard(w, w.displayName || 'NPK Sensor Data', content, isOffline);
}

function renderRuleCard(w, assetAttributes = null, assetName = '', isOffline = false, allAssets = []) {
    let rulesList = [];
    if (w.value && typeof w.value === 'object') {
        rulesList = Object.entries(w.value).filter(([key]) => !key.startsWith('_'));
    }

    let content;
    if (isOffline) {
        content = '<div style="color:#b91c1c; font-style:italic; padding:1rem; font-weight:600;">Device Offline - Controls Disabled</div>';
    } else if (rulesList.length === 0) {
        content = '<div style="color:#999; font-style:italic; padding:1rem;">No active rule targets</div>';
    } else {
        content = `<div style="padding:1rem; display:flex; flex-direction:column; gap:0.5rem;">`;

        rulesList.forEach(([ruleKey, ruleRaw]) => {
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
                        ruleName: parts.length > 4 ? parts[4] : null,
                        whenDeviceId: (parts.length > 5 && parts[5].length > 0) ? parts[5] : null,
                        timeType: parts.length > 6 ? parts[6] : 'N',
                        timeStart: parts.length > 7 ? parts[7] : '',
                        timeEnd: parts.length > 8 ? parts[8] : ''
                    };
                }
            }

            if (parsed) {
                const sensorKey = ruleKey.split('_')[0];
                let sensorName = getFriendlyLabel(sensorKey);
                
                if (parsed.whenDeviceId && parsed.whenDeviceId !== w.assetId) {
                    const sensorDevice = allAssets.find(a => a.id === parsed.whenDeviceId);
                    if (sensorDevice && sensorDevice.name) {
                        sensorName = `[${sensorDevice.name}] ${sensorName}`;
                    }
                }

                let isActive = false;
                let currentVal = null;
                if (assetAttributes) {
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

                // Check schedule mute status
                let isMuted = false;
                let scheduleText = '';
                if (parsed.timeType !== 'N' && parsed.timeStart && parsed.timeEnd) {
                    const now = new Date();
                    const nowMins = now.getHours() * 60 + now.getMinutes();
                    const startMins = parseInt(parsed.timeStart.substring(0, 2)) * 60 + parseInt(parsed.timeStart.substring(2));
                    const endMins = parseInt(parsed.timeEnd.substring(0, 2)) * 60 + parseInt(parsed.timeEnd.substring(2));

                    const fmtTime = (hhmm) => {
                        const h = parseInt(hhmm.substring(0, 2));
                        const m = hhmm.substring(2);
                        const suffix = h >= 12 ? 'PM' : 'AM';
                        const h12 = h % 12 || 12;
                        return `${h12}:${m} ${suffix}`;
                    };

                    const inWindow = startMins <= endMins
                        ? (nowMins >= startMins && nowMins < endMins)
                        : (nowMins >= startMins || nowMins < endMins);

                    if (parsed.timeType === 'I') {
                        scheduleText = `Skip ${fmtTime(parsed.timeStart)} - ${fmtTime(parsed.timeEnd)}`;
                        if (inWindow) isMuted = true;
                    } else if (parsed.timeType === 'A') {
                        scheduleText = `Run ${fmtTime(parsed.timeStart)} - ${fmtTime(parsed.timeEnd)}`;
                        if (!inWindow) isMuted = true;
                    }
                }

                // Override active status if muted
                if (isMuted) isActive = false;

                const displayTitle = parsed.ruleName || getFriendlyLabel(ruleKey);

                const opColors = {
                    'Greater Than': '#e67e22',
                    'Less Than': '#3498db',
                    'Equal To': '#2ecc71',
                    'Not': '#e74c3c'
                };
                const opColor = opColors[parsed.op] || '#8e44ad';

                const switchColors = ['#9b59b6', '#d35400', '#009688', '#e91e63', '#795548', '#2c3e50', '#16a085', '#5f27cd'];
                const getSwitchColor = (str) => {
                    let hash = 0;
                    for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
                    return switchColors[Math.abs(hash) % switchColors.length];
                };
                const switchColor = getSwitchColor(parsed.targetName);

                let activeStyle, statusBadge;
                if (isMuted) {
                    activeStyle = `border-left: 4px solid #e67e22; background: #fef3e2; box-shadow: 0 1px 2px rgba(0,0,0,0.05);`;
                    statusBadge = `<span style="float:right; font-size:0.7rem; background:#e67e22; color:white; padding:2px 6px; border-radius:4px; font-weight:bold;">MUTED</span>`;
                } else if (isActive) {
                    activeStyle = `border-left: 6px solid #2ecc71; background: #e8f8f5; box-shadow: 0 4px 6px rgba(46, 204, 113, 0.2); transform: scale(1.02);`;
                    statusBadge = `<span style="float:right; font-size:0.7rem; background:#2ecc71; color:white; padding:2px 6px; border-radius:4px; font-weight:bold;">ACTIVE</span>`;
                } else {
                    activeStyle = `border-left: 4px solid var(--primary); background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,0.05);`;
                    statusBadge = ``;
                }

                const scheduleHtml = scheduleText
                    ? `<div style="margin-top:6px; font-size:0.75rem; color:${isMuted ? '#c0792b' : '#888'}; font-weight:600;">${scheduleText}</div>`
                    : '';

                content += `
                    <div style="${activeStyle} padding:0.75rem; border-radius:4px; font-size:0.9rem; color:#444; transition: all 0.3s ease;">
                        <div style="font-weight:700; color:${isMuted ? '#c0792b' : (isActive ? '#27ae60' : '#999')}; margin-bottom:4px; text-transform:uppercase; font-size:0.65rem; letter-spacing:0.5px;">
                            ${displayTitle} ${statusBadge}
                        </div>
                        <div style="line-height:1.5;">
                            <span style="font-weight:bold; color:#555;">If</span> 
                            <span style="color:#2980b9; font-weight:700;">${sensorName}</span> 
                            <span style="color:#555;">is</span> 
                            <span style="color:${opColor}; font-weight:800;">${parsed.op}</span> 
                            <span style="color:#c0392b; font-weight:700;">${parsed.threshold}${(() => { const u = getSensorUnit(ruleKey.split('_')[0], ''); return u ? ' ' + u : ''; })()}</span>,
                            <br>
                            <span style="font-weight:bold; color:#555;">Set</span> 
                            <span style="color:${switchColor}; font-weight:700;">${parsed.targetName}</span> 
                            <span style="color:#555;">to</span> 
                            <span style="color:${parsed.targetVal === 'ON' ? '#27ae60' : '#c0392b'}; font-weight:700;">${parsed.targetVal}</span>
                        </div>
                        ${scheduleHtml}
                    </div>
                 `;
            } else {
                content += `<div style="background:#eee; padding:0.5rem; border-radius:4px; font-size:0.8rem; color:#666;">${ruleKey}: ${ruleRaw}</div>`;
            }
        });

        content += `</div>`;
    }

    let ruleTitle = w.displayName || 'Rule Targets';
    if (assetName) {
        ruleTitle = `${ruleTitle} - ${assetName}`;
    } else if (w.assetName) {
        ruleTitle = `${ruleTitle} - ${w.assetName}`;
    }
    return wrapWidgetCard(w, ruleTitle, content, isOffline);
}


function renderEnvCard(w, isOffline = false) {
    if (!w.value || typeof w.value !== 'object') return renderGenericCard(w, isOffline);

    const keys = Object.keys(w.value).sort();
    let content = '<div class="sensor-grid">';

    keys.forEach(k => {
        const val = w.value[k];
        content += `<div class="sensor-item">
            <span class="sensor-label">${getFriendlyLabel(k)}</span>
            <span class="sensor-value">${formatSensorValue(val, k, 'EnvData')}</span>
        </div>`;
    });

    content += '</div>';
    return wrapWidgetCard(w, w.displayName || 'Environment', content, isOffline);
}

function renderMoistureCard(w, isOffline = false) {
    if (!w.value || typeof w.value !== 'object') return renderGenericCard(w, isOffline);

    const keys = Object.keys(w.value).sort();
    let content = '<div class="sensor-grid">';

    keys.forEach(k => {
        const val = w.value[k];
        content += `<div class="sensor-item">
            <span class="sensor-label">${getFriendlyLabel(k)}</span>
            <span class="sensor-value">${formatSensorValue(val, k, 'MoistureData')}</span>
        </div>`;
    });

    content += '</div>';
    return wrapWidgetCard(w, w.displayName || 'Moisture Levels', content, isOffline);
}

function renderTimerCard(w, assetName, isOffline = false, showDeviceName = true, isHighlighted = false) {
    if (!w.value || typeof w.value !== 'object') return renderGenericCard(w, isOffline);

    let status = isOffline ? 'OFFLINE' : (w.value['Status'] || 'Unknown');
    if (typeof status === 'string') status = status.toUpperCase();
    const isActive = status === 'ACTIVE' || status === 'ON';

    let content = `
        <div style="padding:1rem; display:flex; flex-direction:column; gap:0.5rem;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <span style="font-weight:600; color:#555;">Status</span>
                <span style="font-weight:700; color:${isOffline ? '#b91c1c' : (isActive ? 'var(--success)' : '#999')}">${isOffline ? 'OFFLINE' : (isActive ? 'ACTIVE' : 'INACTIVE')}</span>
            </div>
    `;

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

    if (w.value['Days']) {
        content += `
            <div style="padding:0 1rem 1rem 1rem;">
                <div style="font-size:0.7rem; color:#999; margin-bottom:2px;">DAYS</div>
                <div style="font-size:0.85rem; color:#333; font-weight:600;">${w.value['Days']}</div>
            </div>
         `;
    }

    if (w.value['Outputs']) {
        let outStr = w.value['Outputs'].replace(/OUT\s0?/g, '');
        content += `
            <div style="padding:0 1rem 1rem 1rem;">
                <div style="font-size:0.7rem; color:#999; margin-bottom:2px;">SWITCHES</div>
                <div style="font-size:0.85rem; color:#333; font-weight:600;">${outStr}</div>
            </div>
         `;
    }

    content += '</div>';

    let timerTitle = w.displayName || 'Timer';
    if (showDeviceName && assetName) {
        timerTitle = `${timerTitle} - ${assetName}`;
    }
    return wrapWidgetCard(w, timerTitle, content, isOffline, true, isHighlighted);
}

function renderGenericCard(w, isOffline = false) {
    let content = '<div class="generic-content" style="padding: 1rem;">';
    if (typeof w.value === 'object' && w.value !== null) {
        content += '<pre style="background:#f4f4f4; padding:0.5rem; border-radius:4px; font-size:0.8rem; overflow-x:auto;">' + JSON.stringify(w.value, null, 2) + '</pre>';
    } else {
        const val = w.value;
        const formatted = formatSensorValue(val, w.key || '', w.attributeName || '');
        content += `<div style="font-size:1.5rem; font-weight:700; color:var(--primary);">${formatted}</div>`;
    }
    content += '</div>';
    return wrapWidgetCard(w, w.displayName || w.attributeName, content, isOffline);
}

function wrapWidgetCard(w, title, contentHtml, isOffline = false, isTimer = false, isHighlighted = false) {
    const isFixed = !w.id;
    const isRuleParams = w.attributeName && w.attributeName === 'RuleTargets';
    const isStandardTimer = isTimer || (w.attributeName && w.attributeName.toLowerCase().startsWith('timer'));

    let starBtnHtml = '';
    if (isStandardTimer) {
        starBtnHtml = `<button class="timer-hl-star ${isHighlighted ? 'highlighted' : ''}" 
                        onclick="toggleHighlightTimer('${w.assetId}', '${w.attributeName}')" 
                        title="${isHighlighted ? 'Remove from Highlights' : 'Add to Highlights'}">
                        ${isHighlighted ? '★' : '☆'}
                       </button>`;
    }

    return `
        <div class="widget-card ${isOffline ? 'idle' : ''}">
            <div class="widget-card-header" style="display:flex; justify-content:space-between; align-items:center;">
                <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; padding-right:8px;">${title}</span>
                <div style="display:flex; gap:8px; align-items:center;">
                    ${starBtnHtml}
                    ${!isRuleParams && !isStandardTimer ? `<span onclick="renameWidget('${w.id}', '${title.replace(/'/g, "\\'")}')" style="cursor:pointer; color:#777; font-size:0.8rem; font-weight:600;">RENAME</span>` : ''}
                    <span onclick="unpinWidget('${w.assetId}', '${w.attributeName}', '${w.key || ''}')" style="cursor:pointer; color:#999; font-weight:bold; font-size:1.1rem; line-height:1;">✕</span>
                </div>
            </div>
            ${contentHtml}
        </div>
    `;
}

// ── Dashboard Timer Highlight Logic ──
async function toggleHighlightTimer(assetId, attributeName) {
    try {
        const res = await fetch(`${APP_PREFIX}/api/user/preferences/highlight`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ assetId, attributeName })
        });
        const data = await res.json();
        if (data.status === 'success') {
            loadDashboard(); // Refresh to update grids immediately
        } else {
            toast('Failed to update highlight');
        }
    } catch (e) {
        console.error(e);
        toast('Connection error');
    }
}

function toggleTimerDeviceGroup(cleanId) {
    const grid = document.getElementById(`timer-grid-${cleanId}`);
    const icon = document.getElementById(`timer-toggle-${cleanId}`);
    if (grid) {
        grid.classList.toggle('collapsed');
        icon.classList.toggle('collapsed');
    }
}

async function unpinWidget(assetId, attributeName, key) {
    if (!confirm('Remove this widget from dashboard?')) return;
    try {
        const payload = {
            assetId: assetId,
            attributeName: attributeName,
            key: key || null
        };

        const res = await fetch(`${APP_PREFIX}/api/user/preferences/pin`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (data.status === 'success') {
            toast('Widget removed');
            loadWidgets();
        } else {
            toast('Failed to remove widget: ' + (data.message || 'Unknown error'));
        }
    } catch (e) {
        console.error(e);
        toast('Connection error');
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

// getFriendlyLabel is provided by main.js

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

document.addEventListener('DOMContentLoaded', async () => {
    await ensureFriendlyNames();
    loadDashboard();
    setInterval(loadDashboard, 3000);
});

