async function loadAssets() {
    try {
        const grid = document.getElementById('assetsGrid');

        const res = await fetch('/api/user/assets');
        const data = await res.json();

        const assets = Array.isArray(data) ? data : (data.assets || []);

        if (assets.length === 0) {
            grid.innerHTML = `
<div
    style="grid-column: 1/-1; text-align:center; padding:3rem; color:var(--text-muted); border:1px dashed var(--border); border-radius:8px;">
    No IoT devices linked. Click <b>+ Link New IoT Device</b> to get started.
</div>`;
            return;
        }

        grid.innerHTML = assets.map(a => {
            // Calculate activity status
            let activityStatus = 'unknown';
            let statusColor = 'var(--text-muted)';
            let statusDot = '⚪';

            if (a.lastActivityTimestamp) {
                const diffMinutes = (Date.now() - a.lastActivityTimestamp) / (1000 * 60);
                if (diffMinutes <= 0.5) {
                    activityStatus = 'Active';
                    statusColor = 'var(--success)';
                    statusDot = '🟢';
                } else if (diffMinutes <= 5.0) {
                    activityStatus = 'Idle';
                    statusColor = '#f0ad4e';
                    statusDot = '🟡';
                } else {
                    activityStatus = 'Offline';
                    statusColor = 'var(--danger)';
                    statusDot = '🔴';
                }
                activityStatus += ` (${timeAgo(a.lastActivityTimestamp)})`;
            }

            return `
<div class="card asset-card" style="cursor:pointer; position:relative; transition:transform 0.2s; display:flex; flex-direction:column; gap:0.75rem;"
    onclick="location.href='/asset/${a.id}'">

    <!-- Row 1: Name and Edit -->
    <div style="display:flex; justify-content:space-between; align-items:center;">
        <div style="font-weight:700; font-size:1.2rem; color:var(--text-dark);">${a.name}</div>
        <button class="btn-ghost btn-sm" onclick="event.stopPropagation(); openEditModal('${a.id}', '${a.name}')"
            style="padding:2px 8px; font-size:0.8rem;">
            Edit Name
        </button>
    </div>

    <!-- Row 2: Type and Status -->
    <div style="display:flex; align-items:center; gap:12px;">
         <span style="background:var(--bg-light); padding:3px 10px; border-radius:12px; font-size:0.8rem; font-weight:600; color:#555;">${a.type}</span>
         <div style="display:flex; align-items:center; gap:6px; font-size:0.9rem; background:#f8f9fa; padding:3px 10px; border-radius:12px; border:1px solid #eee;">
            <span>${statusDot}</span>
            <span style="color:${statusColor}; font-weight:700;">${activityStatus}</span>
        </div>
    </div>

    <div style="height:1px; background:#f0f0f0; margin:0.25rem 0;"></div>

    <!-- Row 3: Actions (Show ID, Unlink) -->
    <div style="display:flex; justify-content:space-between; align-items:center;">
        <span onclick="event.stopPropagation(); showIdModal('${a.id}')"
            style="cursor:pointer; color:var(--primary); font-weight:600; font-size:0.9rem; border-bottom:1px dashed var(--primary);">
            Show ID
        </span>
        <button class="btn-danger btn-sm" onclick="event.stopPropagation(); unlinkAsset('${a.id}')"
            style="width:auto; padding:4px 12px; font-size:0.8rem;">Unlink</button>
    </div>
</div>
`;
        }).join('');

    } catch (e) {
        console.error(e);
        toast('Failed to load assets');
    }
}

// Link Asset Modal
function openLinkModal() { document.getElementById('linkAssetModal').classList.add('show'); }
function closeLinkModal() {
    document.getElementById('linkAssetModal').classList.remove('show');
    document.getElementById('linkAssetId').value = '';
}

// Edit Asset Modal
function openEditModal(id, name) {
    document.getElementById('editAssetId').value = id;
    document.getElementById('editAssetName').value = name;
    document.getElementById('editAssetModal').classList.add('show');
}
function closeEditModal() {
    document.getElementById('editAssetModal').classList.remove('show');
}

// Show ID Modal
function showIdModal(id) {
    document.getElementById('displayAssetId').textContent = id;
    document.getElementById('showIdModal').classList.add('show');
}
function closeIdModal() {
    document.getElementById('showIdModal').classList.remove('show');
}
function copyIdToClipboard() {
    const id = document.getElementById('displayAssetId').textContent;
    navigator.clipboard.writeText(id).then(() => {
        toast('ID copied to clipboard');
    }).catch(() => {
        toast('Failed to copy ID');
    });
}

async function updateAssetName() {
    const id = document.getElementById('editAssetId').value;
    const newName = document.getElementById('editAssetName').value;

    if (!newName) return toast("Name cannot be empty");

    try {
        const res = await fetch(`/api/user/assets/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: newName })
        });
        const data = await res.json();

        if (res.ok && data.status === 'success') {
            toast("Asset updated");
            closeEditModal();
            loadAssets(); // Refresh list
        } else {
            toast("Error: " + (data.message || "Failed to update"));
        }
    } catch (e) {
        console.error(e);
        toast("Connection error");
    }
}

// Logic
async function linkAsset() {
    const id = document.getElementById('linkAssetId').value;
    if (!id) return toast('Please enter an ID');

    try {
        const res = await fetch('/api/user/assets', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ assetId: id })
        });
        const data = await res.json();

        if (data.status === 'success') {
            toast('IoT Device Linked Successfully');
            closeLinkModal();
            // Add a small delay for backend propagation
            setTimeout(loadAssets, 500);
        } else {
            toast('Error: ' + (data.message || 'Failed'));
        }
    } catch (e) {
        toast('Connection Error');
    }
}

async function unlinkAsset(id) {
    if (!confirm('Are you sure you want to unlink this asset? It will accept NO from your account.')) return;

    try {
        const res = await fetch(`/api/user/assets/${id}`, { method: 'DELETE' });
        const data = await res.json();

        if (data.status === 'success') {
            toast('IoT Device Unlinked');
            // Add a small delay for backend propagation
            setTimeout(loadAssets, 500);
        } else {
            toast('Error unlinking asset');
        }
    } catch (e) {
        toast('Connection Error');
    }
}

// Init
document.addEventListener('DOMContentLoaded', () => {
    loadAssets();
});
