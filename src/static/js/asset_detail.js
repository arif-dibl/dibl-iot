let pinnedAttributes = [];
const openGroups = new Set();

function shouldShowPin(key, itemKey) {
    if (key === 'RelayData') return false;
    if (key && key.includes('RelayNode')) return false; 
    if (itemKey && itemKey.startsWith('r') && key === 'RelayData') return false;
    return true;
}

async function loadDetail() {
    try {
        // 1. Fetch Preferences First
        try {
            const prefsRes = await fetch('/api/user/preferences');
            const prefs = await prefsRes.json();
            pinnedAttributes = prefs.pinned || [];
        } catch (e) { console.error("Prefs error", e); }

        // 2. Fetch Asset
        const res = await fetch(`/api/asset/${ASSET_ID}`);
        const asset = await res.json();

        if (!asset || !asset.id) {
            document.getElementById('detailCard').innerHTML = '<div style="padding:2rem; text-align:center; color:var(--danger)">IoT Device not found or access denied.</div>';
            return;
        }

        document.getElementById('assetName').textContent = asset.name;
        document.getElementById('assetTypeBadge').textContent = asset.type;

        // Update Last Update Text
        if (asset.lastActivityTimestamp) {
            document.getElementById('lastUpdateText').textContent = `• Updated ${timeAgo(asset.lastActivityTimestamp)}`;
        } else {
            document.getElementById('lastUpdateText').textContent = '';
        }

        const attrContainer = document.getElementById('attributesList');
        if (!asset.attributes || Object.keys(asset.attributes).length === 0) {
            attrContainer.innerHTML = '<div style="font-style:italic; color:var(--text-muted)">No attributes found.</div>';
        } else {
            // Define grouping rules in requested order
            const groupingRules = [
                { name: "Switches", pattern: /^(relaydata|relay)/i, priority: 1 },
                { name: "Sensors", pattern: /^(envdata|moisturedata)/i, priority: 2 },
                { name: "Timers", pattern: /^timer/i, priority: 3 },
                { name: "Nutritions", pattern: /^npk/i, priority: 4 },
                { name: "Rules", pattern: /^ruletargets/i, priority: 5 },
                { name: "Device Info", pattern: /^(device|asset|id|status|type)/i, priority: 6 },
                { name: "Configuration", pattern: /^(config|setting|mode)/i, priority: 7 }
            ];

            // Group attributes
            const grouped = {};
            for (const [key, val] of Object.entries(asset.attributes)) {
                // Hide Thresholds
                if (key.toLowerCase().includes('threshold')) continue;

                const rule = groupingRules.find(r => r.pattern.test(key));
                const groupName = rule ? rule.name : "Sensors";
                if (!grouped[groupName]) {
                    grouped[groupName] = { attributes: {}, priority: rule ? rule.priority : 1 };
                }
                grouped[groupName].attributes[key] = val;
            }

            // Sort groups by priority
            const sortedGroups = Object.entries(grouped).sort((a, b) => a[1].priority - b[1].priority);

            // Custom sort: Non-numbered keys first, then by numeric suffix
            const customSort = (a, b) => {
                const getSuffix = (str) => {
                    const match = str.match(/(\d+)$/);
                    return match ? parseInt(match[0], 10) : -1; 
                };

                const suffixA = getSuffix(a);
                const suffixB = getSuffix(b);

                if (suffixA !== suffixB) {
                    return suffixA - suffixB;
                }
                return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
            };

            // Render grouped attributes
            let html = '';
            for (const [groupName, groupData] of sortedGroups) {
                const attrCount = Object.keys(groupData.attributes).length;
                const groupId = groupName.replace(/[^a-zA-Z0-9]/g, '');
                const isOpen = openGroups.has(groupId);

                // Sort attributes within group
                const sortedAttrKeys = Object.keys(groupData.attributes).sort(customSort);

                html += `
                    <div style="margin-bottom:1.5rem; border:1px solid var(--border); border-radius:8px; overflow:hidden;">
                        <div 
                            onclick="toggleGroup('${groupId}')" 
                            style="background:#f8f9fa; padding:1rem 1.5rem; cursor:pointer; display:flex; justify-content:space-between; align-items:center; user-select:none;"
                        >
                            <div style="font-weight:600; font-size:1.05rem; color:#333;">
                                ${groupName} <span style="color:var(--text-muted); font-weight:400; font-size:0.9rem;">(${attrCount})</span>
                            </div>
                            <span id="icon-${groupId}" style="transition:transform 0.2s; transform: ${isOpen ? 'rotate(0deg)' : 'rotate(-90deg)'};">▼</span>
                        </div>
                        <div id="${groupId}" style="display:${isOpen ? 'block' : 'none'};">
                            <div style="padding:1rem; display:grid; grid-template-columns: 1fr 2fr; gap:1rem;">
                `;

                for (const key of sortedAttrKeys) {
                    const val = groupData.attributes[key];
                    // Format value based on type
                    let displayVal = '';
                    if (key === 'RuleTargets') {
                        let rulesCount = 0;
                        let rulesList = [];
                        if (val && typeof val === 'object') {
                            rulesList = Object.keys(val);
                            rulesCount = rulesList.length;
                        }

                        if (rulesCount === 0) {
                            displayVal = '<div style="color:#999; font-style:italic;">No active rule targets</div>';
                        } else {
                            displayVal = `
                                <div style="display:flex; flex-direction:column; gap:0.5rem;">
                                    <div style="font-weight:600; color:var(--primary);">${rulesCount} Target(s) Configured</div>
                                    <div style="display:flex; flex-wrap:wrap; gap:0.5rem;">
                                        ${rulesList.map(r => `<span style="background:#eef; color:var(--primary); padding:2px 8px; border-radius:12px; font-size:0.85rem;">${r}</span>`).join('')}
                                    </div>
                                </div>
                             `;
                        }
                    } else if (isBooleanLike(val)) {
                        const boolVal = toBool(val);
                        displayVal = `
                            <div style="display:flex; align-items:center; gap:10px;">
                                <label class="toggle-switch">
                                    <input type="checkbox" ${boolVal ? 'checked' : ''} onchange="toggleAttribute('${key}', this.checked)">
                                    <span class="slider"></span>
                                </label>
                                <span style="font-weight:600; color:${boolVal ? 'var(--primary)' : 'var(--text-muted)'}; min-width:30px;">
                                    ${boolVal ? 'ON' : 'OFF'}
                                </span>
                            </div>
                        `;
                    } else if (typeof val === 'object' && val !== null) {
                        if (key.toLowerCase().startsWith('timer')) {
                            const isActive = String(val['Status']).toUpperCase() === 'ON' || String(val['Status']).toUpperCase() === 'ACTIVE';
                            const onTime = `${String(val['OnHour'] || 0).padStart(2, '0')}:${String(val['OnMinute'] || 0).padStart(2, '0')}`;
                            const offTime = `${String(val['OffHour'] || 0).padStart(2, '0')}:${String(val['OffMinute'] || 0).padStart(2, '0')}`;

                            displayVal = `
                                <div style="display:flex; flex-wrap:wrap; gap:1rem; margin-bottom:1rem;">
                                    <div style="padding:1rem; background:#fff; border-radius:6px; flex:1; min-width:250px; 
                                                border:1px solid #e0e0e0; box-shadow:0 1px 3px rgba(0,0,0,0.05);">
                                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.75rem;">
                                            <div style="font-weight:700; color:#555;">${getFriendlyLabel(key)}</div>
                                            <div style="font-weight:700; color:${isActive ? 'var(--success)' : '#999'}; font-size:0.9rem;">${isActive ? 'ACTIVE' : 'INACTIVE'}</div>
                                        </div>
                                        <div style="display:flex; justify-content:space-between; border-top:1px solid #eee; padding-top:0.5rem;">
                                            <div style="text-align:center;">
                                                <div style="font-size:0.7rem; color:#999;">START</div>
                                                <div style="font-weight:700; color:#333;">${onTime}</div>
                                            </div>
                                            <div style="text-align:center;">
                                                <div style="font-size:0.7rem; color:#999;">END</div>
                                                <div style="font-weight:700; color:#333;">${offTime}</div>
                                            </div>
                                        </div>

                                        <!-- Days -->
                                        ${val['Days'] ? `
                                        <div style="padding-top:0.75rem;">
                                            <div style="font-size:0.7rem; color:#999; margin-bottom:2px;">DAYS</div>
                                            <div style="font-size:0.85rem; color:#333; font-weight:600;">${val['Days']}</div>
                                        </div>` : ''}

                                        <!-- Outputs -->
                                        ${val['Outputs'] ? `
                                        <div style="padding-top:0.75rem;">
                                            <div style="font-size:0.7rem; color:#999; margin-bottom:2px;">SWITCHES</div>
                                            <div style="font-size:0.85rem; color:#333; font-weight:600;">${val['Outputs'].replace(/OUT\s0?/g, '')}</div>
                                        </div>` : ''}

                                         <div style="margin-top:0.75rem; text-align:center; font-size:0.8rem; color:var(--primary); cursor:pointer; font-weight:600;" onclick="location.href='/timers'">
                                            Edit in Timers Page →
                                        </div>
                                    </div>
                                </div>
                             `;
                        } else {
                            // Standard Grouping Logic for other JSON attributes (e.g. NPK)
                            const keys = Object.keys(val).sort(customSort);
                            const prefixes = {};
                            keys.forEach(k => {
                                const p = k.substring(0, 2);
                                prefixes[p] = (prefixes[p] || 0) + 1;
                            });

                            const standalone = [];
                            const groups = {};
                            keys.forEach(k => {
                                const p = k.substring(0, 2);
                                if (prefixes[p] > 1) {
                                    if (!groups[p]) groups[p] = [];
                                    groups[p].push({ k, v: val[k] });
                                } else {
                                    standalone.push({ k, v: val[k] });
                                }
                            });

                            displayVal = '<div style="background:#f8f9fa; padding:0.5rem; border-radius:4px; display:flex; flex-direction:column; gap:0.6rem;">';


                            // Render Standalone First
                            standalone.forEach(item => {
                                const isPinned = pinnedAttributes.some(p => p.assetId === ASSET_ID && p.attributeName === key && p.key === item.k);
                                const starIcon = isPinned ? '★' : '☆';
                                const starColor = isPinned ? '#f1c40f' : '#ccc';

                                let valueHtml;
                                if (isBooleanLike(item.v)) {
                                    const boolVal = toBool(item.v);
                                    valueHtml = `
                                    <div style="display:flex; align-items:center; gap:8px;">
                                        <label class="toggle-switch" style="transform:scale(0.8);">
                                            <input type="checkbox" ${boolVal ? 'checked' : ''} onchange="toggleNestedAttribute('${key}', '${item.k}', this.checked)">
                                            <span class="slider"></span>
                                        </label>
                                        <span style="font-weight:600; color:${boolVal ? 'var(--primary)' : 'var(--text-muted)'};">${boolVal ? 'ON' : 'OFF'}</span>
                                    </div>
                                `;
                                } else if (['OnHour', 'OffHour', 'OnMinute', 'OffMinute'].includes(item.k)) {
                                    // Custom Wheel Picker Trigger
                                    const isHour = item.k.includes('Hour');
                                    const maxVal = isHour ? 23 : 59;
                                    const currentVal = String(item.v || '0').padStart(2, '0');

                                    valueHtml = `
                                    <div onclick="openWheelPicker(event, '${key}', '${item.k}', ${item.v || 0}, ${maxVal})"
                                        style="width:55px; padding:4px 0; border:1px solid #ccc; border-radius:4px; font-size:0.9rem; font-weight:700; text-align:center; cursor:pointer; background:#fff; color:var(--primary);">
                                        ${currentVal}
                                    </div>
                                `;
                                } else if (item.k === 'Days') {
                                    // Multi-day bubble selector
                                    const daysOrder = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
                                    const currentDays = (item.v || '').toUpperCase();
                                    const isEveryday = currentDays === 'EVERYDAY';

                                    let daysHtml = '<div style="display:flex; gap:3px; flex-wrap:nowrap;">';
                                    daysOrder.forEach(d => {
                                        const active = isEveryday || currentDays.includes(d);
                                        daysHtml += `
                                        <div onclick="event.stopPropagation(); toggleDay('${key}', '${item.k}', '${d}')"
                                            title="${d}"
                                            style="width:22px; height:22px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:0.65rem; font-weight:700; cursor:pointer; transition:all 0.2s;
                                            background:${active ? 'var(--primary)' : '#f0f0f0'}; 
                                            color:${active ? 'white' : '#999'}; 
                                            border:1px solid ${active ? 'var(--primary)' : '#ddd'};">
                                            ${d[0]}
                                        </div>
                                    `;
                                    });
                                    daysHtml += '</div>';
                                    valueHtml = daysHtml;
                                } else if (item.k === 'Outputs') {
                                    // Multi-output bubble selector for Relays (r1, r2, r3, r4)
                                    const relayOptions = ['r1', 'r2', 'r3', 'r4'];
                                    const currentOutputs = (item.v || '').toLowerCase();

                                    let outputsHtml = '<div style="display:flex; gap:3px; flex-wrap:nowrap;">';
                                    relayOptions.forEach(r => {
                                        const active = currentOutputs.includes(r);
                                        const label = r.replace('r', ''); // Just "1", "2" etc.
                                        outputsHtml += `
                                        <div onclick="event.stopPropagation(); toggleTimerOutput('${key}', '${item.k}', '${r}')"
                                            title="Switch ${label}"
                                            style="width:22px; height:22px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:0.65rem; font-weight:700; cursor:pointer; transition:all 0.2s;
                                            background:${active ? 'var(--primary)' : '#f0f0f0'}; 
                                            color:${active ? 'white' : '#999'}; 
                                            border:1px solid ${active ? 'var(--primary)' : '#ddd'};">
                                            ${label}
                                        </div>
                                    `;
                                    });
                                    outputsHtml += '</div>';
                                    valueHtml = outputsHtml;
                                } else {
                                    valueHtml = `<div style="color:#333; word-break:break-word;">${item.v}</div>`;
                                }

                                displayVal += `
                                <div style="display:flex; border-bottom:1px solid #e1e4e8; padding:0.25rem 0.5rem; justify-content:space-between; align-items:center;">
                                    <div style="display:flex; gap:10px; width:100%; align-items:center;">
                                        <div style="font-weight:600; color:#555; min-width:80px;">${getFriendlyLabel(item.k)}</div>
                                        ${valueHtml}
                                    </div>
                                    ${shouldShowPin(key, item.k) ? `<button onclick="togglePin('${key}', '${item.k}')" style="background:none; border:none; color:${starColor}; cursor:pointer; font-size:1.1rem; padding:0;">${starIcon}</button>` : ''}
                                </div>
                            `;
                            });

                            // Render Groups Side-by-Side
                            Object.entries(groups).forEach(([prefix, items]) => {
                                displayVal += `<div style="display:flex; flex-wrap:wrap; gap:0.5rem; padding:0.5rem; background:#fff; border-radius:6px; border:1px solid #dee2e6; box-shadow:0 1px 2px rgba(0,0,0,0.03);">`;
                                items.forEach((item, idx) => {
                                    const isPinned = pinnedAttributes.some(p => p.assetId === ASSET_ID && p.attributeName === key && p.key === item.k);
                                    const starColor = isPinned ? '#f1c40f' : '#ccc';

                                    let valueHtml;
                                    if (isBooleanLike(item.v)) {
                                        const boolVal = toBool(item.v);
                                        valueHtml = `
                                            <div style="display:flex; align-items:center; gap:6px;">
                                                <label class="toggle-switch" style="transform:scale(0.7);">
                                                    <input type="checkbox" ${boolVal ? 'checked' : ''} onchange="toggleNestedAttribute('${key}', '${item.k}', this.checked)">
                                                    <span class="slider"></span>
                                                </label>
                                                <span style="font-weight:600; color:${boolVal ? 'var(--primary)' : 'var(--text-muted)'}; font-size:0.85rem;">${boolVal ? 'ON' : 'OFF'}</span>
                                            </div>
                                        `;
                                    } else {
                                        valueHtml = `<div style="font-weight:600; color:#222; font-size:0.95rem;">${item.v}</div>`;
                                    }

                                    // Render Item
                                    displayVal += `
                                        <div style="flex:1; min-width:120px; display:flex; flex-direction:column; ${idx < items.length - 1 ? 'border-right:1px solid #eee;' : ''} padding:0 0.5rem; position:relative;">
                                            <div style="display:flex; justify-content:space-between; align-items:center;">
                                                 <div style="font-size:0.75rem; font-weight:700; color:#999; text-transform:uppercase; margin-bottom:2px;">${getFriendlyLabel(item.k)}</div>
                                                 ${shouldShowPin(key, item.k) ? `<button onclick="togglePin('${key}', '${item.k}')" style="background:none; border:none; color:${starColor}; cursor:pointer; font-size:1rem; padding:0; line-height:1;">★</button>` : ''}
                                            </div>
                                            ${valueHtml}
                                        </div>
                                    `;
                                });
                                displayVal += '</div>';
                            });
                            displayVal += '</div>';
                        }
                    } else {
                        displayVal = val;
                    }

                    const pinnedItem = pinnedAttributes.find(p => p.assetId === ASSET_ID && p.attributeName === key && !p.key);
                    const isPinned = !!pinnedItem;
                    const starIcon = isPinned ? '★' : '☆';
                    const starColor = isPinned ? '#f1c40f' : '#ccc';

                    const isTimer = key.toLowerCase().startsWith('timer');
                    const editBtn = (isPinned && key !== 'RuleTargets' && !isTimer) ? `<button onclick="renamePin('${key}')" style="background:none; border:none; color:#777; cursor:pointer; font-size:0.7rem; font-weight:600; padding:0; margin-right:8px;" title="Rename">RENAME</button>` : '';

                    const pinButtonHtml = shouldShowPin(key, null) ? `
                         <button onclick="togglePin('${key}')" style="background:none; border:none; color:${starColor}; cursor:pointer; font-size:1.2rem; padding:0;">${starIcon}</button>
                     ` : '';

                    html += `
                        <div style="padding:0.75rem; background:#fafafa; border-radius:4px; font-weight:600; color:#555; display:flex; justify-content:space-between; align-items:center;">
                            ${getFriendlyLabel(key, true)}
                            <div style="display:flex; align-items:center;">
                                ${editBtn}
                                ${pinButtonHtml}
                            </div>
                        </div>
                        <div style="padding:0.75rem; border:1px solid var(--border); border-radius:4px; background:white;">${displayVal}</div>
                    `;
                }

                html += `
                            </div>
                        </div>
                    </div>
                `;
            }

            attrContainer.innerHTML = html;
        }

    } catch (e) {
        console.error(e);
        toast('Failed to load asset details');
    }
}

