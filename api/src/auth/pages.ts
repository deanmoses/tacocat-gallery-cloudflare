// The two admin screens. Their scripts are browser code inside template strings, so neither tsc nor ESLint checks them; keep them small.

const PAGE_HEAD = `<!doctype html>
<meta charset="utf-8"><meta name="viewport" content="width=device-width">
<style>body{font:17px system-ui;margin:16px;max-width:480px}button{font:inherit;padding:10px 16px}#msg{margin-top:16px}</style>`;

const BROWSER_LIB = 'https://cdn.jsdelivr.net/npm/@simplewebauthn/browser@14.0.0/+esm';

export const LOGIN_PAGE = `${PAGE_HEAD}
<title>Log in</title>
<h1>Tacocat admin</h1>
<p id="guest" hidden><button id="login">Log in with passkey</button></p>
<p id="admin" hidden>Logged in as <b id="name"></b>. <button id="logout">Log out</button></p>
<p id="msg"></p>
<script type="module">
import { startAuthentication } from '${BROWSER_LIB}';
const $ = (id) => document.getElementById(id);
const post = (path, body) => fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
function show(admin) {
    $('guest').hidden = !!admin;
    $('admin').hidden = !admin;
    $('name').textContent = admin ?? '';
}
show((await (await fetch('/api/auth/status')).json()).admin);
$('login').onclick = async () => {
    $('msg').textContent = '';
    try {
        const optionsJSON = await (await post('/api/auth/login/options')).json();
        const res = await post('/api/auth/login/verify', await startAuthentication({ optionsJSON }));
        const body = await res.json();
        if (!res.ok) throw new Error(body.error);
        show(body.admin);
    } catch (e) {
        $('msg').textContent = e.message;
    }
};
$('logout').onclick = async () => show((await (await post('/api/auth/logout')).json()).admin);
</script>`;

export const INVITE_PAGE = `${PAGE_HEAD}
<title>Create passkey</title>
<h1>Tacocat admin</h1>
<p>Create a passkey to log in to the gallery as an admin. Your device will ask for Face ID, Touch ID or your password manager.</p>
<p><button id="create">Create passkey</button></p>
<p id="msg"></p>
<script type="module">
import { startRegistration } from '${BROWSER_LIB}';
const $ = (id) => document.getElementById(id);
const token = location.pathname.split('/').pop();
const post = (path, body) => fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
$('create').onclick = async () => {
    $('msg').textContent = '';
    try {
        const options = await post('/api/auth/register/options', { token });
        const optionsJSON = await options.json();
        if (!options.ok) throw new Error(optionsJSON.error);
        const res = await post('/api/auth/register/verify', { token, response: await startRegistration({ optionsJSON }) });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error);
        $('create').hidden = true;
        $('msg').innerHTML = 'Done. You are logged in as <b></b>. Next time, log in at <a href="/login">/login</a>.';
        $('msg').querySelector('b').textContent = body.admin;
    } catch (e) {
        $('msg').textContent = e.message;
    }
};
</script>`;
