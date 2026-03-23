const { Plugin, htmlToMarkdown } = require('obsidian');

module.exports = class CleanAIPastePlugin extends Plugin {
    async onload() {
        // Track the Shift key state globally
        this.isShiftPressed = false;

        this.registerDomEvent(document, 'keydown', (evt) => {
            this.isShiftPressed = evt.shiftKey;
        });

        this.registerDomEvent(document, 'keyup', (evt) => {
            this.isShiftPressed = evt.shiftKey;
        });

        this.registerEvent(
            this.app.workspace.on('editor-paste', (evt, editor, view) => {
                // Bypass formatting if Shift is held down (Ctrl+Shift+V / Cmd+Shift+V)
                if (this.isShiftPressed) {
                    return;
                }

                // Ignore file and image pastes to preserve default Obsidian behavior
                if (!evt.clipboardData || evt.clipboardData.types.includes('Files')) {
                    return; 
                }

                const hasHtml = evt.clipboardData.types.includes('text/html');
                const hasText = evt.clipboardData.types.includes('text/plain');

                if (hasHtml || hasText) {
                    evt.preventDefault();
                    
                    let rawText = "";
                    
                    // Prioritize HTML-to-Markdown conversion to preserve native text formatting
                    if (hasHtml) {
                        const html = evt.clipboardData.getData('text/html');
                        rawText = htmlToMarkdown(html);
                    } else {
                        rawText = evt.clipboardData.getData('text/plain');
                    }

                    // Move detached language identifiers into the code block declaration
                    rawText = rawText.replace(/(^|\n)([A-Za-z0-9+#\-_]+)\s*\n```([A-Za-z0-9+#\-_]*)\n/g, (match, p1, p2, p3) => {
                        const lang = p3 || p2; 
                        return p1 + '```' + lang + '\n';
                    });

                    // Split text to isolate and protect code blocks from global regex replacements
                    const textSegments = rawText.split(/(```[\s\S]*?```)/g);

                    for (let i = 0; i < textSegments.length; i++) {
                        // Apply formatting strictly to standard text (even indexes)
                        if (i % 2 === 0) {
                            // Condense multiple blank lines into a single newline, preserving leading indentation
                            textSegments[i] = textSegments[i].replace(/\r?\n(?:[ \t\xA0]*\r?\n)+/g, '\n');
                            
                            // Strip bold formatting (asterisks and underscores) exclusively from Markdown headers
                            textSegments[i] = textSegments[i].replace(/^\s*(#+\s+)(.*)$/gm, (match, hashes, content) => {
                                return hashes + content.replace(/\*\*|__/g, '');
                            });
                        }
                    }

                    // Reassemble and insert the formatted document
                    const processedText = textSegments.join('');
                    editor.replaceSelection(processedText);
                }
            })
        );
    }
};