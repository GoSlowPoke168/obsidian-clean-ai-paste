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
    enableNotifications: true
}

module.exports = class CleanAIPastePlugin extends Plugin {
    async onload() {
        await this.loadSettings();

        this.addSettingTab(new CleanAIPasteSettingTab(this.app, this));

        this.registerEvent(
            this.app.workspace.on('editor-paste', (evt, editor) => {
                if (evt.shiftKey) return;

                const clipboardData = evt.clipboardData;
                if (!clipboardData || clipboardData.types.includes('Files')) return;

                const hasHtml = clipboardData.types.includes('text/html');
                const hasText = clipboardData.types.includes('text/plain');

                if (!hasHtml && !hasText) return;

                try {
                    evt.preventDefault();

                    let rawText = hasHtml
                        ? htmlToMarkdown(clipboardData.getData('text/html'))
                        : clipboardData.getData('text/plain');

                    // Split text: Even indices are normal text, odd indices are code blocks
                    const textSegments = rawText.split(/(^[ \t]*```[a-zA-Z0-9+#\-_]*[ \t]*\r?\n[\s\S]*?^[ \t]*```[ \t]*(?:\r?\n|$))/m);

                    for (let i = 0; i < textSegments.length; i++) {
                        if (i % 2 === 0) {
                            let text = textSegments[i];

                            // Normalize detached language labels or remove redundant ones
                            if (i + 1 < textSegments.length) {
                                let codeBlock = textSegments[i + 1];
                                let match = text.match(/(?:^|\n)[ \t]*([A-Za-z0-9+#\-_]+)\s*$/);

                                if (match) {
                                    let lang = match[1];
                                    let prefixToKeep = match[0].startsWith('\n') ? '\n' : '';

                                    if (/^[ \t]*```\s*\n/.test(codeBlock)) {
                                        // Case 1: Code block has no label
                                        text = text.substring(0, text.length - match[0].length) + prefixToKeep;
                                        textSegments[i + 1] = codeBlock.replace(/^([ \t]*)```\s*\n/, '$1```' + lang + '\n');
                                    } else {
                                        // Case 2: Code block already has the EXACT SAME label (Claude redundant labels)
                                        let cbMatch = codeBlock.match(/^[ \t]*```([a-zA-Z0-9+#\-_]+)\s*\n/);
                                        if (cbMatch && cbMatch[1].toLowerCase() === lang.toLowerCase()) {
                                            text = text.substring(0, text.length - match[0].length) + prefixToKeep;
                                        }
                                    }
                                }
                            }

                            // Unbold Headers
                            if (this.settings.unboldHeaders) {
                                text = text.replace(/^\s*(?:\*\*|__)\s*(#+\s+.*?)\s*(?:\*\*|__)\s*$/gm, '$1');
                                text = text.replace(/^\s*(#+\s+)(.*)$/gm, (match, hashes, content) => hashes + content.replace(/\*\*|__/g, ''));
                            }

                            // Header Downgrade Level
                            if (this.settings.headerDowngradeLevel > 0) {
                                text = text.replace(/^\s*(#+)(\s+.*)$/gm, (match, hashes, content) => {
                                    const newHashes = '#'.repeat(Math.min(6, hashes.length + this.settings.headerDowngradeLevel));
                                    return newHashes + content;
                                });
                            }

                            // Strips out AI padding spaces and removes spaces between new text, lists, and header lines
                            if (this.settings.condenseBlankLines) {
                                text = text.replace(/\r?\n(?:[ \t\xA0]*\r?\n)+/g, '\n');
                                // Also remove blank lines inside blockquotes
                                text = text.replace(/^>[ \t]*\r?\n/gm, '');
                            }

                            // Math delimiter conversion
                            if (this.settings.convertMathDelimiters) {
                                text = text.replace(/\\\[([\s\S]*?)\\\]/g, '$$$$$1$$$$');
                                text = text.replace(/\\\([\s\S]*?\\\)/g, match => {
                                    return '$' + match.slice(2, -2) + '$';
                                });
                            }

                            // Padding before Horizontal Line
                            if (this.settings.formatHorizontalRules) {
                                text = text.replace(/([^\n])\n+(---)/g, '$1\n\n$2');
                            }

                            // Padding before Tables
                            text = text.replace(/([^\n|])\n+(\|.*\|)/g, '$1\n\n$2');

                            // Padding after blockquote
                            text = text.replace(/(^>.*$)\r?\n([^>\n\r])/gm, '$1\n\n$2');

                            // Strip Trailing Whitespaces
                            if (this.settings.stripTrailingWhitespaces) {
                                text = text.replace(/[ \t]+$/gm, '');
                            }

                            // Strip Emojis
                            if (this.settings.stripEmojis) {
                                text = text.replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{2B00}-\u{2BFF}\uFE0F\u200D]/gu, '').replace(/  +/g, ' ');
                            }

                            // Protect Code Blocks & Horizontal Rules
                            if (i > 0) {
                                // If the text comes after a code block
                                if (this.settings.paddingAfterCodeblock || text.trimStart().startsWith('---')) {
                                    // Blank line if a horizontal rule immediately follows
                                    text = '\n' + text.trimStart();
                                } else {
                                    // Otherwise, no space after the code block
                                    text = text.trimStart();
                                }
                            }

                            if (i < textSegments.length - 1) {
                                // Adds a new line before a codeblock
                                text = text.trimEnd() + (this.settings.paddingBeforeCodeblock ? '\n\n' : '\n');
                            }

                            textSegments[i] = text;
                        } else {
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
                        formattedText = this.settings.trackingSignatureStart + '\n' + formattedText + '\n' + this.settings.trackingSignatureEnd;
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
            .setDesc('Automatically converts LaTeX math delimiters \\( \\) and \\[ \\] typically used by AI models into Obsidian\'s native $ and $$ formats.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.convertMathDelimiters)
                .onChange(async (value) => {
                    this.plugin.settings.convertMathDelimiters = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Format horizontal rules')
            .setDesc('Ensures proper formatting and padding around horizontal separators (---).')
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
            .setDesc('Wraps the pasted text with a hidden start and end tracking comment so you can easily identify AI-generated blocks in Source Mode. These comments are hidden in read mode.')
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