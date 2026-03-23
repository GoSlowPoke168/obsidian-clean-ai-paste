# Clean AI Paste for Obsidian

Clean AI Paste is an Obsidian plugin designed to automatically clean up and format text pasted from AI chatbots like ChatGPT, Claude, Gemini, etc.

When copying text from AI web interfaces, the resulting paste in Obsidian often includes excessive blank lines, heavily bolded headers, and detached code block labels. This plugin intercepts the paste command, translates the HTML to native Markdown, and applies targeted formatting rules to keep your notes clean and readable.

## Features

- **Removes Extra Blank Lines:** Condenses multiple line breaks and empty spaces into a single standard line break, without breaking list indentation.
- **Fixes Language Headers:** Automatically detects detached code language labels (e.g., a line reading "Python" floating above a code block) and properly integrates them into the Markdown backticks (` ```python `).
- **Unbolds Headers:** Automatically detects Markdown headers (e.g., `### Header`) and strips out asterisks (`**`) or underscores (`__`), while leaving bold text in your standard paragraphs intact.
- **Protects Code Blocks:** Completely isolates triple-backtick code blocks during formatting so your code syntax, spacing, and indentation remain untouched.
- **Smart Formatting Bypass:** Use `Ctrl+Shift+V` (Windows/Linux) or `Cmd+Shift+V` (Mac) to bypass the plugin entirely and paste the exact original text.

## How to Use

Simply copy text from your AI tool of choice and paste it into Obsidian using standard paste (`Ctrl+V` or `Cmd+V`). The formatting happens instantly and automatically. 

If you need to paste something exactly as it was copied without triggering the cleanup rules, use Obsidian's default "Paste as plain text" shortcut (`Ctrl+Shift+V` or `Cmd+Shift+V`).

## Manual Installation

You can install this manually by:

1. Download the latest release from the GitHub repository.
2. Extract the `clean-ai-paste` folder.
3. Move the folder into your vault's plugins directory: `YourVaultName/.obsidian/plugins/`.
4. Open Obsidian, go to **Settings > Community plugins**.
5. Disable "Restricted mode" if it is currently enabled.
6. Click the refresh button next to "Installed plugins".
7. Find **Clean AI Paste** in the list and toggle it **ON**.

## License

MIT License