function toggleGroup(groupId) {
    const content = document.getElementById(groupId);
    const icon = document.getElementById('icon-' + groupId);
    if (content.style.display === 'none') {
        content.style.display = 'block';
        icon.style.transform = 'rotate(0deg)';
        openGroups.add(groupId);
    } else {
        content.style.display = 'none';
        icon.style.transform = 'rotate(-90deg)';
        openGroups.delete(groupId);
    }
}

async function toggleAttribute(attrName, newValue) {
    try {
        const res = await fetch(`/api/asset/${ASSET_ID}/attribute/${attrName}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ value: newValue })
        });
        const data = await res.json();
        if (data.status === 'success') {
            toast(`${attrName} turned ${newValue ? 'ON' : 'OFF'}`);
            loadDetail();
        } else {
            toast(`Failed to update ${attrName}: ${data.message}`);
            loadDetail();
        }
    } catch (e) {
        toast('Failed to update attribute');
        loadDetail();
    }
}

async function toggleNestedAttribute(attrName, nestedKey, newValue) {
    try {
        const res = await fetch(`/api/asset/${ASSET_ID}`);
        const asset = await res.json();

        if (asset && asset.attributes && asset.attributes[attrName] !== undefined) {
            let currentVal = asset.attributes[attrName];

            // If value is a JSON
            if (typeof currentVal === 'string') {
                try {
                    currentVal = JSON.parse(currentVal);
                } catch (e) {
                    console.error('Failed to parse attribute as JSON:', e);
                    toast('Failed to update: invalid data format');
                    return;
                }
            }

            if (typeof currentVal === 'object' && currentVal !== null) {
                // Convert bool/string to "ON"/"OFF"
                if (nestedKey === 'Status') {
                    currentVal[nestedKey] = newValue ? 'ON' : 'OFF';
                } else {
                    currentVal[nestedKey] = newValue;
                }

                const updateRes = await fetch(`/api/asset/${ASSET_ID}/attribute/${attrName}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ value: currentVal })
                });
                const updateData = await updateRes.json();
                if (updateData.status === 'success') {
                    toast(`${nestedKey} turned ${newValue ? 'ON' : 'OFF'}`);
                    loadDetail();
                } else {
                    toast(`Failed to update ${nestedKey}: ${updateData.message || 'Unknown error'}`);
                    loadDetail();
                }
            } else {
                toast('Failed to update: attribute is not an object');
            }
        } else {
            toast('Attribute not found');
        }
    } catch (e) {
        console.error('Toggle nested attribute error:', e);
        toast('Failed to update nested attribute');
        loadDetail();
    }
}

