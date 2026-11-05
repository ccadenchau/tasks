# tasks.cadenchau.com

A static checklist app written in vanilla HTML, CSS, and JavaScript. Host it on GitHub Pages; checklist data syncs directly to the existing API at `api.cadenchau.com`. No Worker, Zero Trust setup, Node server, or npm dependencies are required.

The app asks for your API password the first time. **Remember me on this device** is checked by default; after a successful sign-in the app saves the Basic Authorization value in localStorage and uses it to sign in automatically after refresh. Uncheck it to keep the login only in memory. **Data → Sign out** saves pending local edits, clears the remembered credential, and reloads the sign-in screen. If the API password changes, the saved login is rejected and removed.

The website's HTML, CSS, and JavaScript are public. The API protects remote checklist data with its own authentication; this sign-in screen does not make GitHub Pages files private. A remembered login is accessible to scripts running on this site's origin and to anyone with access to this browser profile, so use it only on a trusted device. Cached checklist data also remains unencrypted in IndexedDB. Keep the GitHub repository private if you also want to restrict access to the source code; that does not make a published Pages site private. GitHub's private Pages access control requires an eligible Enterprise Cloud organization. [Pages visibility documentation](https://docs.github.com/en/enterprise-cloud%40latest/pages/getting-started-with-github-pages/changing-the-visibility-of-your-github-pages-site)

## Set up GitHub Pages

### 1. Push this directory to GitHub

Keep `index.html`, `css/`, `js/`, `sw.js`, `.nojekyll`, and `CNAME` in the repository root. The supplied `CNAME` contains `tasks.cadenchau.com`. `.nojekyll` disables Jekyll processing for these static files.

Do not add API passwords or Authorization values to GitHub, including GitHub Actions variables used to build browser files. If an earlier credential was published, rotate it on the API. Deleting it from the latest source does not erase it from Git history.

### 2. Enable Pages

In the repository, open **Settings → Pages**. Under **Build and deployment**, choose **Deploy from a branch**, select your publishing branch (usually `main`), and choose **/(root)**. Save.

There is no build command or GitHub Actions workflow to configure for this setup. GitHub serves the checked-in static files. See [configuring a publishing source](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).

### 3. Connect your domain

Set the Pages custom domain to `tasks.cadenchau.com`. At your DNS provider, point the `tasks` CNAME record to **YOUR-USERNAME.github.io**, without a repository name or URL path. Replace the old hosting record if it conflicts. After GitHub completes its DNS/certificate checks, enable **Enforce HTTPS**. [Custom domain setup](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site)

If the old Cloudflare Worker or Access application was deployed, remove its route/application for this hostname so it no longer intercepts requests. This repository no longer uses either service. Using Cloudflare just for DNS is fine.

### 4. Check API access and sign in

Open `https://tasks.cadenchau.com` and enter the password used by `api.cadenchau.com`. The API username is `admin`, set in `js/sign-in.js`. This is your API password, not your GitHub password. An incorrect password keeps the app on the sign-in screen.

The API must allow the page's origin, the `Authorization` and `Content-Type` headers, and GET/POST/PUT requests through CORS. The existing API configuration allows `cadenchau.com` and its subdomains, including `tasks.cadenchau.com`. To change the password, update `SITE_PASSWORD` in the API server's private environment configuration and restart that API. Do not put this setting in this repository or in a frontend build variable.

If you use a `https://YOUR-USERNAME.github.io` address instead, add that exact origin to the API server's `CORS_ORIGINS` setting and restart the API. Origins do not include the repository path. Local previews likewise need their exact HTTP origin allowed. CORS configuration lives on the API server, not GitHub Pages.

The API credential must permit reading/writing the `tasks_cadenchau_com` collection and creating it if missing. Authentication remains enforced by the API; the client only operates on that collection. No credential is included in source or committed.

Existing browser data uploads after signing in on its original origin and browser. Changing the hostname changes the IndexedDB origin and remembered login; export a backup before moving to another hostname and import it afterward if needed.

## Files

```text
.
├── index.html                 Static entry point and CSP
├── CNAME                      GitHub Pages custom domain
├── .nojekyll                  Disables Jekyll processing
├── css/
│   ├── base.css               Variables and base styles
│   ├── components.css         Reusable controls and modals
│   ├── app.css                Layout and responsive styles
│   └── vendor/                Editor styles
├── js/
│   ├── main.js                App startup, actions, and event wiring
│   ├── sign-in.js             Password form and in-memory authorization
│   ├── ui.js                  Main layout, task views, and search
│   ├── task-panel.js          Task editor, status, notes, and subtasks
│   ├── task-session.js        Draft state and autosave
│   ├── model.js               Data shape, validation, and task operations
│   ├── document.js            Markdown note conversion and validation
│   ├── repository.js          IndexedDB persistence
│   ├── store.js               App state, queued writes, and cross-tab updates
│   ├── sync-api.js            Authenticated requests and attachment chunks
│   ├── sync.js                Sync scheduling, retries, and polling
│   ├── sync-model.js          Change tracking and conflict merging
│   ├── inline-markdown.js     Inline Markdown editor setup
│   ├── vendor/                Bundled editor, versions, and licenses
│   ├── backup.js              JSON export and import
│   ├── completion.js          Completion feedback animation
│   ├── controls.js            Shared input and button components
│   ├── dialogs.js             Reusable confirmation dialog
│   ├── dom.js                 Small DOM rendering helpers
│   ├── help.js                Keyboard shortcut dialog
│   ├── layout.js              Active tab indicator sizing
│   ├── panel-resize.js        Sidebar resizing
│   ├── shortcuts.js           Shortcut definitions and handling
│   ├── status-actions.js      Status changes and completion
│   ├── tag-colors.js          Tag color handling
│   ├── tags.js                Tag editor, picker, and tag views
│   └── transitions.js         View switching animation
├── scripts/
│   ├── build.mjs              Optional static export to dist/
│   └── check.mjs              Syntax, references, and module checks
├── tests/                     Unit, auth, sync, and DOM checks
├── sw.js                      Retires the previous offline cache
├── .gitignore                 Excludes generated files and local secrets
├── package.json               Optional development commands
```

