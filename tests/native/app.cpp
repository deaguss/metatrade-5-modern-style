// Drag-and-confirm scenarios for open trades, run against the real CAiApp in a fake MT5. Each one
// does what a trader does (drag, release, click, type, press keys) or what the server does (close,
// change, refuse), and checks what reaches the server. A random fuzz runs the same moves in any
// order. Exits with 1 when any check fails.
//   app [fuzz-iterations] [seed]
#include <random>
#include "mql.h"
#include "brokers.h"
#include <ActionInna/App.mqh>

CAiApp g_app;   // a global, as in the EA: zeroed before its constructor runs

static int s_pass = 0;
static int s_fail = 0;
static std::string s_case;
static bool s_confirming = false;   // a Confirm click or key is being handled: a request may go out
static std::vector<std::string> s_bad;   // requests the server should never have seen
static int s_checked = 0;               // changes the server checked
// The order a removal just took away: a new order in the same Confirm is its replacement.
static FakeOrd s_removed{};
static bool s_hasRemoved = false;

static void Expect_(bool ok, const std::string &what, int line)
  {
   if(ok)
     {
      s_pass++;
      return;
     }
   s_fail++;
   if(s_fail <= 60)
      printf("FAIL [%s] %s (app.cpp:%d)\n", s_case.c_str(), what.c_str(), line);
  }
#define EXPECT(cond, what) Expect_((cond), (what), __LINE__)

//--- reading the fake chart --------------------------------------------------
static const std::string kP = "AINNA_P_";
static std::string Obj(ulong t, const char *part) { return "AINNA_O_" + std::to_string(t) + "#" + part; }
static FakeObj *Get(const std::string &n) { auto it = g_fake.objs.find(n); return it == g_fake.objs.end() ? nullptr : &it->second; }
static bool Exists(const std::string &n) { return Get(n) != nullptr; }
// Hidden on every timeframe, or drawn in no colour (how the preview hides its lines without
// changing where MT5 draws them).
static bool Shown(const std::string &n)
  {
   FakeObj *o = Get(n);
   return o && o->i[OBJPROP_TIMEFRAMES * 16] != OBJ_NO_PERIODS && (uint32_t)o->i[OBJPROP_COLOR * 16] != clrNONE;
  }
static double PriceOf(const std::string &n) { FakeObj *o = Get(n); return o ? o->d[OBJPROP_PRICE * 16] : 0.0; }
static bool Selectable(const std::string &n) { FakeObj *o = Get(n); return o && o->i[OBJPROP_SELECTABLE * 16] != 0; }
static int WidthOf(const std::string &n) { FakeObj *o = Get(n); return o ? (int)o->i[OBJPROP_WIDTH * 16] : 0; }
static int IntOf(const std::string &n, int prop) { FakeObj *o = Get(n); return o ? (int)o->i[prop * 16] : 0; }
static std::string TextOf(const std::string &n) { FakeObj *o = Get(n); return o ? o->s[OBJPROP_TEXT] : std::string(); }
static int OrderOf(const std::string &n) { FakeObj *o = Get(n); return o ? o->order : 0; }
static bool Has(const std::string &hay, const std::string &needle) { return hay.find(needle) != std::string::npos; }
static bool Near(double a, double b, double eps = 1e-9) { return std::fabs(a - b) <= eps; }
static bool CardOpen() { return Shown(kP + "MODOK#tx"); }
static std::string CardStatus() { return TextOf(kP + "XMST1#t") + " " + TextOf(kP + "XMST2#t"); }
static std::string PanelStatus() { return TextOf(kP + "XST1#t") + " " + TextOf(kP + "XST2#t"); }

// Highest creation number among the trade objects drawn in front (server-level lines sit behind).
static int TopTradeObject()
  {
   int top = 0;
   for(auto &kv : g_fake.objs)
      if(kv.first.rfind("AINNA_O_", 0) == 0 && kv.first.back() != 'g')
         top = std::max(top, kv.second.order);
   return top;
  }
static int GhostCount()
  {
   int n = 0;
   for(auto &kv : g_fake.objs)
      if(kv.first.rfind("AINNA_O_", 0) == 0 && kv.first.back() == 'g')
         n++;
   return n;
  }

//--- what the trader and the terminal do -------------------------------------
static void Advance(int ms) { g_fake.us += (ulong)ms * 1000ULL; }
static void Event(int id, int64_t l, double d, const std::string &s)
  {
   int64_t lp = l;
   double dp = d;
   string sp(s);
   g_app.ChartEvent(id, lp, dp, sp);
  }
static void Refresh() { Advance(150); g_app.Timer(); }
static void Mouse(int x, int y, int buttons) { Advance(30); Event(CHARTEVENT_MOUSE_MOVE, x, y, std::to_string(buttons)); }
static int YOf(double price) { int x = 0, y = 0; ChartTimePriceToXY(0, 0, 0, price, x, y); return y; }
static bool IsConfirm(const std::string &n) { return n == kP + "MODOK#bg" || n == kP + "MODOK#tx" || n == kP + "CONFIRM#bg" || n == kP + "CONFIRM#tx"; }
static void Click(const std::string &n, int y = 300)
  {
   // A replacement goes out with its removal, in one Confirm; a removal from before is no clue.
   s_hasRemoved = false;
   s_confirming = IsConfirm(n);
   Event(CHARTEVENT_OBJECT_CLICK, 400, y, n);
   s_confirming = false;
  }
static void Key(int vk)
  {
   s_hasRemoved = false;
   s_confirming = (vk == 13 || vk == 32);
   Event(CHARTEVENT_KEYDOWN, vk, 1.0, "0");
   s_confirming = false;
  }
static void Type(const std::string &field, const std::string &text)
  {
   Click(field);
   if(FakeObj *o = Get(field))
      o->s[OBJPROP_TEXT] = text;
   Event(CHARTEVENT_OBJECT_ENDEDIT, 0, 0, field);
  }
// What a trader does to move a line: the mouse comes over it, the button goes down 'off' pixels
// from it, the mouse moves, the button comes up. The app moves the line itself (MT5 never drags
// it), and the price is the one under the mouse.
// An x where, at height y, the mouse is on no price tag, card or panel: where a trader takes a
// line, beside them.
static int FreeX(int y)
  {
   for(int x : {500, 420, 340, 260, 180, 120, 60, 640})
     {
      bool clear = true;
      for(auto &kv : g_fake.objs)
        {
         const std::string &n = kv.first;
         bool box = (n.rfind("AINNA_O_", 0) == 0 && n.back() == 'b') || (n.rfind("AINNA_T_", 0) == 0 && n.find("#bg") != std::string::npos) ||
                    n == kP + "XMBG#r" || n == kP + "XBG#r";
         if(!box || !Shown(n))
            continue;
         int bx = IntOf(n, OBJPROP_XDISTANCE), by = IntOf(n, OBJPROP_YDISTANCE), bw = IntOf(n, OBJPROP_XSIZE), bh = IntOf(n, OBJPROP_YSIZE);
         if(x >= bx && x < bx + bw && y >= by && y < by + bh)
           {
            clear = false;
            break;
           }
        }
      if(clear)
         return x;
     }
   return 500;
  }
static void Drag(const std::string &n, double to, int off = 0)
  {
   double from = PriceOf(n);
   int x = FreeX(YOf(from) + off);
   Mouse(x, YOf(from) + off, 0);
   Mouse(x, YOf(from) + off, 1);
   for(int k = 1; k <= 3; k++)
      Mouse(x, YOf(from + (to - from) * k / 3.0) + off, 1);
   Mouse(x, YOf(to) + off, 0);
  }
// The mouse over the line thickens it when the line can be taken; then it moves well away.
static bool Grabbable(const std::string &n)
  {
   Mouse(FreeX(YOf(PriceOf(n))), YOf(PriceOf(n)), 0);
   bool can = (WidthOf(n) == 2);
   Mouse(500, -100000, 0);
   return can;
  }

//--- setting up --------------------------------------------------------------
static AiSettings DefaultCfg()
  {
   AiSettings c;
   ZeroMemory(c);
   c.preset[0] = 1.0;
   c.preset[1] = 1.5;
   c.preset[2] = 2.0;
   c.riskBase = AI_BASE_EQUITY;
   c.maxRiskPct = 5.0;
   c.requireSL = true;
   c.requireTP = true;
   c.defaultSLPips = 20.0;
   c.defaultTPMode = AI_LEVEL_RR;
   c.defaultTPValue = 2.0;
   c.pipMode = AI_PIP_TRADER;
   c.autoRecall = true;
   c.pendingOffsetPips = 10.0;
   c.deviation = 10;
   c.comment = "ActionInna";
   c.manageOrders = true;
   c.hotkeys = true;
   c.keyBuy = "B";
   c.keySell = "S";
   c.keyConfirm = "ENTER";
   c.keyCancel = "ESC";
   c.keyRisk1 = "1";
   c.keyRisk2 = "2";
   c.keyRisk3 = "3";
   c.keyRiskC = "4";
   c.keyRecall = "R";
   c.keyPending = "P";
   c.keyCollapse = "H";
   c.hideOneClick = true;
   c.autoShift = true;
   c.showZones = true;
   c.theme = AI_THEME_AUTO;
   c.uiScale = 1.0;
   c.font = "Trebuchet MS";
   c.fontSize = 9;
   return c;
  }

// Requotes aside, the server refused nothing the panel sent: every request a Confirm let through was
// one this broker's rules accept.
static void CheckServerRefusals()
  {
   for(uint code : g_fake.refusals)
      if(code != TRADE_RETCODE_REQUOTE)
         s_bad.push_back(s_case + ": the server refused a request with " + std::to_string(code));
   g_fake.refusals.clear();
  }

static void Setup(const std::string &name, bool manage = true, const BrokerProfile *broker = nullptr)
  {
   CheckServerRefusals();
   s_case = name;
   g_app.Deinit(REASON_REMOVE);
   g_fake.Reset();
   _Symbol = string(g_fake.sym.name);
   if(broker)
      ApplyBroker(*broker);
   g_app.cfg = DefaultCfg();
   g_app.cfg.manageOrders = manage;
   g_app.Init();
   Refresh();
  }

static void AddPos(ulong t, int type, double vol, double open, double sl, double tp)
  {
   g_fake.pos.push_back(FakePos{t, type, vol, open, sl, tp, 0.0, (int64_t)g_fake.time * 1000, g_fake.sym.name});
  }
static void AddOrd(ulong t, int type, double vol, double price, double sl, double tp, int typeTime = ORDER_TIME_GTC, datetime exp = 0,
                   double stoplimit = 0.0)
  {
   g_fake.ords.push_back(FakeOrd{t, type, vol, price, sl, tp, stoplimit, typeTime, exp, g_fake.sym.name});
  }
static FakePos *PosOf(ulong t) { for(auto &p : g_fake.pos) if(p.ticket == t) return &p; return nullptr; }
static FakeOrd *OrdOf(ulong t) { for(auto &o : g_fake.ords) if(o.ticket == t) return &o; return nullptr; }
static size_t Sent() { return g_fake.requests.size(); }
static const MqlTradeRequest &Last() { return g_fake.requests.back(); }

