const { Plugin, htmlToMarkdown } = require('obsidian');

module.exports = class CleanAIPastePlugin extends Plugin {
    async onload() {
        this.registerEvent(
            this.app.workspace.on('editor-paste', (evt, editor) => {
                // Allow Shift+Paste (Ctrl+Shift+V / Cmd+Shift+V) to bypass formatting
                if (evt.shiftKey) {
                    return; 
                }

                // Verify clipboard data exists and ignore file/image pastes
                const clipboardData = evt.clipboardData;
                if (!clipboardData || clipboardData.types.includes('Files')) {
                    return; 
                }

                const hasHtml = clipboardData.types.includes('text/html');
                const hasText = clipboardData.types.includes('text/plain');

                if (hasHtml || hasText) {
                    evt.preventDefault();
                    
                    let rawText = "";
                    
                    // Convert HTML to Markdown to preserve formatting like links and lists
                    if (hasHtml) {
                        const html = clipboardData.getData('text/html');
                        rawText = htmlToMarkdown(html);
                    } else {
                        rawText = clipboardData.getData('text/plain');
                    }

                    // Normalize detached language labels into code block declarations
                    rawText = rawText.replace(/(^|\n)([A-Za-z0-9+#\-_]+)\s*\n```([A-Za-z0-9+#\-_]*)\n/g, (match, p1, p2, p3) => {
                        const lang = p3 || p2; 
                        return p1 + '```' + lang + '\n';
                    });

                    // Protect code blocks from global formatting rules
                    const textSegments = rawText.split(/(```[\s\S]*?```)/g);

                    for (let i = 0; i < textSegments.length; i++) {
                        // Apply formatting only to non-code segments
                        if (i % 2 === 0) {
                            // Condense multiple blank lines into a single newline while preserving indentation
                            textSegments[i] = textSegments[i].replace(/\r?\n(?:[ \t\xA0]*\r?\n)+/g, '\n');
                            
                            // Remove bold formatting specifically from Markdown headers
                            textSegments[i] = textSegments[i].replace(/^\s*(#+\s+)(.*)$/gm, (match, hashes, content) => {
                                return hashes + content.replace(/\*\*|__/g, '');
                            });
                        }
                    }

                    const processedText = textSegments.join('');
                    editor.replaceSelection(processedText);
                }
            })
        );
    }
};