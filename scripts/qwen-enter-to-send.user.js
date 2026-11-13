// ==UserScript==
// @name         Qwen Chat - Enter to Send
// @namespace    https://github.com/anik-amd/UserScripts
// @version      2.0.0
// @description  Press Enter to send in Qwen Chat when the site would otherwise insert a newline. Shift+Enter keeps the newline.
// @author       anik-amd
// @match        https://chat.qwen.ai/*
// @match        https://chat.qwenlm.ai/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // Real send control (verified on chat.qwen.ai):
  //   .message-input-right-button-send > .chat-prompt-send-button > button.send-button[aria-label="Send"]
  // Only these are clicked — no "last button in the composer" guessing, so a
  // mis-click can never open the mode picker, voice mode or an upload dialog.
  const SEND_SELECTORS = [
    '.message-input-right-button-send button.send-button',
    '.message-input-right-button-send .chat-prompt-send-button button',
    '.message-input-right-button-send [role="button"][aria-label*="send" i]',
    'button.send-button[aria-label*="send" i]',
    'form button[aria-label*="send" i]'
  ];

  // While one of these is open, Enter belongs to the popup (mention list, menus).
  const POPUP_SELECTOR = [
    '[role="listbox"]',
    '[role="menu"]',
    '[data-radix-popper-content-wrapper]',
    '[data-popper-placement]',
    '.ant-dropdown:not(.ant-dropdown-hidden)'
  ].join(',');

  let busy = false;

  function isShown(el) {
    if (!el) return false;
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    const style = getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none' && style.pointerEvents !== 'none';
  }

  function isEditor(el) {
    return !!el && (el.tagName === 'TEXTAREA' || el.isContentEditable === true);
  }

  function textOf(el) {
    return el.tagName === 'TEXTAREA' ? el.value : (el.innerText || el.textContent || '');
  }

  function popupOpen() {
    for (const el of document.querySelectorAll(POPUP_SELECTOR)) {
      if (isShown(el)) return true;
    }
    return false;
  }

  function findSendButton(editor) {
    const scope = editor.closest('.message-input-wrapper, form, .message-input-container') || document;
    for (const selector of SEND_SELECTORS) {
      for (const el of scope.querySelectorAll(selector)) {
        if (isShown(el)) return el;
      }
    }
    return null;
  }

  function pressEnterToSend(event) {
    if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229) return;
    // Shift/Alt/Ctrl/Meta+Enter stay with the site (newline, shortcuts, IME alternatives).
    if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
    if (!isEditor(event.target)) return;
    if (!textOf(event.target).trim()) return;
    if (popupOpen()) return;

    const button = findSendButton(event.target);
    if (!button) return; // never guess: if the control is missing, leave the site alone

    event.preventDefault();
    event.stopPropagation();
    if (busy) return;

    busy = true;
    // Let the editor flush its value before the click lands.
    requestAnimationFrame(() => {
      busy = false;
      if (isShown(button)) button.click();
    });
  }

  window.addEventListener('keydown', pressEnterToSend, true);
})();
