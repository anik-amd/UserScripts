// ==UserScript==
// @name         Qwen Chat - Enter to Send
// @namespace    https://github.com/anik-amd/UserScripts
// @version      1.0.0
// @description  Send a Qwen Chat message by pressing Enter. Shift+Enter still inserts a newline.
// @author       anik-amd
// @match        https://chat.qwen.ai/*
// @match        https://chat.qwenlm.ai/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // Text that appears on / around a send button, across EN and ZH locales.
  const SEND_HINT = /send|submit|发送|傳送|送出|paper[-_ ]?plane/i;

  // If one of these is open, Enter belongs to the popup (mention picker, menu...), not the send action.
  const POPUP_SELECTOR = [
    '[role="listbox"]',
    '[role="menu"]',
    '[data-radix-popper-content-wrapper]',
    '[data-popper-placement]',
    '.ant-dropdown:not(.ant-dropdown-hidden)'
  ].join(',');

  let pendingClick = false;

  function isVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    const style = getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none';
  }

  function isEditable(el) {
    if (!el) return false;
    if (el.tagName === 'TEXTAREA') return true;
    return el.isContentEditable === true;
  }

  function editorText(el) {
    return el.tagName === 'TEXTAREA' ? el.value : (el.innerText || el.textContent || '');
  }

  function hasOpenPopup() {
    return Array.from(document.querySelectorAll(POPUP_SELECTOR)).some(isVisible);
  }

  function buttonLabel(el) {
    const svg = el.querySelector('svg');
    return [
      el.getAttribute('aria-label'),
      el.getAttribute('title'),
      el.getAttribute('data-testid'),
      el.getAttribute('name'),
      typeof el.className === 'string' ? el.className : '',
      svg && svg.getAttribute('class'),
      svg && svg.getAttribute('data-icon'),
      svg && svg.querySelector('title') && svg.querySelector('title').textContent
    ]
      .filter((value) => typeof value === 'string' && value)
      .join(' ');
  }

  function sendButtonIn(scope) {
    const buttons = Array.from(scope.querySelectorAll('button, [role="button"]'))
      .filter((el) => isVisible(el) && el.closest('button, [role="button"]') === el)
      .filter((el) => !el.querySelector('input[type="file"]'));

    const hinted = buttons.find((el) => SEND_HINT.test(buttonLabel(el)));
    if (hinted) return hinted;

    // No recognizable label: the send control is normally the trailing button of the composer toolbar.
    return buttons.length ? buttons[buttons.length - 1] : null;
  }

  function findSendButton(editor) {
    // Walk up a few levels so the whole composer (textarea + toolbar) is in scope.
    let node = editor;
    for (let depth = 0; depth < 8 && node; depth += 1) {
      const parent = node.parentElement;
      if (!parent) break;
      const found = sendButtonIn(parent);
      if (found) return found;
      node = parent;
    }
    // Last resort: look page-wide, but only accept an explicitly labelled send button.
    const labelled = Array.from(document.querySelectorAll('button, [role="button"]'))
      .filter((el) => isVisible(el) && SEND_HINT.test(buttonLabel(el)));
    return labelled.length ? labelled[labelled.length - 1] : null;
  }

  function submit(editor) {
    if (pendingClick) return;
    const button = findSendButton(editor);
    if (!button) return;

    pendingClick = true;
    // Let the editor flush its value to the framework before clicking.
    requestAnimationFrame(() => {
      pendingClick = false;
      if (!button.disabled && button.getAttribute('aria-disabled') !== 'true') {
        button.click();
      }
    });
  }

  function onKeyDown(event) {
    if (event.key !== 'Enter') return;
    if (event.isComposing || event.keyCode === 229) return; // IME is composing
    if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return; // keep native newline / shortcuts
    if (!isEditable(event.target)) return;
    if (!editorText(event.target).trim()) return; // nothing to send
    if (hasOpenPopup()) return; // Enter picks the highlighted suggestion

    event.preventDefault();
    // Capture-phase listener on window: stopping here keeps the site's own Enter handler
    // from also submitting, so the click below is the single send path.
    event.stopPropagation();
    submit(event.target);
  }

  window.addEventListener('keydown', onKeyDown, true);
})();
