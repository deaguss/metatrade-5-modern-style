# Prototype

The browser prototype the ActionInna order ticket and the modern chart style were designed with. It
runs on made-up prices; nothing connects to MetaTrader 5 and no order is sent.

Open `index.html` with a double-click, or run `node prototype/serve.js` and open
<http://127.0.0.1:8140/>. The bar at the bottom switches between the three tickets that were tried
(A, the floating ticket, is the one that was built), and between the clean window layout and
MetaTrader 5 as it opens. **Notes** explains each one.

| Address | Shows |
|---|---|
| `?variant=A` | A, floating ticket |
| `?variant=B` | B, sidebar dock |
| `?variant=C` | C, on-chart position |
| `&shell=mt5` | MetaTrader 5 as it opens, to compare |
| `&clean=1` | without the prototype bar |
