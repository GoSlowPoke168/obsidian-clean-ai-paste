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
        'reconstructCodeFencesFromLabels', 'stripCodeblockIndentation',
        'isInsideFencedCode', 'preprocessHtml', 'normalizeLanguageLabel',
        'resolveRawText', 'migrateSettings'
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

// htmlToMarkdown emits `||` for an empty <th>/<td>, which doesn't render.
check('empty leading header cell is padded',
    H.formatTablePadding(lines('||**A**|**B**|', '|---|---|---|', '|Row|1|2|')),
    lines('| |**A**|**B**|', '|---|---|---|', '|Row|1|2|'));

check('empty cell in the middle of a row is padded',
    H.formatTablePadding(lines('|a|b|c|', '|---|---|---|', '|1||3|')),
    lines('|a|b|c|', '|---|---|---|', '|1| |3|'));

check('empty trailing cell is padded',
    H.formatTablePadding(lines('|a|b|c|', '|---|---|---|', '|1|2||')),
    lines('|a|b|c|', '|---|---|---|', '|1|2| |'));

check('consecutive empty cells are each padded',
    H.formatTablePadding(lines('|a|b|c|', '|---|---|---|', '|1|||')),
    lines('|a|b|c|', '|---|---|---|', '|1| | |'));

check('escaped pipes in a cell are not touched',
    H.formatTablePadding(lines('|a|b|', '|---|---|', '|x \\|\\| y|2|')),
    lines('|a|b|', '|---|---|', '|x \\|\\| y|2|'));

check('rows already containing spaced cells are unchanged',
    H.formatTablePadding(lines('| | A | B |', '| --- | --- | --- |', '| Row | 1 | 2 |')),
    lines('| | A | B |', '| --- | --- | --- |', '| Row | 1 | 2 |'));

// CRLF text reaches formatTablePadding via the plain-text path (no text/html on the
// clipboard). A blank line is "\r" after splitting on \n, so it must count as blank.
check('CRLF table already padded is not given extra blank lines',
    H.formatTablePadding('Intro\r\n\r\n| a | b |\r\n| --- | --- |\r\n| 1 | 2 |\r\n\r\nAfter'),
    'Intro\r\n\r\n| a | b |\r\n| --- | --- |\r\n| 1 | 2 |\r\n\r\nAfter');

check('CRLF table with no blank lines gets CRLF blanks added',
    H.formatTablePadding('Intro\r\n| a | b |\r\n| --- | --- |\r\nAfter'),
    'Intro\r\n\r\n| a | b |\r\n| --- | --- |\r\n\r\nAfter');

check('LF documents still get plain LF blanks',
    H.formatTablePadding('Intro\n| a | b |\n| --- | --- |\nAfter'),
    'Intro\n\n| a | b |\n| --- | --- |\n\nAfter');

// Cell padding must only apply inside a real table, never to pipe-containing line art.
check('ascii art with adjacent pipes is not cell-padded',
    H.formatTablePadding(lines('+--+--+', '||  ||', '+--+--+')),
    lines('+--+--+', '||  ||', '+--+--+'));

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
// isInsideFencedCode — decides whether a paste lands in literal-text context
// ─────────────────────────────────────────────────────────────────────────────

// `inside` marks the cursor line; every line before it is what the detector sees.
const cursorIn = (doc, cursorLine) => H.isInsideFencedCode(doc, cursorLine);

check('cursor on the line after an opening fence is inside',
    cursorIn(['```', ''], 1), true);

check('cursor after an opening fence with a language label is inside',
    cursorIn(['```python', ''], 1), true);

check('cursor after a closed block is outside',
    cursorIn(['```', 'code', '```', ''], 3), false);

check('cursor between two separate blocks is outside',
    cursorIn(['```', 'a', '```', '', '```', 'b', '```', ''], 7), false);

check('cursor inside the second of two blocks is inside',
    cursorIn(['```', 'a', '```', '', '```', ''], 5), true);

check('cursor in plain prose is outside',
    cursorIn(['# Title', '', 'Some prose.', ''], 3), false);

