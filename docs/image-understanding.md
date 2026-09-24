# Optional image understanding

`decideFromScreen` is an explicit SDK composition point for a captured viewport:
**original PNG → configured image understanding → existing text-only decision engine**.
It neither captures another page nor executes an action. Normal Jev Browser
DOM/ARIA operations do not call it and incur no added vision request.

The configured image service receives only PNG frames, capture timing and pixel
geometry. It does not receive the caller's questions, expected answers, source,
DOM/ARIA, local artifact paths or route hints. Its generated description is then
passed as text/JSON to the existing `DecisionEngine`, alongside the caller's
context and questions. Image bytes are never put into the standard System One
payload. Independent questions share one interpretation of the captured frames.

## Configuration

```js
import {
  JevDecisionEngine, ChatCompletionsImageUnderstanding, decideFromScreen,
} from '@tontoko/jev-browser';

const understand = new ChatCompletionsImageUnderstanding({
  baseURL: 'http://localhost:8000/v1',
  model: 'your-image-capable-model',
  // apiKey: a separate explicitly provided vision key, when required
});
const engine = new JevDecisionEngine(); // or your existing injected DecisionEngine
const screen = await browser.screen({ action: 'look' });
const result = await decideFromScreen(screen, {
  state: { purpose: 'Inspect this captured page' },
  questions: {
    readable: {
      query: 'Is the page purpose identifiable from visible text?',
      criteria: { yes: 'Visible text identifies it', unknown: 'Not enough visible evidence' },
    },
  },
}, { understand, engine, signal: AbortSignal.timeout(30_000) });
```

`baseURL` is a Chat Completions API root, including any version path. The adapter
appends `/chat/completions` and sends ordered `image_url` data blocks. The chosen
endpoint and model must support this protocol and PNG input. No default provider,
model, environment-key discovery, hosted-key inheritance, automatic retry or
redirect following is provided. Authentication-free local endpoints need no key.
A failed or empty caption stops before a decision request; no silent DOM fallback
or raw-image forwarding is attempted.

For another image protocol or an in-process model, supply an `ImageUnderstanding`
object with `describe(observation, { signal })`. It returns `{ text, model?,
requestedModel?, usage? }` and must honor cancellation. This is a caller adapter,
not a plugin manager or harness integration. Qwen-MM-Plugins' native-image versus
caption distinction was reference material; no Qwen package or implementation is
imported. See its official configuration documentation for that distinction.

## Evidence, coordinates and limitations

The result keeps `decision` unmodified, including provider confidence and usage.
`evidence` records the observation ID, original frame SHA-256 and capture times,
image-pixel coordinate convention, interpreter provenance, separate vision usage
when reported, and interpretation time. Missing usage stays unknown, not zero.
The original `screen` remains with the caller; retain it or use the browser's
existing `outputDir` when originals are required for review.

Every result is labelled `freshness: 'snapshot'`. Calling this helper on an old
capture does not make it current. Before an operation, obtain the current browser
observation and use the existing screen observation-ID and input protections.
Descriptions may omit, misread or hallucinate visible details. A location that the
interpreter cannot establish is not permission to invent coordinates or use
hidden DOM information. No caption, decision or model confidence is a durable
save/provider oracle, functional pass, visual-design approval, or user study.
Questions should include an insufficient-evidence option when that is possible.

The built-in interpreter asks for visible text, spatial distinctions and
uncertainty without inventing hidden application semantics. This prompt is not a
mathematical guarantee of correct perception or resistance to page instructions.
The caller still owns appropriate data-sharing consent, tool isolation and
independent assertions.

## Delivery scope

This change adds the SDK boundary and a read-only SDK example. It does **not**
change existing CLI/MCP tool behavior, add automatic visual action selection,
add a direct djev image protocol, or make visual inference mandatory. Integrating
an optional observation choice into the shared browser command surface and
checking it through installed CLI/MCP remain tracked by issue #19; do not describe
this SDK boundary alone as a completed end-to-end rollout.

Deterministic HTTP/model fixtures test the boundary and a real browser capture
exercises its connection to ordinary screen input authority. They do not measure
live-model accuracy or prove a speed advantage. Compare full observation → vision
→ decision → action time with authorized real providers before making that claim.
