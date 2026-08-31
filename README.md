# Clean AI Paste for Obsidian

[![Downloads](https://img.shields.io/badge/dynamic/json?logo=obsidian&color=%23483699&label=downloads&style=for-the-badge&query=%24%5B%22clean-ai-paste%22%5D.downloads&url=https%3A%2F%2Fraw.githubusercontent.com%2Fobsidianmd%2Fobsidian-releases%2Fmaster%2Fcommunity-plugin-stats.json)](https://obsidian.md/plugins?id=clean-ai-paste)
[![Release](https://img.shields.io/github/v/release/GoSlowPoke168/obsidian-clean-ai-paste?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiNmZmZmZmYiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIiBjbGFzcz0ibHVjaWRlIGx1Y2lkZS1naXQtbWVyZ2UiPjxjaXJjbGUgY3g9IjE4IiBjeT0iMTgiIHI9IjMiLz48Y2lyY2xlIGN4PSI2IiBjeT0iNiIgcj0iMyIvPjxwYXRoIGQ9Ik02IDIxVjlhOSA5IDAgMCAwIDkgOSIvPjwvc3ZnPg==)](https://github.com/GoSlowPoke168/obsidian-clean-ai-paste/releases/latest)
[![Latest Release](https://img.shields.io/github/release-date/GoSlowPoke168/obsidian-clean-ai-paste?style=for-the-badge&label=Latest%20Release&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiNmZmZmZmYiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIiBjbGFzcz0ibHVjaWRlIGx1Y2lkZS1jYWxlbmRhci1jaGVjay0yIj48cGF0aCBkPSJNMjEgMTRWNmEyIDIgMCAwIDAtMi0ySDVhMiAyIDAgMCAwLTIgMnYxNGEyIDIgMCAwIDAgMiAyaDgiLz48bGluZSB4MT0iMTYiIHgyPSIxNiIgeTE9IjIiIHkyPSI2Ii8+PGxpbmUgeDE9IjgiIHgyPSI4IiB5MT0iMiIgeTI9IjYiLz48bGluZSB4MT0iMyIgeDI9IjIxIiB5MT0iMTAiIHkyPSIxMCIvPjxwYXRoIGQ9Im0xNiAyMCAyIDIgNC00Ii8+PC9zdmc+)](https://github.com/GoSlowPoke168/obsidian-clean-ai-paste/releases/latest)

**Clean AI Paste** is an Obsidian plugin designed to automatically clean up and format text pasted from AI chatbots (ChatGPT, Claude, Gemini, etc.) instantly and silently, every time you paste.

When you copy text from an AI web interface, the result in Obsidian is often cluttered with excessive blank lines, malformed code blocks, over-bolded headers, broken LaTeX math, emojis, and more. This plugin intercepts the paste event, converts the clipboard HTML to native Markdown, and applies a fully customizable set of formatting rules before inserting it into your note.

---

## Quick Look: Before & After

| Feature           | Original AI Paste                               | With Clean AI Paste                       |
| :---------------- | :---------------------------------------------- | :---------------------------------------- |
| **Headers**       | `### **Introduction**`                          | `### Introduction`                        |
| **Blank Lines**   | Several blank lines between paragraphs          | Exactly one                               |
| **Headings**      | `Text`<br><br>`## Heading`<br><br>`Body`        | `Text`<br>`## Heading`<br>`Body`          |
| **ASCII Tables**  | `+---+  +---+` _(alignment collapsed)_          | `+---+     +---+` _(spacing preserved)_   |
| **Code Blocks**   | `python`<br>` ``` `<br>`print("hi")`<br>` ``` ` | ` ```python `<br>`print("hi")`<br>` ``` ` |
| **Math (LaTeX)**  | `\( x = y \)`                                   | `$ x = y $`                               |
| **Tracking URLs** | `https://example.com/?utm_source=chatgpt.com`   | `https://example.com/`                    |

---

## Features

Clean AI Paste runs automatically. Just press `Ctrl+V` or `Cmd+V` to paste from anywhere into your Obsidian note.

### Spacing Normalization

- **Standard** — Natural line and paragraph spacing with comfortable room to breathe.
- **Tight** — Removes all blank lines everywhere.
- **Off** — Leaves all spacing completely untouched.

Under **Standard**, two sub-options control the blank lines around headings. Obsidian already renders headings with space above and below, so both are usually redundant in the source.

- **Remove blank line before headings** — Strips the blank line above each heading.
- **Remove blank line after headings** — Strips the blank line between a heading and the content under it.

### Formatting & Cleanup

- **Strip Trailing Whitespaces** — Removes invisible trailing spaces at the end of every line.
- **Strip Emojis** — Removes all emoji characters from pasted text. An optional allowlist lets you preserve specific ones. Keyboard and technical symbols (⌘ ⌥ ⏎ ⌫) are kept by default, since removing them rewrites instructions — a separate sub-option strips those too if you want.
- **Strip Link Tracking Parameters** — Removes tracking parameters (`?utm_source=`, `?gclid=`, `?fbclid=`, etc.) from pasted URLs.

### Markdown Elements

- **Unbold Headers** — Strips bold markers from Markdown headers (`**## Header**` → `## Header`).
- **Unbold Links** — Removes bold formatting wrapped around Markdown links (`**[Link](url)**` → `[Link](url)`).
- **Header Downgrade Level** — Shifts pasted headers down by 1–3 levels (e.g. `#` → `##`). Capped at `######`.
- **Convert Math Delimiters** — Converts AI-style LaTeX (`\(`, `\)`, `\[`, `\]`) to Obsidian's native `$` and `$$`. Leaves content inside inline code untouched.
- **Format Horizontal Lines** — Ensures a blank line both before and after `---` separators so they render correctly. (A heading placed directly after a rule is always kept tight against it — see below.)

### Code Blocks

- **Padding Before/After Code Blocks** — Independently control whether a blank line is inserted before and after every fenced code block.
- **Inline Single-Line Code Blocks** — Converts a fenced code block containing only one line (e.g. a copied one-line command) into inline `` `code` ``. Blocks with a language label (like ` ```python `) and multi-line blocks are always kept as full blocks. _(Off by default.)_

> **Note:** For some AI chats, you may need to copy a bit above or below the selected codeblock for the language to be detected, otherwise it would paste as a plain code block.

### Code Block Intelligence (Always Active)

- **Pasted markup becomes a code block** — XML or HTML source is fenced (` ```xml `) with its indentation intact, instead of being pasted as raw tags that Obsidian's renderer would swallow.
- **Single table cells are not tables** — Copying one cell of a table inserts just its contents, rather than a one-cell grid.
- **Detached Language Labels** — Detects floating language names (e.g., a bare `python` line above an unlabeled fence) and binds them into the opening backticks (` ```python `).
- **Duplicate Label Removal** — Detects and removes the redundant language label that Claude generates when copying manually (e.g., bash floating above ```bash).

### AI Tracking & Notifications

- **Add Tracking Signature** — Wraps pasted text with hidden HTML comments (invisible in Reading View) to mark AI-generated content in source mode. The start and end tags are independently configurable.
- **Enable Paste Notifications** — Shows a brief notice in the corner each time a normal `Ctrl+V` paste is formatted. Bypass paste never notifies.

### Troubleshooting

- **Debug/Preview Mode** — When enabled, pasting (either `Ctrl+V` or `Ctrl+Shift+V`) opens a wide popup showing three panels: the raw `text/plain`, the raw `text/html`, and the plugin's formatted output. Each panel has a **Copy** button, and you can choose which version to insert — useful for understanding exactly why a paste looks the way it does, and for filing a bug report.
- **Paste with Debug/Preview** _(command)_ — Opens that same popup for a single paste without turning Debug/Preview Mode on. It ships without a hotkey so it can't clash with your existing bindings — assign one under **Settings → Hotkeys**, or run it from the command palette.
- **Paste raw text** _(command)_ — Inserts the clipboard's plain text exactly as copied, ignoring every setting. Since `Ctrl+Shift+V` already does this by default, it is mainly useful if you have turned **Legacy paste** on and want a one-off raw paste without switching it back. Ships without a hotkey.
- **Report a bug or request a feature** — Opens a GitHub issue form directly from the settings tab. If you are reporting a paste that came out wrong, turn on Debug/Preview Mode first and include the three panels — that is what makes a report fixable.
- **Reset settings to default** — A button at the bottom of the settings tab to instantly restore all toggles to their original state.

### Baseline Behavior (Always Active)

These actions happen on every external paste, regardless of your settings:

1. **External paste interception** — On a normal `Ctrl+V`, content copied from inside Obsidian passes through completely untouched; the plugin's formatting only activates for content from outside (browsers, AI chat interfaces, etc.).
2. **Code blocks are never reformatted** — Pasting with the cursor inside a fenced code block inserts the plain text exactly as copied, preserving alignment.
3. **HTML → Markdown conversion** — Reads `text/html` from the clipboard and converts it to native Markdown using Obsidian's built-in engine, preserving headings, bold, lists, links, and code blocks. Text copied with meaningful alignment (ASCII tables, diagrams, indented code) becomes a code block, since that is the only way Obsidian keeps the spacing.
4. **Table & blockquote padding** — Always adds a blank line before/after tables and after blockquotes so they render correctly in all Markdown contexts. This cannot be toggled off, but it only adds lines where they are structurally required. Pipe-delimited lines only count as a table when a delimiter row (`| --- | --- |`) follows the header, so ASCII line art is left alone.

Everything in the [Features](#features) section is applied on top of this baseline and can be individually toggled and customized.

---

## Installation

### From the Community Plugin Store _(Recommended)_

1. Open Obsidian → **Settings → Community plugins**.
2. Disable **Restricted mode** if prompted.
3. Click **Browse**, search for **Clean AI Paste**, click **Install** then **Enable**.

### Manual Installation

1. Download the latest release from the [GitHub repository](https://github.com/GoSlowPoke168/obsidian-clean-ai-paste).
2. Copy `main.js` and `manifest.json` into `YourVault/.obsidian/plugins/clean-ai-paste/`.
3. In Obsidian, go to **Settings → Community plugins**, find **Clean AI Paste**, and enable it.

---

## How to Use

Simply copy and paste whatever text using the standard shortcut: `Ctrl+V` (Windows/Linux) or `Cmd+V` (macOS). All formatting rules fire instantly and automatically.

### Bypass Paste

To bypass the plugin's formatting pipeline, use: `Ctrl+Shift+V` (Windows/Linux) or `Cmd+Shift+V` (macOS).

Bypass paste inserts the clipboard's **raw plain text**, exactly as copied. No Markdown conversion, no formatting rules — spacing and indentation survive byte-for-byte, so ASCII tables, aligned terminal output and indented code paste intact. It's the fallback for when a normal paste formats something the way you didn't want.

Because it skips conversion entirely, raw text has no code fences, and content from sites that generate list bullets in CSS will lose those bullets — use a normal `Ctrl+V` when you want that structure.

- **Legacy paste** _(off by default)_ — Turn this **on** to restore the older behaviour, where bypass converts the clipboard HTML to keep Markdown structure (lists, headings, tables, links) while still skipping every formatting rule above. Useful for sites that generate list bullets in CSS, since those are missing from plain text.

---

## Known Limitations

- **Code blocks missing HTML structure:** Sometimes when copying code, it will just copy as plain text and `<br>` tags rather than proper `<code>` blocks on the clipboard. When this happens, it's impossible for the plugin's parser to detect it as code, and it will be pasted as plain text.

---

## Compatibility

- **Obsidian:** 0.15.0+
- **Platform:** Desktop and Mobile (iOS & Android)

---

## Feedback & Bug Reports

If you encounter a bug, have a feature request, or want to suggest an improvement, please open an issue on the [GitHub repository](https://github.com/GoSlowPoke168/obsidian-clean-ai-paste/issues).

Issue templates are provided to make reporting bugs and requesting features as quick and easy as possible!

---

## License

[![GitHub License](https://img.shields.io/github/license/goslowpoke168/obsidian-clean-ai-paste?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiNmZmZmZmYiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIiBjbGFzcz0ibHVjaWRlIGx1Y2lkZS1zY2FsZSI+PHBhdGggZD0ibTE2IDE2IDMtOCAzIDhjLS44Ny42NS0xLjkyIDEtMyAxcy0yLjEzLS4zNS0zLTFaIi8+PHBhdGggZD0ibTIgMTYgMy04IDMgOGMtLjg3LjY1LTEuOTIgMS0zIDFzLTIuMTMtLjM1LTMtMVoiLz48cGF0aCBkPSJNNyAyMWgxMCIvPjxwYXRoIGQ9Ik0xMiAzdjE4Ii8+PHBhdGggZD0iTTMgN2gyYzIgMCA1LTEgNy0yIDIgMSA1IDIgNyAyaDIiLz48L3N2Zz4=)](https://github.com/GoSlowPoke168/obsidian-clean-ai-paste/blob/master/LICENSE)

---

## Support the Project

If you find this plugin useful, please leave a star on GitHub or consider supporting its development!

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/T5T725W4FX)
