function copyUrl(url, method = 'GET', body = null) {
    document.getElementById('endpoint').value = url;
    document.getElementById('method').value = method;

    if (body) {
        document.getElementById('reqBody').value = JSON.stringify(body, null, 2);
    } else {
        document.getElementById('reqBody').value = '';
    }

    // Use document title as brief visual feedback
    const prev = document.title;
    document.title = "Copied!";
    setTimeout(() => document.title = prev, 1000);
}

async function sendRequest() {
    const method = document.getElementById('method').value;
    const endpoint = document.getElementById('endpoint').value;
    const bodyStr = document.getElementById('reqBody').value;
    const out = document.getElementById('responseOutput');

    out.textContent = "Sending...";
    out.style.color = "#aaa";

    let body = null;
    if (bodyStr && method !== 'GET') {
        try {
            body = JSON.parse(bodyStr);
        } catch (e) {
            out.textContent = "Invalid JSON in Request Body:\n" + e;
            out.style.color = "#f55";
            return;
        }
    }

    try {
        const res = await fetch('/api/debug/proxy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ method, endpoint, body })
        });
        const data = await res.json();

        out.scrollTop = 0;
        if (data.status >= 200 && data.status < 300) {
            out.style.color = "#0f0";
        } else {
            out.style.color = "#f55";
        }

        out.textContent = `Status: ${data.status}\n\n${JSON.stringify(data.data, null, 2)}`;

    } catch (e) {
        out.textContent = "Proxy Error:\n" + e;
        out.style.color = "#f55";
    }
}
