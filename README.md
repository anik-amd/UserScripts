# UserScripts

Personal collection of browser userscripts. Install with a userscript manager such as
[Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/).

Open a script's raw URL in the browser and the manager offers to install it:
`https://raw.githubusercontent.com/anik-amd/UserScripts/main/scripts/<file>.user.js`
(raw links only resolve once this repo is public, or with a token if it stays private).

## Scripts

| Script | Site(s) | What it does |
| --- | --- | --- |
| [`qwen-enter-to-send.user.js`](scripts/qwen-enter-to-send.user.js) | `chat.qwen.ai`, `chat.qwenlm.ai` | Sends the message when you press **Enter**. `Shift+Enter` / `Alt+Enter` still insert a newline. Skipped while an IME composition or a suggestion popup (mentions, menus) is open, and on empty input. |

## Layout

```
scripts/<name>.user.js   # one userscript per file
tests/                   # optional Playwright probes
```

Every script carries a `@match`/`@include` header listing the site(s) it runs on. When adding a
script, add a row to the table above (script, site(s), behaviour) and keep the row and the
header in sync.

## License

MIT (to be added)
