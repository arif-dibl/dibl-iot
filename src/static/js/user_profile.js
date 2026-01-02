let userProfile = null;

async function loadProfile() {
    try {
        const res = await fetch('/api/user/profile');
        const data = await res.json();

        if (data.error) {
            document.getElementById('profile-loading').innerHTML = '<span style="color:var(--danger);">Error loading profile</span>';
            return;
        }

        userProfile = data;

        // Set form fields
        document.getElementById('username').value = data.username || '';
        document.getElementById('email').value = data.email || '';
        document.getElementById('firstName').value = data.firstName || '';
        document.getElementById('lastName').value = data.lastName || '';

        // Set display
        const fullName = [data.firstName, data.lastName].filter(Boolean).join(' ') || data.username || 'User';
        document.getElementById('displayName').textContent = fullName;
        document.getElementById('displayEmail').textContent = data.email || '';
        document.getElementById('avatar').textContent = (data.firstName || data.username || 'U')[0].toUpperCase();

        document.getElementById('profile-loading').style.display = 'none';
        document.getElementById('profile-form').style.display = 'block';
    } catch (e) {
        console.error('Profile load error', e);
        document.getElementById('profile-loading').innerHTML = '<span style="color:var(--danger);">Error loading profile</span>';
    }
}

document.getElementById('profile-form').addEventListener('submit', async (e) => {
    e.preventDefault();

    if (!userProfile) return;

    const updatedProfile = {
        ...userProfile,
        firstName: document.getElementById('firstName').value,
        lastName: document.getElementById('lastName').value
    };

    try {
        const res = await fetch('/api/user/profile', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updatedProfile)
        });
        const data = await res.json();

        if (data.status === 'success') {
            toast('Profile updated successfully!');
            loadProfile(); // Refresh display
        } else {
            toast('Error: ' + (data.error || 'Unknown error'));
        }
    } catch (e) {
        console.error('Profile save error', e);
        toast('Failed to save profile');
    }
});

document.getElementById('password-form').addEventListener('submit', async (e) => {
    e.preventDefault();

    const currentPassword = document.getElementById('currentPassword').value;
    const newPassword = document.getElementById('newPassword').value;
    const confirmPassword = document.getElementById('confirmPassword').value;

    if (!currentPassword) {
        toast('Please enter your current password');
        return;
    }

    if (newPassword !== confirmPassword) {
        toast('Passwords do not match!');
        return;
    }

    if (newPassword.length < 6) {
        toast('Password must be at least 6 characters');
        return;
    }

    try {
        const res = await fetch('/api/user/change-password', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ currentPassword: currentPassword, password: newPassword })
        });
        const data = await res.json();

        if (data.status === 'success') {
            toast('Password changed! Please log in again.');
            document.getElementById('currentPassword').value = '';
            document.getElementById('newPassword').value = '';
            document.getElementById('confirmPassword').value = '';
            setTimeout(() => window.location.href = '/logout', 2000);
        } else {
            toast('Error: ' + (data.error || 'Unknown error'));
        }
    } catch (e) {
        console.error('Password change error', e);
        toast('Failed to change password');
    }
});

async function loadLinkedUsers() {
    try {
        const res = await fetch('/api/user/asset-partners');
        const data = await res.json();

        if (data && data.length > 0) {
            document.getElementById('linked-users-card').style.display = 'block';
            document.getElementById('linked-users-loading').style.display = 'none';
            const list = document.getElementById('linked-users-list');

            list.innerHTML = data.map(item => `
                <div style="background:#f8f9fa; border:1px solid #eee; border-radius:8px; padding:1rem;">
                    <div style="font-weight:700; color:var(--primary); margin-bottom:0.8rem; font-size:0.95rem; border-bottom:1pxdashed #ddd; padding-bottom:0.5rem;">
                        ${item.assetName}
                    </div>
                    <div style="display:flex; flex-wrap:wrap; gap:10px;">
                        ${item.users.map(u => {
                // Extract Initial
                const initial = (u && u.length > 0) ? u[0].toUpperCase() : '?';
                // Random color for avatar background based on name
                const colors = ['#3498db', '#e74c3c', '#f1c40f', '#2ecc71', '#9b59b6', '#34495e'];
                let hash = 0;
                for (let i = 0; i < u.length; i++) hash = u.charCodeAt(i) + ((hash << 5) - hash);
                const bg = colors[Math.abs(hash) % colors.length];

                return `
                            <div style="display:flex; align-items:center; gap:8px; background:white; padding:6px 12px; border-radius:20px; border:1px solid #eee; box-shadow:0 1px 2px rgba(0,0,0,0.05);">
                                <div style="width:24px; height:24px; background:${bg}; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:0.75rem; font-weight:bold; color:white;">
                                    ${initial}
                                </div>
                                <span style="font-size:0.9rem; color:#555; font-weight:500;">${u}</span>
                            </div>
                            `;
            }).join('')}
                    </div>
                </div>
            `).join('');
        } else {
            // Keep hidden if no partners
        }
    } catch (e) {
        console.error('Failed to load linked users', e);
    }
}

loadProfile();
loadLinkedUsers();
