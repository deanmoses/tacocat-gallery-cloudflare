// Browser self-test for the presigned PUT. Its script is browser code inside a template string, so neither tsc nor ESLint checks it.

export const UPLOAD_TEST_PAGE = String.raw`<!doctype html>
<meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>R2 upload test</title>
<style>body{font:15px system-ui;margin:16px;max-width:720px}pre{white-space:pre-wrap;background:#f4f4f4;padding:8px}</style>
<h1>Presigned PUT to R2</h1>
<p><input type="file" id="file" multiple accept="image/*,video/*"> <button id="self">Self-test with a fixture</button></p>
<pre id="log"></pre>
<script>
const log = (m) => (document.getElementById('log').textContent += m + '\n');
const day = new Date().toISOString().slice(5, 10);
async function upload(name, blob) {
    const path = '/2025/' + day + '/' + name;
    const t0 = performance.now();
    const signed = await (await fetch('/api/upload-url', { method: 'POST', body: JSON.stringify({ path, contentType: blob.type || 'application/octet-stream' }) })).json();
    const t1 = performance.now();
    const put = await fetch(signed.url, { method: 'PUT', body: blob, headers: { 'content-type': signed.contentType } });
    const t2 = performance.now();
    log(name + ': sign ' + Math.round(t1 - t0) + ' ms, PUT ' + put.status + ' in ' + Math.round(t2 - t1) + ' ms (' + blob.size + ' bytes), ETag ' + put.headers.get('etag'));
    for (let i = 0; i < 30; i++) {
        const album = await (await fetch('/api/album/2025/' + day + '/?consistency=primary')).json();
        const item = album.children.find((c) => c.item_name === name);
        if (item) { log('  processed after ' + Math.round(performance.now() - t2) + ' ms: title=' + item.title + ' version=' + item.version_id); return; }
        await new Promise((r) => setTimeout(r, 1000));
    }
    log('  not processed after 30 s');
}
document.getElementById('file').onchange = async (e) => { for (const f of e.target.files) await upload(f.name, f); };
document.getElementById('self').onclick = async () => {
    const blob = await (await fetch('/raw/originals/2024/06-15/FullMetadata.jpg/0mudcdwwsdc76b9b2fc9b4169')).blob();
    await upload('selftest-' + Date.now() + '.jpg', new Blob([blob], { type: 'image/jpeg' }));
};
</script>`;
