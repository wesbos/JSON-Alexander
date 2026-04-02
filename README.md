# JSON Alexander

![JSON Alexander](icons/JSON-Alexander.png)

Believe it or not, George formats JSON.

![Preview Chrome](preview-chrome.png)

![Preview Firefox](preview-firefox.png)

## Features

- Syntax highlighting for keys, strings, numbers, booleans, and null
- Collapsible/expandable tree view with level controls
- Hover any property to see its full JSON path — click to pin, then copy
- Expand/collapse all children of an object with inline button
- View raw JSON or copy to clipboard
- JSON payload available in the console as `window.data`
- Light, dark, and auto (system) themes
- Indent guide lines with hover highlighting

## Installation

### Chrome (Unpacked Extension)

1. Open Chrome and navigate to `chrome://extensions`
2. Enable **Developer mode** (toggle in the top right)
3. Click **Load unpacked**
4. Select the **`dist-chrome`** folder inside this project

### Firefox (Temporary Add-on)

1. Build the Firefox output: `npm run build:firefox`
2. Open Firefox and navigate to `about:debugging#/runtime/this-firefox`
3. Click **Load Temporary Add-on...**
4. Select the `manifest.json` file inside **`dist-firefox`**

#### Disable Firefox's Native JSON Viewer

Firefox has a built-in JSON viewer that can prevent this add-on from taking over JSON pages. Disable it first:

1. Open a new tab and go to `about:config`
2. Accept the warning prompt if shown
3. Search for `devtools.jsonview.enabled`
4. Set it to `false` (toggle button on the right)
5. Reload any JSON page

## Development

```bash
npm run dev:chrome   # watch and rebuild only dist-chrome
npm run dev:firefox  # watch and rebuild only dist-firefox
npm run build  # production build (Chrome + Firefox)
npm run build:chrome # production build only Chrome
npm run build:firefox # production build only Firefox
```

Available build outputs:

- `npm run build:chrome` -> `dist-chrome`
- `npm run build:firefox` -> `dist-firefox`

Pick the development command based on which browser you are testing:

- Use `npm run dev:chrome` while testing in Chrome.
- Use `npm run dev:firefox` while testing in Firefox.

After making changes:

- Chrome: go to `chrome://extensions` and click the extension reload button.
- Firefox: go to `about:debugging#/runtime/this-firefox` and click **Reload** on the temporary add-on.

## Usage

Navigate to any URL that returns JSON (e.g. `https://jsonplaceholder.typicode.com/users`). The extension automatically detects JSON responses and replaces the page with an interactive viewer.

- **Level buttons** (1, 2, 3... All) — collapse/expand the tree to a specific depth
- **Theme toggle** — cycle between auto, dark, and light
- **Raw** — toggle between tree view and raw pretty-printed JSON
- **Copy JSON** — copy the full JSON to clipboard
- **Click any line** — pins the JSON path in the toolbar, click Copy to copy it
- **Console** — the parsed JSON is available as `window.data`