check('cursor at the very start of an empty document is outside',
    cursorIn([], 0), false);

check('indented fences still count',
    cursorIn(['  ```', ''], 1), true);

check('tilde fences are recognised',
    cursorIn(['~~~', ''], 1), true);

// A ``` line inside a ~~~ block is content, not a closing delimiter.
check('a backtick fence inside a tilde block does not close it',
    cursorIn(['~~~', '```', ''], 2), true);

check('yaml frontmatter is not mistaken for a fence',
    cursorIn(['---', 'title: x', '---', '', 'prose', ''], 5), false);

check('longer fences (4+ backticks) are recognised',
    cursorIn(['````', ''], 1), true);

// Fences inside callouts and blockquotes count too.
check('fence inside a blockquote is recognised',
    cursorIn(['> ```', '> code'], 1), true);

check('fence inside a callout is recognised',
    cursorIn(['> [!note]', '> ```python', '> code'], 2), true);

check('closed blockquote fence leaves the cursor outside',
    cursorIn(['> ```', '> code', '> ```', '', 'prose'], 4), false);

check('nested blockquote fence is recognised',
    cursorIn(['> > ```', '> > code'], 1), true);

// A fence at a different quote depth must not close one opened at another depth.
check('unquoted fence does not close a blockquote fence',
    cursorIn(['> ```', '```', ''], 2), true);

// ─────────────────────────────────────────────────────────────────────────────
// preprocessHtml — orphaned table sections
// ─────────────────────────────────────────────────────────────────────────────

// Claude copies a table as bare <thead>/<tbody> with no <table>. Without the wrapper
// an HTML parser drops the table tags and concatenates every cell's text.
const claudeTable =
    '<html><body><!--StartFragment-->' +
    '<thead><tr><th scope="col">Structure</th><th scope="col">Order Matters?</th></tr></thead>' +
    '<tbody><tr><td><strong>Set</strong></td><td>No</td></tr></tbody>' +
    '<!--EndFragment--></body></html>';

const wrapped = H.preprocessHtml(claudeTable, 'Structure\tOrder Matters?\nSet\tNo');
check('orphaned thead/tbody gets a <table> wrapper',
    /<table><thead>[\s\S]*<\/tbody><\/table>/.test(wrapped), true);
check('wrapping does not duplicate the table content',
    (wrapped.match(/Structure/g) || []).length, 1);

// Multi-cell, since a single cell is deliberately unwrapped by the rule below.
check('html that already has a <table> is left alone',
    H.preprocessHtml('<table><tbody><tr><td>a</td><td>b</td></tr></tbody></table>', 'a\tb'),
    '<table><tbody><tr><td>a</td><td>b</td></tr></tbody></table>');

// Sites wrap heading text in a div for layout. The converter treats that as a block, so
// the `##` ends up alone on its line and the title becomes a plain paragraph.
const headingHtml = (inner) =>
    H.preprocessHtml('<html><body><!--StartFragment-->' + inner + '<!--EndFragment--></body></html>', '');

check('a div inside a heading is unwrapped',
    /<div/i.test(headingHtml('<h2><div class="title">Table 2.5.1</div></h2>')), false);

check('unwrapping a heading keeps its text',
    headingHtml('<h2><div class="title">Table 2.5.1</div></h2>').includes('Table 2.5.1'), true);

check('a p inside a heading is unwrapped',
    /<p[ >]/i.test(headingHtml('<h2><p>Title</p></h2>')), false);

check('every heading level is handled',
    /<div/i.test(headingHtml('<h3><div>Sub</div></h3>')), false);

// Inline children carry no block break, so they must be left intact.
check('inline children inside a heading are preserved',
    headingHtml('<h2><strong>Bold</strong> title</h2>').includes('<strong>'), true);

// Only inside headings — a div elsewhere is a real block and must stay one.
check('a div outside a heading is untouched',
    headingHtml('<div>Before</div><h2>Title</h2>').includes('<div>Before</div>'), true);

