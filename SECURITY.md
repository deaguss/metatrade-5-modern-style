# Security policy

The ActionInna order ticket places orders on a real trading account, so some bugs cost money. Report
those privately.

## What to report privately

- An order sent without a preview and a confirm (with one-click trading off).
- An order sent with a different side, type, volume, entry, SL or TP than the preview showed.
- A lot size that risks more than the risk you set.
- A change to an open trade sent without the modify card's **Confirm change**.
- Anything written outside MetaTrader 5's own file folders, or any network access, by the EA or the
  scripts.
- An installer (`install.bat`, `uninstall.bat`) that writes or deletes anything other than the
  folders its help text names.

Other bugs, including wrong numbers on the ticket that never reach an order, go to the public issue
tracker.

## How to report

Use **Report a vulnerability** on the repository's **Security** tab (GitHub private vulnerability
reporting). Include:

- the version (EA properties, About), the MetaTrader 5 build, and whether the account is demo or
  live, hedging or netting;
- the symbol, the inputs you changed, and the steps;
- the lines from `MQL5\Files\ActionInna\log.txt` around the order, and the order or deal ticket.

Never include passwords, account numbers or investor logins. The reply comes in the advisory thread.

## What the programs touch

- The EA trades only through MetaTrader 5's own order functions, on the chart's symbol, and only
  when you confirm. It makes no network connections.
- It writes its settings and SL/TP history to `Common\Files\ActionInna` and its log to
  `MQL5\Files\ActionInna` (the log can be switched off with the "Write a log" input).
- `ModernStyle` changes chart colours and display settings, and saves one chart template.
- `install.bat` copies the programs into `MQL5\Experts`, `MQL5\Include` and `MQL5\Scripts` of each
  MetaTrader 5 data folder and runs MetaEditor to compile them. `uninstall.bat` deletes those folders
  after asking.

## Supported versions

Only the latest release gets fixes.
