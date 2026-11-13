// ==UserScript==
// @name         Qwen Chat - Selectable Text
// @namespace    https://github.com/anik-amd/UserScripts
// @version      1.0.0
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

  // Message bodies. Kept narrow on purpose: only text content is unlocked, never the shell.
  const CONTENT = [
    '.qwen-markdown',
    '.markdown-body',
    '.message-content',
    '[class*="message-content"]',
    '[class*="message-inner"]',
    '[class*="chat-message"]',
    '.chat-message'
  ].join(',');

  // 1. Undo `user-select: none` (and the -webkit- form, which some builds use alone).
  function addStyle() {
    const style = document.createElement('style');
    style.id = 'us-qwen-selectable';
    style.textContent = [
      `${CONTENT}, ${CONTENT} * {`,
      '  -webkit-user-select: text !important;',
      '  user-select: text !important;',
      '  -webkit-touch-callout: default !important;',
      '}',
      `${CONTENT} ::selection { background: Highlight; color: HighlightText; }`
    ].join('\n');
    (document.head || document.documentElement).appendChild(style);
  }

  if (document.readyState === 'loading' && !document.head) {
    document.addEventListener('DOMContentLoaded', addStyle, { once: true });
  } else {
    addStyle();
  }

  // 2. In its mobile layout Qwen treats the list like an app and cancels the pointer
  //    events that start a drag selection. Swallow those events before its handlers run,
  //    but only for plain text: links, buttons, inputs and code-copy controls stay clickable.
  const INTERACTIVE = 'button, a[href], input, textarea, select, summary, [role="button"], [role="link"], [contenteditable="true"]';

  function inContent(target) {
    return target instanceof Element && !!target.closest(CONTENT);
  }

  function swallow(event) {
    if (event.button !== 0) return;
    if (!inContent(event.target)) return;
    if (event.target.closest(INTERACTIVE)) return;
    event.stopPropagation();
  }

  window.addEventListener('mousedown', swallow, true);
  window.addEventListener('pointerdown', swallow, true);

  // 3. Some handlers call preventDefault() on selectstart; stop them from seeing it.
  window.addEventListener(
    'selectstart',
    (event) => {
      if (inContent(event.target)) event.stopPropagation();
    },
    true
  );
})();