// Pasted markup renders as HTML in Obsidian and vanishes, so it is fenced instead. Built
// from plainText, so indentation survives the HTML round-trip.
const asMarkup = (plain) => H.preprocessHtml('<html><body><p>x</p></body></html>', plain);
const xmlDoc = '<menu>\n  <selection>\n    <name>Greek salad</name>\n  </selection>\n</menu>';

check('xml is wrapped in a labelled pre/code',
    /^<pre><code class="language-xml">/.test(asMarkup(xmlDoc)), true);

check('xml indentation is preserved',
    asMarkup(xmlDoc).includes('    &lt;name&gt;'), true);

check('an xml declaration is recognised',
    /language-xml/.test(asMarkup('<?xml version="1.0"?>\n<a>\n  <b/>\n</a>')), true);

check('an html document gets the html label',
    /language-html/.test(asMarkup('<!DOCTYPE html>\n<html>\n<body>x</body>\n</html>')), true);

check('a one-line element still counts as markup',
    /^<pre>/.test(asMarkup('<div>hi</div>')), true);

// Prose that merely mentions tags must not be fenced.
check('prose mentioning a tag is not fenced',
    /^<pre>/.test(asMarkup('Use the <div> element for layout.')), false);

check('inline markup inside a sentence is not fenced',
    /^<pre>/.test(asMarkup('See <b>bold</b> in the docs and more text')), false);

check('comparison operators are not markup',
    /^<pre>/.test(asMarkup('a < b and c > d')), false);

check('ordinary prose is not fenced',
    /^<pre>/.test(asMarkup('Hello world')), false);

// Copying one cell yields a 1x1 grid, which is never useful. Keep just the contents.
const oneCell = (inner) =>
    H.preprocessHtml('<html><body><!--StartFragment-->' + inner + '<!--EndFragment--></body></html>', 'a\nb');

check('a single cell in a full table is unwrapped',
    /<t[dh]|<table/i.test(oneCell('<table><tr><td>hello</td></tr></table>')), false);

check('a single cell in an orphaned row is unwrapped',
    /<t[dh]|<table/i.test(oneCell('<tr><td>hello</td></tr>')), false);

check('a bare single cell is unwrapped',
    /<t[dh]|<table/i.test(oneCell('<td>hello</td>')), false);

check('unwrapping a single cell keeps its contents',
    oneCell('<table><tr><td>hello</td></tr></table>').includes('hello'), true);

// Two or more cells is a real table and must survive intact.
check('a two-cell table is not unwrapped',
    /<table/i.test(oneCell('<table><tr><td>a</td><td>b</td></tr></table>')), true);

check('a multi-row table is not unwrapped',
    /<table/i.test(oneCell('<table><tr><td>a</td></tr><tr><td>b</td></tr></table>')), true);

check('a single header cell is unwrapped too',
    /<t[dh]|<table/i.test(oneCell('<table><tr><th>hello</th></tr></table>')), false);

check('html with no table tags is left alone',
    H.preprocessHtml('<p>Just a paragraph</p>', 'Just a paragraph'),
    '<p>Just a paragraph</p>');

// The wrapper must land before the no-block-element check, or a multi-row table
// whose plain text has newlines would get <br> injected into it instead.
check('wrapped table is not treated as a structureless fragment',
    /<br>/.test(wrapped), false);

// ─────────────────────────────────────────────────────────────────────────────
// preprocessHtml — structureless fragments (no block elements, newlines in plain text)
// ─────────────────────────────────────────────────────────────────────────────

const frag = (inner) => '<html><body><!--StartFragment-->' + inner + '<!--EndFragment--></body></html>';

// Alignment is load-bearing here, so it must become a <pre> (and so a code block).
// Only <pre> survives both htmlToMarkdown and Obsidian's proportional-font renderer.
const asciiFrag = frag(asciiDiagram);
const asciiOut = H.preprocessHtml(asciiFrag, asciiDiagram);
check('ascii art becomes a <pre>', /<pre>/.test(asciiOut), true);
check('ascii art gets no <br> injected', /<br>/.test(asciiOut), false);
check('ascii art keeps its space runs verbatim',
    asciiOut.slice(asciiOut.indexOf('<pre>') + 5, asciiOut.indexOf('</pre>')), asciiDiagram);