// Every change that reaches the server must have come from a Confirm, pass the checks against what
// the server has at that moment, keep both levels, and change something.
// A pending order changing type goes out as a removal and a new order (CAiExecutor::Replace): the
// new one must take over the removed one's side, lots, expiry, owner and comment, as the other type.

static void CheckReplacement(const MqlTradeRequest &r)
  {
   const FakeOrd &o = s_removed;
   bool buy = FakeBuyType(o.type);
   if(FakeBuyType(r.type) != buy || r.type == o.type)
      s_bad.push_back(s_case + ": a replacement changed the side, or kept the type");
   if(std::fabs(r.volume - o.volume) > 1e-9)
      s_bad.push_back(s_case + ": a replacement changed the lots");
   // The old expiry stays when a new order may carry it; otherwise the server must take what is sent.
   int flag = (o.typeTime == ORDER_TIME_GTC) ? SYMBOL_EXPIRATION_GTC : (o.typeTime == ORDER_TIME_DAY) ? SYMBOL_EXPIRATION_DAY :
              (o.typeTime == ORDER_TIME_SPECIFIED) ? SYMBOL_EXPIRATION_SPECIFIED : SYMBOL_EXPIRATION_SPECIFIED_DAY;
   bool dated = (o.typeTime == ORDER_TIME_SPECIFIED || o.typeTime == ORDER_TIME_SPECIFIED_DAY);
   bool keepable = (g_fake.sym.expiration == 0 || (g_fake.sym.expiration & flag) != 0) && (!dated || o.expiration > g_fake.time);
   if(keepable && (r.type_time != o.typeTime || r.expiration != o.expiration))
      s_bad.push_back(s_case + ": a replacement did not keep the expiry");
   if(r.magic != o.magic || std::string(r.comment.s) != o.comment)
      s_bad.push_back(s_case + ": a replacement did not keep the owner's magic and comment");
   AiSpec s;
   AiLoadSpec(_Symbol, AI_PIP_TRADER, s);
   string why = AiCheckStops(s, (ENUM_ORDER_TYPE)r.type, r.price, r.sl, r.tp, g_fake.sym.bid, g_fake.sym.ask);
   if(why != string(""))
      s_bad.push_back(s_case + ": placed a replacement the checks refuse: " + why.s);
   if((g_app.cfg.requireSL && r.sl <= 0.0) || (g_app.cfg.requireTP && r.tp <= 0.0))
      s_bad.push_back(s_case + ": placed a replacement without a required SL or TP");
  }

static void CheckRequest(const MqlTradeRequest &r)
  {
   s_checked++;
   if(!s_confirming)
      s_bad.push_back(s_case + ": a request went out without a Confirm click or key");
   if(r.action == TRADE_ACTION_REMOVE)
     {
      if(FakeOrd *o = OrdOf(r.order))
        {
         s_removed = *o;
         s_hasRemoved = true;
        }
      else
         s_bad.push_back(s_case + ": removed an order the server does not have");
      return;
     }
   // A new order right after a removal that went through is that order's replacement.
   if(r.action == TRADE_ACTION_PENDING && s_hasRemoved && !OrdOf(s_removed.ticket))
     {
      s_hasRemoved = false;
      CheckReplacement(r);
      return;
     }
   if(r.action != TRADE_ACTION_SLTP && r.action != TRADE_ACTION_MODIFY)
      return;
   AiLive l;
   ZeroMemory(l);
   bool found = false;
   if(r.action == TRADE_ACTION_SLTP)
     {
      if(FakePos *p = PosOf(r.position))
        {
         found = true;
         l.side = (p->type == POSITION_TYPE_BUY) ? AI_BUY : AI_SELL;
         l.type = (p->type == POSITION_TYPE_BUY) ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;
         l.open = p->open;
         l.sl = p->sl;
         l.tp = p->tp;
         l.lots = p->volume;
        }
     }
   else if(FakeOrd *o = OrdOf(r.order))
     {
      found = true;
      l.isOrder = true;
      l.type = (ENUM_ORDER_TYPE)o->type;
      l.side = (o->type == ORDER_TYPE_BUY_LIMIT || o->type == ORDER_TYPE_BUY_STOP || o->type == ORDER_TYPE_BUY_STOP_LIMIT) ? AI_BUY : AI_SELL;
      l.open = o->price;
      l.sl = o->sl;
      l.tp = o->tp;
      l.lots = o->volume;
      if(r.type_time != o->typeTime || r.expiration != o->expiration)
         s_bad.push_back(s_case + ": a pending order's expiry was not kept");
      if(r.stoplimit != o->stoplimit)
         s_bad.push_back(s_case + ": a pending order's stop-limit price was not kept");
     }
   if(!found)
     {
      s_bad.push_back(s_case + ": a change was sent for a trade the server does not have");
      return;
     }
   AiSpec s;
   AiLoadSpec(_Symbol, AI_PIP_TRADER, s);
   double open = (r.action == TRADE_ACTION_MODIFY) ? r.price : l.open;
   string why = AiCheckModify(s, l, open, r.sl, r.tp, g_fake.sym.bid, g_fake.sym.ask);
   if(why != string(""))
      s_bad.push_back(s_case + ": sent a change the checks refuse: " + why.s);
   if((g_app.cfg.requireSL && r.sl <= 0.0) || (g_app.cfg.requireTP && r.tp <= 0.0))
      s_bad.push_back(s_case + ": sent a change without a required SL or TP");
   if(open == l.open && r.sl == l.sl && r.tp == l.tp)
      s_bad.push_back(s_case + ": sent a change that changes nothing");
   double half = s.point * 0.5;
   if(std::fabs(r.sl - AiNormPrice(s, r.sl)) > half || std::fabs(r.tp - AiNormPrice(s, r.tp)) > half || std::fabs(open - AiNormPrice(s, open)) > half)
      s_bad.push_back(s_case + ": sent a price off the tick grid");
  }

//--- scenarios ---------------------------------------------------------------
static void ScenarioChartLines()
  {
   Setup("MT5's own trade lines are handed over and back");
   EXPECT(g_fake.chartI[CHART_SHOW_TRADE_LEVELS] == 0, "MT5's own trade lines are hidden while the EA runs");
   EXPECT(g_fake.chartI[CHART_DRAG_TRADE_LEVELS] == 0, "dragging MT5's own trade lines is off while the EA runs");
   g_app.Deinit(REASON_CHARTCHANGE);
   g_app.Init();
   EXPECT(g_fake.chartI[CHART_SHOW_TRADE_LEVELS] == 0, "still hidden after a timeframe change");
   g_app.Deinit(REASON_REMOVE);
   EXPECT(g_fake.chartI[CHART_SHOW_TRADE_LEVELS] == 1 && g_fake.chartI[CHART_DRAG_TRADE_LEVELS] == 1, "MT5's own lines come back when the EA is removed");

   Setup("switched off: MT5's lines stay, no trade lines drawn", false);
   AddPos(101, POSITION_TYPE_BUY, 0.10, 1.08000, 1.07750, 1.08900);
   Refresh();
   EXPECT(g_fake.chartI[CHART_SHOW_TRADE_LEVELS] == 1 && g_fake.chartI[CHART_DRAG_TRADE_LEVELS] == 1, "MT5's own lines untouched");
   EXPECT(!Exists(Obj(101, "S")), "no trade lines of ActionInna's own");
  }

static void ScenarioLinesDrawn()
  {
   Setup("a position's lines and tags");
   AddPos(101, POSITION_TYPE_BUY, 0.10, 1.08000, 1.07750, 1.08900);
   Refresh();
   EXPECT(Exists(Obj(101, "E")) && Exists(Obj(101, "S")) && Exists(Obj(101, "T")), "entry, SL and TP lines drawn");
   EXPECT(!Grabbable(Obj(101, "E")), "a position's entry line cannot be dragged");
   EXPECT(Grabbable(Obj(101, "S")) && Grabbable(Obj(101, "T")), "SL and TP lines can be taken with the mouse");
   EXPECT(!Selectable(Obj(101, "S")) && !Selectable(Obj(101, "T")), "MT5 itself drags none of them");
   EXPECT(Near(PriceOf(Obj(101, "S")), 1.07750) && Near(PriceOf(Obj(101, "T")), 1.08900), "lines at the server's levels");
   EXPECT(Has(TextOf(Obj(101, "Sx")), "SL 1.07750 | -$25.00 (-0.25%)"), "SL tag with money and %: " + TextOf(Obj(101, "Sx")));
   EXPECT(Has(TextOf(Obj(101, "Tx")), "TP 1.08900 | +$90.00 (+0.90%)"), "TP tag with money and %: " + TextOf(Obj(101, "Tx")));
   EXPECT(Has(TextOf(Obj(101, "Ex")), "BUY 0.10 @ 1.08000 | +$48.00"), "entry tag with floating profit: " + TextOf(Obj(101, "Ex")));
   EXPECT(OrderOf(kP + "XBG#r") > TopTradeObject(), "the panel is drawn over the trade lines");
   EXPECT(!CardOpen() && GhostCount() == 0, "no card and no server-level lines before a drag");
  }

static void ScenarioDragConfirm()
  {
   Setup("drag SL, then confirm");
   AddPos(101, POSITION_TYPE_BUY, 0.10, 1.08000, 1.07750, 1.08900);
   Refresh();
   Mouse(500, YOf(1.07750), 0);
   Mouse(500, YOf(1.07750), 1);
   Mouse(500, YOf(1.07650), 1);
   EXPECT(!CardOpen(), "the card waits while the line is held");
   EXPECT(Near(PriceOf(Obj(101, "S")), 1.07650), "the line follows the mouse");
   EXPECT(Has(TextOf(Obj(101, "Sx")), "SL 1.07650") && Has(TextOf(Obj(101, "Sx")), "-$35.00 (-0.35%)"), "the tag shows the money while the line is held: " + TextOf(Obj(101, "Sx")));
   Mouse(500, YOf(1.07650), 0);
   EXPECT(CardOpen(), "the card opens when the line is let go");
   EXPECT(Sent() == 0, "a drag sends nothing");
   EXPECT(PosOf(101)->sl == 1.07750, "the server still has the old SL");
   EXPECT(Exists(Obj(101, "Sg")) && Near(PriceOf(Obj(101, "Sg")), 1.07750), "the server's SL is shown as a dotted line");
   EXPECT(Has(TextOf(kP + "XMTKT#t"), "#101"), "the card names the ticket");
   EXPECT(Has(TextOf(kP + "XMSLW#t"), "was 1.07750"), "the card shows the old SL");
   Click(kP + "MODOK#tx");
   EXPECT(Sent() == 0, "Confirm right after the drop is ignored");
   Advance(350);
   Click(kP + "MODOK#tx");
   EXPECT(Sent() == 1, "Confirm sends one request");
   if(Sent() == 1)
     {
      EXPECT(Last().action == TRADE_ACTION_SLTP && Last().position == 101, "a position change is TRADE_ACTION_SLTP for its ticket");
      EXPECT(Near(Last().sl, 1.07650) && Near(Last().tp, 1.08900) && Last().symbol == string("EURUSD"), "with the new SL and the TP kept");
     }
   EXPECT(PosOf(101)->sl == 1.07650, "the server has the new SL");
   EXPECT(!CardOpen() && GhostCount() == 0, "the card and the dotted line are gone");
   EXPECT(Has(PanelStatus(), "Changed #101: SL 1.07650"), "the panel says what changed: " + PanelStatus());
   Click(kP + "MODOK#tx");
   Key(13);
   EXPECT(Sent() == 1, "nothing more is sent");
  }

