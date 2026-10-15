# Git Time Machine

An [Obsidian](https://obsidian.md) plugin that turns your vault's Git history into a Time Machine: scrub
through earlier versions of a note or canvas, see them side by side with today's version, rendered the way
Obsidian renders them, and bring back exactly the part you need.

It is made for vaults that [Obsidian Git](https://github.com/Vinzent03/obsidian-git) commits automatically
(for example every 10 minutes), but works with any Git repository that contains the vault.

**Desktop only** (it runs the `git` program). Developed and tested on macOS.

## What it does

- **A Time Machine tab** for the current file: the past version on the left, your file as it is now on the
  right, and a timeline of every commit that changed the file down the right side. Click a time or use the arrow keys
  to move through time; renames are followed.
- **Notes**, side by side in two views:
  - **Rendered**: both versions in Obsidian's reading view, with changed blocks marked and changed words
    highlighted (deleted in red, added in green). Lists, callouts, checkboxes and links stay intact.
  - **Source**: a line-by-line diff of the Markdown.
- **Canvases**, drawn by Obsidian's own canvas engine (read-only), with pan and zoom linked between the sides:
  - Cards and connections are tagged **Edited**, **Added**, **Removed**, **Moved** or **Resized**. Moves are
    measured against the cards that didn't change, so dragging the whole canvas around isn't a change.
  - Click a card on either side to see where it was and where it is now: a red "ghost" for the past position,
    a green one for today's, and an arrow from past to now. The ghost shows the card's text with deleted and
    added words together.
  - **Compare text…** on an edited card opens that card's text in the note comparison.
- **Restore, as finely as you like.** Nothing is changed until you choose to, and **Undo last restore** puts it back.
  - **A block** of a note: restore it, *bring back only the deleted text*, or *remove only the added text*.
  - **The whole version**, with the same three choices.
  - **Part of a canvas**: pick cards with Select, Rectangle or Lasso, then choose *what* to restore (text,
    position, size, colour, connections, bringing back deleted cards, removing cards added since then).
    Connected cards and group contents come along automatically.

## Commands

- **Open Time Machine for current file** (also on the ribbon, and **Show in Time Machine** in the file menu)
- **Undo last restore**

## Settings

| Setting | Default |
|---|---|
| Repository folder | Obsidian Git's setting, else the repository that contains the vault |
| Git program | Obsidian Git's setting, else `/opt/homebrew/bin/git`, `/usr/local/bin/git`, `/usr/bin/git` |
| Default view for notes | Rendered |
| Versions loaded at a time | 50 |

**Check connection** shows which `git` and repository the plugin found.

## Installation

Not yet in the community plugin directory. Install with
[BRAT](https://github.com/TfTHacker/obsidian42-brat) using `k-u-knt/obsidian-git-time-machine`, or manually:
download `main.js`, `manifest.json` and `styles.css` from the latest release into
`<vault>/.obsidian/plugins/git-time-machine/`, then enable **Git Time Machine** under Community plugins.

Your vault (or a folder above it) must be a Git repository with some history, for example from Obsidian Git.

## Disclosures

- **Git is only read.** The plugin runs `git --version`, `git rev-parse`, `git log` and `git show` on your
  repository. It never commits, pushes, fetches, resets or changes Git's state; committing is left to you or
  Obsidian Git.
- **It edits your files only when you restore**, through Obsidian (so an open editor and its undo history stay
  in sync). If the file changed since the comparison was drawn, the restore is refused and the comparison
  refreshed.
- It sends nothing over the network.
- The canvas view uses **Obsidian's internal canvas engine**, which is not public API (checked with Obsidian
  1.14). Both canvases are read-only and cannot save; if the engine can't be reached, the plugin draws the
  canvases itself instead.

## Known limits

- Canvas file cards and embeds show the embedded file as it is now, not as it was.
- Very large notes and canvases can be slow to compare; the tab asks before drawing them.
- Excalidraw drawings and a whole-vault view are planned, not yet available.

## Development

```bash
npm install
npm run dev            # watch build into main.js (set GTM_TEST_VAULT to copy each build into a test vault)
npm test               # unit tests (vitest)
npm run build          # type-check + production build
npm run install-vault  # build and copy into a vault: pass its folder, set OBSIDIAN_VAULT, or use .vault-path
```

Releases: `npm version patch` (tags without a "v", via `.npmrc`), `git push --follow-tags`, and GitHub Actions
builds a draft release from the tag.

## License

MIT
