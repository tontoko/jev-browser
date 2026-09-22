# Pi: operate from viewport images

The optional `@tontoko/jev-browser/pi` extension connects a screenshot-only Jev browser session to Pi's normal model and tool loop. It registers two tools: `browser_screen` and `browser_close`. Pi is the host; Jev does not add an agent runner, provider configuration, scoring system, or product-specific workflow.

The actor receives actual viewport image blocks, an opaque observation ID, viewport dimensions, and action/frame timing. The extension does not provide DOM text, accessible element names, selectors, page titles, URLs, source files, or artifact paths. It uses coordinate and keyboard input against the same persistent browser.

## Trusted setup

Install Jev in the working directory and configure the entry point before starting Pi:

```sh
npm install https://github.com/tontoko/jev-browser/releases/download/v0.9.0/tontoko-jev-browser-0.9.0.tgz
JEV_PLAYWRIGHT_CLI="$(
  node --input-type=module -e '
    import { createRequire } from "node:module";
    import { dirname, join } from "node:path";
    const require = createRequire(import.meta.resolve("@tontoko/jev-browser"));
    console.log(join(dirname(require.resolve("playwright/package.json")), "cli.js"));
  '
)"
node "$JEV_PLAYWRIGHT_CLI" install chromium
export JEV_SCREEN_URL=http://localhost:3000
```

`JEV_SCREEN_URL` is required and must be an HTTP(S) URL. The extension opens this URL once when the first screen operation starts. Navigation after that happens through the visible page or the `back`, `forward`, and `reload` actions.

For authentication, viewport size, motion settings, or saved screenshots, optionally set `JEV_SCREEN_OPTIONS` to a trusted JSON file containing the existing SDK's `BrowserLaunchOptions`:

```json
{
  "headless": true,
  "contextOptions": {
    "viewport": { "width": 1280, "height": 800 },
    "reducedMotion": "no-preference"
  },
  "storageState": "/trusted/browser-auth.json",
  "outputDir": "/trusted/viewport-artifacts"
}
```

```sh
export JEV_SCREEN_OPTIONS=/trusted/browser-options.json
```

Omit `storageState` and `outputDir` when they are unnecessary. This file uses the same launch options as `JevBrowser.launch`; it is not an actor input. The extension reads configuration during registration, before the actor starts, and always forces `screenOnly: true`. It also captures the SDK's `JEV_BROWSER` engine default at registration. Changing the environment or JSON file during a run does not reconfigure that run. Leave reduced motion as `no-preference` when the walkthrough needs to observe normal animation.

## Start a clean actor

With a Pi installation that supports the following flags, start only the two browser tools and supply the actor's system prompt explicitly:

```sh
JEV_PI_EXTENSION="$(
  node --input-type=module -e '
    import { fileURLToPath } from "node:url";
    console.log(fileURLToPath(import.meta.resolve("@tontoko/jev-browser/pi")));
  '
)"
pi \
  --no-context-files \
  --no-skills \
  --no-extensions \
  --no-prompt-templates \
  --no-session \
  --system-prompt /trusted/actor-system.md \
  -e "$JEV_PI_EXTENSION" \
  --tools browser_screen,browser_close
```

`--no-extensions` disables discovery; `-e` explicitly loads this extension. The host should verify its active tools and loaded context before passing the task to the actor. Keep source inspection and result verification in the outer caller. A normal final text response remains available to the actor.

This is a tool and context boundary within Pi. The enclosing process retains its normal operating system permissions. The extension does not install operating system access controls.

The adapter uses a structural registration interface and shared JSON schemas, so Jev does not require Pi as a runtime dependency. Native loader and schema validation are tested separately against `@earendil-works/pi-coding-agent` 0.87.0.

## Screen operations

Start by looking:

```json
{ "action": "look" }
```

The response contains one or more actual Pi image blocks. Its text block describes their order and timing:

```json
{
  "observationId": "opaque-current-observation",
  "viewport": { "width": 1280, "height": 800 },
  "action": {
    "id": "opaque-action-id",
    "kind": "look",
    "startedAt": "2026-01-01T00:00:00.000Z",
    "durationMs": 25,
    "outcome": "observed"
  },
  "frames": [
    {
      "index": 0,
      "mimeType": "image/png",
      "capturedAt": "2026-01-01T00:00:00.025Z",
      "elapsedMs": 25
    }
  ]
}
```

The timestamps and IDs above are illustrative. Image bytes appear only in image blocks; the metadata does not repeat base64 data or expose saved file paths. Frame index `0` identifies the first image block. Frames are chronological: use the last image to choose coordinates for the next action, and use earlier images to inspect motion history.

Use the most recent observation ID when performing an action. For example:

```json
{
  "action": "click",
  "x": 320,
  "y": 240,
  "observationId": "opaque-current-observation"
}
```

Coordinates are viewport CSS pixels. `type` inserts literal text at the current focus. The shared `screen` schema specifies each supported action and its required fields:

| Action | Action-specific fields |
| --- | --- |
| `look` | None |
| `click`, `move` | `x`, `y` |
| `drag` | `x`, `y`, `toX`, `toY` |
| `scroll` | `deltaX`, `deltaY`; optional `x`, `y` |
| `type` | `text` |
| `press` | `key`, from the shared schema's allowed keys |
| `back`, `forward`, `reload` | None |
| `wait` | `milliseconds` |

Input actions use the latest `observationId`. The registered schema is authoritative for required fields and bounds. Unsupported fields, selectors, configuration, and source-reading requests are rejected before browser startup or input.

Any operation can request a short sequence of actual frames:

```json
{
  "action": "look",
  "capture": { "frames": 4, "intervalMs": 100 }
}
```

`frames` accepts 1–10 and `intervalMs` accepts 20–1000 milliseconds. The core records actual capture times; capture work can make the observed spacing longer than the requested interval. The extension preserves frame order and the action outcome. It does not infer product correctness or UX quality from successful tool execution.

Treat explicit unsupported popup or native-dialog errors as tool capability limits. The outer caller should preserve that limitation in the walkthrough result and avoid assigning a product UX failure to it.

## Lifetime and cancellation

Both tools use Pi's sequential execution mode. One extension instance owns one browser session, started lazily. The extension passes cancellation through to the shared browser operation. Cancelling a tool does not create a replacement browser or replay an input action.

`browser_close` takes an empty object. It is idempotent and final for that Pi session. Pi's `session_shutdown` event also closes the owned browser. A startup failure remains a failure for the run; the adapter does not silently relaunch with a fresh browser or reset application state.

To run the optional native Pi integration test from a Jev checkout, point `JEV_PI_PACKAGE` at an installed Pi package directory:

```sh
npm run build
JEV_PI_PACKAGE=/path/to/node_modules/@earendil-works/pi-coding-agent \
  node --test test/pi.test.mjs
```

The ordinary suite exercises the extension with real Playwright browsers and a local page. It does not require a model provider or make live model calls.