static void ScenarioCancel()
  {
   Setup("drag TP, cancel with Esc and with the button");
   AddPos(101, POSITION_TYPE_BUY, 0.10, 1.08000, 1.07750, 1.08900);
   Refresh();
   Drag(Obj(101, "T"), 1.09200);
   EXPECT(CardOpen(), "card open");
   Advance(350);
   Key(27);
   EXPECT(Sent() == 0 && !CardOpen(), "Esc closes the card and sends nothing");
   EXPECT(Near(PriceOf(Obj(101, "T")), 1.08900) && GhostCount() == 0, "the TP line goes back");
   Drag(Obj(101, "T"), 1.09300);
   Advance(350);
   Click(kP + "MODX#tx");
   EXPECT(Sent() == 0 && !CardOpen() && Near(PriceOf(Obj(101, "T")), 1.08900), "Cancel does the same");
   EXPECT(Has(PanelStatus(), "Nothing was sent"), "the panel says nothing was sent");
  }

static void ScenarioTwoLevelsOneRequest()
  {
   Setup("drag SL and TP, one request");
   AddPos(101, POSITION_TYPE_BUY, 0.10, 1.08000, 1.07750, 1.08900);
   Refresh();
   Drag(Obj(101, "S"), 1.07650);
   Drag(Obj(101, "T"), 1.09100);
   Advance(350);
   Click(kP + "MODOK#tx");
   EXPECT(Sent() == 1 && Near(Last().sl, 1.07650) && Near(Last().tp, 1.09100), "both levels in one request");
  }

static void ScenarioOtherTradeDropsFirst()
  {
   Setup("dragging another trade drops the first change");
   AddPos(101, POSITION_TYPE_BUY, 0.10, 1.08000, 1.07750, 1.08900);
   AddPos(102, POSITION_TYPE_SELL, 0.20, 1.09000, 1.09300, 1.08200);
   Refresh();
   Drag(Obj(101, "S"), 1.07650);
   Drag(Obj(102, "T"), 1.08100);
   EXPECT(Near(PriceOf(Obj(101, "S")), 1.07750), "the first trade's SL goes back");
   EXPECT(Has(TextOf(kP + "XMTKT#t"), "#102"), "the card is now for the second trade");
   EXPECT(Has(PanelStatus(), "change to #101 was dropped"), "the panel says the first change was dropped: " + PanelStatus());
   Advance(350);
   Click(kP + "MODOK#tx");
   EXPECT(Sent() == 1 && Last().position == 102 && Near(Last().tp, 1.08100) && Near(Last().sl, 1.09300), "only the second change is sent");
   EXPECT(PosOf(101)->sl == 1.07750, "the first trade is untouched");
  }

static void ScenarioPendingEntry()
  {
   Setup("a pending order's entry takes SL and TP along");
   datetime exp = g_fake.time + 86400;
   AddOrd(201, ORDER_TYPE_BUY_LIMIT, 0.10, 1.08300, 1.08100, 1.08700, ORDER_TIME_SPECIFIED, exp);
   Refresh();
   EXPECT(Grabbable(Obj(201, "E")), "a pending order's entry can be dragged");
   Drag(Obj(201, "E"), 1.08200);
   EXPECT(Near(PriceOf(Obj(201, "S")), 1.08000) && Near(PriceOf(Obj(201, "T")), 1.08600), "SL and TP moved by the same distance");
   EXPECT(Exists(Obj(201, "Eg")) && Near(PriceOf(Obj(201, "Eg")), 1.08300), "the server's entry shown dotted");
   Advance(350);
   Click(kP + "MODOK#tx");
   EXPECT(Sent() == 1, "one request");
   if(Sent() == 1)
     {
      EXPECT(Last().action == TRADE_ACTION_MODIFY && Last().order == 201, "a pending change is TRADE_ACTION_MODIFY for its ticket");
      EXPECT(Near(Last().price, 1.08200) && Near(Last().sl, 1.08000) && Near(Last().tp, 1.08600), "new entry, SL and TP");
      EXPECT(Last().type_time == ORDER_TIME_SPECIFIED && Last().expiration == exp, "the order keeps its expiry");
     }
  }

static void ScenarioRefusals()
  {
   Setup("changes the checks refuse are never sent");
   g_fake.sym.orderMode = SYMBOL_ORDER_MARKET | SYMBOL_ORDER_LIMIT | SYMBOL_ORDER_SL | SYMBOL_ORDER_TP;   // no stop orders
   AddPos(101, POSITION_TYPE_BUY, 0.10, 1.08000, 1.07750, 1.08900);
   AddOrd(201, ORDER_TYPE_BUY_LIMIT, 0.10, 1.08300, 1.08100, 1.08700);
   Refresh();
   Drag(Obj(201, "E"), 1.08600);
   Advance(350);
   Click(kP + "MODOK#tx");
   Key(13);
   EXPECT(Sent() == 0, "a Buy Limit dragged above the market, on a symbol without stop orders, is not sent");
   EXPECT(Has(CardStatus(), "takes no stop orders: keep the entry below the price"), "the card says why: " + CardStatus());
   Key(27);
   Drag(Obj(101, "S"), 1.08490);
   Advance(350);
   Click(kP + "MODOK#tx");
   EXPECT(Sent() == 0, "a buy's SL above the bid is not sent");
   EXPECT(Has(CardStatus(), "Stop loss must stay below the price"), "the card says why: " + CardStatus());
   Key(27);
   Drag(Obj(101, "T"), 1.08470);
   Advance(350);
   Click(kP + "MODOK#tx");
   EXPECT(Sent() == 0, "a buy's TP below the bid is not sent");
   Key(27);
   g_fake.sym.stops = 30;
   Drag(Obj(101, "S"), 1.08460);
   Advance(350);
   Click(kP + "MODOK#tx");
   EXPECT(Sent() == 0 && Has(CardStatus(), "too close"), "a SL inside the stops level is not sent: sent " + std::to_string(Sent()) + ", " + CardStatus());
   Key(27);
   g_fake.sym.stops = 0;
  }

// MT5 can't change an order's type: a Buy Limit dragged above the market is removed, then placed
// again as a Buy Stop, with its lots, SL/TP (moved along), expiry, magic and comment.
static void ScenarioRetype()
  {
   Setup("a pending order dragged across the market becomes the other type");
   // ActionInna's own magic number here (another EA's order would get no lines).
   g_app.Deinit(REASON_REMOVE);
   g_app.cfg.magic = 77;
   g_app.Init();
   AddOrd(201, ORDER_TYPE_BUY_LIMIT, 0.10, 1.08300, 1.08100, 1.08700, ORDER_TIME_DAY);
   g_fake.ords[0].magic = 77;
   g_fake.ords[0].comment = "mine";
   Refresh();
   Drag(Obj(201, "E"), 1.08600);
   Advance(350);
   EXPECT(Has(CardStatus(), "Becomes a BUY STOP"), "the card says what will happen: " + CardStatus());
   EXPECT(Sent() == 0, "the drag sent nothing");
   Click(kP + "MODOK#tx");
   EXPECT(Sent() == 2 && g_fake.requests[0].action == TRADE_ACTION_REMOVE && g_fake.requests[0].order == 201 &&
          g_fake.requests[1].action == TRADE_ACTION_PENDING, "the old order is removed first, then the new one placed");
   const FakeOrd *o = g_fake.ords.empty() ? nullptr : &g_fake.ords[0];
   EXPECT(g_fake.ords.size() == 1 && o->ticket != 201 && o->type == ORDER_TYPE_BUY_STOP && Near(o->price, 1.08600) && Near(o->sl, 1.08400) &&
          Near(o->tp, 1.09000) && Near(o->volume, 0.10), "a Buy Stop at the dragged price, SL and TP along, the same lots");
   EXPECT(o && o->typeTime == ORDER_TIME_DAY && o->magic == 77 && o->comment == "mine", "it keeps the expiry, the owner's magic and the comment");
   EXPECT(g_fake.refusals.empty(), "the server refused nothing");

   Setup("a replacement the server refuses leaves no order, and says so");
   AddOrd(202, ORDER_TYPE_SELL_STOP, 0.20, 1.08200, 1.08400, 1.07800);
   Refresh();
   Drag(Obj(202, "E"), 1.08700);
   Advance(350);
   EXPECT(Has(CardStatus(), "Becomes a SELL LIMIT"), "a Sell Stop dragged above the market becomes a Sell Limit: " + CardStatus());
   auto keep = g_fake.onSend;
   g_fake.onSend = [keep](const MqlTradeRequest &r) {
      if(keep) keep(r);
      g_fake.forceRetcode = (r.action == TRADE_ACTION_PENDING) ? TRADE_RETCODE_INVALID_PRICE : 0;
   };
   Click(kP + "MODOK#tx");
   g_fake.onSend = keep;
   g_fake.forceRetcode = 0;
   EXPECT(g_fake.ords.empty(), "the old order was removed, the new one refused: no order");
   EXPECT(Has(PanelStatus(), "No order now: SELL STOP removed, SELL LIMIT refused"),
          "the panel says exactly that: " + PanelStatus());
  }

static void ScenarioBreakEven()
  {
   Setup("a stop past the open price is allowed");
   AddPos(101, POSITION_TYPE_BUY, 0.10, 1.08000, 1.07750, 1.08900);
   Refresh();
   Drag(Obj(101, "S"), 1.08100);
   EXPECT(Has(TextOf(Obj(101, "Sx")), "+$10.00"), "the SL tag shows the profit it locks in: " + TextOf(Obj(101, "Sx")));
   EXPECT(Has(TextOf(kP + "XRMRR#v"), "break-even or better"), "R:R says the stop is at break-even or better");
   Advance(350);
   Click(kP + "MODOK#tx");
   EXPECT(Sent() == 1 && Near(Last().sl, 1.08100), "sent");

   Setup("a sell's stop past the open price is allowed");
   AddPos(102, POSITION_TYPE_SELL, 0.10, 1.09000, 1.09300, 1.08200);
   Refresh();
   Drag(Obj(102, "S"), 1.08510);
   Advance(350);
   Click(kP + "MODOK#tx");
   EXPECT(Sent() == 1 && Near(Last().sl, 1.08510), "a sell's stop just above the ask is sent");
   Advance(800);
   Drag(Obj(102, "S"), 1.08495);
   Advance(350);
   Click(kP + "MODOK#tx");
   EXPECT(Sent() == 1, "a sell's stop below the ask is not");
  }