const indentedCode = 'def f(x):\n    return x + 1';
check('indented code becomes a <pre>',
    /<pre>/.test(H.preprocessHtml(frag(indentedCode), indentedCode)), true);

// No significant whitespace: keep the original <br> behavior, unchanged.
const prose = 'First line.\nSecond line.\nThird line.';
const proseOut = H.preprocessHtml(frag(prose), prose);
check('plain multi-line prose is not fenced', /<pre>/.test(proseOut), false);
check('plain multi-line prose still gets <br>', /<br>/.test(proseOut), true);

// Whitespace inside markup is not alignment — only the text content counts.
const tagSpaces = '<span  class="x">First line.</span>\nSecond line.';
check('double space inside a tag does not trigger a code block',
    /<pre>/.test(H.preprocessHtml(frag(tagSpaces), 'First line.\nSecond line.')), false);

const styledLink = '<a href="http://x" title="a  b">First line.</a>\nSecond line.';
check('double space inside an attribute value does not trigger a code block',
    /<pre>/.test(H.preprocessHtml(frag(styledLink), 'First line.\nSecond line.')), false);

// A single space between words is not alignment.
const singleSpaced = 'apples and pears\nbananas\ncherries';
check('single-spaced text is not fenced',
    /<pre>/.test(H.preprocessHtml(frag(singleSpaced), singleSpaced)), false);

// ─────────────────────────────────────────────────────────────────────────────
// applyHeadingSpacing — the two sub-toggles are independent
// ─────────────────────────────────────────────────────────────────────────────

check('removeBlankBefore strips the blank line above a heading',
    H.applyHeadingSpacing(lines('Text', '', '## H', 'Body'), true, false),
    lines('Text', '## H', 'Body'));

check('removeBlankBefore collapses a run of blank lines above a heading',
    H.applyHeadingSpacing(lines('Text', '', '', '## H', 'Body'), true, false),
    lines('Text', '## H', 'Body'));

check('removeBlankBefore is a no-op when there is no blank line',
    H.applyHeadingSpacing(lines('Text', '## H', 'Body'), true, false),
    lines('Text', '## H', 'Body'));

check('removeBlankBefore handles consecutive headings',
    H.applyHeadingSpacing(lines('## A', '', '## B'), true, false),
    lines('## A', '## B'));

check('removeBlankBefore handles indented headings',
    H.applyHeadingSpacing(lines('Text', '', '  ### H'), true, false),
    lines('Text', '  ### H'));

check('removeBlankBefore off leaves the blank line alone',
    H.applyHeadingSpacing(lines('Text', '', '## H', 'Body'), false, false),
    lines('Text', '', '## H', 'Body'));

// Both sub-options on: the gap above and below a heading both go.
check('both remove options together',
    H.applyHeadingSpacing(lines('Text', '', '## H', '', 'Body'), true, true),
    lines('Text', '## H', 'Body'));

check('removeBlankAfter drops the blank line below a heading',
    H.applyHeadingSpacing(lines('## H', '', 'Body'), false, true),
    lines('## H', 'Body'));

// blankBefore owns the gap between two headings, so removeBlankAfter must not touch it.
check('removeBlankAfter leaves a heading-to-heading gap alone',
    H.applyHeadingSpacing(lines('## A', '', '## B'), false, true),
    lines('## A', '', '## B'));

check('removeBlankAfter leaves a 2+ blank run alone',
    H.applyHeadingSpacing(lines('## H', '', '', 'Body'), false, true),
    lines('## H', '', '', 'Body'));

// The old default: only the line below a heading goes, the one above stays.
check('removeBlankAfter alone leaves the blank above intact',
    H.applyHeadingSpacing(lines('Text', '', '## H', '', 'Body'), false, true),
    lines('Text', '', '## H', 'Body'));

// ─────────────────────────────────────────────────────────────────────────────
// downgradeHeaders
// ─────────────────────────────────────────────────────────────────────────────

check('headings shift down by the given level',
    H.downgradeHeaders(lines('# A', '## B'), 1), lines('## A', '### B'));