The inline editor uses a locally bundled ProseMirror library. Its versions and licenses are in `js/vendor/`; no CDN requests are needed. Each application JavaScript module is imported from `js/main.js`, directly or through another module. `npm run check` verifies JavaScript syntax and relative imports, checks the files referenced by `index.html`, and fails if an app module is unreachable. `sw.js` is a one-time compatibility file: it unregisters the previous app service worker and removes its old shell cache. Keep it while returning users may still have that old worker installed.

The small `scripts/` folder and `package.json` are only for local checks and making an optional `dist/` export; GitHub Pages serves the root files directly. There is no dependency lockfile because the project has no npm dependencies. `tests/` contains local tests and is not needed by the deployed app. `.env` and `.env.*` are ignored in case local tooling uses private settings; the browser app has no API key or password file.

## Development and checks

Serve the directory over HTTP with any static web server; ES modules do not work reliably from `file://`. For example, with Python installed:

```sh
python3 -m http.server 8080
```

This is only a local preview server. The deployed site is static. To sign in locally, add the exact origin `http://localhost:8080` to the API server's `CORS_ORIGINS` setting and restart the API. Reloading requires an API connection to authenticate; after sign-in, local edits remain available during temporary connection failures.

Optional checks use Node, with no package installation required. Node is only needed for these developer commands; it does not run the website:

```sh
npm test
npm run check
npm run build
```

The build recreates `dist/` containing only static website files, `CNAME`, and `.nojekyll`. It is useful for other static hosts or an artifact-based deployment, but branch-based GitHub Pages hosting does not need it. `dist/` is ignored by Git.

Optional DOM integration checks install test tools outside the repository:

```sh
npm install --prefix /tmp/checklist-dom-tests --no-save jsdom fake-indexeddb
node tests/dom.mjs
```

Tests use fake passwords, storage, and API responses. They never send test data to the real checklist collection. DOM checks cover sign-in, editing, Markdown safety, tags, views, keyboard help, sync, and confirmation dialogs; they do not replace visual browser checks.

## Using the app

Use the bottom-right button to add a task. Click its row or card to open the editor. The editable task name and trash button share the sidebar header. Click the main pane or press Escape to save and close it; drag the divider to resize it.

Notes render Markdown in the editable area. Tasks support subtasks, due dates, colored tags, and list/board views. Tag chips appear beside task names and wrap to show their full names. **No tags** appears only in the task editor. Manage tags in **Tags**; select a tag above the list/board to see its tasks. Trash buttons ask for confirmation.

The search field shows its keyboard shortcut. Click the circled **?** to see all app, notes, and divider shortcuts. The centered content is limited to 1280px on wide screens, with subtle side borders.

| Shortcut | Action |
| --- | --- |
| N or Cmd/Ctrl + Shift + A | Add task |
| / or Cmd/Ctrl + K | Search |
| V | Switch list/board |
| T | Edit tags |
| M | Restore drag order |
| ? | Keyboard-shortcuts help |
| Cmd/Ctrl + S | Save open task |
| Cmd/Ctrl + Enter | Complete/reopen open task |
| Delete | Confirm deletion outside text fields |
| Escape | Close sidebar or active dialog |

Single-key shortcuts apply outside text fields. Help also lists Markdown formatting and sidebar-resize keys. Transitions respect reduced-motion preferences.

## Data and sync

Edits save to IndexedDB first, then sync directly to `tasks_cadenchau_com` on the API. Other devices refresh every 30 seconds and when the page becomes visible again. Connection failures keep local edits and retry after reconnecting. If the password changes, reload and sign in with the replacement.

| Footer dot | Meaning |
| --- | --- |
| Green | Synced |
| Blue | Syncing or waiting to sync |
| Red | Failed; hover for details, click to retry |

Each browser has a `checklist_<replica>` snapshot. Records merge by monotonic timestamp with a stable device tie-breaker. Concurrent changes to different tasks are retained; simultaneous edits to the same task use the later record. Deletion tombstones keep older devices from restoring removed tasks. Existing attachment bytes use separate chunk keys.

**Data → Export** downloads a JSON backup, including notes and existing attachments. **Import** replaces local data after confirmation and syncs the result. Browser data is not erased by signing out, so keep a trusted browser profile and export important backups. The app does not include a new attachment-upload interface.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Incorrect password | Use the API password for username `admin`, not your GitHub password. |
| Unable to connect at sign-in | Check API availability, HTTPS, and its CORS allowlist for the exact page origin. |
| Login works on the custom domain but not github.io | Add the github.io origin to the API's CORS settings, or use `tasks.cadenchau.com`. |
| Old Cloudflare login still appears | Remove the Access application and Worker route for the hostname, then verify DNS points to Pages. |
| Sync fails after the API password changes | The remembered login is cleared; enter the new API password. Export unsynced edits first if needed. |
| Sync fails with large data | Check API request and collection size limits. Local edits remain saved. |
| Pages shows a 404 | Confirm the selected branch/root contains `index.html`; check the Pages deployment status and custom domain. |
| Data seems missing after changing hosts | IndexedDB is per origin. Return to the old origin to export, or restore a backup. |
