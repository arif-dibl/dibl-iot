// State
let currentAssetId = null;
let currentAttribute = null;
let currentSubAttribute = null;
let realm = 'master';

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    // Priority: window.USER_REALM passed from template
    realm = window.USER_REALM || 'master';

    // Initialize DateTime Pickers
    initDateTimePickers();

    // Load Assets
    await loadAssets();

    // Sub-Attribute Listener
    const subSelect = document.getElementById('subAttributeSelect');
    subSelect.onchange = () => {
        currentSubAttribute = subSelect.value;
    };
});

// Note: friendlyNames is loaded globally by main.js

// Initialize date and time inputs with min/max and defaults
function initDateTimePickers() {
    const startDateInput = document.getElementById('startDate');
    const startTimeInput = document.getElementById('startTime');
    const endDateInput = document.getElementById('endDate');
    const endTimeInput = document.getElementById('endTime');

    const now = new Date();
    const minDate = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000)); // 30 days ago
    const defaultStart = new Date(now.getTime() - (24 * 60 * 60 * 1000)); // 24 hours ago

    // Format helpers
    const formatDate = (d) => {
        const pad = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    };
    const formatTime = (d) => {
        const pad = (n) => String(n).padStart(2, '0');
        return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };

    // Set min/max for date inputs
    startDateInput.min = formatDate(minDate);
    startDateInput.max = formatDate(now);
    startDateInput.value = formatDate(defaultStart);

    endDateInput.min = formatDate(minDate);
    endDateInput.max = formatDate(now);
    endDateInput.value = formatDate(now);

    // Set default times
    startTimeInput.value = '00:00';
    endTimeInput.value = '00:01';

    // Update end min when start changes
    startDateInput.addEventListener('change', () => {
        endDateInput.min = startDateInput.value;
    });
}