check('heading depth is capped at 6',
    H.downgradeHeaders('##### A', 3), '###### A');

check('non-heading lines are untouched by downgrade',
    H.downgradeHeaders(lines('Text #notatag', '# A'), 1), lines('Text #notatag', '## A'));

// ─────────────────────────────────────────────────────────────────────────────
// inlineSingleLineCodeblocks (off by default)
// ─────────────────────────────────────────────────────────────────────────────

check('a bare single-line fence becomes inline code',
    H.inlineSingleLineCodeblocks('```\nnpm install\n```'), '`npm install`');

check('a labeled fence is never inlined',
    H.inlineSingleLineCodeblocks('```bash\nnpm install\n```'), '```bash\nnpm install\n```');

check('a multi-line fence is never inlined',
    H.inlineSingleLineCodeblocks('```\na\nb\n```'), '```\na\nb\n```');

check('a body containing a backtick stays a block',
    H.inlineSingleLineCodeblocks('```\necho `date`\n```'), '```\necho `date`\n```');

// ─────────────────────────────────────────────────────────────────────────────
// normalizeLanguageLabel — merges a floating label into the fence below it
// ─────────────────────────────────────────────────────────────────────────────

const norm = (text, block) => {
    const r = H.normalizeLanguageLabel(text, block);
    return [r.text, r.codeBlock];
};

check('a floating language label moves onto the fence',
    JSON.stringify(norm('Intro\npython', '```\nprint(1)\n```')),
    JSON.stringify(['Intro\n', '```python\nprint(1)\n```']));

// The allowlist is what stops ordinary English between two blocks being eaten.
check('an ordinary word above a fence is not treated as a label',
    JSON.stringify(norm('Intro\nor', '```\nprint(1)\n```')),
    JSON.stringify(['Intro\nor', '```\nprint(1)\n```']));

check('a duplicate label above an already-labeled fence is dropped',
    JSON.stringify(norm('Intro\npython', '```python\nprint(1)\n```')),
    JSON.stringify(['Intro\n', '```python\nprint(1)\n```']));

// ─────────────────────────────────────────────────────────────────────────────
// reconstructCodeFencesFromLabels — only for text that arrived with no fences at all
// ─────────────────────────────────────────────────────────────────────────────

check('a floating label wraps the following block in a fence',
    H.reconstructCodeFencesFromLabels(lines('python', '', 'print(1)', '')),
    lines('```python', 'print(1)', '```', ''));

check('every floating label is wrapped, not just the first',
    H.reconstructCodeFencesFromLabels(lines('python', '', 'print(1)', '', 'bash', '', 'ls -la', '')),
    lines('```python', 'print(1)', '```', '', '```bash', 'ls -la', '```', ''));

check('text that already has a fence is left completely alone',
    H.reconstructCodeFencesFromLabels(lines('python', '', 'print(1)', '', '```', 'x', '```')),
    lines('python', '', 'print(1)', '', '```', 'x', '```'));

check('an unknown word is not treated as a language label',
    H.reconstructCodeFencesFromLabels(lines('Summary', '', 'Some prose.', '')),
    lines('Summary', '', 'Some prose.', ''));

// A language name can also be an English word, so the body decides. Prose stays prose,
// whatever the casing of the word above it.
check('"Go" above a prose sentence is not a label',
    H.reconstructCodeFencesFromLabels(lines('Go', '', 'to the next section', '')),
    lines('Go', '', 'to the next section', ''));

check('"R" above a prose sentence is not a label',
    H.reconstructCodeFencesFromLabels(lines('R', '', 'is a language', '')),
    lines('R', '', 'is a language', ''));

check('lowercase "text" above prose is not a label either',
    H.reconstructCodeFencesFromLabels(lines('text', '', 'follows on from here', '')),
    lines('text', '', 'follows on from here', ''));

check('multi-line prose is not fenced',
    H.reconstructCodeFencesFromLabels(lines('Go', '', 'to the next section', 'and read it carefully', '')),
    lines('Go', '', 'to the next section', 'and read it carefully', ''));

