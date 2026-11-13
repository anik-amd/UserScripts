# UserScripts

Personal collection of browser userscripts. Install with a userscript manager such as
[Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/).

Open a script's raw URL in the browser and the manager offers to install it:
`https://raw.githubusercontent.com/anik-amd/UserScripts/main/scripts/<file>.user.js`

## Scripts

| Script | Site(s) | What it does |
| --- | --- | --- |
| [`qwen-enter-to-send.user.js`](scripts/qwen-enter-to-send.user.js) | `chat.qwen.ai`, `chat.qwenlm.ai` | Sends the message when you press **Enter**, for sessions where the site inserts a newline instead. `Shift+Enter` / `Alt+Enter` still insert a newline. Skipped during IME composition, while a mention/menu popup is open, and on empty input. Only ever clicks the real send button (`.message-input-right-button-send button.send-button`); if that control isn't present it does nothing. |

## Layout

```
scripts/<name>.user.js   # one userscript per file
tests/                   # optional Playwright probes
```

Every script carries a `@match`/`@include` header listing the site(s) it runs on. When adding a
script, add a row to the table above (script, site(s), behaviour) and keep the row and the
header in sync.

## Verification

`tests/` holds a Playwright probe that loads the live site in GitHub Actions, types into the
composer and checks what Enter does. Run it with `gh workflow run dom-probe.yml --ref main`
(needs Actions enabled; no local dependencies). Last verified 2026-11-13 against
`chat.qwen.ai`:

- guest composer: Enter and clicking the send button both trigger a send attempt, `Shift+Enter`
  inserts a newline
- with the userscript loaded, Enter clicks exactly one element — `button.send-button` — and
  produces the same send attempt, while `Shift+Enter` still inserts a newline

## License

[MIT](LICENSE) © 2026 Anik Ahmed