static void ScenarioSafetyCap()
  {
   Setup("the safety cap blocks a bigger risk, not a smaller one");
   AddPos(101, POSITION_TYPE_BUY, 2.00, 1.08000, 1.07800, 1.08900);   // risk $400 = 4%
   Refresh();
   Drag(Obj(101, "S"), 1.07700);   // $600 = 6%, above the 5% cap
   Advance(350);
   Click(kP + "MODOK#tx");
   EXPECT(Sent() == 0 && Has(CardStatus(), "safety cap"), "widening past the cap is blocked: " + CardStatus());
   Key(27);
   PosOf(101)->sl = 1.07600;   // the server now has $800 = 8%
   Refresh();
   Drag(Obj(101, "S"), 1.07700);   // 6%: still above the cap, but smaller
   Advance(350);
   Click(kP + "MODOK#tx");
   EXPECT(Sent() == 1 && Near(Last().sl, 1.07700), "tightening a stop above the cap goes through");
  }

static void ScenarioKeys()
  {
   Setup("Enter confirms, after the arm delay");
   AddPos(101, POSITION_TYPE_BUY, 0.10, 1.08000, 1.07750, 1.08900);
   Refresh();
   Drag(Obj(101, "S"), 1.07650);
   Key(13);
   EXPECT(Sent() == 0, "Enter right after the drop is ignored");
   Advance(350);
   Key(13);
   EXPECT(Sent() == 1 && Near(Last().sl, 1.07650), "Enter confirms the change");
  }

static void ScenarioTyping()
  {
   Setup("type a price on the card");
   AddPos(101, POSITION_TYPE_BUY, 0.10, 1.08000, 1.07750, 1.08900);
   Refresh();
   Click(Obj(101, "Sx"), YOf(1.07750));
   EXPECT(CardOpen(), "a click on the tag opens the card");
   EXPECT(Sent() == 0, "and sends nothing");
   Type(kP + "E_MSL", "1,07500");
   EXPECT(Near(PriceOf(Obj(101, "S")), 1.07500), "the SL line moves to the typed price");
   Click(kP + "MODOK#tx");
   EXPECT(Sent() == 0, "Confirm right after typing is ignored");
   Key(13);
   EXPECT(Sent() == 0, "so is the Enter that ended the typing");
   Advance(600);
   Click(kP + "MODOK#tx");
   EXPECT(Sent() == 1 && Near(Last().sl, 1.07500), "then it is sent");
   Advance(800);
   Click(Obj(101, "Tx"), YOf(1.08900));
   Type(kP + "E_MTP", "");
   Advance(600);
   Click(kP + "MODOK#tx");
   EXPECT(Sent() == 1 && Has(CardStatus(), "Set a take profit"), "removing a required TP is refused: " + CardStatus());
   Type(kP + "E_MTP", "abc");
   EXPECT(Has(CardStatus(), "Enter a price"), "letters are refused: " + CardStatus());
   Key(27);
  }

static void ScenarioServerSide()
  {
   Setup("the trade closes while the card is open");
   AddPos(101, POSITION_TYPE_BUY, 0.10, 1.08000, 1.07750, 1.08900);
   Refresh();
   Drag(Obj(101, "S"), 1.07650);
   g_fake.pos.clear();
   Refresh();
   EXPECT(!CardOpen() && !Exists(Obj(101, "S")), "card and lines go");
   EXPECT(Has(PanelStatus(), "#101 is closed. Nothing was changed"), "the panel says so: " + PanelStatus());
   Click(kP + "MODOK#tx");
   EXPECT(Sent() == 0, "nothing sent");

   Setup("the server's SL changes while the trader moves the TP");
   AddPos(101, POSITION_TYPE_BUY, 0.10, 1.08000, 1.07750, 1.08900);
   Refresh();
   Drag(Obj(101, "T"), 1.09100);
   Advance(350);
   PosOf(101)->sl = 1.07800;
   Refresh();
   EXPECT(Has(CardStatus(), "changed elsewhere"), "the card says the trade changed: " + CardStatus());
   Click(kP + "MODOK#tx");
   EXPECT(Sent() == 0, "Confirm waits until the new values have been shown");
   Advance(350);
   Click(kP + "MODOK#tx");
   EXPECT(Sent() == 1 && Near(Last().sl, 1.07800) && Near(Last().tp, 1.09100), "the server's new SL and the trader's TP");

   Setup("part of the position is closed while the card is open");
   AddPos(101, POSITION_TYPE_BUY, 0.10, 1.08000, 1.07750, 1.08900);
   Refresh();
   Drag(Obj(101, "S"), 1.07650);
   PosOf(101)->volume = 0.05;
   Refresh();
   EXPECT(Has(CardStatus(), "changed elsewhere") && Has(TextOf(kP + "XMTTL#t"), "0.05"), "the card shows the new size");
   Advance(350);
   Click(kP + "MODOK#tx");
   EXPECT(Sent() == 1 && Near(Last().sl, 1.07650), "the trader's SL is still sent");

   Setup("a pending order fills while the card is open");
   AddOrd(201, ORDER_TYPE_BUY_LIMIT, 0.10, 1.08300, 1.08100, 1.08700);
   Refresh();
   Drag(Obj(201, "E"), 1.08200);
   g_fake.ords.clear();
   AddPos(201, POSITION_TYPE_BUY, 0.10, 1.08300, 1.08100, 1.08700);
   Refresh();
   EXPECT(!CardOpen() && Has(PanelStatus(), "was filled"), "the card closes: " + PanelStatus());
   EXPECT(!Grabbable(Obj(201, "E")), "the filled order's entry is now fixed");
   Advance(350);
   Click(kP + "MODOK#tx");
   EXPECT(Sent() == 0, "nothing sent");
  }

static void ScenarioFailure()
  {
   Setup("the server refuses the change");
   AddPos(101, POSITION_TYPE_BUY, 0.10, 1.08000, 1.07750, 1.08900);
   Refresh();
   Drag(Obj(101, "S"), 1.07650);
   Advance(350);
   g_fake.forceRetcode = TRADE_RETCODE_INVALID_STOPS;
   Click(kP + "MODOK#tx");
   EXPECT(Sent() == 1 && CardOpen(), "the card stays open");
   EXPECT(Has(CardStatus(), "Not changed: Invalid SL or TP (10016)"), "and says why: " + CardStatus());
   EXPECT(Near(PriceOf(Obj(101, "S")), 1.07650), "the line stays where it was dropped");
   Click(kP + "MODOK#tx");
   EXPECT(Sent() == 1, "a second click while the request settles is ignored");
   Advance(750);
   g_fake.forceRetcode = 0;
   Click(kP + "MODOK#tx");
   EXPECT(Sent() == 2 && !CardOpen() && PosOf(101)->sl == 1.07650, "after the pause it can be sent again");
  }

static void ScenarioLocked()
  {
   Setup("stop-limit orders are locked");
   AddOrd(301, ORDER_TYPE_BUY_STOP_LIMIT, 0.10, 1.08800, 1.08500, 1.09200, ORDER_TIME_GTC, 0, 1.08700);
   Refresh();
   EXPECT(Exists(Obj(301, "E")) && !Grabbable(Obj(301, "E")) && !Grabbable(Obj(301, "S")) && !Grabbable(Obj(301, "T")), "no line can be dragged");
   Drag(Obj(301, "S"), 1.08400);
   Click(Obj(301, "Sx"));
   EXPECT(!CardOpen() && Sent() == 0, "no card");
   EXPECT(Has(PanelStatus(), "stop-limit"), "the panel says where to change it: " + PanelStatus());
  }

static void ScenarioDrawOrder()
  {
   Setup("a new trade's lines go under the panel");
   Refresh();
   AddPos(101, POSITION_TYPE_BUY, 0.10, 1.08000, 1.07750, 1.08900);
   Refresh();
   EXPECT(OrderOf(kP + "XBG#r") > TopTradeObject(), "the panel is drawn again on top");
   Click(kP + "E_SL");   // the trader starts typing in the panel
   AddPos(102, POSITION_TYPE_SELL, 0.10, 1.09000, 1.09300, 1.08200);
   Refresh();
   EXPECT(OrderOf(kP + "XBG#r") < OrderOf(Obj(102, "S")), "not while a field is being typed in");
   Type(kP + "E_SL", "25");
   EXPECT(OrderOf(kP + "XBG#r") > TopTradeObject(), "afterwards it is");
   ObjectDelete(0, string(Obj(101, "S")));   // the Delete key removes a selected line
   Refresh();
   EXPECT(Exists(Obj(101, "S")) && OrderOf(kP + "XBG#r") > TopTradeObject(), "a deleted line comes back, under the panel");
  }

