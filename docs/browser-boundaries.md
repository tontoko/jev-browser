# Shared browser-boundary contracts

This repair aligns existing SDK, CLI and MCP paths. It does not add a planner, business-rule dictionary, model router or inference server. Jev still decides meanings; the runtime preserves the identities, scope and evidence on which a decision relied.

## Observed scope and operation lifetime

An observed target carries its original Page, frame/document and retained scope roots. Delayed AI plans, native refs and goal effects check this boundary after inference/authorization awaits and before dispatch. Multi-field native commands validate all fields before starting, then revalidate each captured ref before its effect, because earlier fields may move later ones.

Observed region roots are independently owned handles. A temporary handle passed into capture may be disposed without invalidating the retained observation; removal/replacement of the actual DOM root still invalidates it. Owned ARIA popup interactions retain the original control's boundary, even when the actual popup is portalled outside a form. Losing the original control scope cannot be authorized by creating a fresh popup capture.

These checks are not atomic with every browser event and are not a browser/network sandbox. Direct caller Page/selector code, page scripts and navigation side effects remain outside a universal transaction guarantee.

## Progress and result adoption

Only frames actually observed are registered as progress waits. Scoped progress fingerprints use the observed roots, including real root detachment, rather than unrelated tickers or unobserved iframes. Detached/navigated observed frames count as genuine invalidation; an empty task for an unobserved frame does not count as progress.

A goal's inferred readback is a proposal until its record/status evidence is read again. The actual physical sources must still be current, within scope and consistent with the inferred result. Changed/deleted/replaced records or new contradictory status evidence require fresh observation. This cannot resubmit the pending save. Input readback flags and checkpoints are committed only after evidence adoption, not while the provider's response is being assembled.

Additional harmless changes can conservatively trigger reobservation. A successful freshness check cannot guarantee future page immutability, server durability or exactly-once delivery.

## Page/core event ownership

Dialog, filechooser and download effects have a Page and a core owner. Closing a neighboring core cannot dismiss an owner's dialog. An implicit file upload may use only this core's chooser on its selected Page. Selecting another Page discards the old implicit chooser; explicit caller-authored file-input targets remain subject to their normal command and file-root policies. Download lists and indices are scoped to the current Page's owned downloads.

Independent Pages are not placed behind a global operation queue. A browser may nevertheless schedule tab-modal dialogs sequentially, so ownership tests must not require concurrent presentation. Context-wide route/cookie/tracing operations remain context operations; this repair does not reinterpret them as Page-local capabilities.

## Primary errors and evidence identities

Postfailure capture used only to prepare a continuation must not replace the primary error or its executed-action ledger. If that preparation fails or the Page is closed, preserve the primary partial result and do not fabricate a usable continuation.

Extraction preserves ordinary dotted evidence paths, but escapes each literal segment. `.` becomes `\.` and `\` becomes `\\`; an empty segment becomes `\e`. Thus literal key `a.b` is recorded as `a\.b`, while nested `a` / `b` remains `a.b`. Empty and backslash-containing keys remain distinguishable. This changes only names needing escaping; callers that parse evidence paths must honor escapes rather than splitting every dot.

## Endpoint and credential pairing

The default endpoint is explicitly `https://api.typesafe.ai`. Cloud environment credentials (`JEV_API_KEY` / `TYPESAFE_API_KEY`) are implicitly used only for that HTTPS origin. Another endpoint defaults to the SDK-compatible local placeholder unless the caller supplies `apiKey` explicitly or sets `JEV_ENDPOINT_API_KEY`. A credential-sharing proxy must opt in explicitly; changing baseURL alone must not forward a cloud secret. The upstream SDK's separate `TYPESAFE_BASE_URL` does not silently redirect this library's default endpoint.

## Model evaluation integrity

Environment fixtures must not mutate an injected decision engine or its returned answers. Synthetic confidence overrides belong only to explicitly fake engines. In real-model runs, preserve raw scores and chosen IDs, the runtime's threshold outcome and the application's submission oracle separately. A low score can correctly stop the runtime while still counting as a task that did not complete. Do not rewrite scores, lower thresholds or resample unchanged evidence until the task appears successful.

The repair includes paired counterexamples for normal and adverse cases, not a claim that every API/interleaving is covered. Before a production release, use the exact patched tree for cross-platform CI and raw-provider evaluation and retain incomplete/blocked outcomes alongside successful runs.
