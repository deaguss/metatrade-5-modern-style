# Changelog

All notable changes to MetaTrader 5 Modern Style are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- The Modern Screen's watchlist is your own list: add symbols, remove them, drag them into your
  order, sort by a column, group them in sections; Last, Chg and Chg% columns; arrow keys step
  through it; its panel can be made wider or narrower by dragging its edge.

## [1.2.0] - 2026-11-25

### Added

- **The Modern Screen** ([docs/screen.md](docs/screen.md)): a roomy, modern chart on MetaTrader 5's
  chart area, with MetaTrader 5's own candles.
  - The **ModernScreen service** sends the terminal's bars (`CopyRates`, in the broker's server time)
    and prices; **ModernScreen.exe** (a tray program, built with the C# compiler that comes with
    Windows) opens the screen when MetaTrader 5 opens, glued onto its chart area (it moves,
    resizes, minimises and closes with it), or as a window of its own. `Ctrl+Alt+M` hides and shows it.
  - Pan, zoom, a price scale that can be dragged, a crosshair, every timeframe, symbol search over
    the terminal's symbols, a watchlist of the Market Watch symbols.
  - Drawing tools: lines, rays, horizontal and vertical lines, a parallel channel, Fibonacci
    retracement, rectangles, triangles, paths, arrows, text, price and date ranges, and long and short
    positions that work out the lots from the risk with the symbol's own contract specification.
    A floating toolbar on the selected drawing, undo and redo, copy and paste, magnet, lock and hide.
    Right-click a tool to draw with one of its saved templates (a long position's "150 150", say),
    or right-click a drawing to apply one.
  - Chart settings (candles, background, grid, scales, crosshair, last price line with a countdown)
    and templates for the chart and for each drawing tool, with import and export.
  - A network indicator in milliseconds: MetaTrader 5's ping to the broker, the round trip to
    MetaTrader 5, the time from a tick to the screen.
  - Fast: while a screen is open the program wakes the service about every 2 ms; a round trip from
    the screen to MetaTrader 5 takes 8 to 15 ms. Lines and candles are drawn on the screen's own
    pixels, so they stay sharp at 125% display scale and the like.
  - Everything stays on the PC: 127.0.0.1 only, with a key made at each start.
- `install.bat` installs the service and the screen, and asks whether the screen starts with Windows.

## [1.1.0] - 2026-11-25

### Changed

- The ticket takes less of the chart. While you are not trading it is one row (SELL, risk, BUY);
  BUY or SELL opens the full ticket with the preview, and it folds again after Confirm or Cancel.
  The `+` button keeps it open. A new ticket floats at the top left instead of docking at the right,
  and an update starts there too.
- The chart is shifted only when something needs the room (a docked ticket, or price tags on the
  chart), so an idle chart keeps all of it. EA version 1.30.

## [1.0.1] - 2026-11-25

### Fixed

- The ticket stayed in its slim layout (SELL / risk / BUY) on a chart tall enough for the full
  ticket. Its first guess at its own height was too tall, and the slim layout never measured the
  full one again. The full ticket's height is now worked out from its rows, so it comes back as
  soon as it fits.

### Changed

- The full ticket is shorter (about 405 px at 100% display scale, the old panel was about 440 px),
  so it fits the charts the old panel fitted. EA version 1.21.

## [1.0.0] - 2026-11-25

First public release.

### Added

- **ActionInna order ticket** (Expert Advisor, version 1.20):
  - risk presets of 1% / 1.5% / 2% and a custom risk in %, money or fixed lots; the lot size is
    worked out from the stop loss;
  - stop loss in pips or price, take profit in pips, price or R, each with - and + beside it, and
    "Last" to recall the levels used before on the symbol;
  - a preview on the chart before anything is sent: entry, SL and TP lines with price tags showing
    pips, money and %; drag the lines and every number follows; nothing is sent before Confirm;
  - market and pending orders (Market | Limit / Stop), the pending type following from the price;
  - changing open trades by dragging their lines, with a card that waits for Confirm;
  - a modern look: near-black surfaces, rounded corners and a soft shadow, the lots in large type
    and risk, reward and risk : reward in tiles;
  - docked at the chart's right edge, or floating anywhere: it snaps to the edges and back to its
    docked place; it can be collapsed to one row;
  - hotkeys and Tab focus for every control; light and dark themes following the chart.
- **ModernStyle script**: gives a chart, or every open chart, the modern style (near-black
  background, white and blue candles, no grid, a blue Bid line, a price scale that can be dragged)
  and saves it as a template.
- `install.bat` and `uninstall.bat`: install into, and remove from, every MetaTrader 5 on the PC.
- A guide to a clean MetaTrader 5 window layout and its drawing tools (`docs/layout.md`).
- A browser prototype of the ticket and the chart style (`prototype/`).

[Unreleased]: https://github.com/deaguss/metatrade-5-modern-style/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/deaguss/metatrade-5-modern-style/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/deaguss/metatrade-5-modern-style/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/deaguss/metatrade-5-modern-style/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/deaguss/metatrade-5-modern-style/releases/tag/v1.0.0