// The app holds the lines, not MT5: a line is taken a few pixels off it or by its tag, the chart
// stays still under it, its price and money follow every move, and a press that hardly moves is a
// click.
static void ScenarioGrab()
  {
   Setup("a line is taken a few pixels off it, or by its tag");
   AddPos(101, POSITION_TYPE_BUY, 0.10, 1.08000, 1.08400, 1.08700);   // levels on screen
   Refresh();
   int y = YOf(1.08400);
   Mouse(500, y + 6, 0);
   EXPECT(WidthOf(Obj(101, "S")) == 2, "6 pixels off the SL line, it thickens: it can be taken");
   EXPECT(g_fake.chartI[CHART_MOUSE_SCROLL] == 0, "and the chart does not scroll under it");
   Mouse(500, y + 40, 0);
   EXPECT(WidthOf(Obj(101, "S")) == 1 && g_fake.chartI[CHART_MOUSE_SCROLL] == 1, "away from it, the line is thin and the chart scrolls again");

   Drag(Obj(101, "S"), 1.08300, 5);
   EXPECT(CardOpen() && Near(PriceOf(Obj(101, "S")), 1.08300), "taken 5 pixels below it, the SL moves as far as the mouse, without a jump: " + std::to_string(PriceOf(Obj(101, "S"))));
   Key(27);
   EXPECT(!CardOpen() && Near(PriceOf(Obj(101, "S")), 1.08400), "Esc puts it back");

   std::string tag = Obj(101, "Tb");
   int tx = IntOf(tag, OBJPROP_XDISTANCE) + IntOf(tag, OBJPROP_XSIZE) / 2;
   int ty = IntOf(tag, OBJPROP_YDISTANCE) + IntOf(tag, OBJPROP_YSIZE) / 2;
   Mouse(tx, ty, 0);
   Mouse(tx, ty, 1);
   Mouse(tx, YOf(1.08800), 1);
   EXPECT(g_fake.chartI[CHART_MOUSE_SCROLL] == 0, "the chart stays still while a line is held");
   EXPECT(Has(TextOf(Obj(101, "Tx")), "TP 1.08800") && Has(TextOf(Obj(101, "Tx")), "+$80.00"), "the TP taken by its tag follows the mouse, with its money: " + TextOf(Obj(101, "Tx")));
   Mouse(tx, YOf(1.08800), 0);
   EXPECT(CardOpen() && Near(PriceOf(Obj(101, "T")), 1.08800), "let go, the card opens with it");
   EXPECT(g_fake.chartI[CHART_MOUSE_SCROLL] == 1, "and the chart scrolls again");
   Key(27);

   Mouse(500, y, 0);
   Mouse(500, y + 1, 1);
   Mouse(500, y + 2, 1);
   Mouse(500, y + 2, 0);
   EXPECT(!CardOpen() && Near(PriceOf(Obj(101, "S")), 1.08400), "a press that hardly moves changes nothing");
   EXPECT(Sent() == 0, "nothing is sent by a drag");

   // A chart pan that started away from the lines goes on when it crosses one.
   Mouse(500, y + 60, 0);
   Mouse(500, y + 60, 1);
   Mouse(500, y + 2, 1);
   Mouse(500, y - 2, 1);
   EXPECT(g_fake.chartI[CHART_MOUSE_SCROLL] == 1 && Near(PriceOf(Obj(101, "S")), 1.08400), "panning across a line neither stops the chart nor takes the line");
   Mouse(500, y - 60, 0);

   // The release counts where the line was last held, not where a late button-up is reported.
   Mouse(500, y, 0);
   Mouse(500, y, 1);
   Mouse(500, YOf(1.08350), 1);
   Mouse(500, YOf(1.08000), 0);
   EXPECT(CardOpen() && Near(PriceOf(Obj(101, "S")), 1.08350), "let go, the SL stays where it was last held: " + std::to_string(PriceOf(Obj(101, "S"))));
   Key(27);

   Setup("a stop past the entry (SL+), shown while it is held");
   AddPos(101, POSITION_TYPE_BUY, 0.10, 1.08200, 1.08000, 1.08900);   // the bid is 30 pips past the entry
   Refresh();
   Mouse(500, YOf(1.08000), 0);
   Mouse(500, YOf(1.08000), 1);
   Mouse(500, YOf(1.08300), 1);
   EXPECT(Has(TextOf(Obj(101, "Sx")), "SL 1.08300") && Has(TextOf(Obj(101, "Sx")), "+$10.00"), "held past the entry, the tag shows the profit it locks in: " + TextOf(Obj(101, "Sx")));
   Mouse(500, YOf(1.08300), 0);
   Advance(350);
   Click(kP + "MODOK#tx");
   EXPECT(Sent() == 1 && Near(Last().sl, 1.08300), "and it is sent: SL+ " + CardStatus());

   Setup("price tags go right of the last candle, off the candles and off the panel");
   AddPos(101, POSITION_TYPE_BUY, 0.10, 1.08000, 1.08400, 1.08700);
   Key('B');
   Refresh();
   Refresh();   // the chart shift follows the widest tag of the frame before
   int lastBar = 0, py = 0;
   ChartTimePriceToXY(0, 0, 0, 1.08400, lastBar, py);
   int panelX = IntOf(kP + "XBG#r", OBJPROP_XDISTANCE);
   for(const std::string &box : {Obj(101, "Sb"), Obj(101, "Tb"), Obj(101, "Eb"), std::string("AINNA_T_SL#bg"), std::string("AINNA_T_TP#bg")})
     {
      int bx = IntOf(box, OBJPROP_XDISTANCE);
      int bw = IntOf(box, OBJPROP_XSIZE);
      EXPECT(bx > lastBar && bx + bw <= panelX, box + " sits right of the last candle (x " + std::to_string(lastBar) + ") and left of the panel (x " +
             std::to_string(panelX) + "): " + std::to_string(bx) + ".." + std::to_string(bx + bw));
     }
   Drag(Obj(101, "S"), 1.08350);
   EXPECT(CardOpen() && IntOf(kP + "XMBG#r", OBJPROP_XDISTANCE) + IntOf(kP + "XMBG#r", OBJPROP_XSIZE) <= IntOf(Obj(101, "Sb"), OBJPROP_XDISTANCE),
          "the card opens left of the tags, so it hides none of them");
   Key(27);
   Key(27);
   g_fake.barX = 1150;   // no room right of the last candle
   Refresh();
   int bx = IntOf(Obj(101, "Sb"), OBJPROP_XDISTANCE);
   EXPECT(bx < 100, "with no room there, a tag goes to the chart's edge away from the panel: x " + std::to_string(bx));

   // A floating panel: the chart still makes room right of the last candle for the tags.
   for(int side = 0; side < 2; side++)
     {
      Setup(side == 0 ? "a panel floating on the left still leaves the tags room off the candles"
                      : "a panel floating on the right half: the tags fit between the candles and it");
      AddPos(101, POSITION_TYPE_BUY, 0.10, 1.08000, 1.08400, 1.08700);
      Refresh();
      int px = IntOf(kP + "XBG#r", OBJPROP_XDISTANCE);
      int pyTop = IntOf(kP + "XBG#r", OBJPROP_YDISTANCE);
      int to = (side == 0) ? 20 : px - 60;
      Mouse(px + 30, pyTop + 8, 0);
      Mouse(px + 30, pyTop + 8, 1);
      Mouse(to + 30, pyTop + 40, 1);
      Mouse(to + 30, pyTop + 40, 0);
      int nx = IntOf(kP + "XBG#r", OBJPROP_XDISTANCE);
      int nw = IntOf(kP + "XBG#r", OBJPROP_XSIZE);
      EXPECT(nx + nw < g_fake.chartW - 40, "the panel floats: x " + std::to_string(nx));
      Key('B');
      Refresh();
      Refresh();
      int last = 0, ly = 0;
      ChartTimePriceToXY(0, 0, 0, 1.08400, last, ly);
      int limit = (side == 0) ? g_fake.chartW : nx;
      for(const std::string &box : {Obj(101, "Sb"), Obj(101, "Tb"), Obj(101, "Eb"), std::string("AINNA_T_SL#bg"), std::string("AINNA_T_TP#bg")})
        {
         int x0 = IntOf(box, OBJPROP_XDISTANCE);
         int x1 = x0 + IntOf(box, OBJPROP_XSIZE);
         EXPECT(x0 > last && x1 <= limit, box + " sits right of the last candle (x " + std::to_string(last) + ") and left of " +
                std::to_string(limit) + ": " + std::to_string(x0) + ".." + std::to_string(x1));
        }
      Key(27);
     }
  }

static void ScenarioOtherEas()
  {
   Setup("another EA's trades get no lines on the chart");
   AddPos(101, POSITION_TYPE_BUY, 0.10, 1.08000, 1.07750, 1.08900);
   for(ulong t = 201; t <= 230; t++)
     {
      AddPos(t, POSITION_TYPE_BUY, 0.01, 1.08000 + (double)(t - 200) * 0.00010, 0.0, 1.08900);
      g_fake.pos.back().magic = 77001;
     }
   Refresh();
   EXPECT(Shown(Obj(101, "E")) && Shown(Obj(101, "S")), "the manual trade has its lines");
   int bot = 0;
   for(auto &kv : g_fake.objs)
      if(kv.first.rfind("AINNA_O_2", 0) == 0)
         bot++;
   EXPECT(bot == 0, "the bot's 30 positions have none: " + std::to_string(bot) + " objects");

   Setup("other EAs' trades on the chart on request");
   AddPos(101, POSITION_TYPE_BUY, 0.10, 1.08000, 1.07750, 1.08900);
   AddPos(201, POSITION_TYPE_BUY, 0.01, 1.08100, 0.0, 1.08900);
   g_fake.pos.back().magic = 77001;
   g_app.Deinit(REASON_REMOVE);
   g_app.cfg.showOthers = true;
   g_app.Init();
   Refresh();
   EXPECT(Shown(Obj(201, "E")), "with \"Show other EAs' trades\" on, the bot's position has its lines");
  }

static void ScenarioPreviewDrag()
  {
   Setup("the preview's lines follow the mouse, with the risk");
   Key('B');
   Refresh();
   std::string sl = "AINNA_L_SL";
   double from = PriceOf(sl);
   std::string before = TextOf("AINNA_T_SL#tx");
   EXPECT(!Selectable(sl), "MT5 itself does not drag the preview's lines");
   Mouse(500, YOf(from) + 4, 0);
   EXPECT(WidthOf(sl) == 2, "4 pixels off it, the preview's SL thickens");
   Mouse(500, YOf(from) + 4, 1);
   Mouse(500, YOf(from - 0.00100) + 4, 1);
   EXPECT(Near(PriceOf(sl), from - 0.00100), "held, it moves as far as the mouse");
   std::string during = TextOf("AINNA_T_SL#tx");
   EXPECT(during != before && Has(during, "30.0 pips"), "and its tag shows the new distance and risk before it is let go: " + during);
   Mouse(500, YOf(from - 0.00100) + 4, 0);
   EXPECT(Near(PriceOf(sl), from - 0.00100), "let go, it stays there");
   Key(27);
  }

// MT5 draws an object that is shown again on top of the others. The preview's lines and tags are
// shown on every preview, after the panel was drawn, so they must stay under it all the same.
static bool PreviewUnderPanel()
  {
   int panel = OrderOf(kP + "XBG#r");
   for(auto &kv : g_fake.objs)
      if((kv.first.rfind("AINNA_L_", 0) == 0 || kv.first.rfind("AINNA_T_", 0) == 0) && Shown(kv.first) && kv.second.order > panel)
         return false;
   return panel > 0;
  }

static void ScenarioPreviewUnderPanel()
  {
   Setup("the preview's lines and tags stay under the panel");
   Key('B');
   Refresh();
   EXPECT(Shown("AINNA_L_SL") && Shown("AINNA_T_SL#bg"), "a BUY preview shows its SL line and tag");
   EXPECT(PreviewUnderPanel(), "and every line and tag of it is drawn under the panel");
   Key(27);
   Refresh();
   EXPECT(!Shown("AINNA_L_SL") && !Shown("AINNA_T_SL#bg"), "Esc hides them");
   Key('S');
   Refresh();
   EXPECT(Shown("AINNA_L_SL") && PreviewUnderPanel(), "shown again for a SELL, still under the panel");
   Key(27);
  }

// A field the trader clicked into goes with the panel when the panel is dragged. It used to stay
// where it was, apart from the panel, until the typing ended (up to a minute later).
static void ScenarioFieldFollowsPanel()
  {
   Setup("a field being typed in moves with the panel");
   std::string bg = kP + "XBG#r", sl = kP + "E_SL";
   int dx = IntOf(sl, OBJPROP_XDISTANCE) - IntOf(bg, OBJPROP_XDISTANCE);
   int dy = IntOf(sl, OBJPROP_YDISTANCE) - IntOf(bg, OBJPROP_YDISTANCE);
   int px = IntOf(bg, OBJPROP_XDISTANCE);
   Click(sl);   // the trader clicks into the stop loss field
   int hx = px + 40, hy = IntOf(bg, OBJPROP_YDISTANCE) + 22;   // on the panel's header
   Mouse(hx, hy, 1);
   Mouse(hx - 200, hy + 60, 1);
   Mouse(hx - 200, hy + 60, 0);
   EXPECT(IntOf(bg, OBJPROP_XDISTANCE) < px - 100, "the panel moved");
   EXPECT(IntOf(sl, OBJPROP_XDISTANCE) - IntOf(bg, OBJPROP_XDISTANCE) == dx && IntOf(sl, OBJPROP_YDISTANCE) - IntOf(bg, OBJPROP_YDISTANCE) == dy,
          "and the field went with it");
  }

