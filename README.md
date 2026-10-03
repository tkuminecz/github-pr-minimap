github-pr-minimap
=================

A Chrome extension that adds a minimap to GitHub pull requests.

On a PR's **Conversation** tab, a timeline floats at the right edge of the window: a vertical line
with one icon per event, running from the first event (top) to the latest (bottom), 60% of the
window tall at most (a PR with few events gets a shorter line, events no more than 32px apart).
Each event has a label to its left, joined by an angled connector. The labels reach
past both ends of the line, so the connectors fan outward like branches. Point at the timeline and
it magnifies gently around the pointer, like the macOS Dock: nearby dots and labels grow and spread
apart, while the line's ends and everything further away stay still.

```
                       👁
      PR description 1w ──⑂
waldyrious commented 1w ──💬
BagToad requested ch… 1w ──📄
1 commit, force-pushed 6d ──⛑
                            ╱
                            3d
                            ╱
    BagToad approved 3d ──👍
              Merged 3d ──⑂
```

| Icon | Event |
|---|---|
| pull request | the PR description |
| speech bubble | comment (blue); bot comments get a speech bubble with a robot, in grey; dashed when GitHub hid it as spam |
| document | review (blue); with a "!" in red when changes were requested |
| thumbs-up | approval (green) |
| wrench | commits; pushes with no comment in between share one icon |
| hard hat | the same, including a force-push (yellow) |
| merge / stop sign | merged (purple) / closed (red) |
| rewind / paper plane / pencil | reopened / ready for review / converted to draft |

A bot's approvals and change requests keep their colour; its other comments and reviews are grey.
Where events crowd closer together than an icon is tall, the line shows small dots in the same
colours instead.

A day or more with nothing happening breaks the line: a gap between two slashes, with how long it
lasted ("3d") written in the gap, or beside the line when the line is too crowded for that. Commits that came with the PR when it was opened, and
items GitHub hid as spam, show no date, so the quiet is measured across them.

Click a label or dot to jump to it. What's on screen is highlighted. On a really long PR every
event keeps its dot, but only the section you're reading is labelled, and the labels follow the page
as you scroll. Hovering a label shows the comment snippet or commit titles. The eye above the line
fades the whole timeline out or back in (remembered across PRs). On any other tab (Files changed,
Commits, Checks) it goes away.

Long PRs hide their middle behind "Load more". The extension loads those items automatically, so
the list covers the whole PR.

## Install (unpacked)

```sh
pnpm install
pnpm build
```

Then in Chrome open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**
and pick the `dist/` folder. After rebuilding, click the reload icon on the extension's card.

## Settings

Edit `src/settings.ts` and rebuild:

- `autoLoadHidden`: `false` stops the automatic "Load more"; the hidden items then show as a
  row that loads them when clicked.
- `botsOnlyOnOwnPRs`: bots whose comments and reviews only appear on PRs you opened (default:
  CodeRabbit). On anyone else's PR, or when signed out, they're left out, and the pushes either
  side of them merge into one row.
- `hiddenBots`: bots whose comments and reviews never appear (default: Linear Code, Blacksmith
  and GitHub Actions).
- `approvalsOnlyBots`: bots whose approvals appear, but none of their comments or other reviews
  (default: jbparabot).

## Development

```sh
pnpm test        # unit tests (vitest + jsdom, against saved real PR pages)
pnpm check       # typecheck + lint + tests + build
pnpm smoke       # build, then drive a live PR in headless Chromium with the extension loaded
pnpm perf        # build, then measure hover/scroll/idle cost on a long PR (add --without to compare)
pnpm fixtures    # re-download the PR page fixtures after GitHub changes its markup
```

`pnpm smoke` needs Playwright's Chromium once: `pnpm exec playwright install chromium`.
It accepts a PR URL: `node scripts/smoke.mjs https://github.com/owner/repo/pull/123`.

### How it reads the page

The extension reads GitHub's own markup; no token is needed. Each timeline item carries a
GraphQL node id whose prefix names its type (`IC_` comment, `PRR_` review). Smaller events
(pushes, merges, labels) are bundled several to an item, so they're told apart by their icon
plus their wording. The parser tests in `test/extract.test.ts` check its output against what the
GitHub API reports for the same PRs. When GitHub changes its markup, those tests are what fail.

### Fonts

Labels use IBM Plex Sans Condensed and the times IBM Plex Mono Light, bundled in `public/fonts`
(SIL Open Font License, see `public/fonts/LICENSE-IBM-Plex.txt`). They're handed to the page as
bytes, because GitHub's content security policy blocks fonts loaded from other places.

### Icons

The event icons are from [Lucide](https://lucide.dev) (ISC License, see
`public/LICENSE-Lucide.txt`), and the eye is from GitHub's
[Octicons](https://github.com/primer/octicons) (MIT License, see `public/LICENSE-Octicons.txt`).
Only the icons used are copied into `src/node-icons.ts` and `src/icons.ts`.