async function loadAssets() {
    const select = document.getElementById('assetSelect');
    select.innerHTML = '<option>Loading...</option>';

    try {
        const res = await fetch('/api/user/assets');
        const data = await res.json();

        if (data.error) {
            select.innerHTML = `<option value="">Error: ${data.error}</option>`;
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
    const select = document.getElementById('attributeSelect');
    const subGroup = document.getElementById('subAttributeGroup');
    const subSelect = document.getElementById('subAttributeSelect');

    select.innerHTML = '<option value="">Loading...</option>';
    select.disabled = true;
    subGroup.style.display = 'none';
    currentAssetId = assetId || null;
    currentAttribute = null;
    currentSubAttribute = null;

    if (!assetId) {
        select.innerHTML = '<option value="">Select device first...</option>';
        return;
    }

    try {
        const res = await fetch(`/api/asset/${assetId}`);
        const asset = await res.json();
        const attrs = asset.attributes || {};

        select.innerHTML = '<option value="">Select group...</option>';

        // Only use actual attribute keys, do not expand JSON
        Object.keys(attrs).sort().forEach(key => {
            const el = document.createElement('option');
            el.value = key;
            el.textContent = key;
            select.appendChild(el);
        });

        select.disabled = false;

        select.onchange = () => {
            currentAttribute = select.value;
            currentSubAttribute = null;

            // Check for Map/JSON type
            const attr = attrs[currentAttribute];
            let keys = [];
            let isJsonAttribute = false;

            console.log('Selected attribute:', currentAttribute);
            console.log('Attribute object:', attr);

            if (attr) {
                // The attribute could be the value directly OR have a .value property
                let val = attr.value !== undefined ? attr.value : attr;
                console.log('Using val:', val);

                // Try to parse if string
                if (typeof val === 'string') {
                    try {
                        val = JSON.parse(val);
                        console.log('Parsed value:', val);
                    } catch (e) {
                        console.log('Not JSON string');
                    }
                }

                // Check if value is an object with keys
                if (val && typeof val === 'object' && !Array.isArray(val)) {
                    keys = Object.keys(val).sort();
                    isJsonAttribute = keys.length > 0;
                    console.log('Detected keys:', keys);
                }
            }

            console.log('isJsonAttribute:', isJsonAttribute);

            if (isJsonAttribute) {
                subGroup.style.display = 'block';
                subSelect.innerHTML = '<option value="">(All Elements)</option>';
                keys.forEach(k => {
                    const opt = document.createElement('option');
                    opt.value = k;
                    opt.textContent = k;
                    subSelect.appendChild(opt);
                });
            } else {
                subGroup.style.display = 'none';
            }
        };

    } catch (e) {
        console.error(e);
        select.innerHTML = '<option value="">Error</option>';
    }
}

function getTimeRange() {
    const startDateInput = document.getElementById('startDate');
    const startTimeInput = document.getElementById('startTime');
    const endDateInput = document.getElementById('endDate');
    const endTimeInput = document.getElementById('endTime');

    // Combine date and time
    const startStr = `${startDateInput.value}T${startTimeInput.value || '00:00'}`;
    const endStr = `${endDateInput.value}T${endTimeInput.value || '23:59'}`;

    let start = new Date(startStr).getTime();
    let end = new Date(endStr).getTime();

    // Validation fallback
    if (isNaN(start)) start = Date.now() - 24 * 3600000;
    if (isNaN(end)) end = Date.now();

    // Ensure start < end
    if (start > end) {
        const temp = start;
        start = end;
        end = temp;
    }

    return { start, end };
}

// Visualization State
let currentData = null;
let chartInstance = null;

function updateView() {
    // Hide all
    document.getElementById('initialMessage').style.display = 'none';
    document.getElementById('jsonWrapper').style.display = 'none';
    document.getElementById('tableOutput').style.display = 'none';
    document.getElementById('graphOutput').style.display = 'none';

    // Show Selected
    const mode = document.querySelector('input[name="viewMode"]:checked').value;

    if (!currentData || (Array.isArray(currentData) && currentData.length === 0)) {
        const msg = document.getElementById('initialMessage');
        msg.style.display = 'block';
        if (typeof currentData === 'string') {
            msg.textContent = currentData;
        } else {
            msg.innerHTML = 'Choose a device and group above, then click <strong>Fetch Data</strong> to see the history.';
        }
        return;
    }

    if (mode === 'json') {
        const wrapper = document.getElementById('jsonWrapper');
        const out = document.getElementById('responseOutput');
        wrapper.style.display = 'block';
        out.textContent = JSON.stringify(currentData, null, 2);
        resetCopyButton();
    } else if (mode === 'table') {
        document.getElementById('tableOutput').style.display = 'block';
        renderTable(currentData);
    } else if (mode === 'graph') {
        document.getElementById('graphOutput').style.display = 'block';
        renderGraph(currentData);
    }
}

function renderTable(data) {
    const container = document.getElementById('tableOutput');
    if (!Array.isArray(data)) {
        container.innerHTML = '<div style="padding:10px; color:#f55;">Unable to display data in table format.</div>';
        return;
    }

    // Determine Display Name using Friendly Names
    let displayText = currentAttribute;

    // Check if friendlyNames is loaded and has attributes
    if (typeof friendlyNames !== 'undefined' && friendlyNames.attributes) {
        if (friendlyNames.attributes[currentAttribute]) {
            displayText = friendlyNames.attributes[currentAttribute];
        }
    }

    if (currentSubAttribute) {
        let subFriendly = currentSubAttribute;
        if (typeof friendlyNames !== 'undefined' && friendlyNames.keys && friendlyNames.keys[currentSubAttribute]) {
            subFriendly = friendlyNames.keys[currentSubAttribute];
        }
        displayText += ` (${subFriendly})`;
    } else if (currentAttribute === 'EnvData' || currentAttribute === 'MoistureData' || currentAttribute === 'RelayData') {
        displayText += ' (All)';
    }

    let html = '<table class="data-table"><thead><tr><th>Attribute Name</th><th>Date</th><th>Time</th><th>Value</th></tr></thead><tbody>';

    // Sort by timestamp desc (newest first)
    const sorted = [...data].sort((a, b) => b.x - a.x);

    sorted.forEach(pt => {
        const d = new Date(pt.x);
        const dateStr = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); // e.g., "11 Jan 2026"
        const timeStr = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }); // e.g., "10:15 AM"

        let val = pt.y;
        let displayVal = val;

        try {
            // Parse JSON if stringified
            if (typeof val === 'string' && (val.trim().startsWith('{') || val.trim().startsWith('['))) {
                val = JSON.parse(val);
            }

            if (val && typeof val === 'object') {
                // Format object as key-value pairs
                displayVal = '<div class="val-object">';
                Object.keys(val).sort().forEach(k => {
                    let v = val[k];
                    if (typeof v === 'object' && v !== null) v = JSON.stringify(v);
                    displayVal += `<div><span class="val-key">${k}:</span> ${v}</div>`;
                });
                displayVal += '</div>';
            } else if (typeof val === 'boolean') {
                displayVal = val ? '<span style="color:#27ae60;">✓ Yes</span>' : '<span style="color:#e74c3c;">✗ No</span>';
            } else {
                displayVal = String(val);
            }
        } catch (e) {
            displayVal = String(pt.y);
        }

        html += `<tr><td><strong>${displayText}</strong></td><td>${dateStr}</td><td>${timeStr}</td><td>${displayVal}</td></tr>`;
    });
    html += '</tbody></table>';

    // Add summary
    html = `<div style="margin-bottom: 0.75rem; font-size: 0.85rem; color: var(--text-muted);">
        Showing <strong>${sorted.length}</strong> records
    </div>` + html;

    container.innerHTML = html;
}

