"use strict";

const { Plugin, htmlToMarkdown } = require('obsidian');

module.exports = class CleanAIPastePlugin extends Plugin {
    async onload() {
        this.registerEvent(
            this.app.workspace.on('editor-paste', (evt, editor) => {
                // Allow Shift+Paste bypass
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

                    // Normalize detached language labels
                    rawText = rawText.replace(/(^|\n)([A-Za-z0-9+#\-_]+)\s*\n```([A-Za-z0-9+#\-_]*)\n/g, (match, p1, p2, p3) => {
                        return p1 + '```' + (p3 || p2) + '\n';
                    });

                    // Split text: Even indices are normal text, odd indices are code blocks
                    const textSegments = rawText.split(/(```[\s\S]*?```)/g);

                    for (let i = 0; i < textSegments.length; i++) {
                        if (i % 2 === 0) {
                            let text = textSegments[i];

                            // 1. Unbold Headers
                            text = text.replace(/^\s*(#+\s+)(.*)$/gm, (match, hashes, content) => hashes + content.replace(/\*\*|__/g, ''));

                            // 2. The Whitespace Crusher (From your original code)
                            // Strips out AI padding spaces and forces text, lists, and headers to be tight
                            text = text.replace(/\r?\n(?:[ \t\xA0]*\r?\n)+/g, '\n');

                            // 3. Padding before Horizontal Rules (overrides the crusher for ---)
                            text = text.replace(/([^\n])\n+(---)/g, '$1\n\n$2');

                            // 4. Boundary Padding: Protect Code Blocks & Horizontal Rules
                            if (i > 0) {
                                // Text comes AFTER a code block
                                if (text.trimStart().startsWith('---')) {
                                    // Guarantee a blank line if a horizontal rule immediately follows
                                    text = '\n\n' + text.trimStart();
                                } else {
                                    // Otherwise, keep the text tight against the bottom of the code block
                                    text = '\n' + text.trimStart(); 
                                }
                            }
                            
                            if (i < textSegments.length - 1) {
                                // Text comes BEFORE a code block
                                // Guarantee exactly one blank line before the backticks open
                                text = text.trimEnd() + '\n\n'; 
                            }

                            textSegments[i] = text;
                        }
                    }

                    editor.replaceSelection(textSegments.join('').trim());
                } catch (error) {
                    console.error("Clean AI Paste plugin error:", error);
                }
            })
        );
    }
};