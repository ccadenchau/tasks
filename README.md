# tasks.cadenchau.com

A personal checklist app written in vanilla HTML, CSS, and JavaScript. A Cloudflare Worker serves the frontend, checks your Cloudflare Access login, and forwards sync requests to `api.cadenchau.com`. There is no running Node.js server; Node is used for development and deployment tools.

```text
Browser → Cloudflare Access → Worker → api.cadenchau.com
                                 └─ frontend assets
```

## Directory layout

```text
.
├── index.html                 Frontend entry point
├── css/
│   ├── base.css               Shared variables and base styles
│   ├── components.css         Reusable controls and components
│   ├── app.css                App layout and responsive styles
│   └── vendor/                Editor styles
├── js/
│   ├── main.js                App initialization and actions
│   ├── ui.js                  List and board rendering
│   ├── model.js               Task operations and validation
│   ├── repository.js          IndexedDB persistence
│   ├── store.js               State and queued writes
│   ├── task-panel.js          Task sidebar
│   ├── task-session.js        Drafts and autosave
│   ├── inline-markdown.js     Inline Markdown editor
│   ├── layout.js              Tab indicators and responsive chip overflow
│   ├── transitions.js         View changes with reduced-motion support
│   ├── help.js                Keyboard-shortcuts dialog
│   ├── sync-api.js            Browser requests to /api/sync
│   ├── sync.js                Automatic sync and retries
│   ├── sync-model.js          Record merging and deletion tracking
│   ├── vendor/                Bundled libraries and licenses
│   └── …                      Tags, dialogs, shortcuts, and other UI helpers
├── worker/
│   ├── index.js               Authenticated request routing and assets
│   ├── access.js              Cloudflare Access JWT verification
│   └── proxy.js               Restricted upstream API proxy
├── scripts/
│   ├── build.mjs              Copies browser assets into dist/
│   └── check.mjs              Checks syntax and static file references
├── tests/                     Unit, sync, Worker, and DOM checks
├── sw.js                      Retires the previous offline cache
├── wrangler.jsonc             Worker, hostname, assets, and Access settings
├── .dev.vars.example          Placeholder local configuration
├── .gitignore                 Excludes secrets and generated files
├── package.json               Commands and dependencies
└── package-lock.json          Locked dependency versions
```

`dist/`, `node_modules/`, and `.wrangler/` are generated and ignored by Git. Only `index.html`, `css/`, `js/`, and `sw.js` are copied into `dist/`. Worker code is deployed separately; server configuration and local secret files are never published as browser assets.

## Set up Cloudflare hosting

### 1. Install tools and sign in

Use a supported Node.js LTS release, version 22 or newer, and a Cloudflare account managing `cadenchau.com`. Your existing API must accept the Authorization value and allow reading, writing, and creating the `tasks_cadenchau_com` collection.

Run these commands from this repository's root, the folder containing `package.json`:

```sh
npm ci
npx wrangler login
```