function renderGraph(data) {
    const ctx = document.getElementById('datapointChart').getContext('2d');

    if (chartInstance) {
        chartInstance.destroy();
    }

    if (!Array.isArray(data)) return;

    // Sort by timestamp asc for graph
    const sorted = [...data].sort((a, b) => a.x - b.x);

    const labels = sorted.map(pt => new Date(pt.x).toLocaleString());
    const values = sorted.map(pt => {
        let val = pt.y;

        // Handle boolean strings or actual booleans
        if (val === 'true' || val === true) return 1;
        if (val === 'false' || val === false) return 0;

        // Attempt to convert to number
        const v = Number(val);
        return isNaN(v) ? 0 : v;
    });

    chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: (currentAttribute + (currentSubAttribute ? `.${currentSubAttribute}` : '')) || 'Value',
                data: values,
                borderColor: '#4CAF50',
                backgroundColor: 'rgba(76, 175, 80, 0.2)',
                borderWidth: 2,
                tension: 0.1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'nearest',
                axis: 'x',
                intersect: false
            },
            scales: {
                x: {
                    ticks: { color: '#ccc', maxTicksLimit: 10 },
                    grid: { color: '#444' }
                },
                y: {
                    ticks: { color: '#ccc' },
                    grid: { color: '#444' }
                }
            },
            plugins: {
                legend: { labels: { color: '#fff' } },
                tooltip: {
                    enabled: true,
                    mode: 'nearest',
                    intersect: false,
                    displayColors: false,
                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                    titleFont: { size: 13 },
                    bodyFont: { size: 13, weight: 'bold' },
                    padding: 10,
                    callbacks: {
                        title: function (context) {
                            return context[0].label;
                        },
                        label: function (context) {
                            return `Value: ${context.parsed.y}`;
                        }
                    }
                }
            }
        }
    });
}


