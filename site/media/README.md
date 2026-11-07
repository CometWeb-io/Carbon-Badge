# Landing page media

Everything here was captured on 7 November 2026 from a real local run of this
repository at 2.0.6 (commit `f3115b3`), built with
`npm run clean && NODE_ENV=production npm run build`, in headless Chromium driven
by Playwright. Nothing is a mockup. The page under test is the repository's own
`test.html`, served from the repository root with `node scripts/serve-static.mjs`
on `127.0.0.1`, which is why the badges show that host. The badge measured that
page in estimate mode; no API or network score request was involved.

- `badge-{default,compact,minimal}-{dark,light}.webp`: element screenshots of
  the first badge on `test.html` at device scale factor 2. The other demo
  sections of `test.html` were hidden with an injected stylesheet, and the page
  background was set to `#0f0f0f` or `#ffffff` to match the theme. All six show
  one measurement: 36,108 bytes transferred, 0.0054 g CO₂e (displayed as
  &lt;0.01 g), grade A+. The variant and theme were switched by changing
  attributes, which redraws the badge without measuring again.
- `outcome-lower.webp`: the same page, with the repository's six
  `docs/media/badge-*.png` screenshots and one image from a second local origin
  (`localhost`, no `Timing-Allow-Origin` header) added to the DOM before the
  measurement. Result: 8 of 9 sizes visible, 218,141 visible bytes, a floor of
  0.032 g displayed as "At least 0.03 g", no letter.
- `outcome-nd.webp`: after the graded capture, `history.pushState` moved the
  page to `/test.html/next-route`; the badge switched to N/D with
  "URL changed. Reload this page."
- `badge-demo.mp4`: a 12-second screen recording at 960×540 of the same page,
  played back in real time with no speed-up. The first 0.4 s of blank frames
  were trimmed, then the video was encoded to H.264 with
  `-crf 26 -movflags +faststart`. The monospace labels above the badge were
  injected for the recording. Sequence: loading state, A+ result, `compact`,
  `minimal`, `theme="light"`, back to dark, then `history.pushState` and N/D.
- `badge-demo-poster.jpg`: a frame from that recording.

Screenshots were converted from PNG to WebP with `cwebp -q 90 -m 6`.
`../og.jpg` is a composed social card that reuses `badge-default-dark.webp`;
its text and layout were written for the card and are not a capture.

## Hero and logos (added 7 Nov 2026)

- The hero is not a recording. It is a sketch of a website with the real
  component, built from this repository, in its footer. The three numbers under
  it (bytes, grams and grade) are read from that badge's `cometweb:badge-load`
  event on every visit, so they describe the visitor's own load of this page.
- Platform and browser logos (WordPress, Shopify, Webflow, Wix, HTML5, Google
  Chrome, Firefox, Safari) are from Simple Icons 16.36.0 and belong to their
  owners. The platforms match the website-builder guides in the README; they
  are not endorsements. The browser logos stand for the Chromium, Firefox and
  WebKit engines the Playwright suite runs in.
- Figures in the strip under the hero, checked on 7 Nov 2026: `npx vitest run`
  reported 296 tests, `npx playwright test --list` listed 84 browser tests
  (28 per engine), and `node scripts/check-bundle-size.mjs` reported 10,585 B
  gzip for the embed against a 10,700 B budget.
