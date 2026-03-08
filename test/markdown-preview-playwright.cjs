/**
 * Markdown Preview Tool - Automated Browser Tests
 * Runs via Playwright against the local HTML file.
 */
const { chromium } = require('playwright');

const FILE_URL = 'file:///Q:/src/agentlink/tools/markdown-preview.html';

const results = {};
let browser, page;

function record(tc, pass, details) {
    results[tc] = { pass, details };
    console.log(`${pass ? 'PASS' : 'FAIL'} | ${tc}: ${details}`);
}

(async () => {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    page = await context.newPage();

    // Collect console errors
    const consoleErrors = [];
    page.on('console', msg => {
        if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', err => consoleErrors.push(err.message));

    await page.goto(FILE_URL, { waitUntil: 'networkidle', timeout: 30000 });

    // Allow debounce + render
    await page.waitForTimeout(500);

    // =========================================================================
    // TC1: Initial Page Load
    // =========================================================================
    try {
        const title = await page.title();
        const textareaValue = await page.$eval('#markdown-input', el => el.value);
        const previewHTML = await page.$eval('#preview', el => el.innerHTML);
        const themeBtn = await page.$('#theme-toggle');
        const copyBtn = await page.$('#copy-html');
        const clearBtn = await page.$('#clear-btn');

        const hasTitle = title === 'Markdown Preview';
        const hasSample = textareaValue.length > 100 && textareaValue.includes('# Markdown Preview');
        const hasPreview = previewHTML.length > 100;
        const hasAllButtons = themeBtn !== null && copyBtn !== null && clearBtn !== null;
        const noErrors = consoleErrors.length === 0;

        const allPass = hasTitle && hasSample && hasPreview && hasAllButtons;
        const details = [
            `Title="${title}" (${hasTitle ? 'OK' : 'FAIL'})`,
            `Sample content present (${hasSample ? 'OK' : 'FAIL'})`,
            `Preview rendered (${hasPreview ? 'OK' : 'FAIL'}, ${previewHTML.length} chars)`,
            `All toolbar buttons present (${hasAllButtons ? 'OK' : 'FAIL'})`,
            `Console errors: ${consoleErrors.length === 0 ? 'none' : consoleErrors.join('; ')}`
        ].join('; ');

        record('TC1: Initial Page Load', allPass, details);
    } catch (e) {
        record('TC1: Initial Page Load', false, `Exception: ${e.message}`);
    }

    // =========================================================================
    // TC2: Real-time Markdown Rendering
    // =========================================================================
    try {
        // Test h1
        await page.$eval('#markdown-input', el => el.value = '');
        await page.fill('#markdown-input', '# Hello World');
        await page.waitForTimeout(300); // wait for debounce
        // Trigger input event since fill might not fire it on all browsers
        await page.$eval('#markdown-input', el => el.dispatchEvent(new Event('input')));
        await page.waitForTimeout(300);
        const h1 = await page.$eval('#preview', el => {
            const h = el.querySelector('h1');
            return h ? h.textContent.trim() : null;
        });
        const h1Pass = h1 === 'Hello World';

        // Test bold
        await page.fill('#markdown-input', '**bold text**');
        await page.$eval('#markdown-input', el => el.dispatchEvent(new Event('input')));
        await page.waitForTimeout(300);
        const boldHTML = await page.$eval('#preview', el => el.innerHTML);
        const boldPass = boldHTML.includes('<strong>') && boldHTML.includes('bold text');

        // Test fenced code block with language hint
        await page.fill('#markdown-input', '```js\nconst x = 1;\n```');
        await page.$eval('#markdown-input', el => el.dispatchEvent(new Event('input')));
        await page.waitForTimeout(300);
        const codeHTML = await page.$eval('#preview', el => el.innerHTML);
        const codePass = codeHTML.includes('language-js') || codeHTML.includes('hljs');

        const allPass = h1Pass && boldPass && codePass;
        const details = [
            `h1 rendered: "${h1}" (${h1Pass ? 'OK' : 'FAIL'})`,
            `Bold rendered (${boldPass ? 'OK' : 'FAIL'})`,
            `Code block with syntax highlighting (${codePass ? 'OK' : 'FAIL'})`
        ].join('; ');

        record('TC2: Real-time Markdown Rendering', allPass, details);
    } catch (e) {
        record('TC2: Real-time Markdown Rendering', false, `Exception: ${e.message}`);
    }

    // =========================================================================
    // TC3: Theme Toggle
    // =========================================================================
    try {
        const initialTheme = await page.$eval('html', el => el.getAttribute('data-theme'));

        await page.click('#theme-toggle');
        await page.waitForTimeout(200);

        const afterToggle = await page.$eval('html', el => el.getAttribute('data-theme'));
        const hljsLightDisabled = await page.$eval('#hljs-light', el => el.disabled);
        const hljsDarkDisabled = await page.$eval('#hljs-dark', el => el.disabled);

        const themeChanged = initialTheme !== afterToggle;
        let stylesCorrect;
        if (afterToggle === 'dark') {
            stylesCorrect = hljsLightDisabled === true && hljsDarkDisabled === false;
        } else {
            stylesCorrect = hljsLightDisabled === false && hljsDarkDisabled === true;
        }

        // Toggle back
        await page.click('#theme-toggle');
        await page.waitForTimeout(200);
        const restored = await page.$eval('html', el => el.getAttribute('data-theme'));
        const restoredCorrect = restored === initialTheme;

        const allPass = themeChanged && stylesCorrect && restoredCorrect;
        const details = [
            `Initial theme: "${initialTheme}"`,
            `After toggle: "${afterToggle}" (${themeChanged ? 'OK' : 'FAIL'})`,
            `hljs stylesheets correct (${stylesCorrect ? 'OK' : 'FAIL'})`,
            `Restored to "${restored}" (${restoredCorrect ? 'OK' : 'FAIL'})`
        ].join('; ');

        record('TC3: Theme Toggle', allPass, details);
    } catch (e) {
        record('TC3: Theme Toggle', false, `Exception: ${e.message}`);
    }

    // =========================================================================
    // TC4: Clear Button
    // =========================================================================
    try {
        // First put some content
        await page.fill('#markdown-input', '# Some content\n\nParagraph here.');
        await page.$eval('#markdown-input', el => el.dispatchEvent(new Event('input')));
        await page.waitForTimeout(300);

        // Verify content exists before clearing
        const beforeValue = await page.$eval('#markdown-input', el => el.value);
        const beforePreview = await page.$eval('#preview', el => el.innerHTML);
        const hadContent = beforeValue.length > 0 && beforePreview.length > 0;

        // Click clear
        await page.click('#clear-btn');
        await page.waitForTimeout(200);

        const afterValue = await page.$eval('#markdown-input', el => el.value);
        const afterPreview = await page.$eval('#preview', el => el.innerHTML);

        const textareaCleared = afterValue === '';
        const previewCleared = afterPreview.trim() === '';

        const allPass = hadContent && textareaCleared && previewCleared;
        const details = [
            `Had content before clear (${hadContent ? 'OK' : 'FAIL'})`,
            `Textarea cleared (${textareaCleared ? 'OK' : 'FAIL'}, value="${afterValue}")`,
            `Preview cleared (${previewCleared ? 'OK' : 'FAIL'}, innerHTML="${afterPreview.substring(0, 50)}")`
        ].join('; ');

        record('TC4: Clear Button', allPass, details);
    } catch (e) {
        record('TC4: Clear Button', false, `Exception: ${e.message}`);
    }

    // =========================================================================
    // TC5: Copy HTML Button
    // =========================================================================
    try {
        // Put some content first
        await page.fill('#markdown-input', '# Test Copy');
        await page.$eval('#markdown-input', el => el.dispatchEvent(new Event('input')));
        await page.waitForTimeout(300);

        // Click Copy HTML
        await page.click('#copy-html');
        await page.waitForTimeout(500);

        // Check toast visibility
        const toastVisible = await page.$eval('#copy-feedback', el => {
            return el.classList.contains('show');
        });
        const toastText = await page.$eval('#copy-feedback', el => el.textContent);
        const correctText = toastText.includes('HTML copied to clipboard');

        const allPass = toastVisible && correctText;
        const details = [
            `Toast visible (${toastVisible ? 'OK' : 'FAIL'})`,
            `Toast text: "${toastText}" (${correctText ? 'OK' : 'FAIL'})`
        ].join('; ');

        record('TC5: Copy HTML Button', allPass, details);
    } catch (e) {
        record('TC5: Copy HTML Button', false, `Exception: ${e.message}`);
    }

    // =========================================================================
    // TC6: Draggable Divider Exists
    // =========================================================================
    try {
        const dividerExists = await page.$('#divider') !== null;
        const cursor = await page.$eval('#divider', el => getComputedStyle(el).cursor);
        const width = await page.$eval('#divider', el => getComputedStyle(el).width);

        const correctCursor = cursor === 'col-resize';
        const correctWidth = width === '5px';

        const allPass = dividerExists && correctCursor && correctWidth;
        const details = [
            `Divider exists (${dividerExists ? 'OK' : 'FAIL'})`,
            `Cursor: "${cursor}" (${correctCursor ? 'OK' : 'FAIL'})`,
            `Width: "${width}" (${correctWidth ? 'OK' : 'FAIL'})`
        ].join('; ');

        record('TC6: Draggable Divider Exists', allPass, details);
    } catch (e) {
        record('TC6: Draggable Divider Exists', false, `Exception: ${e.message}`);
    }

    // =========================================================================
    // TC7: Markdown Feature Support
    // =========================================================================
    try {
        const mdFeatures = [
            '# Heading 1',
            '## Heading 2',
            '### Heading 3',
            '#### Heading 4',
            '##### Heading 5',
            '###### Heading 6',
            '',
            '**bold text**',
            '*italic text*',
            '~~strikethrough text~~',
            '',
            '- unordered item 1',
            '- unordered item 2',
            '',
            '1. ordered item 1',
            '2. ordered item 2',
            '',
            '| Col A | Col B |',
            '|-------|-------|',
            '| cell1 | cell2 |',
            '',
            '> blockquote text',
            '',
            '```js',
            'const x = 1;',
            '```',
            '',
            '[link text](https://example.com)',
            '',
            '---'
        ].join('\n');

        await page.fill('#markdown-input', mdFeatures);
        await page.$eval('#markdown-input', el => el.dispatchEvent(new Event('input')));
        await page.waitForTimeout(500);

        const checks = await page.$eval('#preview', el => {
            return {
                h1: el.querySelector('h1') !== null && el.querySelector('h1').textContent.includes('Heading 1'),
                h2: el.querySelector('h2') !== null && el.querySelector('h2').textContent.includes('Heading 2'),
                h3: el.querySelector('h3') !== null && el.querySelector('h3').textContent.includes('Heading 3'),
                h4: el.querySelector('h4') !== null && el.querySelector('h4').textContent.includes('Heading 4'),
                h5: el.querySelector('h5') !== null && el.querySelector('h5').textContent.includes('Heading 5'),
                h6: el.querySelector('h6') !== null && el.querySelector('h6').textContent.includes('Heading 6'),
                bold: el.querySelector('strong') !== null && el.querySelector('strong').textContent.includes('bold'),
                italic: el.querySelector('em') !== null && el.querySelector('em').textContent.includes('italic'),
                strike: el.querySelector('del') !== null && el.querySelector('del').textContent.includes('strikethrough'),
                ul: el.querySelector('ul') !== null,
                ol: el.querySelector('ol') !== null,
                table: el.querySelector('table') !== null,
                th: el.querySelector('th') !== null,
                td: el.querySelector('td') !== null,
                blockquote: el.querySelector('blockquote') !== null,
                code: el.querySelector('pre code') !== null,
                link: el.querySelector('a[href="https://example.com"]') !== null,
                hr: el.querySelector('hr') !== null
            };
        });

        const allChecksPassed = Object.values(checks).every(v => v === true);
        const failedChecks = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);

        const allPass = allChecksPassed;
        const details = allChecksPassed
            ? 'All 18 Markdown features rendered correctly (h1-h6, bold, italic, strikethrough, ul, ol, table, th, td, blockquote, code, link, hr)'
            : `Failed checks: ${failedChecks.join(', ')}`;

        record('TC7: Markdown Feature Support', allPass, details);
    } catch (e) {
        record('TC7: Markdown Feature Support', false, `Exception: ${e.message}`);
    }

    // =========================================================================
    // TC8: Layout Structure
    // =========================================================================
    try {
        const layout = await page.evaluate(() => {
            const main = document.querySelector('.main');
            const inputPane = document.querySelector('.pane-input');
            const previewPane = document.getElementById('preview-pane');
            const textarea = document.getElementById('markdown-input');
            const preview = document.getElementById('preview');

            const mainStyle = getComputedStyle(main);
            const inputRect = inputPane.getBoundingClientRect();
            const previewRect = previewPane.getBoundingClientRect();

            return {
                mainDisplay: mainStyle.display,
                mainFlexDir: mainStyle.flexDirection,
                inputPaneExists: inputPane !== null,
                previewPaneExists: previewPane !== null,
                textareaInsideInput: inputPane.contains(textarea),
                previewInsidePreview: previewPane.contains(preview),
                inputVisible: inputRect.width > 0 && inputRect.height > 0,
                previewVisible: previewRect.width > 0 && previewRect.height > 0,
                sideBySide: inputRect.right <= previewRect.left + 10 // left is to the left of right
            };
        });

        const allPass = layout.mainDisplay === 'flex'
            && layout.mainFlexDir === 'row'
            && layout.inputPaneExists
            && layout.previewPaneExists
            && layout.textareaInsideInput
            && layout.previewInsidePreview
            && layout.inputVisible
            && layout.previewVisible
            && layout.sideBySide;

        const details = [
            `Main display: "${layout.mainDisplay}" (${layout.mainDisplay === 'flex' ? 'OK' : 'FAIL'})`,
            `Main flex-direction: "${layout.mainFlexDir}" (${layout.mainFlexDir === 'row' ? 'OK' : 'FAIL'})`,
            `Input pane exists (${layout.inputPaneExists ? 'OK' : 'FAIL'})`,
            `Preview pane exists (${layout.previewPaneExists ? 'OK' : 'FAIL'})`,
            `Textarea in input pane (${layout.textareaInsideInput ? 'OK' : 'FAIL'})`,
            `Preview in preview pane (${layout.previewInsidePreview ? 'OK' : 'FAIL'})`,
            `Input pane visible (${layout.inputVisible ? 'OK' : 'FAIL'})`,
            `Preview pane visible (${layout.previewVisible ? 'OK' : 'FAIL'})`,
            `Side-by-side layout (${layout.sideBySide ? 'OK' : 'FAIL'})`
        ].join('; ');

        record('TC8: Layout Structure', allPass, details);
    } catch (e) {
        record('TC8: Layout Structure', false, `Exception: ${e.message}`);
    }

    // =========================================================================
    // Print Summary
    // =========================================================================
    console.log('\n========================================');
    console.log('SUMMARY');
    console.log('========================================');
    let passCount = 0;
    let failCount = 0;
    for (const [tc, r] of Object.entries(results)) {
        console.log(`  ${r.pass ? 'PASS' : 'FAIL'} | ${tc}`);
        if (r.pass) passCount++;
        else failCount++;
    }
    console.log(`\nTotal: ${passCount} passed, ${failCount} failed out of ${passCount + failCount}`);
    console.log('========================================');

    // Output JSON for parsing
    console.log('\n__RESULTS_JSON__');
    console.log(JSON.stringify(results, null, 2));

    await browser.close();
})();
