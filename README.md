# UserScripts

Personal collection of browser userscripts. Install with any userscript manager — every install
link points at the raw `.user.js` file, so the manager opens its confirmation page.

## Scripts

| | Site(s) | What it does | Install |
| --- | --- | --- | --- |
| [Qwen Chat - Enter to Send](https://github.com/anik-amd/UserScripts/blob/main/scripts/qwen-enter-to-send.user.js) | `chat.qwen.ai`, `chat.qwenlm.ai` | Sends the message when you press **Enter**, for sessions where the site inserts a newline instead. `Shift+Enter` / `Alt+Enter` still insert a newline. Skipped during IME composition, while a mention/menu popup is open, and on empty input. | [install](https://raw.githubusercontent.com/anik-amd/UserScripts/main/scripts/qwen-enter-to-send.user.js) |

The install link opens the raw `.user.js`; whichever userscript manager you have handles it.

## Install

1. Pick a manager if you don't have one: [Tampermonkey](https://www.tampermonkey.net/)
   (Chrome, Edge, Firefox, Safari, Opera), [Violentmonkey](https://violentmonkey.github.io/)
   (Chrome, Edge, Firefox), [ScriptCat](https://scriptcat.org/) (Chrome, Edge, Firefox), or
   [Userscripts](https://github.com/quoid/userscripts) (Safari, macOS/iOS).
2. Click **install** in the table above.
3. Confirm the install page the manager shows.

If nothing intercepts the click (mobile Safari, locked-down browsers), open the raw URL, copy the
text, and paste it into the manager's "new script" editor:

`https://raw.githubusercontent.com/anik-amd/UserScripts/main/scripts/<file>.user.js`

Updates: each script declares `@updateURL` / `@downloadURL`, so managers pick up a new `@version`
on their own. To force a reinstall, click **install** again.

## Layout

```
scripts/<name>.user.js   # one userscript per file
tests/                   # optional Playwright probes
```

Every script carries a `@match`/`@include` header listing the site(s) it runs on. When adding a
script, add a row to the table above (readable name linked to the file, site(s), behaviour, install
link) and keep the row and the header in sync.

## Verification

`tests/` holds a Playwright probe that loads the live site in GitHub Actions, types into the
composer and checks what Enter does. Run it with `gh workflow run dom-probe.yml --ref main`
(needs Actions enabled; no local dependencies). Last verified 2026-11-13 against `chat.qwen.ai`:

- guest composer: Enter and clicking the send button both trigger a send attempt, `Shift+Enter`
  inserts a newline
- with the userscript loaded, Enter clicks exactly one element — `button.send-button` — and
  produces the same send attempt, while `Shift+Enter` still inserts a newline

## License

[MIT](LICENSE) © 2026 Anik Ahmed
