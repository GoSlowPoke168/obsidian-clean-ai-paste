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

    return text.replace(urlRegex, (match) => {
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
    });
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
    text = text.replace(/^\s*(?:\*\*|__)\s*(#+\s+.*?)\s*(?:\*\*|__)\s*$/gm, '$1');
    return text.replace(/^\s*(#+\s+)(.*)$/gm, (m, hashes, content) => {
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
    return text.replace(/^\s*(#+)(\s+.*)$/gm, (m, hashes, content) => {
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
    text = text.replace(/\\\[([\s\S]*?)\\\]/g, (_, inner) => '$$' + inner + '$$');
    return text.replace(/\\\(([\s\S]*?)\\\)/g, (_, inner) => '$' + inner + '$');
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

function formatTablePadding(text) {
    text = text.replace(/(^(?![ \t]*\|)[^\n]+)\n+([ \t]*\|)/gm, '$1\n\n$2');
    return text.replace(/(\|[^\n]*\n)(?!\|[^\n]|\n|$)/g, '$1\n');
}

function formatBlockquotePadding(text) {
    return text.replace(/(^>.*$)\r?\n([^>\n\r])/gm, '$1\n\n$2');
}

function stripTrailingWhitespaces(text) {
    return text.replace(/[ \t]+$/gm, '');
}

function stripEmojis(text, allowlist) {
    if (allowlist) {
        const allowed = [...new Set(allowlist.split(/[\s,]+/).filter(Boolean))];
        if (allowed.length > 0) {
            const placeholders = allowed.map((emoji, i) => ({ token: `\x00${i}\x00`, emoji }));
            for (const { token, emoji } of placeholders) {
                text = text.split(emoji).join(token);
            }
            text = text.replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{2B00}-\u{2BFF}\uFE0F\u200D]/gu, '');
            for (const { token, emoji } of placeholders) {
                text = text.split(token).join(emoji);
            }
            return text.replace(/(\S)[ \t]{2,}/g, '$1 ');
        }
    }
    return text.replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{2B00}-\u{2BFF}\uFE0F\u200D]/gu, '')
        .replace(/(\S)[ \t]{2,}/g, '$1 ');
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

// Replace <br> tags with newlines before passing to htmlToMarkdown.
function preprocessHtml(html) {
    return html.replace(/<br\s*\/?>/gi, '\n');
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

            keyEvt.preventDefault();
            keyEvt.stopPropagation();

            try {
                const items = await navigator.clipboard.read();
                for (const item of items) {
                    const hasHtmlType = item.types.includes('text/html');
                    const hasPlainType = item.types.includes('text/plain');

                    const plainText = hasPlainType
                        ? await (await item.getType('text/plain')).text()
                        : '';

                    let html = '';
                    if (hasHtmlType) {
                        html = await (await item.getType('text/html')).text();
                    }

                    const isObsidianInternal = html.includes('<!-- obsidian -->');

                    let result;
                    if (isObsidianInternal || !hasHtmlType) {
                        // Obsidian-internal content or no HTML available: use plain text as-is.
                        result = plainText;
                    } else {
                        // External content (AI chatbots etc.): convert HTML to preserve
                        // markdown structure (headings, bold, etc.) without plugin transforms.
                        result = htmlToMarkdown(preprocessHtml(html));
                    }

                    // Optionally apply lightweight cleanup (condense blank lines + strip trailing whitespace).
                    // Cap at 'standard' line condense where the bypass is meant to be lightweight; heading normalization
                    // ('standard+headings') is intentionally excluded here.
                    if (this.settings.cleanupOnBypass) {
                        const bypassMode = this.settings.condenseMode === 'off' ? 'off'
                            : this.settings.condenseMode === 'tight' ? 'tight'
                                : 'standard';
                        result = condenseBlankLines(result, bypassMode);
                        result = stripTrailingWhitespaces(result);
                    }

                    activeEditor.editor.replaceSelection(result.trim());
                    return;
                }
            } catch (e) {
                console.error("Clean AI Paste: Shift+V clipboard read failed", e);
            }
        });

        this.registerEvent(
            this.app.workspace.on('editor-paste', (evt, editor) => {
                const clipboardData = evt.clipboardData;
                if (!clipboardData || clipboardData.types.includes('Files')) return;

                const hasHtml = clipboardData.types.includes('text/html');
                const hasText = clipboardData.types.includes('text/plain');

                if (!hasHtml && !hasText) return;

                if (evt.shiftKey) return;

                const html = hasHtml ? clipboardData.getData('text/html') : '';

                // If the content is copied from within Obsidian, completely bypass the plugin
                if (html.includes('<!-- obsidian -->')) return;

                try {
                    evt.preventDefault();

                    const plainText = hasText ? clipboardData.getData('text/plain') : '';

                    let rawText = hasHtml
                        ? reconstructCodeFencesFromLabels(htmlToMarkdown(preprocessHtml(html)))
                        : plainText;

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
                                    new Notice("AI Paste Formatted");
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
                    new Notice("Clean AI Paste error: Could not format clipboard data.");
                    console.error("Clean AI Paste plugin error:", error);
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

        containerEl.createEl('h2', { text: 'Clean AI Paste Settings' });

        containerEl.createEl('h3', { text: 'Formatting & Cleanup' });

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

        containerEl.createEl('h3', { text: 'Markdown Elements' });

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
            .setDesc('Converts AI-style LaTeX delimiters \\( \\) and \\[ \\] into Obsidian\'s native $ and $$ formats. Works correctly inside table cells.')
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

        containerEl.createEl('h3', { text: 'Bypass Paste (Ctrl+Shift+V / Cmd+Shift+V)' });

        new Setting(containerEl)
            .setName('Lightweight cleanup on bypass')
            .setDesc('When bypassing (Ctrl+Shift+V / Cmd+Shift+V), still condense blank lines and strip trailing whitespace. Heading normalization is always excluded — bypass is intentionally lightweight.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.cleanupOnBypass)
                .onChange(async (value) => {
                    this.plugin.settings.cleanupOnBypass = value;
                    await this.plugin.saveSettings();
                }));

        containerEl.createEl('h3', { text: 'AI Tracking & Notifications' });

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

        containerEl.createEl('h3', { text: 'Troubleshooting' });

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