async function fetchDatapoints() {
    if (!currentAssetId || !currentAttribute) {
        currentData = "Please select a device and group.";
        updateView();
        return;
    }

    // Show loading
    document.getElementById('initialMessage').textContent = "Fetching...";
    document.getElementById('initialMessage').style.display = 'block';
    document.getElementById('jsonWrapper').style.display = 'none';
    document.getElementById('tableOutput').style.display = 'none';
    document.getElementById('graphOutput').style.display = 'none';

    const { start, end } = getTimeRange();
    // Official API: POST /api/{realm}/asset/datapoint/{assetId}/{attributeName}
    const endpoint = `/api/${realm}/asset/datapoint/${currentAssetId}/${currentAttribute}`;

    const body = {
        fromTimestamp: start,
        toTimestamp: end,
        type: "json"
    };

    try {
        const res = await fetch('/api/debug/proxy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                method: 'POST', // Changed from GET to POST
                endpoint: endpoint,
                body: body
            })
        });
        const data = await res.json();

        // Check for error in proxy envelope
        if (data.status >= 400) {
            currentData = data.data || "Error fetching data";
        } else {
            // Success
            // API usually returns plain array: [{"x": ts, "y": val}, ...]
            // Or sometimes wrapped. Let's assume array or data property.
            let rawData = data.data || data;

            // If proxy returns {status: 200, data: [...]}
            // rawData should be the array.
            if (data.status === 200 && Array.isArray(data.data)) {
                rawData = data.data;
            }

            // Process Data if Sub-Attribute is selected
            if (Array.isArray(rawData) && currentSubAttribute) {
                currentData = rawData.map(pt => {
                    let val = pt.y;
                    try {
                        // Parse if string
                        if (typeof val === 'string') val = JSON.parse(val);
                        // Extract sub-key
                        if (val && typeof val === 'object') {
                            return { x: pt.x, y: val[currentSubAttribute] };
                        }
                    } catch (e) { console.log('Parse error', e); }
                    return { x: pt.x, y: null }; // Invalid or missing
                }).filter(pt => pt.y !== null && pt.y !== undefined);
            } else {
                currentData = rawData;
            }
        }

    } catch (e) {
        currentData = 'Request failed: ' + e.message;
    }


    updateView();
}

async function exportDatapoints() {
    if (!currentAssetId || !currentAttribute) {
        alert("Please select a device and group first.");
        return;
    }

    const { start, end } = getTimeRange();

    // Construct attributeRefs JSON
    const refs = JSON.stringify([{ id: currentAssetId, name: currentAttribute }]);
    const encodedRefs = encodeURIComponent(refs);

    // API params: fromTimestamp, toTimestamp, attributeRefs
    const endpoint = `/api/${realm}/asset/datapoint/export?attributeRefs=${encodedRefs}&fromTimestamp=${start}&toTimestamp=${end}`;

    // Show feedback
    const btn = document.querySelector('button[onclick="exportDatapoints()"]');
    const originalText = btn.textContent;
    btn.textContent = "Exporting...";
    btn.disabled = true;

    try {
        const res = await fetch('/api/debug/proxy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                method: 'GET',
                endpoint: endpoint
            })
        });

        if (res.ok) {
            // Check if it returned a file (blob) or JSON error
            const contentType = res.headers.get("Content-Type");
            if (contentType && contentType.includes("application/json")) {
                const data = await res.json();
                if (data.status >= 400) {
                    alert("Export failed: " + JSON.stringify(data.data));
                } else {
                    // Unexpected JSON success?
                    console.log("Unexpected JSON", data);
                }
            } else {
                // Should be a blob
                const blob = await res.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                // Try to get filename from header or default
                // The proxy sets Content-Disposition
                a.download = `${currentAttribute}_export.zip`;
                document.body.appendChild(a);
                a.click();
                a.remove();
                window.URL.revokeObjectURL(url);
            }
        } else {
            alert("Export request failed.");
        }
    } catch (e) {
        console.error(e);
        alert("Export error: " + e.message);
    } finally {
        btn.textContent = originalText;
        btn.disabled = false;
    }
}

function copyToClipboard() {
    const text = document.getElementById('responseOutput').textContent;
    const btn = document.getElementById('copyBtn');

    navigator.clipboard.writeText(text).then(() => {
        btn.classList.add('success');
        const originalHtml = btn.innerHTML;
        btn.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
            Copied!
        `;

        setTimeout(() => {
            btn.classList.remove('success');
            btn.innerHTML = originalHtml;
        }, 2000);
    }).catch(err => {
        console.error('Could not copy text: ', err);
        btn.textContent = "Error";
    });
}

function resetCopyButton() {
    const btn = document.getElementById('copyBtn');
    btn.classList.remove('success');
    btn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
        Copy
    `;
}
