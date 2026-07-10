// Site migration imports (/api/v1/imports) — backs the Import wizard.
// Flow: upload (or URL) → create import → analyze → run, with 2s polling
// on GET /imports/<id> while the backend is analyzing/running.

export async function getImports() {
    return this.request('/imports');
}

export async function getImport(importId) {
    return this.request(`/imports/${importId}`);
}

export async function createImport(sourceType, source, options = {}) {
    return this.request('/imports', {
        method: 'POST',
        body: { source_type: sourceType, source, options },
    });
}

export async function analyzeImport(importId) {
    return this.request(`/imports/${importId}/analyze`, { method: 'POST' });
}

// SSH-source preflight (plan 31 #8): probe a reachable box before pulling it.
// Returns {reachable, docroot_exists, entry_count, detected_stack, sample:[...]}
// or 501 {error, code:'LINUX_ONLY'} off a Linux panel host (e.g. Windows dev).
export async function probeSshImportSource(source) {
    return this.request('/imports/ssh/probe', {
        method: 'POST',
        body: { source },
    });
}

export async function runImport(importId, fromStep = null, options = null) {
    const body = {};
    if (fromStep) body.from_step = fromStep;
    if (options) body.options = options;
    return this.request(`/imports/${importId}/run`, { method: 'POST', body });
}

export async function deleteImport(importId) {
    return this.request(`/imports/${importId}`, { method: 'DELETE' });
}

// Multipart backup-archive upload with progress, XHR-based like files.js
// uploadFile (fetch has no upload progress). Resolves to {upload_path}.
export async function uploadImportArchive(file, onProgress = null) {
    const token = this.getToken();
    const formData = new FormData();
    formData.append('file', file);

    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${this.baseUrl}/imports/upload`);
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);

        if (onProgress) {
            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable) onProgress((e.loaded / e.total) * 100);
            };
        }

        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                resolve(JSON.parse(xhr.responseText));
            } else {
                let message = 'Upload failed';
                try {
                    message = JSON.parse(xhr.responseText).error || message;
                } catch { /* non-JSON error body */ }
                reject(new Error(message));
            }
        };

        xhr.onerror = () => reject(new Error('Upload failed'));
        xhr.send(formData);
    });
}
