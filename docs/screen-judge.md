# Itemized screen judging

`screenJudge` is an opt-in way to ask an **image-capable** decision model many yes/no
questions about the current screen in **one request**: one viewport capture, optional page
content, and up to 64 items. Each item gets its own probability; an item passes when its
probability is at least its threshold (default 0.5).

Typical items are concrete and positively phrased, so "yes" means acceptable:

- design tokens: "Is the primary button background #0055ff (bright blue)?", "Do buttons have 8px rounded corners?"
- capabilities: "Can the user add an item from this screen?", "Is there a link back to the list?"

Concrete values plus a plain-language name work best. Prefer a positive capability
("Can the user archive this item?") over an absence check ("Is there no delete button?").

## SDK

```js
import { JevBrowser } from '@tontoko/jev-browser';

const browser = await JevBrowser.launch({
  judge: {
    // A Workers AI run URL of an image-capable System One model, or a System One API root
    // (requests then go to {baseURL}/v1/systemone and `model` is required).
    baseURL: 'https://api.cloudflare.com/client/v4/accounts/<account>/ai/run/@cf/<vendor>/<model>',
    apiKey: process.env.CLOUDFLARE_API_TOKEN,
    threshold: 0.5, // optional default
  },
});
await browser.goto('https://example.com/items');
const result = await browser.screenJudge({
  state: { design_tokens: 'primary #0055ff bright blue; radius 8px; body 16px' },
  items: {
    primary_color: 'Is the primary button background #0055ff (bright blue)?',
    can_add: 'Can the user add an item from this screen?',
    back_link: { instructions: 'Is there a link back to the list?', threshold: 0.7 },
  },
  page: 'text', // 'text' (default), 'html' or 'none'
});
// result.passed, result.failed, result.items[id] = { probability, threshold, passed }, result.evidence
```

## What is sent

One POST to the judge endpoint: `model`, `questions` (each item as a `noul` question),
`state` (your `state` plus `page.text` or `page.html`, cut to `maxPageChars`, default 30000)
and `images` (the PNG viewport as a data URL). Workers AI v4 envelopes are unwrapped; a
`success: false` envelope or HTTP error is `PROVIDER_ERROR`. Only the explicit `apiKey` is
sent; no environment key is read. Screen-only sessions accept only `page: 'none'`.

`hasJudge` reports whether a judge is configured. You can pass your own adapter
(`{ judge(input) { return { probabilities } } }`) for another protocol or a local model.
`judgeFromScreen(screen, request, { judge, page })` judges an observation you already have.

Results are model judgments, not verified facts or a usability certification.