async function updateNestedValue(attrName, nestedKey, newValue) {
    // Timer OnHour, OnMinute
    try {
        const res = await fetch(`/api/asset/${ASSET_ID}`);
        const asset = await res.json();

        if (asset && asset.attributes && asset.attributes[attrName] !== undefined) {
            let currentVal = asset.attributes[attrName];

            if (typeof currentVal === 'string') {
                try {
                    currentVal = JSON.parse(currentVal);
                } catch (e) {
                    console.error('Failed to parse attribute as JSON:', e);
                    toast('Failed to update: invalid data format');
                    return;
                }
            }

            if (typeof currentVal === 'object' && currentVal !== null) {
                currentVal[nestedKey] = String(newValue);

                const updateRes = await fetch(`/api/asset/${ASSET_ID}/attribute/${attrName}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ value: currentVal })
                });
                const updateData = await updateRes.json();
                if (updateData.status === 'success') {
                    toast(`${nestedKey} updated to ${newValue}`);
                } else {
                    toast(`Failed to update ${nestedKey}: ${updateData.message || 'Unknown error'}`);
                    loadDetail();
                }
            } else {
                toast('Failed to update: attribute is not an object');
            }
        } else {
            toast('Attribute not found');
        }
    } catch (e) {
        console.error('Update nested value error:', e);
        toast('Failed to update value');
        loadDetail();
    }
}

async function toggleDay(attrName, nestedKey, day) {
    try {
        const res = await fetch(`/api/asset/${ASSET_ID}`);
        const asset = await res.json();

        if (asset && asset.attributes && asset.attributes[attrName] !== undefined) {
            let currentObj = asset.attributes[attrName];

            if (typeof currentObj === 'string') {
                try { currentObj = JSON.parse(currentObj); } catch (e) { return; }
            }

            if (typeof currentObj !== 'object' || currentObj === null) return;

            let currentDaysStr = (currentObj[nestedKey] || '').toUpperCase();
            const daysOrder = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
            let activeDays = [];

            if (currentDaysStr === 'EVERYDAY') {
                activeDays = [...daysOrder];
            } else {
                activeDays = currentDaysStr.split(',').map(d => d.trim()).filter(d => daysOrder.includes(d));
            }

            if (activeDays.includes(day)) {
                activeDays = activeDays.filter(d => d !== day);
            } else {
                activeDays.push(day);
            }

            activeDays.sort((a, b) => daysOrder.indexOf(a) - daysOrder.indexOf(b));

            let newValue = activeDays.join(',');
            if (activeDays.length === 7) newValue = 'EVERYDAY';
            if (activeDays.length === 0) newValue = 'NONE';

            currentObj[nestedKey] = newValue;

            const updateRes = await fetch(`/api/asset/${ASSET_ID}/attribute/${attrName}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ value: currentObj })
            });

            if ((await updateRes.json()).status === 'success') {
                toast(`Schedule updated: ${newValue}`);
                loadDetail();
            }
        }
    } catch (e) { console.error(e); }
}

