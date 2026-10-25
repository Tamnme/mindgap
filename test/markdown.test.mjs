import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown, escapeHtml } from '../public/md.js';

test('script tags are escaped, never emitted', () => {
  const html = renderMarkdown('hi <script>alert(1)</script>');
  assert.ok(!/<script/i.test(html), html);
  assert.ok(html.includes('&lt;script&gt;'), html);
});

test('onerror attributes on injected tags stay inert text', () => {
  const html = renderMarkdown('<img src=x onerror="alert(1)">');
  assert.ok(!/<img/i.test(html), html);
  assert.ok(html.includes('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;'), html);
});

test('javascript: links are not turned into anchors', () => {
  const html = renderMarkdown('[click](javascript:alert(1))');
  assert.ok(!/<a\b/i.test(html), html);
  assert.ok(!/href\s*=\s*["']?javascript:/i.test(html), html);
});

test('javascript: link with http-looking label stays inert', () => {
  const html = renderMarkdown('[x](JavaScript:alert(1)) and [y](data:text/html,hi)');
  assert.ok(!/<a\b/i.test(html), html);
});

test('https links are rendered as anchors with rel=noopener', () => {
  const html = renderMarkdown('[AWS](https://docs.aws.amazon.com/vpc/)');
  assert.match(html, /<a href="https:\/\/docs\.aws\.amazon\.com\/vpc\/" target="_blank" rel="noopener noreferrer">AWS<\/a>/);
});

test('bold, italic and inline code', () => {
  const html = renderMarkdown('a **bold** and *it* with `x<y`');
  assert.equal(html, '<p>a <strong>bold</strong> and <em>it</em> with <code>x&lt;y</code></p>');
});

test('formatting is not applied inside code spans', () => {
  const html = renderMarkdown('`**not bold**`');
  assert.equal(html, '<p><code>**not bold**</code></p>');
});

test('paragraphs split on blank lines', () => {
  assert.equal(renderMarkdown('one\n\ntwo'), '<p>one</p>\n<p>two</p>');
});

test('bullet lists', () => {
  assert.equal(renderMarkdown('- a\n- **b**'), '<ul><li>a</li><li><strong>b</strong></li></ul>');
});

test('fenced code blocks are escaped and not formatted', () => {
  const html = renderMarkdown('```\n<b>x</b> **y**\n```');
  assert.equal(html, '<pre><code>&lt;b&gt;x&lt;/b&gt; **y**</code></pre>');
});

test('unclosed fence runs to end of input', () => {
  assert.equal(renderMarkdown('```\nab'), '<pre><code>ab</code></pre>');
});

test('escapeHtml covers the five special characters', () => {
  assert.equal(escapeHtml(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;');
});

test('null and undefined input render empty', () => {
  assert.equal(renderMarkdown(null), '');
  assert.equal(renderMarkdown(undefined), '');
});

test('callout, table, heading and numbered list render; contents stay escaped', () => {
  const html = renderMarkdown('## Hi\n\n> [!IMPORTANT]\n> Every frame has **two** MACs <script>\n\n| wire | cloud |\n|---|---|\n| `fdb` | <b>none</b> |\n\n1. one\n2. two');
  assert.match(html, /<h4>Hi<\/h4>/);
  assert.match(html, /<blockquote class="callout callout-important"><p>Every frame has <strong>two<\/strong> MACs &lt;script&gt;<\/p><\/blockquote>/);
  assert.match(html, /<thead><tr><th>wire<\/th><th>cloud<\/th><\/tr><\/thead><tbody><tr><td><code>fdb<\/code><\/td><td>&lt;b&gt;none&lt;\/b&gt;<\/td><\/tr><\/tbody>/);
  assert.match(html, /<li>one<\/li><li>two<\/li>/);
  assert.doesNotMatch(html, /\[!IMPORTANT\]/);
});