// The panel's backgrounds are one painted picture; its controls are found by where the click is.
static void ScenarioPanelPicture()
  {
   Setup("a click on the panel's picture reaches the control under it");
   std::string bg = kP + "XBG#r";
   EXPECT(IntOf(bg, OBJPROP_XSIZE) > 0 && g_fake.resources > 0, "the panel is a painted picture");
   int made = g_fake.resources;
   g_fake.sym.bid += 0.00012;
   g_fake.sym.ask += 0.00012;
   Refresh();
   EXPECT(g_fake.resources == made, "a new price changes the text, not the picture: it is not painted again");
   int sx = IntOf(kP + "SELL#t2", OBJPROP_XDISTANCE) + 4, sy = IntOf(kP + "SELL#t2", OBJPROP_YDISTANCE) + 4;
   Event(CHARTEVENT_OBJECT_CLICK, sx, sy, bg);
   EXPECT(Shown("AINNA_L_ENTRY") && Has(TextOf("AINNA_T_ENTRY#tx"), "SELL"), "a click on SELL's background opens a SELL preview: " + TextOf("AINNA_T_ENTRY#tx"));
   Key(27);
   Event(CHARTEVENT_OBJECT_CLICK, IntOf(bg, OBJPROP_XDISTANCE) + 2, IntOf(bg, OBJPROP_YDISTANCE) + 2, bg);
   EXPECT(!Shown("AINNA_L_ENTRY"), "a click on the shadow round the panel does nothing");
   Event(CHARTEVENT_OBJECT_CLICK, sx, sy, kP + "XSPREAD#t");
   EXPECT(!Shown("AINNA_L_ENTRY"), "nor does a click on a label that is no control");
  }

// The box a shown label of the panel covers, from its anchor and the fake's text measure.
struct LabelBox { std::string name; int x0, y0, x1, y1; };
static std::vector<LabelBox> PanelLabels()
  {
   std::vector<LabelBox> out;
   for(auto &kv : g_fake.objs)
     {
      const std::string &n = kv.first;
      if(kv.second.type != OBJ_LABEL || n.rfind(kP, 0) != 0 || !Shown(n))
         continue;
      std::string text = TextOf(n);
      if(text.find_first_not_of(' ') == std::string::npos)
         continue;
      int pts = IntOf(n, OBJPROP_FONTSIZE);
      int w = (int)(text.size() * pts * g_fake.charWidth), h = (int)(pts * 1.3);
      int x = IntOf(n, OBJPROP_XDISTANCE), y = IntOf(n, OBJPROP_YDISTANCE), a = IntOf(n, OBJPROP_ANCHOR);
      int x0 = (a == ANCHOR_RIGHT || a == ANCHOR_RIGHT_UPPER || a == ANCHOR_RIGHT_LOWER) ? x - w : (a == ANCHOR_CENTER || a == ANCHOR_UPPER || a == ANCHOR_LOWER) ? x - w / 2 : x;
      int y0 = (a == ANCHOR_LEFT || a == ANCHOR_RIGHT || a == ANCHOR_CENTER) ? y - h / 2 : (a == ANCHOR_LEFT_LOWER || a == ANCHOR_RIGHT_LOWER || a == ANCHOR_LOWER) ? y - h : y;
      out.push_back({n, x0, y0, x0 + w, y0 + h});
     }
   return out;
  }
static std::string LabelOverlap()
  {
   std::vector<LabelBox> b = PanelLabels();
   for(size_t i = 0; i < b.size(); i++)
      for(size_t j = i + 1; j < b.size(); j++)
         if(b[i].x0 < b[j].x1 && b[j].x0 < b[i].x1 && b[i].y0 < b[j].y1 && b[j].y0 < b[i].y1)
            return b[i].name + " \"" + TextOf(b[i].name) + "\" and " + b[j].name + " \"" + TextOf(b[j].name) + "\"";
   return "";
  }

// A chart just tall enough for the full ticket gets it, also when the EA starts on it. The first
// guess at the ticket's height was too tall, and the slim layout it then took never measured the
// full one again, so the ticket stayed slim.
static void ScenarioShortChart()
  {
   Setup("the full ticket on a chart just tall enough for it");
   int full = IntOf(kP + "XBG#r", OBJPROP_YSIZE) - 12;   // the picture has a 6 px shadow margin all round
   g_app.Deinit(REASON_REMOVE);
   g_fake.Reset();
   _Symbol = string(g_fake.sym.name);
   g_fake.chartH = full + 12;
   static CAiApp fresh;   // a new EA, as MT5 makes when it is put on a chart
   fresh.cfg = DefaultCfg();
   fresh.Init();
   auto tick = [&]() { for(int i = 0; i < 3; i++) { Advance(200); fresh.Timer(); } };
   auto resized = [&](int h) { g_fake.chartH = h; int64_t l = 0; double d = 0; string s(""); fresh.ChartEvent(CHARTEVENT_CHART_CHANGE, l, d, s); tick(); };
   tick();
   EXPECT(Shown(kP + "SELL#t2"), "started on it, the EA shows the full ticket (chart " + std::to_string(g_fake.chartH) + " px, ticket " +
          std::to_string(full) + " px)");
   resized(full - 40);
   EXPECT(!Shown(kP + "SELL#t2") && Shown(kP + "MSELL#tx"), "made shorter, it takes the slim layout");
   resized(full + 7);
   EXPECT(!Shown(kP + "SELL#t2"), "1 px short of the full ticket and its 8 px margin, it stays slim");
   resized(full + 8);
   EXPECT(Shown(kP + "SELL#t2"), "and goes back to the full one as soon as it fits: its height is known while slim");
   EXPECT(full <= 440, "the full ticket is no taller than the old panel (440 px): " + std::to_string(full));
   fresh.Deinit(REASON_REMOVE);
  }

// No two words on the ticket run into each other, with narrow or wide text, in every state.
static void ScenarioNoOverlap()
  {
   for(double cw : {0.75, 1.0, 1.15})
     {
      Setup("no text on the ticket runs into other text, characters " + std::to_string(cw).substr(0, 4) + " pt wide");
      g_fake.charWidth = cw;
      Event(CHARTEVENT_CHART_CHANGE, 0, 0, "");   // laid out again with the new measure
      std::string o = LabelOverlap();
      EXPECT(o == "", "idle: " + o);
      Key('B');
      Refresh();
      o = LabelOverlap();
      EXPECT(o == "", "BUY preview: " + o);
      Click(kP + "PND#tx");
      Refresh();
      o = LabelOverlap();
      EXPECT(o == "", "Limit / Stop: " + o);
      Click(kP + "MENU#tx");
      Refresh();
      o = LabelOverlap();
      EXPECT(o == "", "menu open: " + o);
      Key(27);
     }
  }

// The modern order ticket: - and + beside the levels, Market | Limit / Stop, and a panel that is
// docked or floats anywhere, snapping to the edges.
static void ScenarioTicketControls()
  {
   Setup("the - and + beside the levels");
   EXPECT(TextOf(kP + "E_SL") == "20", "the default stop loss: " + TextOf(kP + "E_SL"));
   Click(kP + "SLINC#tx");
   EXPECT(TextOf(kP + "E_SL") == "25", "+ adds 5 pips: " + TextOf(kP + "E_SL"));
   Click(kP + "SLDEC#tx");
   Click(kP + "SLDEC#tx");
   EXPECT(TextOf(kP + "E_SL") == "15", "- takes 5 off: " + TextOf(kP + "E_SL"));
   Click(kP + "TPINC#tx");
   EXPECT(TextOf(kP + "E_TP") == "2.25", "a take profit in R moves by a quarter: " + TextOf(kP + "E_TP"));

   Setup("Market | Limit / Stop");
   EXPECT(!Shown(kP + "E_ENTRY"), "a market order has no entry field");
   Click(kP + "PND#tx");
   EXPECT(Shown(kP + "E_ENTRY") && TextOf(kP + "E_ENTRY") != "", "Limit / Stop shows the entry: " + TextOf(kP + "E_ENTRY"));
   std::string was = TextOf(kP + "E_ENTRY");
   Click(kP + "ENTRYINC#tx");
   EXPECT(TextOf(kP + "E_ENTRY") != was, "and its + moves it: " + was + " -> " + TextOf(kP + "E_ENTRY"));
   Click(kP + "PND#tx");
   EXPECT(Shown(kP + "E_ENTRY"), "pressing Limit / Stop again keeps it");
   Click(kP + "MKT#tx");
   EXPECT(!Shown(kP + "E_ENTRY"), "Market takes it away");

   Setup("dock, float, and snap back to the edge");
   std::string bg = kP + "XBG#r";
   int docked = IntOf(bg, OBJPROP_XDISTANCE);
   Click(kP + "DOCK#tx");
   int floated = IntOf(bg, OBJPROP_XDISTANCE);
   EXPECT(floated < docked - 40, "the dock button lets the panel float: x " + std::to_string(docked) + " -> " + std::to_string(floated));
   g_fake.chartW = 1000;
   Refresh();
   EXPECT(IntOf(bg, OBJPROP_XDISTANCE) == floated, "a floating panel stays where it is when the chart narrows");
   int hx = floated + 40, hy = IntOf(bg, OBJPROP_YDISTANCE) + 22;
   int target = (g_fake.chartW - 10 - IntOf(bg, OBJPROP_XSIZE) + 12) - floated - 6;   // 6 px short of the docked place
   Mouse(hx, hy, 1);
   Mouse(hx + target, hy, 1);
   Mouse(hx + target, hy, 0);
   int snapped = IntOf(bg, OBJPROP_XDISTANCE);
   g_fake.chartW = 1100;
   Refresh();
   EXPECT(IntOf(bg, OBJPROP_XDISTANCE) > snapped, "dropped near the right edge it snaps there and docks: it follows the edge again");
  }

static void ScenarioPreviewAndCard()
  {
   Setup("a new-order preview and the card at the same time");
   AddPos(101, POSITION_TYPE_BUY, 0.10, 1.08000, 1.07750, 1.08900);
   Refresh();
   Key('B');
   EXPECT(Shown("AINNA_L_ENTRY"), "the preview is open");
   Drag(Obj(101, "S"), 1.07650);
   Advance(350);
   Key(13);
   EXPECT(Sent() == 1 && Last().action == TRADE_ACTION_SLTP, "Enter goes to the card, not the preview");
   EXPECT(Shown("AINNA_L_ENTRY"), "the preview is still open");
   Advance(800);
   Key(13);
   EXPECT(Sent() == 2 && Last().action == TRADE_ACTION_DEAL, "with the card closed, Enter confirms the preview");
  }

