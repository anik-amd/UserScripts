// ==UserScript==
// @name         Qwen Chat - Selectable Text
// @namespace    https://github.com/anik-amd/UserScripts
// @version      1.5.0
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

  const INTERACTIVE = 'button, a[href], input, textarea, select, summary, [role="button"], [role="link"], [contenteditable="true"]';

  function inContent(target) {
    return target instanceof Element && !!target.closest(CONTENT);
  }

  /** Nearest message body at a viewport point, looking through transparent overlays. */
  function messageAtPoint(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    for (const el of document.elementsFromPoint(x, y)) {
      const scope = el.closest(CONTENT);
      if (scope) return scope;
    }
    return null;
  }

  // 1. Stylesheet pass. Covers the common case and applies before React even mounts.
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

  // 2. Inline pass. Inline `!important` beats every stylesheet rule, so the logged-in UI
  //    cannot win by loading its `user-select: none` later or with higher specificity.
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

  // 3. The mobile layout cancels the pointer events that begin a drag selection. Blocking
  //    propagation is not an option: the event must still reach the text for the browser to
  //    start a selection. Instead, make `preventDefault()` a no-op for those events while a
  //    drag begins over message text.
  const SELECTION_EVENTS = new Set(['pointerdown', 'mousedown', 'selectstart', 'touchstart']);
  const nativePreventDefault = Event.prototype.preventDefault;
  let neutralize = false;
  let neutralizeTimer = 0;

  Event.prototype.preventDefault = function () {
    if (neutralize && SELECTION_EVENTS.has(this.type)) return;
    return nativePreventDefault.call(this);
  };

  function startDrag(event) {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest(INTERACTIVE)) return;
    if (!inContent(target) && !messageAtPoint(event.clientX, event.clientY)) return;

    neutralize = true;
    clearTimeout(neutralizeTimer);
    neutralizeTimer = setTimeout(() => {
      neutralize = false;
    }, 0);
  }

  function endDrag() {
    clearTimeout(neutralizeTimer);
    neutralize = false;
  }

  for (const type of ['pointerdown', 'mousedown', 'touchstart']) {
    window.addEventListener(type, startDrag, true);
  }
  for (const type of ['pointerup', 'mouseup', 'touchend', 'dragend']) {
    window.addEventListener(type, endDrag, true);
  }

  // 5. Some layouts never start a native selection at all (not CSS, not preventDefault:
  //    the pointer drag simply produces a collapsed caret). Record the drag and, if the
  //    browser ended up with nothing selected, build the range ourselves from the points.
  function caretAt(x, y) {
    if (document.caretRangeFromPoint) return document.caretRangeFromPoint(x, y);
    if (!document.caretPositionFromPoint) return null;
    const position = document.caretPositionFromPoint(x, y);
    if (!position) return null;
    const range = document.createRange();
    range.setStart(position.offsetNode, position.offset);
    range.collapse(true);
    return range;
  }

  let drag = null;

  function beginDrag(event) {
    if (event.button !== 0) return;
    const target = event.target;
    if (!(target instanceof Element) || target.closest(INTERACTIVE)) return;
    const scope = target.closest(CONTENT) || messageAtPoint(event.clientX, event.clientY);
    if (!scope) return;
    drag = { scope, x: event.clientX, y: event.clientY };
  }

  function finishDrag(event) {
    if (!drag) return;
    const start = drag;
    drag = null;
    if (Math.abs(event.clientX - start.x) < 3 && Math.abs(event.clientY - start.y) < 3) return; // a click

    setTimeout(() => {
      const selection = getSelection();
      if (selection && !selection.isCollapsed && selection.toString().trim()) return; // native worked

      const from = caretAt(start.x, start.y);
      const to = caretAt(event.clientX, event.clientY);
      const usable = (range) => !!range && start.scope.contains(range.startContainer);

      // Hit-testing can fail when an overlay sits above the text; the caret lookup then
      // resolves outside the message. Selecting the message beats selecting nothing.
      if (!usable(from) || !usable(to)) {
        selectContents(start.scope);
        return;
      }

      const forward = from.compareBoundaryPoints(Range.START_TO_START, to) <= 0;
      const range = document.createRange();
      range.setStart(
        forward ? from.startContainer : to.startContainer,
        forward ? from.startOffset : to.startOffset
      );
      range.setEnd(
        forward ? to.startContainer : from.startContainer,
        forward ? to.startOffset : from.startOffset
      );

      // Empty area below the text has no caret offset to drag from, so the rebuilt range
      // collapses. Selecting the message is a better outcome than selecting nothing.
      if (range.collapsed) {
        selectContents(start.scope);
        return;
      }

      selection.removeAllRanges();
      selection.addRange(range);
    }, 0);
  }

  window.addEventListener('pointerdown', beginDrag, true);
  window.addEventListener('mouseup', finishDrag, true);

  // 6. Copy. Qwen rewrites the clipboard on copy (attribution / formatted markdown) in some
  //    builds, and at narrow widths that path can end up copying nothing. When the selection
  //    sits inside a message, let the browser copy natively instead.
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

  // 7. Escape hatches for layouts where no pointer drag starts a selection at all.
  function selectContents(el) {
    const range = document.createRange();
    range.selectNodeContents(el);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }

  // Double-click a reply: fall back to selecting the whole message when the native
  // word-select did not happen (or when an overlay swallowed the event).
  window.addEventListener(
    'dblclick',
    (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target && target.closest(INTERACTIVE)) return;
      const scope = (target && target.closest(CONTENT)) || messageAtPoint(event.clientX, event.clientY);
      if (!scope) return;
      setTimeout(() => {
        if (!selectionInContent()) selectContents(scope);
      }, 0);
    },
    true
  );

  // Alt+C copies the message under the pointer (or the last one), no selection needed.
  let pointer = { x: NaN, y: NaN };

  document.addEventListener(
    'mousemove',
    (event) => {
      pointer = { x: event.clientX, y: event.clientY };
    },
    true
  );

  window.addEventListener(
    'keydown',
    (event) => {
      if (!event.altKey || event.ctrlKey || event.metaKey) return;
      if (String(event.key).toLowerCase() !== 'c') return;

      const hovered = document.elementFromPoint(pointer.x, pointer.y);
      const scope =
        (hovered instanceof Element && hovered.closest(CONTENT)) ||
        messageAtPoint(pointer.x, pointer.y) ||
        [...document.querySelectorAll(CONTENT)].pop();
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
