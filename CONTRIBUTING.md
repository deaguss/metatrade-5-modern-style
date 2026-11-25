# Contributing

Thanks for helping. The ActionInna order ticket sends real orders, so every change is held to one
rule: **it must never send an order the trader did not preview and confirm.** Keep that in mind in
review too.

## Set up

You need MetaTrader 5 desktop for Windows (it includes MetaEditor) and a demo account. For the
native tests you also need Git Bash, Node.js and g++ (C++17), for example from MSYS2 or MinGW.

```powershell
git clone https://github.com/deaguss/metatrade-5-modern-style.git
cd metatrade-5-modern-style
powershell -ExecutionPolicy Bypass -File scripts\link-mt5.ps1
powershell -ExecutionPolicy Bypass -File scripts\build.ps1 -Tests
```

`link-mt5.ps1` links the project into your MetaTrader 5 data folder with directory junctions, so
MetaEditor compiles the files in place and MetaTrader 5 runs them. `build.ps1` compiles and writes the
logs to `build\`. Remove the links with `scripts\link-mt5.ps1 -Unlink`; never with
`Remove-Item -Recurse`, which follows a junction in Windows PowerShell 5.1 and deletes the files it
points to. For the same reason, do not delete the programs from MetaTrader 5's Navigator while they
are linked: that deletes the files in your clone.

A recompiled EA keeps running its old code on charts it is already on. Restart MetaTrader 5, or drag
the EA onto the chart again, before testing a change.

## Test

1. `scripts\build.ps1 -Tests` must report **0 errors, 0 warnings** for every program.
2. Drag **Scripts > ActionInna > ActionInnaTests** onto any chart and press OK. It runs the worked
   examples and about 124,000 generated scenarios (seed and rounds are inputs; the same seed replays
   the same scenarios). Every suite must say "all passed". The full report is written to
   `MQL5\Files\ActionInna\test-results.txt` (`runtime\test-results.txt` with the linked set-up).
   Before you share it, check it holds nothing about your account.
3. `bash tests/native/run.sh` must end with "native tests: all passed". It runs the same tests and
   the ticket's scenarios (drag, confirm, typing, drawing order) without MetaTrader 5, against a fake
   terminal in `tests/native/mql.h`.
4. For a change to how the ticket looks, `bash tests/native/preview.sh` draws it without
   MetaTrader 5, one HTML page per state, in `tests/native/out/preview`. Open them in a browser and
   attach screenshots to the pull request.
5. For anything the ticket shows or sends, test it on a **demo account** and say in the pull
   request what you clicked and what happened.

### The Modern Screen

6. `node --test screen/test/*.test.js` (Node.js 18 or later, no packages) runs the page's tests: bars,
   scales, timeframes, the position tools' lots, the drawings (creating, moving, undo) and templates.
7. `powershell -ExecutionPolicy Bypass -File scripts\build-screen.ps1 -Tests` builds ModernScreen.exe
   with the C# compiler that comes with Windows and runs its tests (frames, HTTP, WebSocket, the
   server's checks, the store).
8. To work on the screen without MetaTrader 5, run the program without the glue and a stand-in feed:

   ```powershell
   build\screen\ModernScreen.exe --web screen\web --store build\dev-store --data build\dev-data --no-glue --key devkey-0123456789abcdef --port 8151
   node screen\tools\fake-feed.js
   ```

   The feed prints its process id; open `http://127.0.0.1:8151/?term=<that id>#key=devkey-0123456789abcdef`.
   The page's files are read from `screen\web` as they are: reload the page after a change.

The screen's C# is the version the compiler in Windows understands (C# 5: no `$"..."`, no `?.`, no
`=>` members). The page is plain JavaScript modules: no build step and no packages.

New logic in `RiskCalc.mqh`, `SymbolSpec.mqh`, `Memory.mqh`, `Hotkeys.mqh` or `Util.mqh` needs a
worked example in `ActionInnaTests.mq5` and, where it has rules that hold for every input, a scenario
suite in `Scenarios.mqh`. A change to how the ticket or the chart lines behave needs a scenario in
`tests/native/app.cpp`.

## Code style

- MQL5 and PowerShell sources are ASCII only (CI checks it). Build any other character with
  `ShortToString`.
- Three-space indents in MQL5, as MetaEditor formats them. Free functions start with `Ai`, classes
  with `CAi`, chart objects with the `AINNA_` prefix. The ModernScreen service's code (in
  `Include\ModernScreen`) uses `Ms` and `CMs`.
- Never copy a struct that holds a string or an array: pass it by reference.
- Guard every division and array index. A runtime error unloads the EA without `OnDeinit`, which
  leaves the chart settings it changed (such as the hidden One-Click panel) behind.
- A comment says why, not what. Keep a comment only when the code cannot say it.
- Colours: every text pair 4.5:1, every control edge 3:1, in both themes. Record new colours in
  `DESIGN.md` with their measured contrast.

## Pull requests

- One change per pull request, with an entry under "Unreleased" in `CHANGELOG.md`.
- Update the README when behaviour, inputs or hotkeys change.
- Fill in the pull request template, including the test results line.

## Reporting

Bugs and ideas go to the issue tracker. Anything that could send an unexpected order, or the wrong
volume, SL or TP, is a security issue: follow [SECURITY.md](SECURITY.md) instead of opening a public
issue.

By contributing you agree that your contribution is licensed under the [MIT licence](LICENSE), and
that you follow the [code of conduct](CODE_OF_CONDUCT.md).
