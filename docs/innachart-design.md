# InnaChart: design

A charting screen in the modern style that sits on MetaTrader 5's chart area, with MetaTrader 5's
own candles. MetaTrader 5 keeps running underneath: its menus, Market Watch and Toolbox stay where
they are, its prices and orders are its own.

## Why

MetaTrader 5's charts feel cramped and crowded, and drawing analysis on a web charting site now
costs a subscription once there are more than a few drawings. The screen gives the roomy chart,
the drawing tools and the trader's own drawing templates, without limits, on the broker's own data.

## Goals (phase 1)

- Opens by itself when MetaTrader 5 opens, and sits exactly on its chart area: it moves, resizes,
  minimises and closes with MetaTrader 5. One click hides it to show MetaTrader 5's own charts.
- The candles are MetaTrader 5's: the same broker feed, the same server time, the same bars
  (`CopyRates`), updated on every tick.
- A modern chart: pan and zoom, a price scale that can be dragged (free movement), a crosshair with
  the bar's values, every timeframe from M1 to MN, a symbol search over the terminal's symbols, a
  list of the Market Watch symbols with live prices.
- Chart style settings: background, grid, candle colours, scales, crosshair, watermark; saved as
  chart templates.
- Drawing tools on a left toolbar: trend line, ray, extended line, horizontal line and ray,
  vertical line, parallel channel, Fibonacci retracement, rectangle, rotated rectangle, triangle,
  path, arrow, text, price range, date and price range, long and short position.
- A floating toolbar on the selected drawing: colour, width, line style, template, settings, lock,
  delete. Drawing templates per tool, the trader's own included (imported once).
- The long and short position tools work out the lots from the risk with the symbol's own contract
  specification.
- Drawings are kept per symbol, across timeframes, with undo and redo.
- **Fast.** Trading is about time. While a screen is open, InnaChart.exe wakes the feed about
  every 2 ms (a sleep in MQL5 lasts about 15 ms), and the feed sends the bar with its tick at
  once; the pipe, the WebSocket (no Nagle delay) and the page pass it straight on; the page draws
  it on the next frame. Measured on a PC: screen to InnaChart.exe and back 0.4 ms; screen to
  MT5's feed and back 8 to 15 ms (MT5's own reading of the pipe sets that floor; without the
  wake-ups it was 3 to 31 ms); one frame drawn in under 1 ms. The wake-ups cost about 3% of one
  processor core in MT5 and as much in InnaChart.exe, and stop when no screen is open.
- **A network indicator** in the top bar, in milliseconds: MT5's own ping to the broker's server,
  the round trip screen to MT5 and back, the round trip screen to InnaChart.exe and back, the
  time from a tick's arrival to its frame on screen, the age of the last tick, and ticks a second.

## Non-goals (phase 1)

- Sending orders from the screen. The ActionInna ticket in MetaTrader 5 stays the way to trade.
- Indicators, alerts, several charts at once (later phases).
- MetaTrader 5 on another computer (a VPS). The screen serves the MetaTrader 5 on the same PC.

## Anti-goals

- Anything that sends data off the PC. The screen talks to MetaTrader 5 on the same PC only.
- A screen that can trade without the trader seeing it. When orders come (a later phase) they go
  through the same preview and Confirm as the ticket.
- Candles that differ from MetaTrader 5's.

## How it is built

```
MetaTrader 5 (terminal64.exe)
  InnaChart service (MQL5)  -- named pipe \\.\pipe\InnaChart.Feed -->  InnaChart.exe
                                                                              (tray program)
                                   Edge app window  <-- HTTP + WebSocket on 127.0.0.1 --'
                                   (the screen, glued onto MetaTrader 5's chart area)
```

- **The feed** is an MQL5 *service* (`mql5/Services/InnaChart`). A service runs without a chart
  and starts again each time MetaTrader 5 starts, once it was added in the Navigator. It answers
  history requests with `CopyRates`, and sends the last bar of each watched chart and the quotes of
  the watched symbols when they change. It opens the pipe like a file: no DLL, no setting.