Wrangler opens a browser to authorize your Cloudflare account. It is already included as a development dependency. See [Wrangler installation requirements](https://developers.cloudflare.com/workers/wrangler/install-and-update/).

### 2. Create the private login

In the Cloudflare Zero Trust dashboard, create a **self-hosted Access application** for `tasks.cadenchau.com`. Cover the entire hostname: leave the path unrestricted so the page, scripts, styles, and `/api/sync` all require login.

Add an **Allow** policy with an **Emails** rule containing only your email address. Enable a login method; **One-time PIN** lets you sign in using a code sent to that email. Do not add an Everyone or Bypass policy.

Save the application and copy its **Application Audience (AUD)** value. Also find your team's domain, such as `your-team.cloudflareaccess.com`. Cloudflare's [self-hosted application guide](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/) covers this configuration.

### 3. Fill in `wrangler.jsonc`

Replace the empty values in `vars`:

```json
"vars": {
  "ACCESS_TEAM_DOMAIN": "your-team.cloudflareaccess.com",
  "ACCESS_AUD": "your-application-audience",
  "ACCESS_ALLOWED_EMAIL": "you@example.com"
}
```

| Setting | Value |
| --- | --- |
| `ACCESS_TEAM_DOMAIN` | Team domain only, without `https://` or a trailing slash |
| `ACCESS_AUD` | Audience value from the Access application protecting this hostname |
| `ACCESS_ALLOWED_EMAIL` | The same email permitted by your Access policy |

These three values can be committed to GitHub. **Do not add `API_AUTHORIZATION` to this file.**

The existing configuration uses Worker name `checklist` and custom domain `tasks.cadenchau.com`. If you change the hostname in `routes`, update the Access application to match. Keep `assets.run_worker_first` set to `true` so static files pass through authentication. `workers.dev` and preview URLs are disabled.

### 4. Deploy the Worker and set its secret

Create the deployment:

```sh
npm run deploy
```

Wrangler runs the build automatically, uploads `dist/`, bundles the Worker, and configures the custom domain. If Cloudflare reports a conflicting DNS record for `tasks.cadenchau.com`, remove or replace that record as instructed, then retry. This replaces the old host for that hostname.

Now add the upstream API credential:

```sh
npm run secret:api
```

At the hidden prompt, paste the complete Authorization header value, including its authentication scheme. The command saves it as the Worker secret `API_AUTHORIZATION` and deploys the secret update. Until this is set, the authenticated page can load but sync returns `503`.

Alternatively, add a **Secret** named `API_AUTHORIZATION` in **Workers & Pages → checklist → Settings → Variables and Secrets** and deploy the change. See [Cloudflare Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/).

The credential must not appear in browser JavaScript, `wrangler.jsonc`, command arguments, or committed files. If the previous credential was pushed publicly, rotate it on the upstream API and use the replacement here. This deployment does not rotate the API credential or remove it from old Git commits.

### 5. Verify the deployment

Open `https://tasks.cadenchau.com` in a private browser window. Cloudflare should require login before serving the app. An email outside your policy should be denied.

After signing in, create or edit a task and wait for the footer dot to turn green. Browser requests should go to same-origin `/api/sync` routes, with no upstream Authorization header. Existing IndexedDB data uploads when you open the app on its original browser and origin. The API collection is created automatically if it does not exist and the credential permits creation.

Retire the previous public deployment and any alternate URLs that still serve the old files. Changing the custom domain does not remove copies hosted elsewhere.

For subsequent code changes, run `npm run deploy` again. To update the API credential, run `npm run secret:api` again. Production secret values are stored in Cloudflare, separately from GitHub.

## Local development

```sh
cp .dev.vars.example .dev.vars
```

Fill `.dev.vars` privately with the actual local values for `API_AUTHORIZATION`, `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, and `ACCESS_ALLOWED_EMAIL`, then start the preview:

```sh
npm run dev
```

Wrangler builds the assets and prints the local preview URL. `.dev.vars` supplies local values only; it does not configure the production secret.

**Authentication remains enabled locally.** The local Worker expects a valid, unexpired Access JWT for the configured application in `Cf-Access-Jwt-Assertion`. Opening localhost in a normal browser will return `401`; it does not automatically receive the production Access header. Use an authenticated request that supplies that header to exercise the local Worker. For ordinary browser editing without Access, a static preview supports IndexedDB operations, but cloud sync needs the authenticated Worker.

Never commit `.dev.vars` or `.env` files. The provided `.gitignore` excludes them, their environment-specific variants, and generated output. Placeholder example files are safe to commit.

## Commands and checks

| Command | Purpose |
| --- | --- |
| `npm ci` | Install locked dependencies |
| `npm run build` | Recreate `dist/` from the frontend files |
| `npm run dev` | Start the local Worker preview |
| `npm run deploy` | Build and deploy to Cloudflare |
| `npm run secret:api` | Set or replace the production API secret |
| `npm test` | Run unit, sync, and authentication/proxy tests |
| `npm run check` | Check JavaScript syntax and static references |

To check deployment bundling without publishing:

```sh
npx wrangler deploy --dry-run
```

Optional DOM integration checks use isolated development dependencies:

```sh
npm install --prefix /tmp/checklist-dom-tests --no-save jsdom fake-indexeddb
node tests/dom.mjs
```

Tests use fake data and API responses, not the production credential or checklist collection. DOM checks exercise event wiring, storage, Markdown, tags, subtasks, search, and confirmations; they do not replace visual browser checks.

## Tasks and sync

Use the bottom-right button to add a task. Click anywhere on a task row or card to open its resizable sidebar; click the main pane or press Escape to save and close it. Notes render Markdown in the editable area. Tasks support subtasks, due dates, tags, and list/board views. The view switch sits beside the tag views. List view starts sorted by newest created, with an arrow marking the active sort. View and status tabs animate, respecting reduced-motion preferences.

Edit tag names and colors in the **Tags** modal; tag views above the list/board show assigned tasks. List rows and board cards place tag chips to the right of the task name, with a `+N` indicator when more tags are assigned than fit. **No tags** appears only inside the task editor. Assigned tags in the editor have an internal remove button, and tag search results float without shifting the content below. Trash icons require confirmation.

Changes save to IndexedDB first, then sync through the Worker to `tasks_cadenchau_com` at `api.cadenchau.com`. Other devices refresh every 30 seconds and when the page becomes visible again. Connection failures retain local saves and retry after reconnecting.

| Footer dot | Meaning |
| --- | --- |
| Green | Synced |
| Blue | Syncing or waiting to sync |
| Red | Sync failed; hover for details and click to retry |

Each browser has a `checklist_<replica>` snapshot. Records merge using monotonic timestamps and a stable device tie-breaker. Concurrent edits to different tasks are retained; concurrent edits to the same task use the later record. Deletions retain tombstones so older devices do not restore deleted tasks. Attachment bytes use separate chunk keys. Unrelated collection keys are left alone.

Use **Data → Export** for a JSON backup including notes and existing attachment files. **Import** replaces the current data after confirmation. Existing legacy notes migrate into task notes or tasks. Browser storage can be evicted or cleared, so keep exported backups of important data. This app does not add an attachment-upload interface.

Click the **?** button or press **?** outside text fields to see all app shortcuts, notes formatting shortcuts, and sidebar-resize controls. The search field shows its keyboard shortcut on the right. Escape closes Help and restores focus without closing the task editor. Single-key shortcuts apply outside text fields:

| Shortcut | Action |
| --- | --- |
| N or Cmd/Ctrl + Shift + A | Add task |
| / or Cmd/Ctrl + K | Focus search |
| V | Switch list/board |
| T | Open tag editor |
| M | Restore drag order |
| ? | Open keyboard-shortcuts help |
| Cmd/Ctrl + S | Save the open task |
| Cmd/Ctrl + Enter | Complete/reopen the open task |
| Delete | Confirm deletion of the open task, outside text fields |
| Escape | Close the sidebar or active dialog |

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `503: Cloudflare Access is not configured` | Fill all three Access values in `wrangler.jsonc` and redeploy. |
| `401` from the Worker | Check the JWT, team domain, application audience, expiration, and allowed email. Local previews also require the JWT header. |
| Page opens without a login prompt in a private window | Confirm the Access app covers the whole hostname, remove bypass policies, and verify the hostname points to this Worker. |
| Sync returns `503` | Set `API_AUTHORIZATION` on the deployed Worker. A local `.dev.vars` file does not set production secrets. |
| Sync fails with an upstream `401` or `403` | Check the production secret and the upstream API's authentication/access rules. |
| Sync returns `413` or fails with large data | Check upstream request and collection size limits. The proxy also limits JSON request bodies to 1 MiB. Local data remains saved. |
| Deploy reports a DNS conflict | Resolve the existing record for the configured custom domain, then deploy again. |
| Settings entered in the dashboard disappear after deploy | Keep non-secret Access settings in `wrangler.jsonc`; that file supplies the deployment's values. |

The Worker verifies JWT signatures, issuer, audience, expiration, and owner email. It proxies only checklist collection list/read/write operations, rejects cross-origin writes, and never sends the upstream credential to the browser. No database migration, D1 instance, or new storage service is required; the existing API remains the remote data store.