// The price moves after the panel last drew the preview or the card, and the trader confirms before
// the next refresh: what goes out must be the type and lots on screen, or nothing.
static void ScenarioConfirmHoldsPreview()
  {
   Setup("Confirm refuses a pending order that became the other type since the preview");
   Key('P');
   Key('B');
   Advance(350);
   Refresh();
   EXPECT(Has(TextOf("AINNA_T_ENTRY#tx"), "BUY LIMIT") && Has(TextOf("AINNA_T_ENTRY#tx"), "1.08400"),
          "the preview shows a BUY LIMIT at 1.08400: " + TextOf("AINNA_T_ENTRY#tx"));
   g_fake.sym.bid = 1.08370;
   g_fake.sym.ask = 1.08390;
   Key(13);
   EXPECT(Sent() == 0, "nothing is sent: the price crossed the entry after the preview was drawn");
   EXPECT(Has(PanelStatus(), "now a BUY STOP"), "the panel says what it would be now: " + PanelStatus());
   Key(13);
   EXPECT(Sent() == 0, "an immediate second Confirm waits until the new preview has shown");
   Advance(350);
   Refresh();
   Key(13);
   EXPECT(Sent() == 1 && Last().action == TRADE_ACTION_PENDING && Last().type == ORDER_TYPE_BUY_STOP && Near(Last().price, 1.08400),
          "confirmed again once shown, it goes out as the BUY STOP");

   Setup("Confirm refuses a market order whose lots changed since the preview");
   Key('B');
   Click(kP + "SLMODE#tx");
   Advance(350);
   Refresh();
   g_fake.sym.bid = 1.08530;
   g_fake.sym.ask = 1.08550;
   Key(13);
   EXPECT(Sent() == 0, "nothing is sent: with the SL at a price, the new ask makes it 0.40 lots, the preview said 0.50");
   EXPECT(Has(PanelStatus(), "Lots changed") && Has(PanelStatus(), "0.50") && Has(PanelStatus(), "0.40"),
          "the panel says the lots changed, from and to: " + PanelStatus());
   Advance(350);
   Refresh();
   Key(13);
   EXPECT(Sent() == 1 && Last().action == TRADE_ACTION_DEAL && Near(Last().volume, 0.40), "confirmed again once shown, 0.40 lots go out");

   Setup("the change card refuses a pending order that became the other type since it was drawn");
   AddOrd(201, ORDER_TYPE_BUY_LIMIT, 0.10, 1.08300, 1.08100, 1.08700);
   Refresh();
   Drag(Obj(201, "E"), 1.08450);
   Advance(350);
   Refresh();
   EXPECT(!Has(CardStatus(), "Becomes"), "the card shows a plain change of the BUY LIMIT: " + CardStatus());
   g_fake.sym.bid = 1.08410;
   g_fake.sym.ask = 1.08430;
   Click(kP + "MODOK#tx");
   EXPECT(Sent() == 0 && g_fake.ords.size() == 1 && g_fake.ords[0].type == ORDER_TYPE_BUY_LIMIT, "nothing is removed or placed");
   EXPECT(Has(CardStatus(), "now a BUY STOP"), "the card says what it would be now: " + CardStatus());
   Click(kP + "MODOK#tx");
   EXPECT(Sent() == 0, "an immediate second Confirm waits until the card has shown it");
   Advance(350);
   Refresh();
   Click(kP + "MODOK#tx");
   EXPECT(Sent() == 2 && g_fake.ords.size() == 1 && g_fake.ords[0].type == ORDER_TYPE_BUY_STOP && Near(g_fake.ords[0].price, 1.08450),
          "confirmed again once shown, the BUY LIMIT is replaced by a BUY STOP");
  }

static void ScenarioTimeframeChange()
  {
   Setup("a timeframe change drops an open change");
   AddPos(101, POSITION_TYPE_BUY, 0.10, 1.08000, 1.07750, 1.08900);
   Refresh();
   Drag(Obj(101, "S"), 1.07650);
   g_app.Deinit(REASON_CHARTCHANGE);
   g_app.Init();
   Refresh();
   EXPECT(!CardOpen() && Sent() == 0 && Near(PriceOf(Obj(101, "S")), 1.07750), "no card, nothing sent, lines at the server's levels");
  }

static void ScenarioTemplate()
  {
   Setup("a saved template keeps MT5's own trade lines");
   Click(kP + "PIN#tx");
   g_app.Timer();
   g_app.Timer();
   EXPECT(g_fake.templates.size() == 1 && g_fake.levelsAtSave == 1, "MT5's lines were on when the template was saved");
   EXPECT(g_fake.chartI[CHART_SHOW_TRADE_LEVELS] == 0, "and off again afterwards");
  }

// A market order that fills away from its planned price. The order carries its SL and TP, a second
// request moves them as the SL mode says, and the panel says what the stop risks now. EURUSD at
// $10,000: 1% with a 20-pip stop is 0.50 lots, $100.
static void ScenarioSlippage()
  {
   Setup("slippage: an SL in pips moves with the fill");
   g_fake.slip = 0.00030;
   Key('B');
   Advance(350);
   Key(13);
   EXPECT(g_fake.pos.size() == 1 && Sent() == 2, "one order, then one change: sent " + std::to_string(Sent()));
   if(Sent() == 2 && g_fake.pos.size() == 1)
     {
      const FakePos &p = g_fake.pos[0];
      EXPECT(g_fake.requests[0].sl > 0.0 && g_fake.requests[0].tp > 0.0, "the order itself carried SL and TP");
      EXPECT(Near(p.open, 1.08530) && Near(p.sl, 1.08330) && Near(p.tp, 1.08930), "SL 20 pips and TP 2R from the fill: open " +
             std::to_string(p.open) + ", SL " + std::to_string(p.sl) + ", TP " + std::to_string(p.tp));
     }
   EXPECT(PanelStatus() == "Filled 3.0 pips worse. SL/TP moved: risk $100.00 as planned", "the panel says so, in full: " + PanelStatus());

   Setup("slippage: an SL set as a price stays, a TP in R follows");
   g_fake.slip = 0.00030;
   Key('B');
   Click(kP + "SLMODE#tx");
   Advance(350);
   Key(13);
   EXPECT(g_fake.pos.size() == 1 && Sent() == 2, "one order, then the TP change");
   if(g_fake.pos.size() == 1)
      EXPECT(Near(g_fake.pos[0].sl, 1.08300) && Near(g_fake.pos[0].tp, 1.08990), "SL where it was set, TP 2R from the fill and that SL: SL " +
             std::to_string(g_fake.pos[0].sl) + ", TP " + std::to_string(g_fake.pos[0].tp));
   EXPECT(PanelStatus() == "Filled 3.0 pips worse. SL kept, TP moved: risk $115.00 (plan $100.00)", "the panel says so, in full: " + PanelStatus());

   Setup("slippage: keep my prices");
   g_app.cfg.slipPolicy = AI_SLIP_KEEP_PRICES;
   g_fake.slip = 0.00030;
   Key('B');
   Advance(350);
   Key(13);
   EXPECT(Sent() == 1 && g_fake.pos.size() == 1 && Near(g_fake.pos[0].sl, 1.08300), "nothing moves after the order");
   EXPECT(PanelStatus() == "Filled 3.0 pips worse. SL/TP kept: risk $115.00 (plan $100.00)", "the panel says so, in full: " + PanelStatus());

   Setup("slippage: a better fill");
   g_fake.slip = -0.00020;
   Key('B');
   Advance(350);
   Key(13);
   EXPECT(Sent() == 2 && g_fake.pos.size() == 1 && Near(g_fake.pos[0].sl, 1.08280), "the SL follows down");
   EXPECT(PanelStatus() == "Filled 2.0 pips better. SL/TP moved: risk $100.00 as planned", "the panel says so, in full: " + PanelStatus());

   Setup("slippage: the broker's freeze level blocks the move");
   g_fake.slip = 0.00030;
   g_fake.sym.freeze = 300;
   Key('B');
   Advance(350);
   Key(13);
   EXPECT(Sent() == 1 && g_fake.pos.size() == 1 && Near(g_fake.pos[0].sl, 1.08300), "no change is sent; the order's own SL stays");
   EXPECT(PanelStatus() == "Filled 3.0 pips worse. SL/TP not moved: risk $115.00 (plan $100.00)", "the panel says so, in full: " + PanelStatus());

   Setup("slippage: a netting order that joins the open position");
   g_fake.marginMode = ACCOUNT_MARGIN_MODE_RETAIL_NETTING;
   g_fake.slip = 0.00030;
   AddPos(101, POSITION_TYPE_BUY, 0.10, 1.08000, 1.07750, 1.08900);
   Refresh();
   Key('B');
   Advance(350);
   Key(13);
   EXPECT(Sent() == 1 && g_fake.pos.size() == 1, "the order joins the position; no change follows");
   EXPECT(Has(PanelStatus(), "SL/TP not moved"), "the panel says so: " + PanelStatus());
  }

// The same orders at every broker profile, through the real panel: a market BUY, a market SELL and
// a pending BUY LIMIT. Each is accepted by a server that applies that broker's rules, or refused on
// the panel with the reason and never sent.
static void ScenarioBrokers()
  {
   for(int b = 0; b < kBrokerCount; b++)
     {
      const BrokerProfile &pr = kBrokers[b];
      Setup(std::string("broker: ") + pr.name, true, &pr);
      size_t sent = Sent();
      Key('B');
      Advance(350);
      Key(13);
      Refresh();
      if(!(pr.orderMode & SYMBOL_ORDER_SL) || !(pr.orderMode & SYMBOL_ORDER_TP))
        {
         EXPECT(Sent() == sent, "a symbol that takes no SL or TP: nothing is sent while both are required");
         EXPECT(Has(PanelStatus(), "does not accept a stop loss"), "and the panel says why: " + PanelStatus());
         Key(27);
         continue;
        }
      EXPECT(g_fake.pos.size() == 1 && (Has(PanelStatus(), "filled at") || Has(PanelStatus(), "Filled ")), "the market BUY is filled: " + PanelStatus());
      Advance(800);
      Refresh();

      sent = Sent();
      Key('S');
      Advance(350);
      Key(13);
      Refresh();
      if(BrokerHedging(pr) && !pr.hedgeAllowed)
        {
         EXPECT(Sent() == sent && Has(PanelStatus(), "allows no opposite positions"), "an opposite SELL is refused on the panel: " + PanelStatus());
         Key(27);
        }
      else if(BrokerHedging(pr))
         EXPECT(g_fake.pos.size() == 2, "the SELL opens a second position: " + PanelStatus());
      else
         EXPECT(Sent() > sent && g_fake.pos.size() <= 1, "netting: the SELL goes into the symbol's one position: " + PanelStatus());
      Advance(800);
      Refresh();

      size_t orders = g_fake.ords.size();
      Key('P');
      Key('B');
      Advance(350);
      Key(13);
      Refresh();
      EXPECT(g_fake.ords.size() == orders + 1 && Has(PanelStatus(), "placed at"), "the BUY LIMIT is placed: " + PanelStatus());
     }
  }

//--- fuzz --------------------------------------------------------------------
static double Norm5(double p) { return std::round(p * 100000.0) / 100000.0; }

// When no change is open, every line shows what the server has, and nothing sits behind as dotted.
static std::string s_lastAction;

