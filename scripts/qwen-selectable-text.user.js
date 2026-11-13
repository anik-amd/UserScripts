// ==UserScript==
// @name         Qwen Chat - Selectable Text
// @namespace    https://github.com/anik-amd/UserScripts
// @version      1.3.0
// @description  Restores text selection and copying of chat messages (AI replies and your own) in Qwen Chat, including in narrow windows where the site switches to its mobile layout.
// @author       anik-amd
// @homepageURL  https://github.com/anik-amd/UserScripts
// @supportURL   https://github.com/anik-amd/UserScripts/issues
// @updateURL    https://raw.githubusercontent.com/anik-amd/UserScripts/main/scripts/qwen-selectable-text.user.js
// @downloadURL  https://raw.githubusercontent.com/anik-amd/UserScripts/main/scripts/qwen-selectable-text.user.js
// @license      MIT
// @match        https://chat.qwen.ai/*
// @match        https://chat.qwenlm.ai/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // Message bodies. Deliberately narrow: only text content is unlocked, never the app shell.
  const CONTENT = [
    '.qwen-markdown',
    '.markdown-body',
    '.message-content',
    '[class*="message-content"]',
    '[class*="message-inner"]',
    '[class*="chat-message"]',
    '.chat-message'
  ].join(',');

  // 1. Stylesheet pass. Covers the common case and applies before React even mounts.
  //    (A site rule with equal specificity declared later would win, hence step 2.)
  function addStyle() {
    const style = document.createElement('style');
    style.id = 'us-qwen-selectable';
    style.textContent = [
      `${CONTENT}, ${CONTENT} * {`,
      '  -webkit-user-select: text !important;',
      '  user-select: text !important;',
      '  -webkit-touch-callout: default !important;',
      '}'
    ].join('\n');
    (document.head || document.documentElement).appendChild(style);
  }

  if (document.head) {
    addStyle();
  } else {
    document.addEventListener('DOMContentLoaded', addStyle, { once: true });
  }

  // 2. Inline pass. Inline `!important` beats every stylesheet rule, so the logged-in
  //    chat UI cannot win by loading its `user-select: none` later or with higher specificity.
  const PROPS = [
    ['-webkit-user-select', 'text'],
    ['user-select', 'text'],
    ['-webkit-touch-callout', 'default']
  ];

  function alreadyUnlocked(el) {
    return PROPS.every(
      ([prop, value]) =>
        el.style.getPropertyValue(prop) === value && el.style.getPropertyPriority(prop) === 'important'
    );
  }

  function unlock(el) {
    if (!(el instanceof Element) || alreadyUnlocked(el)) return;
    for (const [prop, value] of PROPS) el.style.setProperty(prop, value, 'important');
  }

  function unlockTree(node) {
    if (!(node instanceof Element)) return;

    const scope = node.closest(CONTENT);
    if (scope) {
      unlock(scope);
      for (const child of scope.querySelectorAll('*')) unlock(child);
      return;
    }

    for (const match of node.querySelectorAll(CONTENT)) {
      unlock(match);
      for (const child of match.querySelectorAll('*')) unlock(child);
    }
  }

  // Re-apply when the site re-renders a message (class/style churn) or streams new text in.
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'attributes') {
        unlockTree(record.target);
        continue;
      }
      for (const node of record.addedNodes) unlockTree(node);
    }
  });

  function start() {
    unlockTree(document.body);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style']
    });
  }

  if (document.body) {
    start();
  } else {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  }

  // 3. The mobile layout cancels the pointer events that begin a drag selection. Swallow them
  //    before any site handler runs — including handlers on the same node (stopImmediate) and
  //    handlers on a transparent overlay that sits above the text (hit-test the whole stack).
  const INTERACTIVE = 'button, a[href], input, textarea, select, summary, [role="button"], [role="link"], [contenteditable="true"]';

  function inContent(target) {
    return target instanceof Element && !!target.closest(CONTENT);
  }

  function overContent(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    const stack = document.elementsFromPoint(x, y);
    // The overlay itself is not in CONTENT, but the text underneath it is.
    return stack.some((el) => !!el.closest(CONTENT));
  }

  function swallow(event) {
    if (event.button !== 0) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (!inContent(target) && !overContent(event.clientX, event.clientY)) return;
    if (target.closest(INTERACTIVE)) return;
    event.stopImmediatePropagation();
  }

  window.addEventListener('mousedown', swallow, true);
  window.addEventListener('pointerdown', swallow, true);

  // 4. Some handlers call preventDefault() on selectstart; keep them from seeing it.
  window.addEventListener(
    'selectstart',
    (event) => {
      if (event.target instanceof Element && inContent(event.target)) event.stopImmediatePropagation();
    },
    true
  );

  // 5. Copy. Qwen rewrites the clipboard on copy (attribution / formatted markdown) in some
  //    builds, and at narrow widths that path can end up copying nothing. When the selection
  //    sits inside a message, let the browser perform the copy natively instead.
  function selectionInContent() {
    const selection = getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return false;
    const elementOf = (node) => (node && node.nodeType === 1 ? node : node && node.parentElement);
    const anchor = elementOf(selection.anchorNode);
    const focus = elementOf(selection.focusNode);
    return !!anchor && !!focus && inContent(anchor) && inContent(focus);
  }

  window.addEventListener(
    'copy',
    (event) => {
      if (selectionInContent()) event.stopImmediatePropagation();
    },
    true
  );

  // Site shortcuts that intercept Ctrl/Cmd+C and write their own clipboard text.
  window.addEventListener(
    'keydown',
    (event) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      if (String(event.key).toLowerCase() !== 'c') return;
      if (!selectionInContent()) return;
      event.stopImmediatePropagation();
    },
    true
  );

  // 6. Escape hatches for layouts where no pointer drag ever starts a selection.
  function selectContents(el) {
    const range = document.createRange();
    range.selectNodeContents(el);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }

  // Double-click a reply: select the whole message if the native word-select didn't happen.
  window.addEventListener(
    'dblclick',
    (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest(INTERACTIVE)) return;
      const scope = target.closest(CONTENT);
      if (!scope) return;
      setTimeout(() => {
        if (!selectionInContent()) selectContents(scope);
      }, 0);
    },
    true
  );

  // Alt+C copies the message under the pointer (or the last one), no selection needed.
  let hovered = null;
  document.addEventListener(
    'mousemove',
    (event) => {
      hovered = event.target instanceof Element ? event.target : null;
    },
    true
  );

  window.addEventListener(
    'keydown',
    (event) => {
      if (!event.altKey || event.ctrlKey || event.metaKey) return;
      if (String(event.key).toLowerCase() !== 'c') return;

      const scope = (hovered && hovered.closest(CONTENT)) || document.querySelector(`${CONTENT}:last-of-type`);
      if (!scope) return;

      const text = (scope.innerText || scope.textContent || '').trim();
      if (!text) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      selectContents(scope);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).catch(() => {});
      }
    },
    true
  );
})();
