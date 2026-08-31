"use strict";

const { Plugin, htmlToMarkdown, Notice, PluginSettingTab, Setting, Modal } = require('obsidian');

const DEFAULT_SETTINGS = {
    // Formatting & Cleanup
    condenseMode: 'standard',
    headingRemoveBlankBefore: true,
    headingRemoveBlankAfter: true,
    stripTrailingWhitespaces: true,
    stripEmojis: true,
    emojiAllowlist: '',
    stripTechnicalSymbols: false,
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
    bypassRawText: false,
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
                // Only treat the trailing word as a language label if it is a known programming language
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

function applyHeadingSpacing(text, removeBlankBefore, removeBlankAfter) {
    if (removeBlankBefore) {
        // Obsidian renders its own space above headings, so the blank line is redundant.
        text = text.replace(/([^\n])\n(?:[ \t\xA0]*\n)+([ \t]*#{1,6}[ \t])/g, '$1\n$2');
    }
    if (removeBlankAfter) {
        // The lookahead skips heading-to-heading gaps and runs of 2+ blank lines.
        text = text.replace(/(^#{1,6}\s.+$)\n\n(?!#{1,6}\s|\n)/gm, '$1\n');
    }
    return text;
}

function convertMathDelimiters(text) {
    // Split on inline code spans so delimiters quoted inside them are left untouched.
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
    // Removes blank line between a horizontal rule and a heading that directly follows it.
    return text.replace(/(^[ \t]*-{3,}[ \t]*\r?\n)(?:[ \t\xA0]*\r?\n)+([ \t]*#{1,6}[ \t])/gm, '$1$2');
}

function formatTablePadding(text) {
    // Requiring a delimiter row stops ASCII line art being padded like a table.
    const isPipeRow = (line) => /^[ \t]*\|.*\|/.test(line);
    // \r so a blank line still counts as blank in CRLF text.
    const isBlank = (line) => /^[ \t\xA0\r]*$/.test(line);
    // `||` doesn't render as an empty cell; a space does. Escaped `\|` never matches.
    const padEmptyCells = (row) => row.replace(/\|(?=\|)/g, '| ');
    const isDelimRow = (line) => {
        if (!line.includes('|')) return false;
        const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|');
        return cells.every((cell) => /^\s*:?-+:?\s*$/.test(cell));
    };

    const lines = text.split('\n');
    // Inserted blank lines must match the document's line ending, not force LF into CRLF.
    const blank = /\r\n/.test(text) ? '\r' : '';
    const out = [];
    let i = 0;
    while (i < lines.length) {
        if (!(isPipeRow(lines[i]) && i + 1 < lines.length && isDelimRow(lines[i + 1]))) {
            out.push(lines[i]);
            i++;
            continue;
        }

        while (out.length > 0 && isBlank(out[out.length - 1])) out.pop();
        if (out.length > 0) out.push(blank);

        out.push(padEmptyCells(lines[i]), lines[i + 1]);
        i += 2;
        while (i < lines.length && isPipeRow(lines[i])) {
            out.push(padEmptyCells(lines[i]));
            i++;
        }

        let next = i;
        while (next < lines.length && isBlank(lines[next])) next++;
        if (next < lines.length) {
            out.push(blank);
            i = next;
        }
    }
    return out.join('\n');
}

function formatBlockquotePadding(text) {
    return text.replace(/(^>.*$)\r?\n([^>\n\r])/gm, '$1\n\n$2');
}

function stripTrailingWhitespaces(text) {
    return text.replace(/[ \t]+$/gm, '');
}

// U+2300-23FF is Miscellaneous Technical (\u2318 \u2325 \u23CE \u232B) \u2014 keyboard keys, not emoji, so it is
// only swept when the caller opts in.
const EMOJI_RANGES = '\\u{1F000}-\\u{1FFFF}\\u{2600}-\\u{27BF}\\u{2B00}-\\u{2BFF}\\uFE0F\\u200D';
const TECHNICAL_RANGE = '\\u{2300}-\\u{23FF}';

function stripEmojis(text, allowlist, stripTechnical) {
    // Matches a run of emoji chars together with any spaces/tabs on either side, so we
    // can collapse to a single space only when the emoji sat between two words.
    const chars = EMOJI_RANGES + (stripTechnical ? TECHNICAL_RANGE : '');
    const emojiRun = new RegExp('([ \\t]*)[' + chars + ']+([ \\t]*)', 'gu');
    // With whitespace on one side only, keep a space unless the other side is punctuation.
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

    const allowed = new Set(allowlist ? allowlist.split(/[\s,]+/).filter(Boolean) : []);
    if (allowed.size === 0) return text.replace(emojiRun, collapse);

    // Filter per grapheme so an allowlisted emoji survives a run it shares with others,
    // and so ZWJ sequences (\uD83D\uDC68\u200D\uD83D\uDC69\u200D\uD83D\uDC67) are judged whole rather than torn apart.
    const segmenter = typeof Intl.Segmenter === 'function'
        ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
        : null;
    const keptOf = (run) => {
        const parts = segmenter
            ? [...segmenter.segment(run)].map((s) => s.segment)
            : Array.from(run);
        return parts.filter((g) => allowed.has(g)).join('');
    };

    return text.replace(emojiRun, (m, before, after, offset, string) => {
        const kept = keptOf(m.slice(before.length, m.length - after.length));
        if (!kept) return collapse(m, before, after, offset, string);
        return before + kept + after;
    });
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

// A whole document or fragment of markup — opens with a tag or declaration and closes with
// a closing tag. Deliberately strict: prose that merely mentions <div> does not match.
const MARKUP_SOURCE = /^\s*<(?:\?xml|!DOCTYPE|[A-Za-z][\w:.-]*)[\s\S]*<\/[A-Za-z][\w:.-]*>\s*$/;

// Pre-process clipboard HTML to fix code blocks and line breaks before htmlToMarkdown
function preprocessHtml(html, plainText = '') {
    // Pasted markup is swallowed by Obsidian's renderer, so fence it. Built from plainText
    // rather than the HTML so indentation survives.
    if (MARKUP_SOURCE.test(plainText)) {
        const lang = /^\s*<(?:!DOCTYPE\s+html|html)\b/i.test(plainText) ? 'html' : 'xml';
        const escaped = plainText.trim()
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return '<pre><code class="language-' + lang + '">' + escaped + '</code></pre>';
    }

    // Normalize Gemini code blocks, turning Gemini's code block from <code-block>
    // to a <pre><code> (the same clean shape as ChatGPT/Claude) so htmlToMarkdown produces a proper fenced block.
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

    // Replace <br> with \n INSIDE <pre> or <code> blocks.
    html = html.replace(/<(pre|code)\b[^>]*>(.*?)<\/\1>/gis, (match, tag, content) => {
        return `<${tag}>` + content.replace(/<br\s*\/?>/gi, '\n') + `</${tag}>`;
    });

    // A block element inside a heading makes the converter break the line, leaving the
    // `##` stranded on its own and the title as a plain paragraph.
    html = html.replace(/<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1>/gi, (m, tag, inner) =>
        '<' + tag + '>'
        + inner.replace(/<\/?(?:div|p|section|article|header|footer|figure)\b[^>]*>/gi, ' ')
        + '</' + tag + '>');

    // One cell is a fragment of a table, not a table — keep just its contents, or the
    // paste becomes a useless 1x1 grid.
    if ((html.match(/<t[dh]\b/gi) || []).length === 1) {
        html = html
            .replace(/<\/?(?:table|thead|tbody|tfoot|tr|colgroup|col|caption)\b[^>]*>/gi, '')
            .replace(/<\/?t[dh]\b[^>]*>/gi, '');
    }

    // Claude copies tables without <table>; parsers drop orphaned table tags.
    if (/<(?:thead|tbody|tfoot|tr)\b/i.test(html) && !/<table\b/i.test(html)) {
        html = html.replace(
            /<(?:thead|tbody|tfoot|tr)\b[\s\S]*<\/(?:thead|tbody|tfoot|tr)>/i,
            (match) => '<table>' + match + '</table>'
        );
    }

    // Structureless fragment + newlines in plainText = copied from a pre-formatted container.
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
            // Test the text only: whitespace inside tags is markup, not alignment.
            const textOnly = content.replace(/<[^>]*>/g, '');
            // Load-bearing alignment only survives as a <pre>, i.e. a fenced code block.
            html = /  +/.test(textOnly) || /^[ \t]+\S/m.test(textOnly)
                ? prefix + '<pre>' + content + '</pre>' + suffix
                : prefix + content.replace(/\r?\n/g, '<br>') + suffix;
        }
    }

    return html;
}

// Punctuation, CLI flags or indentation — things prose sentences don't carry.
const CODE_BODY = /[{};=<>\[\]()|\\$`]|(?:^|\s)-{1,2}[A-Za-z]|^[ \t]{2,}\S/m;

// Fences a floating language label: needs no existing fences, a known language surrounded
// by blank lines, and a body that looks like code.
function reconstructCodeFencesFromLabels(text) {
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
            const codeLines = [];
            let j = i + 2;
            while (j < lines.length && lines[j].trim() !== '') {
                codeLines.push(lines[j]);
                j++;
            }
            // A language name can also just be an English word ("Go", "Text", "R"), so
            // only fence when the body carries a code signal rather than reading as prose.
            if (!CODE_BODY.test(codeLines.join('\n'))) {
                result.push(lines[i]);
                i++;
                continue;
            }
            i = j;
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

// Expands a fence collapsed onto one line — ``` cmd ``` or Gemini's ` ``` cmd ``` `.
function expandSingleLineFences(text) {
    return text.replace(
        /^([ \t]*)(?:`+[ \t]*)?```([a-zA-Z0-9+#\-_]*)[ \t]+(.+?)[ \t]*```(?:[ \t]*`+)?[ \t]*$/gm,
        (m, indent, lang, body) => {
            if (body.includes('```')) return m;
            return indent + '```' + lang + '\n' + indent + body + '\n' + indent + '```';
        }
    );
}

// Turns a single-line unlabeled fence into inline `code`. Runs as a post-pass, after
// label normalization and padding have settled. Bodies with a backtick stay blocks.
function inlineSingleLineCodeblocks(text) {
    // The (?:[ \t]*\r?\n)+ tolerates one stray blank line before the closing fence.
    return text.replace(
        /(^|\n)[ \t]*```[ \t]*\r?\n([^\n]+?)(?:[ \t]*\r?\n)+[ \t]*```[ \t]*(?=\r?\n|$)/g,
        (m, lead, body) => {
            const trimmed = body.trim();
            if (!trimmed || trimmed.includes('`')) return m;
            return lead + '`' + trimmed + '`';
        }
    );
}

// Marker + blockquote depth, so a fence only closes one opened the same way.
function isInsideFencedCode(lines, lineIndex) {
    let open = null;
    for (let i = 0; i < lineIndex && i < lines.length; i++) {
        const match = lines[i].match(/^[ \t]*((?:>[ \t]*)*)(`{3,}|~{3,})/);
        if (!match) continue;
        const depth = (match[1].match(/>/g) || []).length;
        const marker = match[2][0];
        if (open === null) {
            open = { marker, depth };
        } else if (open.marker === marker && open.depth === depth) {
            open = null;
        }
    }
    return open !== null;
}

// A clipboard can advertise text/html and still supply markup that converts to nothing.
// Judge by what came out, not by what was offered.
function resolveRawText(converted, plainText) {
    return (!converted.trim() && plainText.trim()) ? plainText : converted;
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

// Resolves a saved data.json against the current schema. Pure, so the branches below are
// testable — they run once per install at upgrade and fail silently if wrong.
function migrateSettings(saved, defaults) {
    const settings = Object.assign({}, defaults, saved);
    // Migration 1: Very old boolean condenseBlankLines + tightCondense → condenseMode.
    if (saved && 'condenseBlankLines' in saved && !('condenseMode' in saved)) {
        if (!saved.condenseBlankLines) {
            settings.condenseMode = 'off';
        } else if (saved.tightCondense) {
            settings.condenseMode = 'tight';
        } else {
            settings.condenseMode = 'standard';
        }
    }
    // Migration 2: condenseMode='standard+headings' (previous unified mode) → 'standard'.
    if (saved && saved.condenseMode === 'standard+headings') {
        settings.condenseMode = 'standard';
        if (!('headingRemoveBlankAfter' in saved)) {
            settings.headingRemoveBlankAfter = true;
        }
    }
    // Migration 3: old condenseMode='standard' + ensureHeadingSpacing=true → heading sub-option.
    if (saved && saved.condenseMode === 'standard' && saved.ensureHeadingSpacing === true) {
        settings.headingRemoveBlankAfter = true;
    }
    // Migration 4: headingBlankBefore (add) → headingRemoveBlankBefore (remove).
    // Opposite meanings, so the old value is dropped and the new default applies.
    delete settings.headingBlankBefore;
    // Migration 5: cleanupOnBypass=false meant "paste raw" → bypassRawText.
    if (saved && saved.cleanupOnBypass === false && !('bypassRawText' in saved)) {
        settings.bypassRawText = true;
    }
    delete settings.cleanupOnBypass;
    return settings;
}

module.exports = class CleanAIPastePlugin extends Plugin {
    async onload() {
        await this.loadSettings();

        this.addSettingTab(new CleanAIPasteSettingTab(this.app, this));

        // Opens the Debug/Preview modal regardless of the debugMode setting.
        this.addCommand({
            id: 'paste-with-debug-preview',
            name: 'Paste with Debug/Preview',
            editorCallback: async (editor) => {
                try {
                    const items = await navigator.clipboard.read();
                    for (const item of items) {
                        const hasHtmlType = item.types.includes('text/html');
                        const hasPlainType = item.types.includes('text/plain');
                        if (!hasHtmlType && !hasPlainType) continue;

                        const plainText = hasPlainType
                            ? await (await item.getType('text/plain')).text()
                            : '';
                        const html = hasHtmlType
                            ? await (await item.getType('text/html')).text()
                            : '';

                        let formatted;
                        try {
                            formatted = this.formatClipboard(html, plainText, hasHtmlType);
                        } catch (formatError) {
                            console.error("Clean AI Paste plugin error:", formatError);
                            formatted = plainText;
                        }

                        new DebugPreviewModal(this.app, plainText, html, formatted, (selectedText) => {
                            if (selectedText !== null) {
                                editor.replaceSelection(selectedText);
                            }
                        }).open();
                        return;
                    }
                    new Notice("Clean AI Paste: clipboard has no text to paste.");
                } catch (e) {
                    console.error("Clean AI Paste: debug paste clipboard read failed", e);
                    new Notice("Clean AI Paste: could not read the clipboard.");
                }
            }
        });

        // Escape hatch for when a paste comes out wrong in an unanticipated way.
        this.addCommand({
            id: 'paste-raw-text',
            name: 'Paste raw text',
            editorCallback: async (editor) => {
                try {
                    const items = await navigator.clipboard.read();
                    for (const item of items) {
                        if (!item.types.includes('text/plain')) continue;
                        editor.replaceSelection(await (await item.getType('text/plain')).text());
                        return;
                    }
                    new Notice("Clean AI Paste: clipboard has no plain text to paste.");
                } catch (e) {
                    console.error("Clean AI Paste: raw paste clipboard read failed", e);
                    new Notice("Clean AI Paste: could not read the clipboard.");
                }
            }
        });

        // Intercept Ctrl+Shift+V / Cmd+Shift+V at the keydown level.
        this.registerDomEvent(document, 'keydown', async (keyEvt) => {
            const isMod = keyEvt.ctrlKey || keyEvt.metaKey;
            if (!isMod || !keyEvt.shiftKey || keyEvt.key.toLowerCase() !== 'v') return;

            const activeEditor = this.app.workspace.activeEditor;
            if (!activeEditor || !activeEditor.editor) return;

            // Editor only, or this hijacks pastes in search boxes and rename fields.
            const target = keyEvt.target;
            if (!(target instanceof HTMLElement) || !target.closest('.cm-editor')) return;

            keyEvt.preventDefault();
            keyEvt.stopPropagation();

            try {
                const items = await navigator.clipboard.read();
                for (const item of items) {
                    const hasHtmlType = item.types.includes('text/html');
                    const hasPlainType = item.types.includes('text/plain');

                    // No plain text means nothing to paste (e.g. an image-only item).
                    if (!hasPlainType) continue;

                    const plainText = await (await item.getType('text/plain')).text();

                    let html = '';
                    if (hasHtmlType) {
                        html = await (await item.getType('text/html')).text();
                    }

                    // Structure only: many sites build list markers in CSS, so raw
                    // text/plain loses them.
                    const cursor = activeEditor.editor.getCursor('from');
                    const linesAbove = [];
                    for (let i = 0; i < cursor.line; i++) linesAbove.push(activeEditor.editor.getLine(i));
                    const rawOnly = this.settings.bypassRawText
                        || !hasHtmlType
                        || html.includes('<!-- obsidian -->')
                        || isInsideFencedCode(linesAbove, cursor.line);

                    let result = plainText;
                    if (!rawOnly) {
                        const converted = resolveRawText(htmlToMarkdown(preprocessHtml(html, plainText)), plainText);
                        result = converted === plainText
                            ? plainText
                            : formatBlockquotePadding(formatTablePadding(converted));
                    }

                    if (this.settings.debugMode) {
                        new DebugPreviewModal(this.app, plainText, html, result, (selectedText) => {
                            if (selectedText !== null) {
                                activeEditor.editor.replaceSelection(selectedText);
                            }
                        }).open();
                    } else {
                        // No notice: bypass formats nothing, so there is nothing to report.
                        activeEditor.editor.replaceSelection(result);
                    }
                    return;
                }

                // preventDefault() already fired, so say why nothing pasted.
                new Notice("Clean AI Paste: clipboard has no plain text to paste.");
            } catch (e) {
                console.error("Clean AI Paste: Shift+V clipboard read failed", e);
                new Notice("Clean AI Paste: could not read the clipboard.");
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

                const html = hasHtml ? clipboardData.getData('text/html') : '';

                // If the content is copied from within Obsidian, completely bypass the plugin
                if (html.includes('<!-- obsidian -->')) return;

                const plainText = hasText ? clipboardData.getData('text/plain') : '';

                try {
                    evt.preventDefault();

                    // Code blocks take literal text. hasText guards against wiping the
                    // selection with an empty string.
                    if (hasText) {
                        const cursor = editor.getCursor('from');
                        const linesAbove = [];
                        for (let i = 0; i < cursor.line; i++) linesAbove.push(editor.getLine(i));
                        if (isInsideFencedCode(linesAbove, cursor.line)) {
                            editor.replaceSelection(plainText);
                            return;
                        }
                    }

                    const formattedText = this.formatClipboard(html, plainText, hasHtml);

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

    // Shared by the paste handler and the Paste with Debug/Preview command.
    formatClipboard(html, plainText, hasHtml) {
        let rawText = hasHtml
            ? resolveRawText(reconstructCodeFencesFromLabels(htmlToMarkdown(preprocessHtml(html, plainText))), plainText)
            : plainText;

        // Repair collapsed fences so the splitter below recognizes them.
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
                    (this.settings.headingRemoveBlankBefore || this.settings.headingRemoveBlankAfter)) {
                    text = applyHeadingSpacing(text,
                        this.settings.headingRemoveBlankBefore,
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

                // Remove new line between a horizontal rule and a heading
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
                    text = stripEmojis(text, this.settings.emojiAllowlist,
                        this.settings.stripTechnicalSymbols);
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
        return formattedText;
    }

    async loadSettings() {
        this.settings = migrateSettings(await this.loadData(), DEFAULT_SETTINGS);
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
};


// ─────────────────────────────────────────────────────────────────────────────
// Settings UI
// ─────────────────────────────────────────────────────────────────────────────

// app.setting is not part of the public API, so fall back to instructions if it changes.
function openHotkeySettings(app) {
    const setting = app.setting;
    const tab = setting && setting.openTabById && setting.openTabById('hotkeys');
    if (tab && tab.setQuery) {
        tab.setQuery('Clean AI Paste');
    } else {
        new Notice('Open Settings → Hotkeys and search for "Clean AI Paste".');
    }
}

class CleanAIPasteSettingTab extends PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display() {
        const { containerEl } = this;
        containerEl.empty();

        new Setting(containerEl).setName('Spacing & headings').setHeading();

        new Setting(containerEl)
            .setName('Spacing normalization')
            .setDesc('Controls how blank lines in pasted text are cleaned up. Standard creates natural line and paragraph spacing with comfortable room to breathe. Tight removes all blank lines. Off leaves everything untouched.')
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
                .setName('↳ Remove blank line before headings')
                .setDesc('Removes the blank line above each heading. Obsidian already renders headings with space above them, so the blank line in the source is usually redundant.')
                .addToggle(toggle => toggle
                    .setValue(this.plugin.settings.headingRemoveBlankBefore)
                    .onChange(async (value) => {
                        this.plugin.settings.headingRemoveBlankBefore = value;
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

        new Setting(containerEl).setName('Formatting & cleanup').setHeading();

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

            new Setting(containerEl)
                .setName('↳ Also strip technical symbols')
                .setDesc('Removes keyboard and technical symbols such as ⌘ ⌥ ⏎ ⌫ as well. Off by default because these may carry meaning — stripping them turns "Press ⌘C" into "Press C".')
                .addToggle(toggle => toggle
                    .setValue(this.plugin.settings.stripTechnicalSymbols)
                    .onChange(async (value) => {
                        this.plugin.settings.stripTechnicalSymbols = value;
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

        new Setting(containerEl).setName('Code blocks').setHeading();

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
            .setName('Paste raw text instead')
            .setDesc('By default, bypass paste keeps the structure of the copied content (lists, headings, tables, links) but applies none of the formatting rules above. Turn this on to insert the clipboard\'s raw plain text (text/raw) exactly as copied. Note that many sites generate list numbers and bullets in CSS, so raw text can lose them.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.bypassRawText)
                .onChange(async (value) => {
                    this.plugin.settings.bypassRawText = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('↳ Assign a hotkey')
            .setDesc('The "Paste raw text" command applies this bypass instantly for a single paste, without changing the setting above. It ships without a hotkey so it will not clash with your existing bindings.')
            .addButton(button => button
                .setButtonText('Assign a hotkey')
                .onClick(() => openHotkeySettings(this.app)));

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
            .setName('↳ One-off debug paste')
            .setDesc('The "Paste with Debug/Preview" command opens that same popup for a single paste, without leaving Debug/Preview Mode on.')
            .addButton(button => button
                .setButtonText('Assign a hotkey')
                .onClick(() => openHotkeySettings(this.app)));

        new Setting(containerEl)
            .setName('Report a bug or request a feature')
            .setDesc('Opens a GitHub issue form where you can report bugs or request features. If reporting a paste that came out wrong, turn on Debug/Preview Mode above first and copy the three panels into the report — that is the fastest way to get it fixed.')
            .addButton(button => button
                .setButtonText('Open an issue')
                .onClick(() => {
                    window.open('https://github.com/GoSlowPoke168/obsidian-clean-ai-paste/issues/new/choose');
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

        // Ko-fi Support Button
        const donationDiv = containerEl.createEl('div', {
            attr: { style: 'margin-top: 40px; margin-bottom: 20px; text-align: center;' }
        });

        donationDiv.createEl('p', {
            text: 'If you find this plugin helpful, consider supporting its development!',
            attr: { style: 'margin-bottom: 10px; color: var(--text-muted);' }
        });

        const kofiLink = donationDiv.createEl('a', {
            attr: {
                href: 'https://ko-fi.com/T5T725W4FX',
                target: '_blank',
            }
        });

        kofiLink.createEl('img', {
            attr: {
                src: 'https://storage.ko-fi.com/cdn/kofi2.png?v=6',
                alt: 'Buy Me a Coffee at ko-fi.com',
                height: '36',
                style: 'border:0px;height:36px;'
            }
        });

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

        const addColumn = (title, value) => {
            const col = container.createEl('div', { attr: { style: 'flex: 1; display: flex; flex-direction: column; min-width: 0;' } });
            const header = col.createEl('div', { attr: { style: 'display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px;' } });
            header.createEl('h4', { text: title, attr: { style: 'margin: 0;' } });

            const copyBtn = header.createEl('button', { text: 'Copy', attr: { style: 'font-size: 11px; padding: 2px 8px;' } });
            copyBtn.addEventListener('click', async () => {
                try {
                    await navigator.clipboard.writeText(value);
                    copyBtn.textContent = 'Copied';
                } catch (e) {
                    console.error('Clean AI Paste: copy failed', e);
                    copyBtn.textContent = 'Failed';
                }
                setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1200);
            });

            const area = col.createEl('textarea', { attr: { readonly: true, style: 'flex: 1; resize: none; white-space: pre-wrap; font-family: monospace; font-size: 12px;' } });
            area.value = value;
        };

        addColumn('Clipboard: text/plain', this.plainText);
        addColumn('Clipboard: text/html', this.html);
        addColumn('Formatted Text', this.formattedText);

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
