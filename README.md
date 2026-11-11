# Planner's Workbench (standalone page)

The Agent Foundry Planner's Workbench, packaged as a normal web page so it can be hosted
(for example on GitHub Pages) and added to Kinetic as a Home tab.

## Files

| File | Purpose |
|---|---|
| `index.html` | Sign-in panel, top bar with **Allow updates** switch, mounts the workbench |
| `config.js` | Default server URL, company, and site. No credentials. |
| `prism-shim.js` | Replaces the Agent Foundry host: calls Kinetic REST API v2 directly |
| `workbench.js` | The workbench itself, from the Agent Foundry build, with one bug fix |

## Security

- Username, password, and API key are typed on the sign-in panel and kept only in this
  browser tab (cleared when the tab closes, or on **Sign out**). Nothing secret is in the files,
  so a public GitHub Pages repo is fine.
- Calls run with the signed-in user's Kinetic security.
- **Allow updates** starts off on every sign-in. While off, the page blocks every write
  (Release and anything added later). Reads still work.

## Step 1: test on your laptop first (5 minutes)

This tells you whether Kinetic accepts calls from a browser page on another website (CORS)
before you put it anywhere.

```
cd %USERPROFILE%\Downloads\planners-workbench-web
python -m http.server 8080
```

Open http://localhost:8080 in Edge, sign in, and check the Demand tab loads.
Stop the server with Ctrl+C.

If sign-in shows "Could not reach Kinetic ... (CORS)", Kinetic is refusing browser calls from
other sites. Do not host it yet; the fix is a server-side setting or a small proxy.

## Step 2: host it

Upload these four files to the same place your scheduling dashboard is hosted (for example a
GitHub repo with Pages enabled, or a new folder in the existing one). Keep all four files in the
same folder.

## Step 3: add it to Kinetic

Add a Home tab pointing at the hosted `index.html` URL, the same way the scheduling dashboard
was added.

## Changing the defaults

Edit `config.js` to change the server URL, company, or site shown on the sign-in panel.

## Bug fix included

After a successful release the confirmation dialog stayed open (the close function ignored
the request while the release was still flagged busy). Fixed in `workbench.js`. The same bug
exists in the Agent Foundry version.
