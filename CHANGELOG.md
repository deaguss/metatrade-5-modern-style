# Changelog

All notable changes to MetaTrader 5 Modern Style are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

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

[Unreleased]: https://github.com/deaguss/metatrade-5-modern-style/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/deaguss/metatrade-5-modern-style/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/deaguss/metatrade-5-modern-style/releases/tag/v1.0.0
