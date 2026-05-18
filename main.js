"use strict";

const { Plugin, htmlToMarkdown, Notice, PluginSettingTab, Setting } = require('obsidian');

const DEFAULT_SETTINGS = {
    // Formatting & Cleanup
    condenseBlankLines: true,
    stripTrailingWhitespaces: true,
    stripEmojis: true,
    // Markdown Elements
    unboldHeaders: true,
    headerDowngradeLevel: 0,
    convertMathDelimiters: true,
    formatHorizontalRules: true,
    paddingBeforeCodeblock: true,
    paddingAfterCodeblock: true,
    // AI Tracking & Notifications
    addTrackingSignature: false,
    trackingSignatureStart: "<!-- [AI Generated Start] -->",
    trackingSignatureEnd: "<!-- [AI Generated End] -->",
    enableNotifications: false
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
                    if (item.types.includes('text/html')) {
                        const blob = await item.getType('text/html');
                        const html = await blob.text();
                        const markdown = htmlToMarkdown(html);
                        activeEditor.editor.replaceSelection(markdown.trim());
                        return;
                    }
                    if (item.types.includes('text/plain')) {
                        const blob = await item.getType('text/plain');
                        const text = await blob.text();
                        activeEditor.editor.replaceSelection(text.trim());
                        return;
                    }
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

                try {
                    evt.preventDefault();

                    let rawText = hasHtml
                        ? htmlToMarkdown(clipboardData.getData('text/html'))
                        : clipboardData.getData('text/plain');

                    // Split on fenced code blocks.
                    const textSegments = rawText.split(/(^[ \t]*```[a-zA-Z0-9+#\-_]*[ \t]*\r?\n[\s\S]*?^[ \t]*```[ \t]*(?:\r?\n|$))/m);

                    for (let i = 0; i < textSegments.length; i++) {
                        if (i % 2 === 0) {
                            let text = textSegments[i];

                            // Language label normalization
                            if (i + 1 < textSegments.length) {
                                let codeBlock = textSegments[i + 1];
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
                                            text = textTrimmed.substring(0, textTrimmed.length - match[0].length) + prefixToKeep + trailing;
                                            textSegments[i + 1] = codeBlock.replace(/^([ \t]*)```\s*\n/, '$1```' + lang + '\n');
                                        } else {
                                            const cbMatch = codeBlock.match(/^[ \t]*```([a-zA-Z0-9+#\-_]+)\s*\n/);
                                            if (cbMatch && cbMatch[1].toLowerCase() === lang.toLowerCase()) {
                                                text = textTrimmed.substring(0, textTrimmed.length - match[0].length) + prefixToKeep + trailing;
                                            }
                                        }
                                    }
                                }
                            }

                            // Unbold Headers
                            if (this.settings.unboldHeaders) {
                                text = text.replace(/^\s*(?:\*\*|__)\s*(#+\s+.*?)\s*(?:\*\*|__)\s*$/gm, '$1');
                                text = text.replace(/^\s*(#+\s+)(.*)$/gm, (m, hashes, content) =>
                                    hashes + content.replace(/\*\*|__/g, '')
                                );
                            }

                            // Header downgrade
                            if (this.settings.headerDowngradeLevel > 0) {
                                text = text.replace(/^\s*(#+)(\s+.*)$/gm, (m, hashes, content) => {
                                    const newHashes = '#'.repeat(Math.min(6, hashes.length + this.settings.headerDowngradeLevel));
                                    return newHashes + content;
                                });
                            }

                            // Condense blank lines
                            if (this.settings.condenseBlankLines) {
                                text = text.replace(/\r?\n(?:[ \t\xA0]*\r?\n)+/g, '\n');
                                text = text.replace(/^>[ \t]*\r?\n/gm, '');
                            }

                            // Convert math delimiters
                            if (this.settings.convertMathDelimiters) {
                                // Display math: \[...\] → $$...$$
                                text = text.replace(/\\\[([\s\S]*?)\\\]/g, (_, inner) => '$$' + inner + '$$');
                                // Inline math: \(...\) → $...$
                                text = text.replace(/\\\(([^\n]*?(?:\n[^\n]*?){0,4}?)\\\)/g, (_, inner) => '$' + inner + '$');
                            }

                            // Format horizontal rules
                            if (this.settings.formatHorizontalRules) {
                                text = text.replace(/([^\n])\n+(---)/g, '$1\n\n$2');
                                text = text.replace(/(^---[ \t]*)(\n)([^\n])/gm, '$1\n\n$3');
                            }

                            // Table padding
                            text = text.replace(/([^\n|])\n+(\|)/g, '$1\n\n$2');
                            text = text.replace(/(\|[^\n]*\n)([^|\n])/g, '$1\n$2');

                            // Blockquote padding
                            text = text.replace(/(^>.*$)\r?\n([^>\n\r])/gm, '$1\n\n$2');

                            // Strip trailing whitespaces
                            if (this.settings.stripTrailingWhitespaces) {
                                text = text.replace(/[ \t]+$/gm, '');
                            }

                            // Strip emojis
                            if (this.settings.stripEmojis) {
                                text = text.replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{2B00}-\u{2BFF}\uFE0F\u200D]/gu, '')
                                    .replace(/(\S)[ \t]{2,}/g, '$1 ');
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
                            let codeBlock = textSegments[i];
                            const match = codeBlock.match(/^([ \t]*)```/);
                            if (match && match[1].length > 0) {
                                const indent = match[1];
                                const indentRegex = new RegExp('^' + indent, 'gm');
                                codeBlock = codeBlock.replace(indentRegex, '');
                            }
                            textSegments[i] = codeBlock;
                        }
                    }

                    let formattedText = textSegments.join('').trim();

                    if (this.settings.addTrackingSignature) {
                        formattedText =
                            this.settings.trackingSignatureStart + '\n' +
                            formattedText + '\n' +
                            this.settings.trackingSignatureEnd;
                    }

                    editor.replaceSelection(formattedText);

                    if (this.settings.enableNotifications) {
                        new Notice("Paste formatted by Clean AI Paste!");
                    }

                } catch (error) {
                    new Notice("Clean AI Paste error: Could not format clipboard data.");
                    console.error("Clean AI Paste plugin error:", error);
                }
            })
        );
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
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

        containerEl.createEl('h3', { text: 'Formatting & Cleanup' });

        new Setting(containerEl)
            .setName('Condense blank lines')
            .setDesc('Strips out excessive vertical blank lines commonly generated by AI between paragraphs, lists, and sections.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.condenseBlankLines)
                .onChange(async (value) => {
                    this.plugin.settings.condenseBlankLines = value;
                    await this.plugin.saveSettings();
                }));

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

        containerEl.createEl('h3', { text: 'AI Tracking & Notifications' });

        new Setting(containerEl)
            .setName('Add tracking signature')
            .setDesc('Wraps the pasted text with a hidden start and end tracking comment so you can easily identify AI-generated blocks in Source Mode. These comments are hidden in Read Mode.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.addTrackingSignature)
                .onChange(async (value) => {
                    this.plugin.settings.addTrackingSignature = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Tracking signature start tag')
            .setDesc('The string injected at the very top of the AI paste.')
            .addText(text => text
                .setValue(this.plugin.settings.trackingSignatureStart)
                .onChange(async (value) => {
                    this.plugin.settings.trackingSignatureStart = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Tracking signature end tag')
            .setDesc('The string injected at the very bottom of the AI paste.')
            .addText(text => text
                .setValue(this.plugin.settings.trackingSignatureEnd)
                .onChange(async (value) => {
                    this.plugin.settings.trackingSignatureEnd = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Enable paste notifications')
            .setDesc('Shows a small popup notice when the plugin successfully formats pasted text.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableNotifications)
                .onChange(async (value) => {
                    this.plugin.settings.enableNotifications = value;
                    await this.plugin.saveSettings();
                }));
    }
}