- **The host** is `InnaChart.exe`, a small tray program in C#, built with the C# compiler that
  comes with Windows (.NET Framework 4). It starts with Windows (the installer asks first). It
  serves the pipe; learns which MetaTrader 5 a feed belongs to from the pipe's client process;
  serves the screen's files and a WebSocket on `127.0.0.1` only; and opens one Edge app window per
  MetaTrader 5, glued onto it:
  - the window is owned by MetaTrader 5's main window, so it stays just above MetaTrader 5, hides
    when MetaTrader 5 is minimised, and has no taskbar button of its own;
  - it is placed so that its page covers MetaTrader 5's chart area (the `MDIClient` window), and
    its region is cut to the page, so Edge's own title bar and borders are not shown. (Removing
    the title bar's window styles does not work: Edge draws its title bar itself.);
  - it follows MetaTrader 5 on every move and resize, and closes when MetaTrader 5 closes;
  - or, when the trader chooses **Separate window**, it is an ordinary window (owner, region and
    taskbar button given back) placed on the chart area once and then left where the trader puts
    it. The choice is remembered.
- **The screen** is a web page (`screen/web`), plain JavaScript modules on a canvas, without a
  build step or downloaded libraries. Its look follows the browser prototype.
- **Safety.** The host listens on `127.0.0.1` only. Each start makes a random key that the screen
  gets in its address (after `#`, so it is never sent in a request line) and sends back in a header
  with each store request and as the WebSocket's first message (within 5 seconds); the WebSocket
  also checks that the page comes from the host itself. Without both, nothing is served but the
  page's static files.
- **Storage.** Drawings, templates and settings are files in `%APPDATA%\InnaChart`, never in the
  repository. The trader's imported templates stay there.

## Messages

Pipe frames are a 4-byte little-endian length and UTF-8 JSON (the same frames as Chrome's native
messaging). The host passes them between the pipe and the screen's WebSocket.

| From | Message | Meaning |
|---|---|---|
| feed | `hello` | the terminal: company, server, account currency, build |
| feed | `symbols` | the Market Watch symbols with their specification |
| feed | `bars` | a reply to `history`: `[time, open, high, low, close, tick volume]` rows, oldest first |
| feed | `bar` | the latest bar of a watched chart, with the tick's bid and ask, sent on every tick |
| feed | `clock` | the server's time, MT5's connection and ping to the broker, every second |
| feed | `pong` | the answer to `ping`, at once |
| feed | `quote` | bid and ask of a watched symbol, at most 4 times a second |
| feed | `found` | a reply to `find`: symbols matching a search |
| feed | `spec` | a reply to `spec`: digits, tick size and value, lot sizes, currencies |
| feed | `account` | balance, equity and currency, when they change |
| feed | `error` | a request that failed, with its id |
| screen | `history` | bars of a symbol and timeframe before a time |
| screen | `watch` | the charts (symbol, timeframe) whose last bar to send |
| screen | `quotes` | the symbols whose quotes to send |
| screen | `find` | search every symbol of the terminal |
| screen | `spec` | a symbol's contract specification (for the position tools' lots) |
| screen | `ping` | measures the round trip to MT5 |
| screen | `host.ping`, `host.hide`, `host.show`, `host.separate`, `host.glue` | for InnaChart.exe itself: its round trip; hide or show the screen; a window of its own or glued |
| program | `host`, `host.pong` | to a screen: whether its MT5's feed is linked and the window glued; the answer to `host.ping` |
| program | `pulse` | to the feed: an empty frame about every millisecond follows while a screen is open, so the feed wakes at once instead of sleeping (Windows rounds a sleep up to about 15 ms) |

Several screens may show one MT5. The program gives each request an id of its own, so a reply
reaches only the screen that asked, and joins the charts and symbols they watch.

Times are the broker's server time in seconds, as MetaTrader 5 shows them.

## Approaches considered

1. **An Edge app window glued onto MetaTrader 5 (chosen).** No download, real browser engine,
   the prototype's code carries over. Edge's own window frame has to be cut away (tested).
2. **A native window with an embedded browser (WebView2).** Cleaner window handling, but needs
   Microsoft's WebView2 SDK downloaded at build time.
3. **Drawing everything inside MetaTrader 5's chart with MQL5 objects.** No extra program, but
   MetaTrader 5's object model cannot give the free movement, the floating toolbar or the speed.

## Phases

1. The screen, glued, with MetaTrader 5's candles, chart style settings, the drawing tools and
   templates (this document).
2. Orders from the screen through the ticket's preview and Confirm; the trader's open trades on the
   chart.
3. Indicators, alerts, several charts.
