# ActionInna design

This file records the design decisions behind the ActionInna order ticket and the reason for each, so
a change can be checked against them.

**Design read:** a risk-based order panel for discretionary MT5 traders, on the chart itself.
Since v1.2 it is restyled as a modern order ticket ("variant A" of the prototype): near-black
surfaces, rounded corners, and a ticket that can sit anywhere on the chart.
**Dials:** ENERGY 1 / RHYTHM 1 / MOTION 1. It is a tool used for a few seconds per trade, next to a
moving chart: it should be calm, predictable and still.

## Decisions

| Area | Decision | Reason |
|---|---|---|
| Layout | One column: side, risk, SL/TP, money, confirm | The order in which a trade is decided, top to bottom |
| Focal point | The SELL/BUY pair when idle, CONFIRM during a preview, the card's Confirm while a change is open | One question per moment: which side, then go or not |
| Changing open trades | A drag only moves the line; a card beside the panel, level with the dropped line, holds the change until Confirm | A drag is easy to make by accident; a change to a live trade should take a second, deliberate press |
| Card colours | Confirm in the trade's side colour, Cancel neutral, the server's old level as a muted dotted line | Same reading as CONFIRM, and the old and new levels can be told apart at a glance |
| Placement | Docked at the chart's right edge (chart shifted to make room), or floating anywhere: taken by the header, it snaps to an edge or back to its docked place within 12px; a dock button switches | Docked keeps the latest candles visible; floating puts the ticket where the trader looks |
| Slim layout | SELL / risk / BUY bar, chosen or forced by a short chart | CONFIRM must stay on screen on tiled charts |
| Colour: sides | Blue = BUY, red = SELL, and nothing else | The convention traders already read at a glance |
| Colour: levels | Green TP, red SL, neutral entry line | The tag names the side, so the entry line needs no colour |
| Colour: state | Selected controls are neutral (text-coloured edge, bold) | Keeps blue meaning BUY, even during a SELL preview |
| Colour: status | Amber warning, red error, green done, always with words | The words carry the meaning; colour only speeds reading |
| Typeface | Trebuchet MS, 9pt base, nothing below 8pt | A clean modern face that is on every Windows PC; text is measured, so another font keeps the layout |
| Shapes | Rounded corners (8px on the panel and card, 4-6px on controls), a soft shadow, flat fills, 1px edges | The panel and the card are each painted as one picture (OBJ_BITMAP_LABEL), so their corners can be round; text and fields stay chart objects over it |
| Spacing | 10px panel padding, 4px gaps, 28px rows | A modern ticket's density, every control at least 22x26px |
| Fields | SL, TP and entry with - and + either side (5 pips, or 0.25 R) | Changes without typing |
| Drawing order | Preview lines and tags are created before the panel and hidden by drawing them in no colour, never by their timeframes | MT5 draws an object that is shown again on top: lines hidden and shown that way came back over the panel |
| Motion | None | A moving chart is next to it; the panel stays still |
| Keyboard | Hotkeys for the main actions, Tab through every control | Trading without the mouse, and a visible focus ring |

## Colours and measured contrast

Text needs 4.5:1 and control edges 3:1 (WCAG 2.x, computed, not estimated).

| Role | Dark | Light |
|---|---|---|
| Panel | `26,26,26` | `255,255,255` |
| Text on panel | `219,219,219`, 12.6 | `28,31,38`, 16.5 |
| Muted text on panel / on a money tile (`20,20,20`) | `140,140,140`, 5.2 / 5.5 | `100,107,120`, 5.4 |
| Field and button edges | `104,104,104`, 3.1 (3.4 on fields `17,17,17`) | `128,134,146`, 3.7 |
| BUY fill, white text | `41,98,255`, 4.9 | `20,98,212`, 5.6 |
| SELL fill and SL tag, white text | `214,40,56`, 5.0 | `198,40,56`, 5.6 |
| Idle BUY text on its tint | `127,176,255`, 7.1 | `16,86,190`, 5.7 |
| Idle SELL text on its tint | `255,125,136`, 6.5 | `176,30,46`, 5.7 |
| TP tag, white text | `6,128,106`, 4.9 | `18,120,68`, 5.5 |
| Entry tag, white text | `82,88,102`, 7.1 | `72,78,92`, 8.3 |
| Selected control, text on it | `46,46,46`, 9.8 | `228,231,237`, 13.3 |
| Warning text | `242,177,80`, 9.3 | `150,90,0`, 5.6 |
| Error / risk text | `255,110,110`, 6.4 | `196,36,48`, 5.8 |
| Done / reward text | `72,200,125`, 8.1 | `16,122,62`, 5.4 |

The theme follows the chart background (input "Theme"). The values live in `AiBuildTheme`
(`mql5/Include/ActionInna/Ui.mqh`).