static void CheckLevel(ulong t, const char *level, double server, const char *what)
  {
   std::string n = Obj(t, level);
   bool ok = (server > 0.0) ? (Exists(n) && Near(PriceOf(n), server)) : !Exists(n);
   EXPECT(ok, std::string(what) + " #" + std::to_string(t) + ": server " + std::to_string(server) + ", line " +
          (Exists(n) ? std::to_string(PriceOf(n)) : std::string("none")) + " after " + s_lastAction);
  }

static void CheckLinesMatchServer()
  {
   EXPECT(GhostCount() == 0, "no dotted server-level lines while no change is open, after " + s_lastAction);
   for(auto &p : g_fake.pos)
     {
      CheckLevel(p.ticket, "E", p.open, "position entry line");
      CheckLevel(p.ticket, "S", p.sl, "position SL line");
      CheckLevel(p.ticket, "T", p.tp, "position TP line");
     }
   for(auto &o : g_fake.ords)
     {
      CheckLevel(o.ticket, "E", o.price, "order entry line");
      CheckLevel(o.ticket, "S", o.sl, "order SL line");
      CheckLevel(o.ticket, "T", o.tp, "order TP line");
     }
  }

static void Fuzz(int iterations, unsigned seed)
  {
   std::mt19937 rng(seed);
   auto R = [&](double a, double b) { return std::uniform_real_distribution<double>(a, b)(rng); };
   auto I = [&](int a, int b) { return std::uniform_int_distribution<int>(a, b)(rng); };
   for(int it = 0; it < iterations; it++)
     {
      const BrokerProfile &broker = kBrokers[I(0, kBrokerCount - 1)];
      Setup("fuzz " + std::to_string(seed) + "/" + std::to_string(it) + " at " + broker.name, true, &broker);
      bool netting = !BrokerHedging(broker);
      g_fake.sym.stops = I(0, 1) ? 0 : I(1, 40);
      g_fake.sym.freeze = (I(0, 3) == 0) ? I(1, 30) : 0;
      g_app.cfg.maxRiskPct = (I(0, 3) == 0) ? 0.0 : R(0.5, 8.0);
      g_app.cfg.commissionRT = I(0, 1) ? 0.0 : R(0.0, 7.0);
      ulong ticket = 1000;
      auto addTrade = [&]() {
         double bid = g_fake.sym.bid, ask = g_fake.sym.ask;
         int kind = I(0, 9);
         double sl = 0.0, tp = 0.0;
         if(kind < 5 && netting && !g_fake.pos.empty())
            kind = 5;   // a netting account has one position per symbol
         if(kind < 5)
           {
            int type = I(0, 1);
            int side = (type == POSITION_TYPE_BUY) ? 1 : -1;
            double open = Norm5(bid + R(-0.003, 0.003));
            if(I(0, 7)) sl = Norm5(open - side * R(0.0005, 0.004));
            if(I(0, 7)) tp = Norm5(open + side * R(0.0005, 0.008));
            AddPos(++ticket, type, 0.01 * I(1, 300), open, sl, tp);
            return;
           }
         int types[] = {ORDER_TYPE_BUY_LIMIT, ORDER_TYPE_BUY_STOP, ORDER_TYPE_SELL_LIMIT, ORDER_TYPE_SELL_STOP, ORDER_TYPE_BUY_STOP_LIMIT};
         int type = types[I(0, (kind == 9) ? 4 : 3)];
         bool buy = (type == ORDER_TYPE_BUY_LIMIT || type == ORDER_TYPE_BUY_STOP || type == ORDER_TYPE_BUY_STOP_LIMIT);
         bool below = (type == ORDER_TYPE_BUY_LIMIT || type == ORDER_TYPE_SELL_STOP);
         double ref = buy ? ask : bid;
         double price = Norm5(below ? ref - R(0.0003, 0.004) : ref + R(0.0003, 0.004));
         int side = buy ? 1 : -1;
         if(I(0, 7)) sl = Norm5(price - side * R(0.0005, 0.004));
         if(I(0, 7)) tp = Norm5(price + side * R(0.0005, 0.008));
         int tt = I(0, 3);
         AddOrd(++ticket, type, 0.01 * I(1, 300), price, sl, tp, tt, (tt >= 2) ? g_fake.time + 86400 * I(1, 30) : 0,
                (type == ORDER_TYPE_BUY_STOP_LIMIT) ? Norm5(price - 0.0005) : 0.0);
      };
      int n = I(1, 4);
      for(int k = 0; k < n; k++)
         addTrade();
      Refresh();
      for(int step = 0; step < 80; step++)
        {
         size_t before = Sent();
         bool confirm = false;
         ulong t = 0;
         int pick = (int)(g_fake.pos.size() + g_fake.ords.size());
         if(pick > 0)
           {
            int k = I(0, pick - 1);
            t = (k < (int)g_fake.pos.size()) ? g_fake.pos[k].ticket : g_fake.ords[k - g_fake.pos.size()].ticket;
           }
         const char *levels[] = {"E", "S", "T"};
         int a = I(0, 17);
         bool cardWasOpen = CardOpen();
         s_lastAction = "action " + std::to_string(a) + " on #" + std::to_string(t);
         if(a <= 5 && t != 0)
           {
            std::string name = Obj(t, levels[I(0, 2)]);
            if(Exists(name))
              {
               double to = Norm5(g_fake.sym.bid + R(-0.006, 0.006));
               int off = I(-6, 6);
               s_lastAction = "drag " + name + " to " + std::to_string(to) + " from " + std::to_string(off) + " px off the line";
               Drag(name, to, off);
              }
           }
         else if(a == 6 && t != 0)
            Click(Obj(t, I(0, 1) ? "Sx" : (I(0, 1) ? "Tb" : "Ex")), I(0, 700));
         else if(a == 7 || a == 8)
           {
            Click(kP + "MODOK#tx");
            confirm = true;
           }
         else if(a == 9)
            Click(kP + "MODX#tx");
         else if(a == 10)
           {
            Key(13);
            confirm = true;
           }
         else if(a == 11)
            Key(27);
         else if(a == 12 && CardOpen())
           {
            const char *fields[] = {"E_MENTRY", "E_MSL", "E_MTP"};
            std::string f = kP + fields[I(0, 2)];
            if(Exists(f) && Shown(f))
              {
               int v = I(0, 9);
               std::string text = (v == 0) ? "" : (v == 1 ? "abc" : std::to_string(Norm5(g_fake.sym.bid + R(-0.006, 0.006))));
               Type(f, text);
              }
           }
         else if(a == 13 && pick > 0)
           {
            int what = I(0, 3);
            if(what == 0 && !g_fake.pos.empty())
               g_fake.pos.erase(g_fake.pos.begin() + I(0, (int)g_fake.pos.size() - 1));
            else if(what == 1 && !g_fake.ords.empty())
               g_fake.ords.erase(g_fake.ords.begin() + I(0, (int)g_fake.ords.size() - 1));
            else if(what == 2 && !g_fake.pos.empty())
              {
               FakePos &p = g_fake.pos[I(0, (int)g_fake.pos.size() - 1)];
               int side = (p.type == POSITION_TYPE_BUY) ? 1 : -1;
               p.sl = Norm5(g_fake.sym.bid - side * R(0.0005, 0.004));
              }
            else
               addTrade();
           }
         else if(a == 14)
           {
            double spread = g_fake.sym.ask - g_fake.sym.bid;
            g_fake.sym.bid = Norm5(g_fake.sym.bid + R(-0.0008, 0.0008));
            g_fake.sym.ask = Norm5(g_fake.sym.bid + spread);
           }
         else if(a == 15)
            Advance(I(0, 1200));
         else if(a == 16)
            g_fake.forceRetcode = (I(0, 3) == 0) ? (I(0, 1) ? TRADE_RETCODE_INVALID_STOPS : 10029) : 0;
         else if(a == 17)
           {
            if(I(0, 1))
               Key(I(0, 1) ? 'B' : 'S');
            else
              {
               Click(kP + "CONFIRM#tx");
               confirm = true;
              }
           }
         Refresh();
         EXPECT(g_fake.chartI[CHART_SHOW_TRADE_LEVELS] == 0 && g_fake.chartI[CHART_DRAG_TRADE_LEVELS] == 0, "MT5's own trade lines stay off");
         EXPECT(confirm || Sent() == before, "nothing is sent without a Confirm click or key");
         EXPECT(OrderOf(kP + "XBG#r") > TopTradeObject(), "the panel stays over the trade lines");
         if(Sent() > before)
           {
            // A change from the card, not one that moved a new order's SL/TP after slippage.
            const MqlTradeRequest &r = Last();
            bool viaCard = (a == 7 || a == 8 || (a == 10 && cardWasOpen));
            bool change = viaCard && (r.action == TRADE_ACTION_SLTP || r.action == TRADE_ACTION_MODIFY);
            if(change && g_fake.forceRetcode == 0)
               EXPECT(!CardOpen(), "the card closes after a change goes through");
            if(change && g_fake.forceRetcode != 0)
               EXPECT(CardOpen(), "the card stays open after a refused change");
           }
         if(!CardOpen())
            CheckLinesMatchServer();
        }
     }
  }

int main(int argc, char **argv)
  {
   MqlTrapZeroDivide();
   int iterations = (argc > 1) ? atoi(argv[1]) : 300;
   unsigned seed = (argc > 2) ? (unsigned)atoi(argv[2]) : 20261021u;
   g_fake.onSend = CheckRequest;

   ScenarioChartLines();
   ScenarioLinesDrawn();
   ScenarioDragConfirm();
   ScenarioCancel();
   ScenarioTwoLevelsOneRequest();
   ScenarioOtherTradeDropsFirst();
   ScenarioPendingEntry();
   ScenarioRetype();
   ScenarioRefusals();
   ScenarioBreakEven();
   ScenarioSafetyCap();
   ScenarioKeys();
   ScenarioTyping();
   ScenarioServerSide();
   ScenarioFailure();
   ScenarioLocked();
   ScenarioDrawOrder();
   ScenarioGrab();
   ScenarioPreviewDrag();
   ScenarioPreviewUnderPanel();
   ScenarioFieldFollowsPanel();
   ScenarioPanelPicture();
   ScenarioTicketControls();
   ScenarioNoOverlap();
   ScenarioShortChart();
   ScenarioOtherEas();
   ScenarioPreviewAndCard();
   ScenarioConfirmHoldsPreview();
   ScenarioTimeframeChange();
   ScenarioTemplate();
   ScenarioSlippage();
   ScenarioBrokers();
   int named = s_pass + s_fail;
   int namedFail = s_fail;
   printf("app scenarios: %d checks, %d failed\n", named, namedFail);

   Fuzz(iterations, seed);
   CheckServerRefusals();
   printf("app fuzz: %d iterations x 80 steps (seed %u), %d checks, %d failed\n", iterations, seed, s_pass + s_fail - named, s_fail - namedFail);

   for(size_t i = 0; i < s_bad.size() && i < 30; i++)
      printf("BAD REQUEST %s\n", s_bad[i].c_str());
   printf("server checked %d requests: %d should never have been sent\n", s_checked, (int)s_bad.size());
   return (s_fail == 0 && s_bad.empty()) ? 0 : 1;
  }