// Capitalized labels must still work — Gemini writes "Bash", "Python".
check('capitalized "Python" above real code is still a label',
    H.reconstructCodeFencesFromLabels(lines('Python', '', 'print(1)', '')),
    lines('```python', 'print(1)', '```', ''));

check('capitalized "Bash" above a command with flags is still a label',
    H.reconstructCodeFencesFromLabels(lines('Bash', '', 'ls -la /tmp', '')),
    lines('```bash', 'ls -la /tmp', '```', ''));

check('indented body counts as code',
    H.reconstructCodeFencesFromLabels(lines('Python', '', 'def f:', '    return 1', '')),
    lines('```python', 'def f:', '    return 1', '```', ''));

check('lowercase "go" above real code is still a label',
    H.reconstructCodeFencesFromLabels(lines('go', '', 'fmt.Println("hi")', '')),
    lines('```go', 'fmt.Println("hi")', '```', ''));

// ─────────────────────────────────────────────────────────────────────────────
// stripCodeblockIndentation
// ─────────────────────────────────────────────────────────────────────────────

check('a uniformly indented fence is de-indented',
    H.stripCodeblockIndentation(lines('    ```', '    code', '    ```')),
    lines('```', 'code', '```'));

check('an unindented fence is unchanged',
    H.stripCodeblockIndentation(lines('```', 'code', '```')),
    lines('```', 'code', '```'));

// Only the fence's own indent is removed; relative indentation inside must survive.
check('relative indentation inside the block survives',
    H.stripCodeblockIndentation(lines('  ```', '  def f():', '      return 1', '  ```')),
    lines('```', 'def f():', '    return 1', '```'));

// ─────────────────────────────────────────────────────────────────────────────
// resolveRawText — a clipboard can advertise text/html and supply markup that
// converts to nothing; the usable text/plain must win rather than be discarded.
// ─────────────────────────────────────────────────────────────────────────────

check('empty conversion falls back to plain text',
    H.resolveRawText('', 'Hello world'), 'Hello world');

check('whitespace-only conversion falls back to plain text',
    H.resolveRawText('   \n  ', 'Hello world'), 'Hello world');

check('real conversion wins over plain text',
    H.resolveRawText('# Heading', 'Heading'), '# Heading');

// An emoji-only paste with stripEmojis on is legitimately empty; the fallback must not
// resurrect it. Guarded by only firing when plainText itself has content.
check('empty conversion with empty plain text stays empty',
    H.resolveRawText('', '   '), '');

check('conversion that is only whitespace but plain text is too stays as converted',
    H.resolveRawText('\n\n', ''), '\n\n');

// ─────────────────────────────────────────────────────────────────────────────
// stripEmojis — technical symbols are opt-in (U+2300-23FF is keyboard keys)
// ─────────────────────────────────────────────────────────────────────────────

check('keyboard symbols survive by default',
    H.stripEmojis('Press ⌘C to copy', '', false), 'Press ⌘C to copy');

check('keyboard symbols are stripped when opted in',
    H.stripEmojis('Press ⌘C to copy', '', true), 'Press C to copy');

check('return symbol survives by default',
    H.stripEmojis('Hit ⏎ to submit', '', false), 'Hit ⏎ to submit');

check('true emoji strip regardless of the technical toggle',
    H.stripEmojis('Hello \u{1F600} world', '', false), 'Hello world');

check('dingbats still strip by default',
    H.stripEmojis('Done ✓ here', '', false), 'Done here');

// ─────────────────────────────────────────────────────────────────────────────
// stripEmojis allowlist — filtered per grapheme, no placeholder to collide with
// ─────────────────────────────────────────────────────────────────────────────

check('allowlisted emoji survives a run it shares with a stripped one',
    H.stripEmojis('a ✅\u{1F600} b', '✅', false), 'a ✅ b');

check('order within the run does not matter',
    H.stripEmojis('a \u{1F600}✅ b', '✅', false), 'a ✅ b');

check('allowlisted emoji survives at end of line',
    H.stripEmojis('status ✅\u{1F389}', '✅', false), 'status ✅');

