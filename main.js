"use strict";

const { Plugin, htmlToMarkdown, Notice, PluginSettingTab, Setting, Modal } = require('obsidian');

const DEFAULT_SETTINGS = {
    // Formatting & Cleanup
    condenseMode: 'standard',
    headingBlankBefore: true,
    headingRemoveBlankAfter: true,
    stripTrailingWhitespaces: true,
    stripEmojis: true,
    emojiAllowlist: '',
    cleanLinkTracking: true,
    // Markdown Elements
    unboldHeaders: true,
    unboldLinks: true,
    headerDowngradeLevel: 0,
    convertMathDelimiters: true,
    formatHorizontalRules: true,
    paddingBeforeCodeblock: true,
    paddingAfterCodeblock: true,
    inlineSingleLineCodeblocks: false,
    // Bypass Paste (Ctrl+Shift+V)
    cleanupOnBypass: true,
    // AI Tracking & Notifications
    addTrackingSignature: false,
    trackingSignatureStart: "<!-- [AI Generated Start] -->",
    trackingSignatureEnd: "<!-- [AI Generated End] -->",
    enableNotifications: false,
    debugMode: false
}

function stripTrackingParams(text) {
    const trackingParams = [
        'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id',
        'fbclid', 'gclid', 'msclkid', 'yclid', 'mc_cid', 'mc_eid', 'igshid'
    ];

    const urlRegex = /\bhttps?:\/\/[^\s()<>`"\[\]]+/g;

    const cleanUrl = (match) => {
        try {
            const hashParts = match.split('#');
            const urlWithoutHash = hashParts[0];
            const hash = hashParts.length > 1 ? '#' + hashParts.slice(1).join('#') : '';

            const queryParts = urlWithoutHash.split('?');
            if (queryParts.length < 2) return match;

            const baseUrl = queryParts[0];
            const queryString = queryParts.slice(1).join('?');

            const params = queryString.split('&');
            const cleanParams = [];
            for (const param of params) {
                if (!param) continue;
                const [key] = param.split('=');
                const decodedKey = decodeURIComponent(key);
                if (trackingParams.includes(decodedKey) || decodedKey.startsWith('utm_')) {
                    continue;
                }
                cleanParams.push(param);
            }

            const newQueryString = cleanParams.length > 0 ? '?' + cleanParams.join('&') : '';
            return baseUrl + newQueryString + hash;
        } catch (e) {
            return match;
        }
    };

    // Split on inline code spans (`...`) so URLs quoted inside them are left untouched --
    // code/inline-code content should never be modified.
    return text.split(/(`.+?`)/).map((part, i) => {
        if (i % 2 === 1) return part;
        return part.replace(urlRegex, cleanUrl);
    }).join('');
}

function normalizeLanguageLabel(text, codeBlock) {
    const textTrimmed = text.trimEnd();
    const trailing = text.slice(textTrimmed.length);

    const match = textTrimmed.match(/(?:^|\n)([ \t]*)([A-Za-z0-9+#\-_]+)[ \t]*$/);
    if (match) {
        const lang = match[2];
        const prevNl = textTrimmed.lastIndexOf('\n');
        const lastLine = prevNl === -1 ? textTrimmed : textTrimmed.slice(prevNl + 1);

        if (lastLine.trim() === lang) {
            let prefixToKeep = match[0].startsWith('\n') ? '\n' : '';

            if (/^[ \t]*```\s*\n/.test(codeBlock)) {
                // Only treat the trailing word as a language label if it is a known
                // programming language — prevents English words like "or"/"and"/"vs"
                // that appear between two code blocks from being consumed as labels.
                if (KNOWN_CODE_LANGUAGES.has(lang.toLowerCase())) {
                    text = textTrimmed.substring(0, textTrimmed.length - match[0].length) + prefixToKeep + trailing;
                    codeBlock = codeBlock.replace(/^([ \t]*)```\s*\n/, '$1```' + lang + '\n');
                }
            } else {
                const cbMatch = codeBlock.match(/^[ \t]*```([a-zA-Z0-9+#\-_]+)\s*\n/);
                if (cbMatch && cbMatch[1].toLowerCase() === lang.toLowerCase()) {
                    text = textTrimmed.substring(0, textTrimmed.length - match[0].length) + prefixToKeep + trailing;
                }
            }
        }
    }
    return { text, codeBlock };
}

function unboldHeaders(text) {
    // Note: leading anchors use [ \t]* (not \s*) so the blank line ABOVE a heading is
    // never consumed and deleted — \s would match the preceding newline.
    text = text.replace(/^[ \t]*(?:\*\*|__)\s*(#+\s+.*?)\s*(?:\*\*|__)[ \t]*$/gm, '$1');
    return text.replace(/^[ \t]*(#+\s+)(.*)$/gm, (m, hashes, content) => {
        // Split on inline code spans to avoid stripping ** inside backticks.
        const parts = content.split(/(`.+?`)/);
        for (let i = 0; i < parts.length; i++) {
            if (i % 2 === 0) parts[i] = parts[i].replace(/\*\*|__/g, '');
        }
        return hashes + parts.join('');
    });
}

function unboldLinks(text) {
    // Supports URLs with arbitrary nested parentheses as long as they contain no spaces.
    return text.replace(/(?:\*\*|__)\s*(\[[^\]]+\]\([^ \t\n]+?\))\s*(?:\*\*|__)/g, '$1');
}

function downgradeHeaders(text, level) {
    // Leading anchor uses [ \t]* (not \s*) so the blank line above a heading isn't eaten.
    return text.replace(/^[ \t]*(#+)(\s+.*)$/gm, (m, hashes, content) => {
        const newHashes = '#'.repeat(Math.min(6, hashes.length + level));
        return newHashes + content;
    });
}

function condenseBlankLines(text, mode) {
    if (!mode || mode === 'off') return text;
    if (mode === 'tight') {
        // Tight mode: collapse all blank lines to zero (no blank line between paragraphs).
        text = text.replace(/\r?\n(?:[ \t\xA0]*\r?\n)+/g, '\n');
        // Remove empty blockquote separator lines in tight mode.
        return text.replace(/^>[ \t]*\r?\n/gm, '');
    }
    // Standard mode: collapse N>1 blank lines to exactly one blank line.
    text = text.replace(/\r?\n(?:[ \t\xA0]*\r?\n){2,}/g, '\n\n');
    // Remove empty blockquote separator lines.
    text = text.replace(/^>[ \t]*\r?\n/gm, '');
    // Remove blank lines between consecutive unordered list items.
    text = text.replace(/(^[ \t]*[-*+] .+)\n[ \t\xA0]*\n(?=[ \t]*[-*+] )/gm, '$1\n');
    // Remove blank lines between consecutive ordered list items.
    text = text.replace(/(^[ \t]*\d+[.)] .+)\n[ \t\xA0]*\n(?=[ \t]*\d+[.)] )/gm, '$1\n');
    // Remove blank lines between a paragraph/label and the first item of a following list.
    text = text.replace(/([^\n])\n[ \t\xA0]*\n([ \t]*(?:[-*+]|\d+[.)]) )/gm, '$1\n$2');
    return text;
}

function applyHeadingSpacing(text, blankBefore, removeBlankAfter) {
    if (blankBefore) {
        // Add a blank line before a heading when the preceding line is not already blank.
        // Runs on content directly before a heading like paragraphs, list items,
        // or other headings, so consecutive headings always get a gap between them.
        text = text.replace(/([^\n])\n(#{1,6}\s)/gm, '$1\n\n$2');
    }
    if (removeBlankAfter) {
        // Remove the blank line that htmlToMarkdown inserts between a heading and its
        // immediately following content.
        // The (?!#{1,6}\s|\n) lookahead prevents firing when:
        //   - the next line is also a heading (blankBefore already handles that gap)
        //   - there are 2+ blank lines (those are excessive blanks, not heading gaps)
        text = text.replace(/(^#{1,6}\s.+$)\n\n(?!#{1,6}\s|\n)/gm, '$1\n');
    }
    return text;
}

function convertMathDelimiters(text) {
    // Split on inline code spans (`...`) so LaTeX-looking delimiters quoted inside them
    // (e.g. `arr\[0\]`) are left untouched -- code/inline-code content should never be
    // modified.
    return text.split(/(`.+?`)/).map((part, i) => {
        if (i % 2 === 1) return part;
        part = part.replace(/\\\[([\s\S]*?)\\\]/g, (_, inner) => '$$' + inner + '$$');
        return part.replace(/\\\(([\s\S]*?)\\\)/g, (_, inner) => '$' + inner + '$');
    }).join('');
}

function formatHorizontalRules(text) {
    // Skip YAML frontmatter: if text starts with --- it's likely frontmatter, not a rule.
    const hasFrontmatter = /^---[ \t]*\r?\n/.test(text);
    let startIdx = 0;
    if (hasFrontmatter) {
        // Find the closing --- of frontmatter and start processing after it.
        const closingMatch = text.match(/\n---[ \t]*(?:\r?\n|$)/);
        if (closingMatch) startIdx = closingMatch.index + closingMatch[0].length;
    }
    if (startIdx > 0) {
        const before = text.slice(0, startIdx);
        let after = text.slice(startIdx);
        after = after.replace(/([^\n])\n+(---)/g, '$1\n\n$2');
        after = after.replace(/(^---[ \t]*)(\n)([^\n])/gm, '$1\n\n$3');
        return before + after;
    }
    text = text.replace(/([^\n])\n+(---)/g, '$1\n\n$2');
    return text.replace(/(^---[ \t]*)(\n)([^\n])/gm, '$1\n\n$3');
}

function tightenRuleHeadingGap(text) {
    // A heading placed directly after a horizontal rule reads better with no blank line
    // between them — the rule + heading already form a strong visual break, so a gap there
    // is redundant. This deterministically resolves the otherwise-conflicting "Format
    // horizontal rules" (adds a blank after ---) and "Add blank line before headings"
    // (adds a blank before headings) settings at this one junction: the rule/heading pair
    // is always kept tight. Runs regardless of those two toggles. Only fires when a gap
    // actually exists; rule-then-paragraph and standalone headings are left untouched.
    return text.replace(/(^[ \t]*-{3,}[ \t]*\r?\n)(?:[ \t\xA0]*\r?\n)+([ \t]*#{1,6}[ \t])/gm, '$1$2');
}

function formatTablePadding(text) {
    // Table row = leading pipe + at least one more pipe (htmlToMarkdown emits bordered
    // rows like `| a | b |`). Excludes single-leading-pipe line art such as nmap's
    // `| ssh-hostkey:` / `|_...` output, which would otherwise be mistaken for a table.
    text = text.replace(/(^(?![ \t]*\|[^\n]*\|)[^\n]+)\n+([ \t]*\|[^\n]*\|)/gm, '$1\n\n$2');
    return text.replace(/(^[ \t]*\|[^\n]*\|[^\n]*\n)(?![ \t]*\|[^\n]*\||\n|$)/gm, '$1\n');
}

function formatBlockquotePadding(text) {
    return text.replace(/(^>.*$)\r?\n([^>\n\r])/gm, '$1\n\n$2');
}

function stripTrailingWhitespaces(text) {
    return text.replace(/[ \t]+$/gm, '');
}

function stripEmojis(text, allowlist) {
    // Matches a run of emoji chars together with any spaces/tabs on either side, so we
    // can collapse to a single space only when the emoji sat between two words -- and
    // leave everything else (e.g. aligned columns in pasted terminal output) untouched.
    const emojiRun = /([ \t]*)[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{2B00}-\u{2BFF}\uFE0F\u200D]+([ \t]*)/gu;
    // When only ONE side had whitespace (e.g. "Press \u2318C" \u2014 a space before the emoji but
    // none after, since it's glued to "C"), collapsing to '' would delete the emoji AND
    // its space, gluing "Press" to "C" into "PressC". Instead, keep a single space when
    // the whitespace-less side is a word/symbol character (so removal doesn't fuse two
    // adjacent tokens like "Press"+"C" or "and"+"\u21e5") but NOT when it's punctuation
    // (so "Hello \ud83d\ude00." still becomes "Hello." rather than "Hello .").
    const isBoundary = (ch) => !ch || ch === '\n' || ch === '\r' || /\p{P}/u.test(ch);
    const collapse = (m, before, after, offset, string) => {
        if (before && after) return ' ';
        if (before && !after) {
            const next = string[offset + m.length];
            return isBoundary(next) ? '' : ' ';
        }
        if (!before && after) {
            const prev = string[offset - 1];
            return isBoundary(prev) ? '' : ' ';
        }
        return '';
    };

    if (allowlist) {
        const allowed = [...new Set(allowlist.split(/[\s,]+/).filter(Boolean))];
        if (allowed.length > 0) {
            const placeholders = allowed.map((emoji, i) => ({ token: `\x00${i}\x00`, emoji }));
            for (const { token, emoji } of placeholders) {
                text = text.split(emoji).join(token);
            }
            text = text.replace(emojiRun, collapse);
            for (const { token, emoji } of placeholders) {
                text = text.split(token).join(emoji);
            }
            return text;
        }
    }
    return text.replace(emojiRun, collapse);
}

// Languages recognised as code block labels when found floating above plain-text code.
const KNOWN_CODE_LANGUAGES = new Set([
    'python', 'py', 'javascript', 'js', 'typescript', 'ts', 'jsx', 'tsx',
    'java', 'c', 'cpp', 'csharp', 'cs', 'ruby', 'go', 'rust', 'php',
    'swift', 'kotlin', 'bash', 'sh', 'shell', 'zsh', 'fish',
    'powershell', 'ps1', 'cmd', 'batch',
    'sql', 'mysql', 'postgresql', 'sqlite',
    'r', 'matlab', 'julia', 'fortran', 'cobol', 'asm', 'assembly',
    'html', 'css', 'scss', 'sass', 'less', 'xml', 'svg',
    'json', 'yaml', 'yml', 'toml', 'ini', 'env',
    'dockerfile', 'makefile', 'cmake',
    'scala', 'groovy', 'perl', 'lua', 'dart', 'haskell',
    'elixir', 'erlang', 'clojure', 'lisp', 'scheme', 'racket',
    'graphql', 'proto', 'protobuf', 'diff', 'patch',
    'nginx', 'apache', 'terraform', 'hcl',
    'latex', 'tex', 'markdown', 'md',
    'plaintext', 'text', 'txt', 'output', 'log'
]);

// Pre-process clipboard HTML to fix code blocks and line breaks before htmlToMarkdown
function preprocessHtml(html, plainText = '') {
    // 1. Normalize Gemini code blocks. Gemini wraps each code block in a <code-block>
    // custom element containing a header label span ("Bash"), download/copy buttons, and
    // the actual <pre><code> buried several inline custom elements deep. Obsidian's
    // htmlToMarkdown mishandles a <pre> nested inside these inline elements — it collapses
    // the code's newlines to spaces and wraps the whole thing in stray inline-code
    // backticks. Rewrite each <code-block> down to a bare <pre><code> (the same clean
    // shape ChatGPT/Claude emit) so htmlToMarkdown produces a proper fenced block. The
    // header label becomes the fence's language.
    html = html.replace(/<code-block\b[^>]*>([\s\S]*?)<\/code-block>/gi, (match, inner) => {
        const preMatch = inner.match(/<pre\b[^>]*>([\s\S]*?)<\/pre>/i);
        if (!preMatch) return match;
        let body = preMatch[1];
        const innerCode = body.match(/<code\b[^>]*>([\s\S]*?)<\/code>/i);
        if (innerCode) body = innerCode[1];
        // The language label sits in a span immediately before the buttons div.
        const langMatch = inner.match(/<span\b[^>]*>([A-Za-z0-9+#.\-]+)<\/span>\s*<div\b[^>]*class="[^"]*buttons/i);
        const lang = langMatch ? langMatch[1].toLowerCase() : '';
        const classAttr = lang ? ` class="language-${lang}"` : '';
        return `<pre><code${classAttr}>${body}</code></pre>`;
    });

    // 2. Replace <br> with \n INSIDE <pre> or <code> blocks.
    html = html.replace(/<(pre|code)\b[^>]*>(.*?)<\/\1>/gis, (match, tag, content) => {
        return `<${tag}>` + content.replace(/<br\s*\/?>/gi, '\n') + `</${tag}>`;
    });

    // 3. Fix for partial code block copies (where the HTML contains no structural elements)
    // If the copied fragment has no block elements, but the plain text has newlines,
    // the text was copied from a pre-formatted container so we need to convert \n to <br>.
    if (plainText.includes('\n')) {
        let prefix = '', content = html, suffix = '';
        const startFrag = html.match(/<!--StartFragment-->/);
        const endFrag = html.match(/<!--EndFragment-->/);

        if (startFrag && endFrag) {
            const startIdx = startFrag.index + startFrag[0].length;
            const endIdx = endFrag.index;
            if (startIdx < endIdx) {
                prefix = html.substring(0, startIdx);
                content = html.substring(startIdx, endIdx);
                suffix = html.substring(endIdx);
            }
        }

        const blockElementRegex = /<(p|div|pre|table|ul|ol|li|h[1-6]|blockquote|article|section|nav|header|footer|figure|figcaption|br)\b[^>]*>/i;
        if (!blockElementRegex.test(content)) {
            const fixedContent = content.replace(/\r?\n/g, '<br>');
            html = prefix + fixedContent + suffix;
        }
    }

    return html;
}

// After htmlToMarkdown runs, some AI interfaces leave a floating language label
// (e.g. "python" on its own line) above plain-text code because their HTML puts
// the label in a <div> instead of a class on <code>. This function detects that
// pattern and wraps the following content in a code block.
// Only fires when:
//     1. no fences exist yet
//     2. the label is a known language
//     3. the label is surrounded by blank lines.
function reconstructCodeFencesFromLabels(text) {
    // Only run on plain-text pastes that arrived without any fenced code blocks.
    // If ANY code block exist (from htmlToMarkdown), trust that output.
    if (text.includes('```')) return text;

    const lines = text.split('\n');
    const result = [];
    let i = 0;

    while (i < lines.length) {
        const trimmed = lines[i].trim();
        if (
            trimmed.length > 0 &&
            /^[A-Za-z0-9+#\-_]+$/.test(trimmed) &&
            KNOWN_CODE_LANGUAGES.has(trimmed.toLowerCase()) &&
            (i === 0 || lines[i - 1].trim() === '') &&
            i + 1 < lines.length && lines[i + 1].trim() === ''
        ) {
            // Found a floating label. Consume it, the blank line after it,
            // then all subsequent lines until the next blank line or end.
            i += 2; // skip label + blank separator
            const codeLines = [];
            while (i < lines.length && lines[i].trim() !== '') {
                codeLines.push(lines[i]);
                i++;
            }
            result.push('```' + trimmed.toLowerCase());
            result.push(...codeLines);
            result.push('```');
        } else {
            result.push(lines[i]);
            i++;
        }
    }

    return result.join('\n');
}

// Some sources yield a code block collapsed onto a single line, which is not valid
// Markdown — the fences must sit on their own lines. Two observed shapes:
//   ``` some command ```                 (bare collapsed fence)
//   ` ``` some command ``` `             (Gemini: the whole fence wrapped in an
//                                          inline-code span with space padding, because
//                                          htmlToMarkdown saw backticks in the content)
// Expand either into a proper multi-line block so the code-block splitter and Obsidian's
// renderer treat it as a real code block. The optional `+ groups match/discard the inline
// wrapper. Only matches lines that both open AND close a fence; genuine multi-line fences
// (a newline right after the opening ```) never match. A body that itself contains ``` is
// left alone to avoid mangling.
function expandSingleLineFences(text) {
    return text.replace(
        /^([ \t]*)(?:`+[ \t]*)?```([a-zA-Z0-9+#\-_]*)[ \t]+(.+?)[ \t]*```(?:[ \t]*`+)?[ \t]*$/gm,
        (m, indent, lang, body) => {
            if (body.includes('```')) return m;
            return indent + '```' + lang + '\n' + indent + body + '\n' + indent + '```';
        }
    );
}

// Converts any fenced code block(s) in text back to plain unfenced lines (drops the
// ```lang / ``` delimiter lines, keeps the code content). Used by the bypass paste
// handler so it can still get list/heading structure from htmlToMarkdown without ever
// introducing a code fence that wasn't explicitly requested.
function unwrapCodeFences(text) {
    return text.replace(/^[ \t]*```[a-zA-Z0-9+#\-_]*[ \t]*\r?\n([\s\S]*?)^[ \t]*```[ \t]*(?:\r?\n|$)/gm, '$1');
}

// Converts a fenced code block that holds exactly one line of content AND has no
// language label (bare ```) into inline `code` on its own line. Labeled fences
// (```python etc.) and multi-line blocks are left untouched. Runs as a post-pass on
// the fully-formatted text, so language-label normalization and code-block padding
// have already settled. Bodies containing a backtick are left as blocks, since they
// can't be represented safely as single-backtick inline code.
function inlineSingleLineCodeblocks(text) {
    // The (?:[ \t]*\r?\n)+ before the closing fence tolerates a stray trailing blank
    // line inside the block (some sources emit one) while still requiring the body to
    // be a single content line.
    return text.replace(
        /(^|\n)[ \t]*```[ \t]*\r?\n([^\n]+?)(?:[ \t]*\r?\n)+[ \t]*```[ \t]*(?=\r?\n|$)/g,
        (m, lead, body) => {
            const trimmed = body.trim();
            if (!trimmed || trimmed.includes('`')) return m;
            return lead + '`' + trimmed + '`';
        }
    );
}

function stripCodeblockIndentation(codeBlock) {
    const match = codeBlock.match(/^([ \t]*)```/);
    if (match && match[1].length > 0) {
        const indent = match[1];
        const indentRegex = new RegExp('^' + indent, 'gm');
        codeBlock = codeBlock.replace(indentRegex, '');
    }
    return codeBlock;
}

module.exports = class CleanAIPastePlugin extends Plugin {
    async onload() {
        await this.loadSettings();

        this.addSettingTab(new CleanAIPasteSettingTab(this.app, this));

        // Intercept Ctrl+Shift+V / Cmd+Shift+V at the keydown level.
        this.registerDomEvent(document, 'keydown', async (keyEvt) => {
            const isMod = keyEvt.ctrlKey || keyEvt.metaKey;
            if (!isMod || !keyEvt.shiftKey || keyEvt.key.toLowerCase() !== 'v') return;

            const activeEditor = this.app.workspace.activeEditor;
            if (!activeEditor || !activeEditor.editor) return;

            // Only act when the keystroke happened inside a Markdown editor. Otherwise
            // Ctrl+Shift+V in a search box, file-rename field, etc. would hijack the
            // paste into the note behind it.
            const target = keyEvt.target;
            if (!(target instanceof HTMLElement) || !target.closest('.cm-editor')) return;

            keyEvt.preventDefault();
            keyEvt.stopPropagation();

            try {
                const items = await navigator.clipboard.read();
                for (const item of items) {
                    const hasHtmlType = item.types.includes('text/html');
                    const hasPlainType = item.types.includes('text/plain');

                    // Skip clipboard items with no text content at all (e.g. an image-only
                    // item) instead of falling through to an empty-string paste that would
                    // delete the current selection and insert nothing.
                    if (!hasHtmlType && !hasPlainType) continue;

                    const plainText = hasPlainType
                        ? await (await item.getType('text/plain')).text()
                        : '';

                    let html = '';
                    if (hasHtmlType) {
                        html = await (await item.getType('text/html')).text();
                    }

                    const isObsidianInternal = html.includes('<!-- obsidian -->');

                    // With cleanup off, bypass pastes the raw plain text verbatim -- no
                    // HTML->Markdown conversion, so nothing (e.g. code) ever gets wrapped
                    // in a fence. With cleanup on, reconstruct structure from the HTML
                    // instead: many sites' text/plain has no list/heading/table markers at
                    // all (they're CSS-generated, not real text), so raw text alone can't
                    // preserve lists, headings, or tables. Any fence htmlToMarkdown
                    // introduces is then unwrapped back to plain lines, since bypass should
                    // still never introduce a fence that wasn't explicitly requested.
                    let result;
                    if (!this.settings.cleanupOnBypass || isObsidianInternal || !hasHtmlType) {
                        result = plainText;
                    } else {
                        result = unwrapCodeFences(htmlToMarkdown(preprocessHtml(html, plainText)));
                    }

                    // Lightweight cleanup: condense blank lines, pad tables so they render,
                    // and strip trailing whitespace. Heading spacing normalization
                    // (applyHeadingSpacing) is intentionally excluded — bypass stays light.
                    if (this.settings.cleanupOnBypass) {
                        const bypassMode = this.settings.condenseMode === 'off' ? 'off'
                            : this.settings.condenseMode === 'tight' ? 'tight'
                                : 'standard';
                        result = condenseBlankLines(result, bypassMode);
                        result = formatTablePadding(result);
                        result = stripTrailingWhitespaces(result);
                        result = result.trim();
                    }

                    if (this.settings.debugMode) {
                        new DebugPreviewModal(this.app, plainText, html, result, (selectedText) => {
                            if (selectedText !== null) {
                                activeEditor.editor.replaceSelection(selectedText);
                                if (this.settings.enableNotifications) {
                                    new Notice("Paste formatted by Clean AI Paste!");
                                }
                            }
                        }).open();
                    } else {
                        activeEditor.editor.replaceSelection(result);
                        if (this.settings.enableNotifications) {
                            new Notice("Paste formatted by Clean AI Paste!");
                        }
                    }
                    return;
                }
            } catch (e) {
                console.error("Clean AI Paste: Shift+V clipboard read failed", e);
            }
        });

        this.registerEvent(
            this.app.workspace.on('editor-paste', (evt, editor) => {
                // Another plugin may have already handled this paste (e.g. an image-paste
                // or other cleanup plugin). Defer to it instead of double-inserting.
                if (evt.defaultPrevented) return;

                const clipboardData = evt.clipboardData;
                if (!clipboardData || clipboardData.types.includes('Files')) return;

                const hasHtml = clipboardData.types.includes('text/html');
                const hasText = clipboardData.types.includes('text/plain');

                if (!hasHtml && !hasText) return;

                if (evt.shiftKey) return;

                const html = hasHtml ? clipboardData.getData('text/html') : '';

                // If the content is copied from within Obsidian, completely bypass the plugin
                if (html.includes('<!-- obsidian -->')) return;

                const plainText = hasText ? clipboardData.getData('text/plain') : '';

                try {
                    evt.preventDefault();

                    let rawText = hasHtml
                        ? reconstructCodeFencesFromLabels(htmlToMarkdown(preprocessHtml(html, plainText)))
                        : plainText;

                    // Repair code blocks that arrived collapsed onto a single line
                    // (``` cmd ``` or ` ``` cmd ``` `), so the splitter below recognizes
                    // them as fences.
                    rawText = expandSingleLineFences(rawText);

                    // Split on fenced code blocks.
                    const textSegments = rawText.split(/(^[ \t]*```[a-zA-Z0-9+#\-_]*[ \t]*\r?\n[\s\S]*?^[ \t]*```[ \t]*(?:\r?\n|$))/m);

                    // If the last text segment contains an unclosed code fence,
                    // skip all transforms on it to avoid corrupting code content.
                    const lastIdx = textSegments.length - 1;
                    const hasUnclosedFence = lastIdx % 2 === 0 && /^[ \t]*```/m.test(textSegments[lastIdx]);

                    for (let i = 0; i < textSegments.length; i++) {
                        // Skip the last segment if it has an unclosed code fence.
                        if (hasUnclosedFence && i === lastIdx) break;

                        if (i % 2 === 0) {
                            let text = textSegments[i];

                            // Language label normalization
                            if (i + 1 < textSegments.length) {
                                const normalized = normalizeLanguageLabel(text, textSegments[i + 1]);
                                text = normalized.text;
                                textSegments[i + 1] = normalized.codeBlock;
                            }

                            // Unbold Headers
                            if (this.settings.unboldHeaders) {
                                text = unboldHeaders(text);
                            }

                            // Unbold Links
                            if (this.settings.unboldLinks) {
                                text = unboldLinks(text);
                            }

                            // Header downgrade
                            if (this.settings.headerDowngradeLevel > 0) {
                                text = downgradeHeaders(text, this.settings.headerDowngradeLevel);
                            }

                            // Condense blank lines
                            if (this.settings.condenseMode !== 'off') {
                                text = condenseBlankLines(text, this.settings.condenseMode);
                            }

                            // Heading spacing sub-options (only active in Standard mode)
                            if (this.settings.condenseMode === 'standard' &&
                                (this.settings.headingBlankBefore || this.settings.headingRemoveBlankAfter)) {
                                text = applyHeadingSpacing(text,
                                    this.settings.headingBlankBefore,
                                    this.settings.headingRemoveBlankAfter);
                            }

                            // Convert math delimiters
                            if (this.settings.convertMathDelimiters) {
                                text = convertMathDelimiters(text);
                            }

                            // Format horizontal rules
                            if (this.settings.formatHorizontalRules) {
                                text = formatHorizontalRules(text);
                            }

                            // Keep a heading tight against a preceding horizontal rule.
                            // Always runs (independent of the two toggles above) so the
                            // rule/heading junction is deterministic; must come after
                            // formatHorizontalRules so it also removes the blank that
                            // setting adds after ---.
                            text = tightenRuleHeadingGap(text);

                            // Table padding
                            text = formatTablePadding(text);

                            // Blockquote padding
                            text = formatBlockquotePadding(text);

                            // Strip trailing whitespaces
                            if (this.settings.stripTrailingWhitespaces) {
                                text = stripTrailingWhitespaces(text);
                            }

                            // Strip emojis
                            if (this.settings.stripEmojis) {
                                text = stripEmojis(text, this.settings.emojiAllowlist);
                            }

                            // Clean link tracking parameters
                            if (this.settings.cleanLinkTracking) {
                                text = stripTrackingParams(text);
                            }

                            // Code block padding
                            if (i > 0 && i < textSegments.length - 1 && text.trim() === '') {
                                text = '\n';
                            } else {
                                if (i > 0) {
                                    if (this.settings.paddingAfterCodeblock || text.trimStart().startsWith('---')) {
                                        text = '\n' + text.trimStart();
                                    } else {
                                        text = text.trimStart();
                                    }
                                }
                                if (i < textSegments.length - 1) {
                                    text = text.trimEnd() + (this.settings.paddingBeforeCodeblock ? '\n\n' : '\n');
                                }
                            }

                            textSegments[i] = text;

                        } else {
                            // Odd segment = fenced code block. Strip over-indentation only.
                            textSegments[i] = stripCodeblockIndentation(textSegments[i]);
                        }
                    }

                    let formattedText = textSegments.join('').replace(/^\n+|\n+$/g, '');

                    if (this.settings.inlineSingleLineCodeblocks) {
                        formattedText = inlineSingleLineCodeblocks(formattedText);
                    }

                    if (this.settings.addTrackingSignature) {
                        formattedText =
                            this.settings.trackingSignatureStart + '\n' +
                            formattedText + '\n' +
                            this.settings.trackingSignatureEnd;
                    }

                    if (this.settings.debugMode) {
                        new DebugPreviewModal(this.app, plainText, html, formattedText, (selectedText) => {
                            if (selectedText !== null) {
                                editor.replaceSelection(selectedText);
                                if (this.settings.enableNotifications) {
                                    new Notice("Paste formatted by Clean AI Paste!");
                                }
                            }
                        }).open();
                    } else {
                        editor.replaceSelection(formattedText);

                        if (this.settings.enableNotifications) {
                            new Notice("Paste formatted by Clean AI Paste!");
                        }
                    }

                } catch (error) {
                    console.error("Clean AI Paste plugin error:", error);
                    if (plainText) {
                        editor.replaceSelection(plainText);
                        new Notice("Clean AI Paste error: Formatting failed, pasted raw text instead.");
                    } else {
                        new Notice("Clean AI Paste error: Could not format clipboard data.");
                    }
                }
            })
        );
    }

    async loadSettings() {
        const saved = await this.loadData();
        this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);
        // Migration 1: Very old boolean condenseBlankLines + tightCondense → condenseMode.
        if (saved && 'condenseBlankLines' in saved && !('condenseMode' in saved)) {
            if (!saved.condenseBlankLines) {
                this.settings.condenseMode = 'off';
            } else if (saved.tightCondense) {
                this.settings.condenseMode = 'tight';
            } else {
                this.settings.condenseMode = 'standard';
            }
        }
        // Migration 2: condenseMode='standard+headings' (previous unified mode) → 'standard'
        // Re-enable both heading sub-options to preserve old behavior.
        if (saved && saved.condenseMode === 'standard+headings') {
            this.settings.condenseMode = 'standard';
            if (!('headingBlankBefore' in saved)) {
                this.settings.headingBlankBefore = true;
            }
            if (!('headingRemoveBlankAfter' in saved)) {
                this.settings.headingRemoveBlankAfter = true;
            }
        }
        // Migration 3: old condenseMode='standard' + ensureHeadingSpacing=true → both heading sub-options.
        if (saved && saved.condenseMode === 'standard' && saved.ensureHeadingSpacing === true) {
            this.settings.headingBlankBefore = true;
            this.settings.headingRemoveBlankAfter = true;
        }
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
};


// ─────────────────────────────────────────────────────────────────────────────
// Settings UI
// ─────────────────────────────────────────────────────────────────────────────

class CleanAIPasteSettingTab extends PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display() {
        const { containerEl } = this;
        containerEl.empty();

        new Setting(containerEl).setName('Formatting & cleanup').setHeading();

        new Setting(containerEl)
            .setName('Spacing normalization')
            .setDesc('Controls how blank lines in pasted text are cleaned up. Standard natural line and paragraph spacing with comfortable room to breathe. Tight removes all blank lines. Off leaves everything untouched.')
            .addDropdown(dropdown => dropdown
                .addOptions({
                    'standard': 'Standard - compacts text naturally and cleanly',
                    'tight': 'Tight - remove all blank lines',
                    'off': 'Off - do not touch any spacing'
                })
                .setValue(this.plugin.settings.condenseMode)
                .onChange(async (value) => {
                    this.plugin.settings.condenseMode = value;
                    await this.plugin.saveSettings();
                    this.display(); // show/hide heading sub-options
                }));

        // Heading spacing sub-options - only visible when Standard is selected
        if (this.plugin.settings.condenseMode === 'standard') {
            new Setting(containerEl)
                .setName('↳ Add blank line before headings')
                .setDesc('Adds a blank line before each heading when there isn\'t one already.')
                .addToggle(toggle => toggle
                    .setValue(this.plugin.settings.headingBlankBefore)
                    .onChange(async (value) => {
                        this.plugin.settings.headingBlankBefore = value;
                        await this.plugin.saveSettings();
                    }));

            new Setting(containerEl)
                .setName('↳ Remove blank line after headings')
                .setDesc('Removes the blank line after a heading and its following content.')
                .addToggle(toggle => toggle
                    .setValue(this.plugin.settings.headingRemoveBlankAfter)
                    .onChange(async (value) => {
                        this.plugin.settings.headingRemoveBlankAfter = value;
                        await this.plugin.saveSettings();
                    }));
        }

        new Setting(containerEl)
            .setName('Strip trailing whitespaces')
            .setDesc('Removes invisible spaces at the very end of every line. Useful for keeping version control logs clean.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.stripTrailingWhitespaces)
                .onChange(async (value) => {
                    this.plugin.settings.stripTrailingWhitespaces = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Strip emojis')
            .setDesc('Removes all emojis from pasted text. Useful for keeping notes clean and professional.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.stripEmojis)
                .onChange(async (value) => {
                    this.plugin.settings.stripEmojis = value;
                    await this.plugin.saveSettings();
                    this.display();
                }));

        if (this.plugin.settings.stripEmojis) {
            new Setting(containerEl)
                .setName('↳ Emoji allowlist')
                .setDesc('Emojis to preserve when "Strip emojis" is enabled. Paste them here separated by commas (e.g. ✅, ❌, ⭐). Leave blank to strip all emojis.')
                .addText(text => text
                    .setPlaceholder('e.g. ✅, ❌, ⭐')
                    .setValue(this.plugin.settings.emojiAllowlist)
                    .onChange(async (value) => {
                        this.plugin.settings.emojiAllowlist = value;
                        await this.plugin.saveSettings();
                    }));
        }

        new Setting(containerEl)
            .setName('Strip link tracking parameters')
            .setDesc('Removes tracking parameters (e.g., ?utm_source=chatgpt.com) from URLs in the pasted text while preserving important query parameters.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.cleanLinkTracking)
                .onChange(async (value) => {
                    this.plugin.settings.cleanLinkTracking = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl).setName('Markdown elements').setHeading();

        new Setting(containerEl)
            .setName('Unbold headers')
            .setDesc('Removes bold formatting natively generated by AI for markdown headers (e.g. changes **## Header** to ## Header).')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.unboldHeaders)
                .onChange(async (value) => {
                    this.plugin.settings.unboldHeaders = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Unbold links')
            .setDesc('Removes bold formatting wrapper from pasted links (e.g. changes **[Link Text](url)** to [Link Text](url)).')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.unboldLinks)
                .onChange(async (value) => {
                    this.plugin.settings.unboldLinks = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Header downgrade level')
            .setDesc('Automatically shifts pasted headers down by a specific number of levels. Helps prevent deeply nested pasted text from visually overpowering your main document title.')
            .addDropdown(dropdown => dropdown
                .addOptions({
                    '0': 'None',
                    '1': 'Downgrade 1 level (# → ##)',
                    '2': 'Downgrade 2 levels (# → ###)',
                    '3': 'Downgrade 3 levels (# → ####)'
                })
                .setValue(this.plugin.settings.headerDowngradeLevel.toString())
                .onChange(async (value) => {
                    this.plugin.settings.headerDowngradeLevel = parseInt(value, 10);
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Convert math delimiters')
            .setDesc('Converts AI-style LaTeX delimiters \\( \\) and \\[ \\] into Obsidian\'s native $ and $$ formats. Works correctly inside table cells; leaves inline code untouched.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.convertMathDelimiters)
                .onChange(async (value) => {
                    this.plugin.settings.convertMathDelimiters = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Format horizontal rules')
            .setDesc('Ensures a blank line both before and after horizontal separators (---) so they render correctly.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.formatHorizontalRules)
                .onChange(async (value) => {
                    this.plugin.settings.formatHorizontalRules = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Padding before code blocks')
            .setDesc('Ensures there is an empty line immediately before every code block so it renders completely unattached from previous text.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.paddingBeforeCodeblock)
                .onChange(async (value) => {
                    this.plugin.settings.paddingBeforeCodeblock = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Padding after code blocks')
            .setDesc('Ensures there is an empty line immediately after every code block. If turned off, normal text will follow directly on the next line.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.paddingAfterCodeblock)
                .onChange(async (value) => {
                    this.plugin.settings.paddingAfterCodeblock = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Inline single-line code blocks')
            .setDesc('Converts a fenced code block that contains only one line into inline `code` (e.g. a copied one-line command). Code blocks with a language label (like ```python) and multi-line blocks are always left as full blocks.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.inlineSingleLineCodeblocks)
                .onChange(async (value) => {
                    this.plugin.settings.inlineSingleLineCodeblocks = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl).setName('Bypass paste (Ctrl+Shift+V / Cmd+Shift+V)').setHeading();

        new Setting(containerEl)
            .setName('Keep Markdown structure on bypass')
            .setDesc('When on, bypass paste keeps the Markdown structure of the copied content (headings, lists, tables, bold, links) — but never wraps anything in a code fence — and does light cleanup: condensing blank lines (following the Spacing normalization setting above) and stripping trailing whitespace. When off, bypass inserts the clipboard\'s raw plain text exactly as copied, completely untouched.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.cleanupOnBypass)
                .onChange(async (value) => {
                    this.plugin.settings.cleanupOnBypass = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl).setName('AI tracking & notifications').setHeading();

        new Setting(containerEl)
            .setName('Add tracking signature')
            .setDesc('Wraps the pasted text with a hidden start and end tracking comment so you can easily identify AI-generated blocks in Source Mode. These comments are hidden in Read Mode.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.addTrackingSignature)
                .onChange(async (value) => {
                    this.plugin.settings.addTrackingSignature = value;
                    await this.plugin.saveSettings();
                    this.display();
                }));

        if (this.plugin.settings.addTrackingSignature) {
            new Setting(containerEl)
                .setName('↳ Tracking signature start tag')
                .setDesc('The string injected at the very top of the AI paste.')
                .addText(text => {
                    text.inputEl.style.width = '200px';
                    text.setValue(this.plugin.settings.trackingSignatureStart)
                        .onChange(async (value) => {
                            this.plugin.settings.trackingSignatureStart = value;
                            await this.plugin.saveSettings();
                        });
                });

            new Setting(containerEl)
                .setName('↳ Tracking signature end tag')
                .setDesc('The string injected at the very bottom of the AI paste.')
                .addText(text => {
                    text.inputEl.style.width = '200px';
                    text.setValue(this.plugin.settings.trackingSignatureEnd)
                        .onChange(async (value) => {
                            this.plugin.settings.trackingSignatureEnd = value;
                            await this.plugin.saveSettings();
                        });
                });
        }

        new Setting(containerEl)
            .setName('Enable paste notifications')
            .setDesc('Shows a small notice in the top right corner each time the plugin processes a paste.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableNotifications)
                .onChange(async (value) => {
                    this.plugin.settings.enableNotifications = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl).setName('Troubleshooting').setHeading();

        new Setting(containerEl)
            .setName('Enable Debug/Preview Mode')
            .setDesc('When enabled, pasting will open a popup window showing what is inside your clipboard: the raw plain text, raw HTML, and the plugin\'s formatted result. You can inspect the differences and choose which version to insert.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.debugMode)
                .onChange(async (value) => {
                    this.plugin.settings.debugMode = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Reset settings to default')
            .setDesc('Restores all plugin settings to their default values. This action cannot be undone.')
            .addButton(button => button
                .setButtonText('Reset to Default')
                .setWarning()
                .onClick(async () => {
                    this.plugin.settings = Object.assign({}, DEFAULT_SETTINGS);
                    await this.plugin.saveSettings();
                    this.display();
                    new Notice('Clean AI Paste: Settings restored to default');
                }));

        // Buy Me a Coffee Support Button
        const donationDiv = containerEl.createEl('div', {
            attr: { style: 'margin-top: 40px; margin-bottom: 20px; text-align: center;' }
        });

        donationDiv.createEl('p', {
            text: 'If you find this plugin helpful, consider supporting its development!',
            attr: { style: 'margin-bottom: 10px; color: var(--text-muted);' }
        });

        if (!document.getElementById('bmac-cookie-font')) {
            document.head.createEl('link', {
                attr: {
                    id: 'bmac-cookie-font',
                    rel: 'stylesheet',
                    href: 'https://fonts.googleapis.com/css2?family=Cookie&display=swap'
                }
            });
        }

        const bmacLink = donationDiv.createEl('a', {
            attr: {
                href: 'https://www.buymeacoffee.com/jeremyhou',
                target: '_blank',
            }
        });

        bmacLink.createEl('img', {
            attr: {
                src: 'https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png',
                alt: 'Buy Me A Coffee',
                style: 'height: 40px !important; width: 145px !important;'
            }
        });
        // Custom Support Button
        // const bmacButton = bmacLink.createEl('div', {
        //     attr: {
        //         style: `
        //             display: inline-flex; 
        //             align-items: center; 
        //             justify-content: center; 
        //             background-color: #FFDD00; 
        //             color: #000000; 
        //             padding: 5px 15px; 
        //             border-radius: 5px; 
        //             font-family: 'Cookie', cursive, sans-serif; 
        //             font-size: 28px; 
        //             letter-spacing: 0.5px; 
        //             box-shadow: 0px 3px 2px 0px rgba(190, 190, 190, 0.5); 
        //             border: 1px solid transparent;
        //             cursor: pointer;
        //         `
        //     }
        // });

        // bmacButton.createEl('span', {
        //     text: '🧋',
        //     attr: { style: 'margin-right: 8px; font-size: 24px;' }
        // });

        // bmacButton.createEl('span', {
        //     text: 'Buy me a boba tea'
        // });

    }
}

class DebugPreviewModal extends Modal {
    constructor(app, plainText, html, formattedText, onPaste) {
        super(app);
        this.plainText = plainText;
        this.html = html;
        this.formattedText = formattedText;
        this.onPaste = onPaste;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();

        // Make the modal wide enough for 3 columns
        this.modalEl.style.width = '90vw';
        this.modalEl.style.maxWidth = '1400px';

        contentEl.createEl('h2', { text: 'Clean AI Paste: Debug/Preview' });

        const container = contentEl.createEl('div', { attr: { style: 'display: flex; gap: 10px; margin-bottom: 20px; height: 70vh;' } });

        // Plain Text Column
        const plainCol = container.createEl('div', { attr: { style: 'flex: 1; display: flex; flex-direction: column;' } });
        plainCol.createEl('h4', { text: 'Clipboard: text/plain', attr: { style: 'margin-top: 0;' } });
        const plainArea = plainCol.createEl('textarea', { attr: { readonly: true, style: 'flex: 1; resize: none; white-space: pre-wrap; font-family: monospace; font-size: 12px;' } });
        plainArea.value = this.plainText;

        // HTML Column
        const htmlCol = container.createEl('div', { attr: { style: 'flex: 1; display: flex; flex-direction: column;' } });
        htmlCol.createEl('h4', { text: 'Clipboard: text/html', attr: { style: 'margin-top: 0;' } });
        const htmlArea = htmlCol.createEl('textarea', { attr: { readonly: true, style: 'flex: 1; resize: none; white-space: pre-wrap; font-family: monospace; font-size: 12px;' } });
        htmlArea.value = this.html;

        // Formatted Column
        const formattedCol = container.createEl('div', { attr: { style: 'flex: 1; display: flex; flex-direction: column;' } });
        formattedCol.createEl('h4', { text: 'Formatted Text', attr: { style: 'margin-top: 0;' } });
        const formattedArea = formattedCol.createEl('textarea', { attr: { readonly: true, style: 'flex: 1; resize: none; white-space: pre-wrap; font-family: monospace; font-size: 12px;' } });
        formattedArea.value = this.formattedText;

        const buttonContainer = contentEl.createEl('div', { attr: { style: 'display: flex; justify-content: flex-end; gap: 10px;' } });

        const btnCancel = buttonContainer.createEl('button', { text: 'Cancel' });
        btnCancel.addEventListener('click', () => {
            this.onPaste(null);
            this.close();
        });

        const btnPastePlain = buttonContainer.createEl('button', { text: 'Paste Plain Text' });
        btnPastePlain.addEventListener('click', () => {
            this.onPaste(this.plainText);
            this.close();
        });

        const btnPasteFormatted = buttonContainer.createEl('button', { text: 'Paste Formatted', cls: 'mod-cta' });
        btnPasteFormatted.addEventListener('click', () => {
            this.onPaste(this.formattedText);
            this.close();
        });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
/* nosourcemap */