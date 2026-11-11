// Stand-in for the Agent Foundry (Prism) host, so the workbench runs as a normal web page.
// It provides the three things the workbench uses: host.contentRoot, host.callService, host.prism.
// callService talks to Kinetic's REST API v2 directly with the signed-in user's credentials.

const READ_ONLY_POSTS = new Set(['GetByID', 'GetList', 'GetRows']);

export const session = {
  serverUrl: '', company: '', plant: '', username: '', password: '', apiKey: '',
  allowUpdates: false, timeoutSeconds: 90,
};

function basicAuth(user, pass) {
  const bytes = new TextEncoder().encode(`${user}:${pass}`);
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return `Basic ${btoa(bin)}`;
}

function errorText(status, body) {
  if (body && typeof body === 'object') {
    return body.ErrorMessage || (body.error && body.error.message) || JSON.stringify(body).slice(0, 400);
  }
  return String(body || `HTTP ${status}`).slice(0, 400);
}

export async function callService({ service, operation, method = 'GET', input = {} }) {
  const verb = String(method).toUpperCase();
  if (verb !== 'GET' && !READ_ONLY_POSTS.has(operation) && !session.allowUpdates) {
    throw new Error('Updates are off. Turn on "Allow updates" at the top of the page, then try again.');
  }
  const base = `${session.serverUrl.replace(/\/+$/, '')}/api/v2/odata/${encodeURIComponent(session.company)}/${service}/${operation}`;
  let url = base;
  const init = {
    method: verb,
    headers: {
      Accept: 'application/json',
      Authorization: basicAuth(session.username, session.password),
      'x-api-key': session.apiKey,
      CallSettings: JSON.stringify({ Company: session.company, Plant: session.plant }),
    },
  };
  if (verb === 'GET') {
    const params = new URLSearchParams();
    Object.entries(input || {}).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') params.set(k, String(v)); });
    const qs = params.toString().replace(/\+/g, '%20');
    if (qs) url += `?${qs}`;
  } else {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(input || {});
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), (session.timeoutSeconds || 90) * 1000);
  init.signal = controller.signal;
  let response;
  try {
    response = await fetch(url, init);
  } catch (err) {
    if (err && err.name === 'AbortError') throw new Error(`Kinetic did not respond within ${session.timeoutSeconds} seconds (${service}/${operation}).`);
    throw new Error('Could not reach Kinetic. Check the server URL and your network; if the server is reachable, the browser may be blocking cross-site requests (CORS).');
  } finally {
    clearTimeout(timer);
  }
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : {}; } catch { body = text; }
  if (response.status === 401) throw new Error('Kinetic rejected the sign-in (401). Check username, password, and API key.');
  if (!response.ok) throw new Error(`Kinetic returned HTTP ${response.status}: ${errorText(response.status, body)}`);
  return { data: body };
}

export function definePrismAgent(definition) {
  return class PrismAgentElement extends HTMLElement {
    async connectedCallback() {
      if (this._started) return;
      this._started = true;
      const host = {
        contentRoot: this.shadowRoot || this.attachShadow({ mode: 'open' }),
        callService,
        prism: { standalone: true },
        element: this,
      };
      this.host = host;
      if (definition.initialize) await definition.initialize({ host });
      if (definition.connect) definition.connect({ host });
    }
    disconnectedCallback() {
      if (this.host && definition.disconnect) definition.disconnect({ host: this.host });
    }
  };
}