check('separate runs are handled independently',
    H.stripEmojis('a ✅ b \u{1F600} c', '✅', false), 'a ✅ b c');

// A ZWJ sequence is one grapheme, so it is judged whole rather than torn apart.
check('zwj family emoji is stripped as a single unit',
    H.stripEmojis('family \u{1F468}‍\u{1F469}‍\u{1F467} here', '', false), 'family here');

check('zwj family emoji can be allowlisted whole',
    H.stripEmojis('family \u{1F468}‍\u{1F469}‍\u{1F467} here', '\u{1F468}‍\u{1F469}‍\u{1F467}', false),
    'family \u{1F468}‍\u{1F469}‍\u{1F467} here');

// The old implementation swapped allowlisted emoji for a \x00-delimited placeholder and
// swapped anything matching it back, so literal NUL text became an emoji.
check('literal NUL text is not turned into an allowlisted emoji',
    H.stripEmojis('a\x000\x00b ✅', '✅', false), 'a\x000\x00b ✅');

// ─────────────────────────────────────────────────────────────────────────────
// migrateSettings — runs once per install at upgrade and fails silently if wrong
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULTS = {
    condenseMode: 'standard',
    headingRemoveBlankBefore: true,
    headingRemoveBlankAfter: true,
    stripEmojis: true,
    stripTechnicalSymbols: false,
    bypassLegacyStructure: false,
};
const migrate = (saved) => H.migrateSettings(saved, DEFAULTS);

check('a brand new install gets the defaults',
    JSON.stringify(migrate(null)), JSON.stringify(DEFAULTS));

check('migration 1: condenseBlankLines=false becomes off',
    migrate({ condenseBlankLines: false }).condenseMode, 'off');

check('migration 1: tightCondense becomes tight',
    migrate({ condenseBlankLines: true, tightCondense: true }).condenseMode, 'tight');

check('migration 1: plain condenseBlankLines becomes standard',
    migrate({ condenseBlankLines: true }).condenseMode, 'standard');

check('migration 1 defers to an explicit condenseMode',
    migrate({ condenseBlankLines: false, condenseMode: 'tight' }).condenseMode, 'tight');

check('migration 2: standard+headings becomes standard',
    migrate({ condenseMode: 'standard+headings' }).condenseMode, 'standard');

check('migration 2 enables the heading sub-option',
    migrate({ condenseMode: 'standard+headings' }).headingRemoveBlankAfter, true);

check('migration 3: ensureHeadingSpacing enables the heading sub-option',
    migrate({ condenseMode: 'standard', ensureHeadingSpacing: true }).headingRemoveBlankAfter, true);

// headingBlankBefore ADDED a blank line; headingRemoveBlankBefore REMOVES one. Opposite
// meanings, so the old value must not carry over as a boolean.
check('migration 4: the old heading key is dropped, not carried over',
    'headingBlankBefore' in migrate({ headingBlankBefore: true }), false);

check('migration 4: everyone lands on the new default',
    migrate({ headingBlankBefore: false }).headingRemoveBlankBefore, true);

// Bypass is raw by default now, so no old bypass value carries over — every install
// lands on legacy off. bypassRawText only ever existed in unreleased 1.3.0.
check('migration 5: the 1.2.0 default lands on raw bypass',
    migrate({ cleanupOnBypass: true }).bypassLegacyStructure, false);

check('migration 5: a 1.2.0 user who chose raw also lands on raw',
    migrate({ cleanupOnBypass: false }).bypassLegacyStructure, false);

check('migration 5: an unreleased bypassRawText value does not carry over',
    migrate({ bypassRawText: false }).bypassLegacyStructure, false);

check('migration 5: the 1.2.0 bypass key is dropped',
    'cleanupOnBypass' in migrate({ cleanupOnBypass: true }), false);

check('migration 5: the unreleased bypass key is dropped',
    'bypassRawText' in migrate({ bypassRawText: true }), false);

check('a user\'s own settings are preserved through migration',
    migrate({ condenseMode: 'tight', stripEmojis: false }).stripEmojis, false);

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