async function toggleTimerOutput(attrName, nestedKey, relay) {
    try {
        const res = await fetch(`/api/asset/${ASSET_ID}`);
        const asset = await res.json();

        if (asset && asset.attributes && asset.attributes[attrName] !== undefined) {
            let currentObj = asset.attributes[attrName];

            if (typeof currentObj === 'string') {
                try { currentObj = JSON.parse(currentObj); } catch (e) { return; }
            }

            if (typeof currentObj !== 'object' || currentObj === null) return;

            let currentOutputsStr = (currentObj[nestedKey] || '').toUpperCase(); // "OUT 01,OUT 04" or "r1,r4"
            // Normalize to internal r1, r2 format for processing
            let activeOutputs = [];

            // Map "OUT 01" -> "r1" ... ...
            const mapOutToR = (str) => {
                const parts = str.split(',').map(s => s.trim());
                return parts.map(p => {
                    if (p.startsWith('OUT')) {
                        const num = parseInt(p.replace('OUT', '').trim());
                        return `r${num}`;
                    }
                    return p.toLowerCase(); // fallback for existing r1 format
                }).filter(p => p.startsWith('r'));
            };

            activeOutputs = mapOutToR(currentOutputsStr);

            if (activeOutputs.includes(relay)) {
                activeOutputs = activeOutputs.filter(r => r !== relay);
            } else {
                activeOutputs.push(relay);
            }

            // Sort numerically (r1, r2, r3, r4) and Convert back to "OUT 0X" format
            const sorted = activeOutputs.sort();

            const mapRToOut = (rFormatList) => {
                return rFormatList.map(r => {
                    const num = parseInt(r.replace('r', ''));
                    return `OUT ${String(num).padStart(2, '0')}`;
                });
            };

            let newValue = mapRToOut(sorted).join(',');
            currentObj[nestedKey] = newValue;

            const updateRes = await fetch(`/api/asset/${ASSET_ID}/attribute/${attrName}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ value: currentObj })
            });

            if ((await updateRes.json()).status === 'success') {
                toast(`Outputs updated: ${newValue || 'NONE'}`);
                loadDetail();
            }
        }
    } catch (e) {
        console.error(e);
        toast('Failed to update timer outputs');
    }
}

async function togglePin(attrName, key) {
    try {
        // Check if already pinned
        const isPinned = pinnedAttributes.some(p =>
            p.assetId === ASSET_ID &&
            p.attributeName === attrName &&
            p.key === key
        );

        const payload = { assetId: ASSET_ID, attributeName: attrName };
        if (key) payload.key = key;

        // If not pinned, prompt for a custom name
        if (!isPinned) {
            // New Requirement: Don't prompt for rules or timers
            if (attrName === 'RuleTargets' || (key && key.toLowerCase().startsWith('timer'))) {
                // Determine default friendly name
                if (attrName === 'RuleTargets') payload.displayName = 'My Rules';
                else payload.displayName = key; // Use key (friendly name equivalent for now)
            } else {
                const defaultName = key ? `${attrName} → ${key}` : attrName;
                const customName = prompt('Enter a display name for this pin:', defaultName);
                if (customName === null) return; // Cancelled
                if (customName && customName.trim() !== '') {
                    payload.displayName = customName.trim();
                }
            }
        }

        const res = await fetch('/api/user/preferences/pin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.status === 'success') {
            toast(isPinned ? 'Removed from dashboard' : 'Pinned to dashboard');
            loadDetail();
        }
    } catch (e) { toast('Action failed'); }
}

// --- CIRCULAR WHEEL PICKER LOGIC ---
let currentPickerTarget = null;
let currentPickerValue = 0;

function openWheelPicker(e, attrName, nestedKey, currentVal, maxVal) {
    e.stopPropagation();
    const picker = document.getElementById('wheelPicker');
    const overlay = document.getElementById('wheelPickerOverlay');
    const list = document.getElementById('wheelPickerList');
    const title = document.getElementById('wheelPickerTitle');

    currentPickerTarget = { attrName, nestedKey };
    currentPickerValue = currentVal;
    title.textContent = nestedKey;

    let html = '';
    const items = [];
    for (let i = 0; i <= maxVal; i++) items.push(i);

    const addRange = () => {
        items.forEach(i => {
            const padded = String(i).padStart(2, '0');
            html += `<div class="wheel-item" data-value="${i}">${padded}</div>`;
        });
    };

    addRange(); addRange(); addRange();
    list.innerHTML = html;

    picker.style.display = 'block';
    overlay.style.display = 'block';

    const itemHeight = 50;
    const middleOffset = (maxVal + 1) * itemHeight; 
    // Centering logic: ScrollTop = (index * height)
    const targetScroll = middleOffset + (currentVal * itemHeight);
    list.scrollTop = targetScroll;

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

function confirmWheelSelection() {
    if (currentPickerTarget) {
        updateNestedValue(currentPickerTarget.attrName, currentPickerTarget.nestedKey, currentPickerValue);
    }
    closeWheelPicker();
}

function closeWheelPicker() {
    document.getElementById('wheelPicker').style.display = 'none';
    document.getElementById('wheelPickerOverlay').style.display = 'none';
}

// ID Modal
function openIdModal() { document.getElementById('showIdModal').classList.add('show'); }
function closeIdModal() { document.getElementById('showIdModal').classList.remove('show'); }
function copyIdToClipboard() {
    // Use global ASSET_ID
    navigator.clipboard.writeText(ASSET_ID).then(() => toast('ID copied'));
}

async function renamePin(attrName, key) {
    const newName = prompt('Enter a new display name:');
    if (newName === null) return;

    try {
        const payload = { assetId: ASSET_ID, attributeName: attrName, displayName: newName };
        if (key) payload.key = key;

        const res = await fetch('/api/user/preferences/pin/rename', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.status === 'success') {
            toast('Renamed');
            loadDetail();
        } else {
            toast('Failed to rename');
        }
    } catch (e) {
        toast('Failed to rename');
    }
}

// Init
document.addEventListener('DOMContentLoaded', () => {
    loadDetail();
    // Poll every 3 seconds
    setInterval(loadDetail, 3000);
});
