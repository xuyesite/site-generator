# sitegen-entry

A faster drop-in for makefun-site 1.0.0 (make.fun bounty
`site-generator-speed-01-run-20261122`).

- `solve.js` — dependency-free ES module. `run(input)` returns the output
  tree for one case's site, byte for byte identical to makefun-site 1.0.0.
  Written from the makefun-site README only; no reference implementation
  was read.
- `main.ts` — the program the harness runs: reads `/input/cases.json`,
  answers each case with `run`, writes `/output/answers.json`. It tunes
  V8 the same way the house baseline does
  (`--no-incremental-marking`) before importing `solve.js`.

Speed comes from doing each piece of work once: templates are parsed once
per case; each source's Markdown is rendered once (content, excerpt, toc
and reading minutes in the same pass); a post's card HTML is rendered once
and reused on every index and tag page that shows it; the header and footer
are rendered once per case when they do not depend on the page; the inline
parser scans plain text with a single native regex instead of a
per-character loop.

Verified: the 3 practice cases and 45 freshly drawn cases (15 sets from
the kit's own generator, each checked against the oracle) all match the
oracle byte for byte. Locally timed at ~2.2x the house baseline's CPU
time on the practice set (trimmed mean, net of a do-nothing control).
