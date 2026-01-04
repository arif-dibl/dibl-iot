// State
let currentAssetId = null;
let currentAttribute = null;
let currentSubAttribute = null;
let realm = 'master';

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    // Priority: window.USER_REALM passed from template
    realm = window.USER_REALM || 'master';
    await loadAssets();

    // Sub-Attribute Listener
    const subSelect = document.getElementById('subAttributeSelect');
    subSelect.onchange = () => {
        currentSubAttribute = subSelect.value;
    };
});

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
            select.innerHTML = '<option value="">No linked assets</option>';
            return;
        }

        select.innerHTML = '<option value="">Select asset...</option>';
        assets.forEach(a => {
            const opt = document.createElement('option');
            opt.value = a.id;
            opt.textContent = a.name || a.id;
            select.appendChild(opt);
        });
    } catch (e) {
        console.error(e);
        select.innerHTML = '<option value="">Error loading assets</option>';
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
        select.innerHTML = '<option value="">Select asset first...</option>';
        return;
    }

    try {
        const res = await fetch(`/api/asset/${assetId}`);
        const asset = await res.json();
        const attrs = asset.attributes || {};

        select.innerHTML = '<option value="">Select attribute...</option>';

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
            if (attr && (attr.type === 'textMap' || typeof attr.value === 'object')) {
                subGroup.style.display = 'block';
                subSelect.innerHTML = '<option value="">(Optional) Select key...</option>';

                let keys = [];
                try {
                    // Try to get keys from current value
                    const val = typeof attr.value === 'string' ? JSON.parse(attr.value) : attr.value;
                    if (val && typeof val === 'object') {
                        keys = Object.keys(val).sort();
                    }
                } catch (e) { console.log('Parsing error for keys', e); }

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
    const sel = document.getElementById('timeSelect').value;
    const now = Date.now();
    let start = now - 24 * 3600000; // default 24h

    if (sel === 'last_hour') start = now - 3600000;
    else if (sel === 'last_7d') start = now - 7 * 24 * 3600000;
    else if (sel === 'today') {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        start = d.getTime();
    }
    return { start, end: now };
}

// Visualization State
let currentData = null;
let chartInstance = null;

function updateView() {
    // Hide all
    document.getElementById('responseOutput').style.display = 'none';
    document.getElementById('tableOutput').style.display = 'none';
    document.getElementById('graphOutput').style.display = 'none';

    // Show Selected
    const mode = document.querySelector('input[name="viewMode"]:checked').value;

    if (!currentData || (Array.isArray(currentData) && currentData.length === 0)) {
        document.getElementById('responseOutput').style.display = 'block';
        if (mode !== 'json') {
            // Show empty message in JSON box as fallback or clear others
            document.getElementById('responseOutput').textContent = "No data to display.";
        }
        return;
    }

    if (mode === 'json') {
        const out = document.getElementById('responseOutput');
        out.style.display = 'block';
        out.textContent = JSON.stringify(currentData, null, 2);
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
        container.innerHTML = '<div style="padding:10px; color:#f55;">Data is not an array. Cannot render table.</div>';
        return;
    }

    let html = '<table class="data-table"><thead><tr><th>Timestamp</th><th>Date</th><th>Value</th></tr></thead><tbody>';

    // Sort by timestamp desc
    const sorted = [...data].sort((a, b) => b.x - a.x);

    sorted.forEach(pt => {
        const date = new Date(pt.x).toLocaleString();
        let val = pt.y;
        let displayVal = val;

        try {
            // Attempt to parse stringified JSON if it looks like an object
            if (typeof val === 'string' && (val.trim().startsWith('{') || val.trim().startsWith('['))) {
                val = JSON.parse(val);
            }

            if (val && typeof val === 'object') {
                // Format as styled key-value list
                displayVal = '<div style="font-size:0.85em; max-height:150px; overflow-y:auto;">';
                Object.keys(val).sort().forEach(k => {
                    let v = val[k];
                    if (typeof v === 'object' && v !== null) v = JSON.stringify(v);
                    displayVal += `<div style="margin-bottom:2px;"><span style="color:#666; font-weight:600;">${k}:</span> ${v}</div>`;
                });
                displayVal += '</div>';
            } else {
                displayVal = String(val);
            }
        } catch (e) {
            // Fallback to raw string if parsing fails
            displayVal = String(pt.y);
        }

        html += `<tr><td>${pt.x}</td><td>${date}</td><td>${displayVal}</td></tr>`;
    });
    html += '</tbody></table>';
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
        // Attempt to convert to number if possible
        const v = Number(pt.y);
        return isNaN(v) ? 0 : v; // Fallback to 0 if not a number? Or null.
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
                legend: { labels: { color: '#fff' } }
            }
        }
    });
}


async function fetchDatapoints() {
    if (!currentAssetId || !currentAttribute) {
        currentData = "Please select an asset and attribute.";
        updateView();
        return;
    }

    // Show loading in JSON view temporarily
    document.getElementById('responseOutput').textContent = "Fetching...";
    document.getElementById('responseOutput').style.display = 'block';
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
        alert("Please select an asset and attribute first.");
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
