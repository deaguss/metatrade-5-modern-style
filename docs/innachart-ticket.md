# InnaChart's order ticket: the messages

How InnaChart's order ticket talks to the ActionInna EA in MetaTrader 5. The EA keeps every rule and
every number (risk, lots, checks, sending); the screen only shows them and sends what the trader
typed and pressed.

```
the screen  <-- WebSocket (127.0.0.1) -->  InnaChart.exe  <-- named pipe \\.\pipe\InnaChart.Ticket -->  ActionInna EA
```

- **One chart per MetaTrader 5 serves the ticket.** Every chart with the ActionInna EA (with its input
  **Serve InnaChart's order ticket** on) agrees, through two temporary terminal variables, which one
  opens the pipe; another takes over within seconds when that chart closes.
- **The key.** Pipe names are shared by every Windows user of the PC, so the EA serves only a pipe
  whose first frame is `{"t":"link","key":...}` with the key InnaChart.exe wrote for this user to
  `Common\Files\InnaChart\ticket.key` (in MetaTrader 5's Common files folder). Without it the EA
  serves nothing.
- **Frames** on the pipe are a 4-byte little-endian length and UTF-8 JSON, at most 1 MiB.
- **On the WebSocket** InnaChart.exe puts `ticket.` in front of every type: the screen sends
  `ticket.preview`, the EA's `trades` arrive as `ticket.trades`, its replies as `ticket.reply`.
  It gives each request an id of its own, so a reply reaches only the screen that asked, and
  answers a ticket request at once with `ok:false` when no EA serves the ticket.
- The EA's `beat` (sent after a second of silence) stays between the EA and InnaChart.exe.

## Requests and replies

- Every request from the screen has a type `t` and an `id`: a positive integer, unique while the screen
  is open.
- The EA answers each request with exactly one `reply`, carrying the same `id`:

```json
{"t":"reply","id":12,"ok":true, ...}
{"t":"reply","id":13,"ok":false,"err":"Set a stop loss"}
```

- `ok:false` means the request was not carried out. `err` says why, in words the screen can show as
  they are.
- A preview that finds a problem is still `ok:true`: the problem is in the plan's `err`.

Values the screen sends as words:

| Key | Values |
|---|---|
| `side` | `"buy"`, `"sell"` |
| `slMode` | `"pips"`, `"price"` |
| `tpMode` | `"pips"`, `"price"`, `"r"` |
| `riskMode` | `"percent"`, `"money"`, `"lots"` |
| `riskBase` | `"equity"`, `"balance"` |

## Writes: preview, then confirm

Nothing changes in MT5 from a single message. Every write is two steps:

1. A preview request (`preview`, `modPreview`, `closePreview`). The EA checks it, values it, and
   answers with a `preview` id such as `"p17"`.
2. The confirm request (`send`, `modSend`, `close`) names that id.

Before acting on a confirm, the EA checks everything again with the newest prices and the trade as
the server has it now. It refuses:

- an unknown preview id;
- a preview id that was already used;
- a preview older than 60 seconds;
- a preview made on another account (login and server) than the one MT5 is logged in to now;
- an order or change that would now be another order type than the preview showed: a pending entry
  the price crossed since (a limit would become a stop, or back);
- a new order whose lots would now differ from the preview's, or whose risk grew more than 5% since;
- anything the checks refuse now.

`cancel` (remove a pending order) is a single request: repeating it can't do harm. The screen still
asks the trader first.

## Messages the EA sends on its own

### `terminal`

Sent once the key matches, and again whenever any of its values change.

```json
{"t":"terminal","ver":1,"login":0,"server":"Broker-Demo","company":"Broker Ltd","currency":"USD",
 "currencyDigits":2,"tradeMode":"demo","marginMode":"hedging","hedgeAllowed":true,"fifo":false,
 "connected":true,"problem":"",
 "settings":{"presets":[1,1.5,2],"riskBase":"equity","maxRiskPct":5,"commissionRT":0,"requireSL":true,
   "requireTP":true,"pipMode":"trader","defaultSLPips":20,"defaultTPMode":"r","defaultTPValue":2,
   "pendingOffsetPips":10,"slipPolicy":"follow"}}
```

- `tradeMode`: `"demo"`, `"contest"` or `"real"`.
- `marginMode`: `"hedging"`, `"netting"` or `"exchange"`.
- `connected`: MT5's connection to the broker.
- `problem`: what stops sending now, in words, such as `"Turn on Algo Trading (toolbar button) to send
  orders"`. Empty when nothing does.
- `settings` are the EA's inputs. The screen shows them, but can't change them: the safety cap,
  required SL/TP, commission and the rest stay in MT5.
- `pipMode`: `"trader"`, `"10points"` or `"points"`.
- `slipPolicy`: `"follow"`, `"keepPrices"` or `"keepRisk"`.

### `quote`

For the symbol the screen watches (`watch`): at most 10 a second, and only when the price changed.

```json
{"t":"quote","symbol":"XAUUSD","bid":2650.12,"ask":2650.28,"spreadPips":1.6,"timeMsc":1792000000123}
```

### `trades`

Every open position and pending order, on every symbol, and the account's money. Another EA's trades
(its own magic number, not 0 nor ActionInna's) are left out of the list, and counted in `others`
(positions and orders, with the positions' profit); `others` is there only when some are left out.
With the EA's **Show other EAs' trades** on, every trade is listed. Sent once the
key matches, when a trade changes, and every second while positions are open (for the
profit).

```json
{"t":"trades","balance":10000,"equity":10012.4,"margin":530.1,"freeMargin":9482.3,"list":[
 {"ticket":4327679330,"symbol":"XAUUSD","kind":"position","type":"BUY","side":1,"lots":0.2,"open":2650.58,
  "sl":2645.58,"tp":2660.58,"profit":12.4,"slMoney":-100,"tpMoney":200,"digits":3,"openMsc":1792000000123},
 {"ticket":4327679331,"symbol":"EURUSD","kind":"order","type":"SELL LIMIT","side":-1,"lots":0.5,"open":1.0901,
  "sl":1.0921,"tp":1.0861,"profit":0,"slMoney":-100,"tpMoney":200,"digits":5,"expiration":0,"locked":false}],
 "others":{"count":204,"profit":-12295.14}}
```

- `profit` includes swap.
- `slMoney` and `tpMoney` are the money at the stop loss and at the take profit from the open price,
  after commission, as `modPreview` values them. Each is left out when the trade has no stop or no
  target.
- `locked` marks a stop-limit order. The screen can't change one; MT5's Trade tab can.
- A change, close or removal of a trade left out this way is refused: "#… belongs to another EA (a
  bot): ActionInna leaves it alone".

### `beat`

Sent by the EA after a second without any other message, so the screen knows MT5 is alive. The EA
also learns this way when the link has gone: the write fails.

```json
{"t":"beat"}
```

### `error`

A frame the EA could not read.

```json
{"t":"error","err":"Not a JSON object"}
```

## Requests

### `watch`: the symbol the screen shows

```json
{"t":"watch","id":3,"symbol":"XAUUSD"}
-> {"t":"reply","id":3,"ok":true,"spec":{"symbol":"XAUUSD","digits":3,"point":0.001,"tickSize":0.001,
    "pipSize":0.1,"volMin":0.01,"volMax":200,"volStep":0.01,"stopsLevel":0,"freezeLevel":0,
    "execution":"market","tradeMode":"full","orders":{"market":true,"limit":true,"stop":true,"sl":true,"tp":true},
    "contractSize":100,"base":"XAU","profit":"USD"}}
```

Quotes for that symbol follow.

### `preview`: a new order

```json
{"t":"preview","id":4,"symbol":"XAUUSD","side":"buy","pending":false,"entry":0,
 "slMode":"pips","slValue":50,"tpMode":"r","tpValue":2,"riskMode":"percent","riskValue":1,"riskBase":"equity"}
-> {"t":"reply","id":4,"ok":true,"preview":"p1","plan":{"valid":true,"err":"","warn":"","type":"BUY",
    "entry":2650.28,"sl":2645.28,"tp":2660.28,"lots":0.2,"riskMoney":100,"riskPct":1,"rewardMoney":200,
    "rewardPct":2,"rr":2,"slPips":50,"tpPips":100,"pipValue":2,"margin":530.06,"freeAfter":9469.94,
    "commission":0,"spreadPips":1.6,"bid":2650.12,"ask":2650.28}}
```

This is `AiBuildPlan`, as on the chart.

### `send`: send a previewed order

```json
{"t":"send","id":5,"preview":"p1"}
-> {"t":"reply","id":5,"ok":true,"ticket":4327679330,"type":"BUY","pending":false,"price":2650.58,"lots":0.2,
    "fill":{"slipped":true,"slipPips":3,"slMoved":true,"tpMoved":true,"notMoved":"","sl":2645.58,"tp":2660.58,
    "risk":100,"plannedRisk":100}}
```

- The order always carries its SL and TP.
- After a market order fills at another price, SL and TP move as the EA input "When a market order
  fills at another price" says. `fill` reports what happened.
- On instant and request execution, a requote is tried again at the new price, up to three times,
  as on the chart.

### `recall`: earlier SL/TP for a symbol

```json
{"t":"recall","id":6,"symbol":"XAUUSD","side":"buy","entry":0,"which":"both","back":0}
-> {"t":"reply","id":6,"ok":true,"slMode":"pips","slValue":50,"tpMode":"r","tpValue":2,"desc":"SL 50 pips, TP 2R",
    "index":0,"count":3}
```

- `which` is `"sl"`, `"tp"` or `"both"` (the default): the levels to bring back. `desc` names only
  those, and only they are meant; the others in the reply are the defaults.
- `back` steps through the remembered records: 0 is the newest. A record that holds nothing for
  `which` is skipped, as with the chart's Last buttons. `index` is the record used, so the next
  press asks for `index + 1`.
- `count` is the number of records. With none, the levels come from the last trade on the symbol in
  the account's history, and `count` is 0.
- `entry` is a pending order's entry; 0 means the market price.
- A price level that no longer fits on the right side of the entry comes back as a distance, as on
  the chart.

### `modPreview` / `modSend`: change an open trade

```json
{"t":"modPreview","id":7,"ticket":4327679330,"sl":2647.00,"tp":2660.58}
-> {"t":"reply","id":7,"ok":true,"preview":"p2","mod":{"valid":true,"changed":true,"err":"","warn":"",
    "open":2650.58,"sl":2647.0,"tp":2660.58,"slMoney":-71.6,"slPct":-0.72,"oldSlMoney":-100,"tpMoney":200,
    "tpPct":2,"rr":2.79,"slPips":35.8,"tpPips":100,"type":"BUY","retype":false}}
{"t":"modSend","id":8,"preview":"p2"}  -> {"t":"reply","id":8,"ok":true,"ticket":4327679330,"type":"BUY","replaced":false}
```

- A pending order may also send `open`, its new entry.
- This is `AiBuildModPlan`, as on the chart's modify card.
- `mod` also carries `bid` and `ask`: the market for the trade's symbol when MT5 looked. The screen's
  `quote` messages follow only the symbol it watches, and a trade may be on another one. The screen
  asks again every second while a change card is open, so the preview stays fresh and the type it
  shows follows the market.
- `type` is the trade's type after the change. A pending entry moved across the market makes the
  order the other type (a BUY LIMIT moved above the ask becomes a BUY STOP): `retype` is true, and
  `warn` says so. MT5 can't change an order's type, so `modSend` removes the order, then places one
  of the new type with the same lots, SL/TP, owner (magic) and comment, and the expiry when a new
  order may still carry it. Its reply has `"replaced":true` and the new order's `ticket`.
- If the new order is refused after the old one was removed, the reply is `ok:false` with
  `"removed":true`: no order is pending, and `err` says so.
- Break-even (the stop at the entry) is allowed once the price is past the entry by the broker's
  stops level; before that, `err` says how far it has to go.

### `closePreview` / `close`: close a position, or part of it

```json
{"t":"closePreview","id":9,"ticket":4327679330,"lots":0.1}
-> {"t":"reply","id":9,"ok":true,"preview":"p3","close":{"valid":true,"err":"","lots":0.1,"left":0.1,
    "price":2655.10,"profit":45.2}}
{"t":"close","id":10,"preview":"p3"}  -> {"t":"reply","id":10,"ok":true,"ticket":4327679330,"price":2655.08,"lots":0.1}
```

- `lots` of 0 closes all of the position.
- A part close must leave at least the symbol's minimum lot.
- On an account that closes first in, first out, only the oldest position on the symbol can be
  closed, and the preview says which.
- `profit` is MT5's profit for those lots at the current price, swap included, commission not.

### `cancel`: remove a pending order

```json
{"t":"cancel","id":11,"ticket":4327679331}  -> {"t":"reply","id":11,"ok":true}
```

The broker's freeze level is checked first. A stop-limit order can be removed too.
