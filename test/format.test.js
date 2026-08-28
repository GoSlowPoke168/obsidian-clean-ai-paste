// Regression tests for the pure transform helpers in main.js.
//
// Run with:  node test/format.test.js
//
// There is no build toolchain, test runner, or package.json in this repo by design, and
// this file does not add one. It loads main.js directly by stubbing the `obsidian` require
// (none of the pure helpers touch the Obsidian API) and truncating the source before
// `module.exports`, so the plugin class and settings UI are never evaluated.

'use strict';

const fs = require('fs');
const path = require('path');

function loadHelpers() {
    const mainPath = path.join(__dirname, '..', 'main.js');
    let src = fs.readFileSync(mainPath, 'utf8');

    src = src.replace(
        /^const \{ Plugin.*$/m,
        'const Plugin = class {}, htmlToMarkdown = (x) => x, Notice = class {},' +
        ' PluginSettingTab = class {}, Setting = class {}, Modal = class {};'
    );

    const cut = src.indexOf('module.exports');
    if (cut === -1) throw new Error('main.js: could not find module.exports to truncate at');
    src = src.slice(0, cut);

    const exported = [
        'formatTablePadding', 'formatBlockquotePadding', 'condenseBlankLines',
        'formatHorizontalRules', 'tightenRuleHeadingGap', 'applyHeadingSpacing',
        'unboldHeaders', 'unboldLinks', 'downgradeHeaders', 'stripEmojis',
        'stripTrailingWhitespaces', 'stripTrackingParams', 'convertMathDelimiters',
        'expandSingleLineFences', 'inlineSingleLineCodeblocks',
        'reconstructCodeFencesFromLabels', 'stripCodeblockIndentation'
    ];
    return new Function(src + '\nreturn { ' + exported.join(', ') + ' };')();
}

const H = loadHelpers();

let passed = 0;
const failures = [];

function check(name, actual, expected) {
    if (actual === expected) {
        passed++;
        return;
    }
    failures.push({ name, actual, expected });
}

const lines = (...l) => l.join('\n');

// ─────────────────────────────────────────────────────────────────────────────
// formatTablePadding — must pad real Markdown tables and nothing else
// ─────────────────────────────────────────────────────────────────────────────

// The ASCII ER diagram from the bug report. Every row starts with `|` and contains more
// pipes, but no delimiter row follows the header, so this is not a table and must come
// through completely untouched — alignment is load-bearing here.
const asciiDiagram = lines(
    '+---------------------+             +---------------------+',
    '|     Department      |             |      Employee       |',
    '+---------------------+             +---------------------+',
    '| PK | DeptID (INT)   |<----+       | PK | EmpID (INT)    |',
    '|    | DeptName (TXT) |     |       |    | Name (VARCHAR) |',
    '+---------------------+     +-------| FK | DeptID (INT)   |',
    '                                    |    | Salary (DEC)   |',
    '                                    +---------------------+'
);
check('ascii box diagram is left byte-for-byte alone',
    H.formatTablePadding(asciiDiagram), asciiDiagram);

check('ascii diagram is untouched even with surrounding prose',
    H.formatTablePadding('Schema:\n' + asciiDiagram + '\nDone'),
    'Schema:\n' + asciiDiagram + '\nDone');

// nmap-style line art: a single leading pipe, no closing pipe, no delimiter row.
const nmapOutput = lines(
    'PORT   STATE SERVICE',
    '22/tcp open  ssh',
    '| ssh-hostkey:',
    '|   3072 aa:bb:cc:dd',
    '|_  256 ee:ff:00:11'
);
check('nmap line art is left alone',
    H.formatTablePadding(nmapOutput), nmapOutput);

check('real table gets one blank line before and after',
    H.formatTablePadding(lines('Intro', '| a | b |', '| --- | --- |', '| 1 | 2 |', 'After')),
    lines('Intro', '', '| a | b |', '| --- | --- |', '| 1 | 2 |', '', 'After'));

check('alignment delimiters are recognised',
    H.formatTablePadding(lines('Intro', '| a | b | c |', '| :-- | --: | :-: |', '| 1 | 2 | 3 |')),
    lines('Intro', '', '| a | b | c |', '| :-- | --: | :-: |', '| 1 | 2 | 3 |'));

check('compact delimiters without spaces are recognised',
    H.formatTablePadding(lines('Intro', '|a|b|', '|---|---|', '|1|2|')),
    lines('Intro', '', '|a|b|', '|---|---|', '|1|2|'));

check('table at start of text gains no leading blank',
    H.formatTablePadding(lines('| a | b |', '| --- | --- |', 'After')),
    lines('| a | b |', '| --- | --- |', '', 'After'));

check('table at end of text gains no trailing blank',
    H.formatTablePadding(lines('Intro', '| a | b |', '| --- | --- |')),
    lines('Intro', '', '| a | b |', '| --- | --- |'));

check('excess blank lines around a table collapse to one',
    H.formatTablePadding(lines('Intro', '', '', '| a | b |', '| --- | --- |', '', '', 'After')),
    lines('Intro', '', '| a | b |', '| --- | --- |', '', 'After'));

check('already-padded table is left as is (idempotent)',
    H.formatTablePadding(lines('Intro', '', '| a | b |', '| --- | --- |', '', 'After')),
    lines('Intro', '', '| a | b |', '| --- | --- |', '', 'After'));

// A horizontal rule directly under a pipe row must not be read as a delimiter row.
check('horizontal rule after a pipe row is not a delimiter row',
    H.formatTablePadding(lines('| not | a | table |', '---', 'After')),
    lines('| not | a | table |', '---', 'After'));

check('prose containing pipes is not a table',
    H.formatTablePadding(lines('Run `a | b | c` to pipe.', 'Next line.')),
    lines('Run `a | b | c` to pipe.', 'Next line.'));

// ─────────────────────────────────────────────────────────────────────────────
// Rule / heading junction — formatHorizontalRules and tightenRuleHeadingGap interact
// ─────────────────────────────────────────────────────────────────────────────

check('rule followed by heading ends up tight',
    H.tightenRuleHeadingGap(H.formatHorizontalRules(lines('Para', '---', '## Heading'))),
    lines('Para', '', '---', '## Heading'));

check('rule followed by paragraph keeps its blank line',
    H.tightenRuleHeadingGap(H.formatHorizontalRules(lines('Para', '---', 'Body'))),
    lines('Para', '', '---', '', 'Body'));

check('standalone heading is not touched by the rule/heading rule',
    H.tightenRuleHeadingGap(lines('Para', '', '## Heading')),
    lines('Para', '', '## Heading'));

// ─────────────────────────────────────────────────────────────────────────────
// condenseBlankLines — standard vs tight
// ─────────────────────────────────────────────────────────────────────────────

check('standard collapses runs of blank lines to one',
    H.condenseBlankLines(lines('A', '', '', '', 'B'), 'standard'),
    lines('A', '', 'B'));

check('standard removes blanks between list items',
    H.condenseBlankLines(lines('- one', '', '- two', '', '- three'), 'standard'),
    lines('- one', '- two', '- three'));

check('standard removes blanks between ordered list items',
    H.condenseBlankLines(lines('1. one', '', '2. two'), 'standard'),
    lines('1. one', '2. two'));

check('standard pulls a list up to its intro line',
    H.condenseBlankLines(lines('Steps:', '', '- one', '- two'), 'standard'),
    lines('Steps:', '- one', '- two'));

check('tight removes every blank line',
    H.condenseBlankLines(lines('A', '', 'B', '', '', 'C'), 'tight'),
    lines('A', 'B', 'C'));

check('off leaves spacing completely alone',
    H.condenseBlankLines(lines('A', '', '', 'B'), 'off'),
    lines('A', '', '', 'B'));

check('standard drops empty blockquote separator lines',
    H.condenseBlankLines(lines('> one', '>', '> two'), 'standard'),
    lines('> one', '> two'));

// ─────────────────────────────────────────────────────────────────────────────
// Assorted transforms that the pipeline runs unconditionally or by default
// ─────────────────────────────────────────────────────────────────────────────

check('blockquote is padded from following prose',
    H.formatBlockquotePadding(lines('> quoted', 'prose')),
    lines('> quoted', '', 'prose'));

check('bold wrapper is stripped from a heading',
    H.unboldHeaders('**## Heading**'), '## Heading');

check('inline code inside a heading keeps its asterisks',
    H.unboldHeaders('## Use `a ** b` here'), '## Use `a ** b` here');

check('bold wrapper is stripped from a link',
    H.unboldLinks('**[Text](https://example.com/a_(b))**'),
    '[Text](https://example.com/a_(b))');

check('utm parameters are stripped, real ones kept',
    H.stripTrackingParams('See https://example.com/p?id=7&utm_source=chatgpt.com#frag'),
    'See https://example.com/p?id=7#frag');

check('urls inside inline code are left alone',
    H.stripTrackingParams('Use `https://example.com/p?utm_source=x` verbatim'),
    'Use `https://example.com/p?utm_source=x` verbatim');

check('latex delimiters become obsidian math',
    H.convertMathDelimiters('Inline \\(a+b\\) and block \\[c+d\\]'),
    'Inline $a+b$ and block $$c+d$$');

check('emoji between two words collapses to one space',
    H.stripEmojis('Hello 😀 world', ''), 'Hello world');

check('emoji before punctuation leaves no gap',
    H.stripEmojis('Hello 😀.', ''), 'Hello.');

check('allowlisted emoji survives',
    H.stripEmojis('Done ✅ and 😀 gone', '✅'), 'Done ✅ and gone');

check('collapsed single-line fence is expanded',
    H.expandSingleLineFences('``` npm install ```'),
    lines('```', 'npm install', '```'));

check('trailing whitespace is stripped per line',
    H.stripTrailingWhitespaces('a   \nb\t\n'), 'a\nb\n');

// ─────────────────────────────────────────────────────────────────────────────

if (failures.length === 0) {
    console.log('All ' + passed + ' assertions passed.');
    process.exit(0);
}

console.log(passed + ' passed, ' + failures.length + ' FAILED\n');
for (const f of failures) {
    console.log('FAILED: ' + f.name);
    console.log('  expected: ' + JSON.stringify(f.expected));
    console.log('  actual:   ' + JSON.stringify(f.actual));
    console.log('');
}
process.exit(1);
