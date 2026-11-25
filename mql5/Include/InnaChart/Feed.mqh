//+------------------------------------------------------------------+
//| InnaChart - the feed: this terminal's bars and prices        |
//+------------------------------------------------------------------+
// The InnaChart service runs this. It connects to InnaChart.exe through a named pipe and
// answers the screen's requests with the terminal's own data: bars from CopyRates (the same bars as
// MT5's charts, in the broker's server time), the last bar of each watched chart and the quotes of
// the watched symbols as they change. It never trades and never sends the account number.
#ifndef INNACHART_FEED_MQH
#define INNACHART_FEED_MQH

#include "Json.mqh"

#define IC_PIPE          "\\\\.\\pipe\\InnaChart.Feed"
#define IC_MAX_FRAME     1048576   // bytes in one frame, as the host allows
#define IC_MAX_BARS      5000      // bars in one history reply
#define IC_QUOTE_MS      250       // a symbol's quote at most this often
#define IC_HISTORY_WAIT  15000     // ms to wait for history MT5 is still downloading
#define IC_MAX_WATCH     16        // charts kept live at once
#define IC_MAX_QUOTES    200       // symbols whose quotes are sent
#define IC_MAX_PENDING   32        // history requests waiting at once
#define IC_MAX_FOUND     60

//--- The pipe to InnaChart.exe. Frames are a 4-byte little-endian length and UTF-8 JSON. Reads
//--- wait for nothing: FileSize tells how many bytes have arrived. A host that went away shows
//--- when a write fails.
class CIcPipe
  {
private:
   int               m_h;
   int               m_need;     // length of the frame being read, -1 = its length not read yet
   bool              m_broken;

public:
                     CIcPipe() : m_h(INVALID_HANDLE), m_need(-1), m_broken(false) {}

   bool              IsOpen() const { return m_h != INVALID_HANDLE; }
   bool              Broken() const { return m_broken; }

   // Fails at once when InnaChart.exe isn't running.
   bool              Open()
     {
      Close();
      m_h = FileOpen(IC_PIPE, FILE_READ | FILE_WRITE | FILE_BIN);
      return m_h != INVALID_HANDLE;
     }

   void              Close()
     {
      if(m_h != INVALID_HANDLE)
         FileClose(m_h);
      m_h = INVALID_HANDLE;
      m_need = -1;
      m_broken = false;
     }

   bool              Send(const string json)
     {
      if(m_h == INVALID_HANDLE || m_broken)
         return false;
      uchar buf[];
      int n = StringToCharArray(json, buf, 0, WHOLE_ARRAY, CP_UTF8) - 1;   // without the closing zero
      if(n <= 0 || n > IC_MAX_FRAME)
         return false;
      ResetLastError();
      if(FileWriteInteger(m_h, n) != 4 || FileWriteArray(m_h, buf, 0, n) != (uint)n)
        {
         m_broken = true;
         return false;
        }
      FileFlush(m_h);
      return true;
     }

   // Waits for the next frame's length to arrive (the program sends an empty frame about every
   // millisecond while a screen is open, so this wakes the feed far sooner than Sleep, which Windows
   // rounds up to about 15 ms).
   void              WaitFrame()
     {
      if(m_h == INVALID_HANDLE || m_broken || m_need >= 0 || FileSize(m_h) >= 4)
         return;
      ResetLastError();
      int len = FileReadInteger(m_h);
      if(GetLastError() != 0 || len < 0 || len > IC_MAX_FRAME)
        {
         m_broken = true;
         return;
        }
      m_need = len;
     }

   // The frames that have arrived whole.
   int               Receive(string &lines[])
     {
      ArrayResize(lines, 0);
      int count = 0;
      for(int guard = 0; guard < 64 && m_h != INVALID_HANDLE && !m_broken; guard++)
        {
         ulong avail = FileSize(m_h);
         if(m_need < 0)
           {
            if(avail < 4)
               break;
            ResetLastError();
            int len = FileReadInteger(m_h);
            if(GetLastError() != 0 || len < 0 || len > IC_MAX_FRAME)
              {
               m_broken = true;
               break;
              }
            m_need = len;
            continue;
           }
         if(avail < (ulong)m_need)
            break;
         string line = "";
         if(m_need > 0)
           {
            uchar buf[];
            ResetLastError();
            int got = (int)FileReadArray(m_h, buf, 0, m_need);
            if(got != m_need)
              {
               m_broken = true;
               break;
              }
            line = CharArrayToString(buf, 0, got, CP_UTF8);
           }
         m_need = -1;
         ArrayResize(lines, count + 1, 8);
         lines[count] = line;
         count++;
        }
      return count;
     }
  };

//--- Timeframes by the names MT5 shows (M1 ... MN1; MN is taken for MN1 too).
bool IcTimeframe(const string name, ENUM_TIMEFRAMES &tf)
  {
   string n[] = {"M1", "M2", "M3", "M4", "M5", "M6", "M10", "M12", "M15", "M20", "M30",
                 "H1", "H2", "H3", "H4", "H6", "H8", "H12", "D1", "W1", "MN1", "MN"
                };
   ENUM_TIMEFRAMES t[] = {PERIOD_M1, PERIOD_M2, PERIOD_M3, PERIOD_M4, PERIOD_M5, PERIOD_M6, PERIOD_M10,
                          PERIOD_M12, PERIOD_M15, PERIOD_M20, PERIOD_M30, PERIOD_H1, PERIOD_H2, PERIOD_H3,
                          PERIOD_H4, PERIOD_H6, PERIOD_H8, PERIOD_H12, PERIOD_D1, PERIOD_W1, PERIOD_MN1, PERIOD_MN1
                         };
   for(int i = 0; i < ArraySize(n); i++)
      if(n[i] == name)
        {
         tf = t[i];
         return true;
        }
   return false;
  }

//--- One bar as the screen reads it: [time, open, high, low, close, tick volume].
string IcBarRow(const MqlRates &r, const int digits)
  {
   return "[" + IntegerToString((long)r.time) + "," + DoubleToString(r.open, digits) + "," +
          DoubleToString(r.high, digits) + "," + DoubleToString(r.low, digits) + "," +
          DoubleToString(r.close, digits) + "," + IntegerToString(r.tick_volume) + "]";
  }

//--- Splits "a\nb\nc" into its non-empty lines.
int IcLines(const string text, string &out[])
  {
   string parts[];
   int n = StringSplit(text, '\n', parts);
   ArrayResize(out, 0);
   int k = 0;
   for(int i = 0; i < n; i++)
      if(parts[i] != "")
        {
         ArrayResize(out, k + 1);
         out[k++] = parts[i];
        }
   return k;
  }

// Watched charts, quotes and history requests are objects held by pointer: they are kept, moved
// and dropped without copying their strings (see CONTRIBUTING.md).
class CIcWatch
  {
public:
   string            sym;
   string            tfName;
   ENUM_TIMEFRAMES   tf;
   int               digits;
   long              tickMsc;   // the symbol's last tick when the bar was last checked
   double            bid;       // and its prices
   double            ask;
   MqlRates          last;      // the bar last sent
  };

class CIcQuote
  {
public:
   string            sym;
   int               digits;
   double            bid;
   double            ask;
   ulong             sentAt;
   double            prevClose;   // the previous day's close, for the day's change
   ulong             prevAt;
  };

class CIcPending
  {
public:
   long              id;
   string            sym;
   string            tfName;
   ENUM_TIMEFRAMES   tf;
   long              before;
   int               count;
   ulong             deadline;
   ulong             nextTry;
  };

class CIcFeed
  {
private:
   CIcPipe           m_pipe;
   CIcWatch         *m_watch[];
   CIcQuote         *m_quotes[];
   CIcPending       *m_pending[];
   ulong             m_lastTry;
   ulong             m_lastClock;
   double            m_balance;
   double            m_equity;
   bool              m_pulsed;   // the program sends empty frames to wake the feed
   int               m_mwCount;  // symbols in Market Watch when the list was last sent

   void              Reset()
     {
      for(int i = 0; i < ArraySize(m_watch); i++)
         delete m_watch[i];
      for(int i = 0; i < ArraySize(m_quotes); i++)
         delete m_quotes[i];
      for(int i = 0; i < ArraySize(m_pending); i++)
         delete m_pending[i];
      ArrayResize(m_watch, 0);
      ArrayResize(m_quotes, 0);
      ArrayResize(m_pending, 0);
      m_balance = -1;
      m_equity = -1;
      m_lastClock = 0;
      m_pulsed = false;
     }

   void              Error(const long id, const string why)
     {
      m_pipe.Send("{\"t\":\"error\",\"id\":" + IntegerToString(id) + ",\"error\":" + IcJsonQuote(why) + "}");
     }

   void              SendHello()
     {
      m_pipe.Send("{\"t\":\"hello\",\"v\":1,\"company\":" + IcJsonQuote(AccountInfoString(ACCOUNT_COMPANY)) +
                  ",\"server\":" + IcJsonQuote(AccountInfoString(ACCOUNT_SERVER)) +
                  ",\"currency\":" + IcJsonQuote(AccountInfoString(ACCOUNT_CURRENCY)) +
                  ",\"build\":" + IntegerToString(TerminalInfoInteger(TERMINAL_BUILD)) +
                  ",\"maxBars\":" + IntegerToString(TerminalInfoInteger(TERMINAL_MAXBARS)) +
                  ",\"now\":" + IntegerToString((long)TimeTradeServer()) + ",\"pulse\":true}");
     }

   void              SendSymbols()
     {
      string s = "{\"t\":\"symbols\",\"list\":[";
      int n = SymbolsTotal(true);
      m_mwCount = n;
      for(int i = 0; i < n; i++)
        {
         string name = SymbolName(i, true);
         if(i > 0)
            s += ",";
         s += "{\"name\":" + IcJsonQuote(name) + ",\"desc\":" + IcJsonQuote(SymbolInfoString(name, SYMBOL_DESCRIPTION)) +
              ",\"digits\":" + IntegerToString(SymbolInfoInteger(name, SYMBOL_DIGITS)) + "}";
        }
      m_pipe.Send(s + "]}");
     }

   void              SendSpec(const long id, const string sym)
     {
      if(!SymbolSelect(sym, true))
        {
         Error(id, "Unknown symbol " + sym);
         return;
        }
      m_pipe.Send("{\"t\":\"spec\",\"id\":" + IntegerToString(id) + ",\"sym\":" + IcJsonQuote(sym) +
                  ",\"desc\":" + IcJsonQuote(SymbolInfoString(sym, SYMBOL_DESCRIPTION)) +
                  ",\"digits\":" + IntegerToString(SymbolInfoInteger(sym, SYMBOL_DIGITS)) +
                  ",\"point\":" + IcJsonNum(SymbolInfoDouble(sym, SYMBOL_POINT)) +
                  ",\"tickSize\":" + IcJsonNum(SymbolInfoDouble(sym, SYMBOL_TRADE_TICK_SIZE)) +
                  ",\"tickValue\":" + IcJsonNum(SymbolInfoDouble(sym, SYMBOL_TRADE_TICK_VALUE_LOSS)) +
                  ",\"tickValueProfit\":" + IcJsonNum(SymbolInfoDouble(sym, SYMBOL_TRADE_TICK_VALUE_PROFIT)) +
                  ",\"contract\":" + IcJsonNum(SymbolInfoDouble(sym, SYMBOL_TRADE_CONTRACT_SIZE)) +
                  ",\"volMin\":" + IcJsonNum(SymbolInfoDouble(sym, SYMBOL_VOLUME_MIN)) +
                  ",\"volStep\":" + IcJsonNum(SymbolInfoDouble(sym, SYMBOL_VOLUME_STEP)) +
                  ",\"volMax\":" + IcJsonNum(SymbolInfoDouble(sym, SYMBOL_VOLUME_MAX)) +
                  ",\"profitCcy\":" + IcJsonQuote(SymbolInfoString(sym, SYMBOL_CURRENCY_PROFIT)) +
                  ",\"accountCcy\":" + IcJsonQuote(AccountInfoString(ACCOUNT_CURRENCY)) + "}");
     }

   void              Find(const long id, const string query)
     {
      string q = query;
      StringToLower(q);
      string s = "{\"t\":\"found\",\"id\":" + IntegerToString(id) + ",\"list\":[";
      int k = 0;
      int n = SymbolsTotal(false);
      for(int i = 0; i < n && k < IC_MAX_FOUND; i++)
        {
         string name = SymbolName(i, false);
         string desc = SymbolInfoString(name, SYMBOL_DESCRIPTION);
         string ln = name;
         string ld = desc;
         StringToLower(ln);
         StringToLower(ld);
         if(q != "" && StringFind(ln, q) < 0 && StringFind(ld, q) < 0)
            continue;
         if(k++ > 0)
            s += ",";
         s += "{\"name\":" + IcJsonQuote(name) + ",\"desc\":" + IcJsonQuote(desc) +
              ",\"path\":" + IcJsonQuote(SymbolInfoString(name, SYMBOL_PATH)) +
              ",\"mw\":" + (SymbolInfoInteger(name, SYMBOL_SELECT) != 0 ? "true" : "false") + "}";
        }
      m_pipe.Send(s + "]}");
     }

   //--- History: answered when MT5 has the bars; while it downloads them, tried again until
   //--- IC_HISTORY_WAIT has passed.
   void              AddHistory(const CIcJsonIn &j)
     {
      if(ArraySize(m_pending) >= IC_MAX_PENDING)
        {
         Error(j.Int("id"), "Too many history requests at once");
         return;
        }
      CIcPending *p = new CIcPending;
      p.id = j.Int("id");
      p.sym = j.Str("sym");
      p.tfName = j.Str("tf");
      p.before = j.Int("before");
      p.count = (int)MathMax(1, MathMin(IC_MAX_BARS, j.Int("count", 1000)));
      if(!IcTimeframe(p.tfName, p.tf))
        {
         Error(p.id, "Unknown timeframe " + p.tfName);
         delete p;
         return;
        }
      if(!SymbolSelect(p.sym, true))
        {
         Error(p.id, "Unknown symbol " + p.sym);
         delete p;
         return;
        }
      p.deadline = GetTickCount64() + IC_HISTORY_WAIT;
      p.nextTry = 0;
      int n = ArraySize(m_pending);
      ArrayResize(m_pending, n + 1);
      m_pending[n] = p;
     }

   // true when the request is finished (answered or failed).
   bool              TryHistory(CIcPending *p, const ulong now)
     {
      if(now < p.nextTry)
         return false;
      p.nextTry = now + 100;   // CopyRates on a series MT5 still downloads is not cheap
      bool synced = (SeriesInfoInteger(p.sym, p.tf, SERIES_SYNCHRONIZED) != 0);
      long first = SeriesInfoInteger(p.sym, p.tf, SERIES_FIRSTDATE);
      MqlRates r[];
      int got = -1;
      ResetLastError();
      if(p.before > 0)
        {
         if(synced && first > 0 && p.before <= first)
            got = 0;   // nothing older
         else
            got = CopyRates(p.sym, p.tf, (datetime)(p.before - 1), p.count, r);
        }
      else
         got = CopyRates(p.sym, p.tf, 0, p.count, r);
      if((got <= 0 || !synced) && now < p.deadline)
         return false;
      if(got <= 0 && !synced)
        {
         // Not "no more bars": MT5 is still downloading them, and the screen asks again later.
         Error(p.id, "MT5 has no bars for " + p.sym + " " + p.tfName + " yet (error " + IntegerToString(GetLastError()) + ")");
         return true;
        }
      if(got < 0)
         got = 0;
      int digits = (int)SymbolInfoInteger(p.sym, SYMBOL_DIGITS);
      string s = "{\"t\":\"bars\",\"id\":" + IntegerToString(p.id) + ",\"sym\":" + IcJsonQuote(p.sym) +
                 ",\"tf\":" + IcJsonQuote(p.tfName) + ",\"digits\":" + IntegerToString(digits) +
                 ",\"done\":" + (got < p.count ? "true" : "false") + ",\"bars\":[";
      int k = 0;
      for(int i = 0; i < got; i++)
        {
         if(p.before > 0 && (long)r[i].time >= p.before)
            continue;   // only bars before the asked time
         if(k++ > 0)
            s += ",";
         s += IcBarRow(r[i], digits);
        }
      m_pipe.Send(s + "]}");
      return true;
     }

   void              Pending(const ulong now)
     {
      for(int i = ArraySize(m_pending) - 1; i >= 0; i--)
         if(TryHistory(m_pending[i], now))
           {
            delete m_pending[i];
            for(int k = i; k < ArraySize(m_pending) - 1; k++)
               m_pending[k] = m_pending[k + 1];
            ArrayResize(m_pending, ArraySize(m_pending) - 1);
           }
     }

   //--- The charts to keep live: "M15@XAUUSD\nH1@EURUSD". A chart already watched keeps its state.
   void              SetWatch(const string list)
     {
      string items[];
      int n = (int)MathMin(IC_MAX_WATCH, IcLines(list, items));
      CIcWatch *next[];
      ArrayResize(next, 0);
      for(int i = 0; i < n; i++)
        {
         int at = StringFind(items[i], "@");
         if(at <= 0)
            continue;
         string tfName = StringSubstr(items[i], 0, at);
         string sym = StringSubstr(items[i], at + 1);
         ENUM_TIMEFRAMES tf;
         if(!IcTimeframe(tfName, tf) || !SymbolSelect(sym, true))
            continue;
         CIcWatch *w = NULL;
         for(int k = 0; k < ArraySize(m_watch) && w == NULL; k++)
            if(m_watch[k] != NULL && m_watch[k].sym == sym && m_watch[k].tfName == tfName)
              {
               w = m_watch[k];   // already watched: keeps what it last sent
               m_watch[k] = NULL;
              }
         if(w == NULL)
           {
            w = new CIcWatch;
            w.sym = sym;
            w.tfName = tfName;
            w.tf = tf;
            w.digits = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
            w.tickMsc = -1;
            w.bid = 0;
            w.ask = 0;
            w.last.time = 0;
           }
         int m = ArraySize(next);
         ArrayResize(next, m + 1);
         next[m] = w;
        }
      for(int k = 0; k < ArraySize(m_watch); k++)
         if(m_watch[k] != NULL)
            delete m_watch[k];
      ArrayResize(m_watch, ArraySize(next));
      for(int i = 0; i < ArraySize(next); i++)
         m_watch[i] = next[i];
     }

   // The bar, with the tick that made it: the chart's bid and ask lines move with every tick.
   void              SendBar(CIcWatch *w, const MqlRates &r)
     {
      MqlTick t;
      string tick = "";
      if(SymbolInfoTick(w.sym, t))
         tick = ",\"bid\":" + DoubleToString(t.bid, w.digits) + ",\"ask\":" + DoubleToString(t.ask, w.digits) +
                ",\"time\":" + IntegerToString((long)t.time_msc);
      m_pipe.Send("{\"t\":\"bar\",\"sym\":" + IcJsonQuote(w.sym) + ",\"tf\":" + IcJsonQuote(w.tfName) +
                  ",\"bar\":" + IcBarRow(r, w.digits) + tick + "}");
     }

   void              Bars()
     {
      for(int i = 0; i < ArraySize(m_watch); i++)
        {
         MqlTick t;
         if(!SymbolInfoTick(m_watch[i].sym, t))
            continue;
         bool tickMoved = (t.time_msc != m_watch[i].tickMsc || t.bid != m_watch[i].bid || t.ask != m_watch[i].ask);
         if(!tickMoved && m_watch[i].last.time != 0)
            continue;
         MqlRates r[];
         int got = CopyRates(m_watch[i].sym, m_watch[i].tf, 0, 2, r);
         if(got <= 0)
            continue;
         m_watch[i].tickMsc = t.time_msc;
         m_watch[i].bid = t.bid;
         m_watch[i].ask = t.ask;
         MqlRates now = r[got - 1];
         MqlRates was = m_watch[i].last;
         if(now.time != was.time)
           {
            // The bar before closed: send its final values first.
            if(was.time != 0 && got == 2 && r[0].time == was.time)
               SendBar(m_watch[i], r[0]);
            SendBar(m_watch[i], now);
           }
         else if(tickMoved || now.open != was.open || now.high != was.high || now.low != was.low ||
                 now.close != was.close || now.tick_volume != was.tick_volume)
            SendBar(m_watch[i], now);   // a tick that moved only the ask moves the ask line
         m_watch[i].last = now;
        }
     }

   //--- The symbols whose quotes to send: "XAUUSD\nEURUSD".
   void              SetQuotes(const string list)
     {
      string items[];
      int n = (int)MathMin(IC_MAX_QUOTES, IcLines(list, items));
      CIcQuote *next[];
      ArrayResize(next, 0);
      for(int i = 0; i < n; i++)
        {
         if(!SymbolSelect(items[i], true))
            continue;
         CIcQuote *q = NULL;
         for(int k = 0; k < ArraySize(m_quotes) && q == NULL; k++)
            if(m_quotes[k] != NULL && m_quotes[k].sym == items[i])
              {
               q = m_quotes[k];
               m_quotes[k] = NULL;
              }
         if(q == NULL)
           {
            q = new CIcQuote;
            q.sym = items[i];
            q.digits = (int)SymbolInfoInteger(q.sym, SYMBOL_DIGITS);
            q.bid = 0;
            q.ask = 0;
            q.sentAt = 0;
            q.prevClose = 0;
            q.prevAt = 0;
           }
         int m = ArraySize(next);
         ArrayResize(next, m + 1);
         next[m] = q;
        }
      for(int k = 0; k < ArraySize(m_quotes); k++)
         if(m_quotes[k] != NULL)
            delete m_quotes[k];
      ArrayResize(m_quotes, ArraySize(next));
      for(int i = 0; i < ArraySize(next); i++)
         m_quotes[i] = next[i];
     }

   void              Quotes(const ulong now)
     {
      for(int i = 0; i < ArraySize(m_quotes); i++)
        {
         if(now - m_quotes[i].sentAt < IC_QUOTE_MS)
            continue;
         MqlTick t;
         if(!SymbolInfoTick(m_quotes[i].sym, t))
            continue;
         if(now - m_quotes[i].prevAt > 60000)
           {
            double c[];
            if(CopyClose(m_quotes[i].sym, PERIOD_D1, 1, 1, c) == 1)
               m_quotes[i].prevClose = c[0];
            m_quotes[i].prevAt = now;
           }
         if(t.bid == m_quotes[i].bid && t.ask == m_quotes[i].ask)
            continue;
         m_quotes[i].bid = t.bid;
         m_quotes[i].ask = t.ask;
         m_quotes[i].sentAt = now;
         int d = m_quotes[i].digits;
         m_pipe.Send("{\"t\":\"quote\",\"sym\":" + IcJsonQuote(m_quotes[i].sym) + ",\"bid\":" + DoubleToString(t.bid, d) +
                     ",\"ask\":" + DoubleToString(t.ask, d) + ",\"time\":" + IntegerToString((long)t.time_msc) +
                     ",\"prev\":" + DoubleToString(m_quotes[i].prevClose, d) + "}");
        }
     }

   // MT5's own link to the broker: connected, and its last ping to the trade server (ms).
   string            BrokerLink()
     {
      return ",\"connected\":" + (TerminalInfoInteger(TERMINAL_CONNECTED) != 0 ? "true" : "false") +
             ",\"brokerPing\":" + DoubleToString(TerminalInfoInteger(TERMINAL_PING_LAST) / 1000.0, 1);
     }

   void              Clock(const ulong now)
     {
      if(now - m_lastClock < 1000)
         return;
      m_lastClock = now;
      if(SymbolsTotal(true) != m_mwCount)
         SendSymbols();   // symbols added to or removed from Market Watch
      m_pipe.Send("{\"t\":\"clock\",\"now\":" + IntegerToString((long)TimeTradeServer()) + BrokerLink() + "}");
      double b = AccountInfoDouble(ACCOUNT_BALANCE);
      double e = AccountInfoDouble(ACCOUNT_EQUITY);
      if(b != m_balance || e != m_equity)
        {
         m_balance = b;
         m_equity = e;
         m_pipe.Send("{\"t\":\"account\",\"balance\":" + DoubleToString(b, 2) + ",\"equity\":" + DoubleToString(e, 2) +
                     ",\"currency\":" + IcJsonQuote(AccountInfoString(ACCOUNT_CURRENCY)) + "}");
        }
     }

   void              Handle(const string text)
     {
      if(text == "")
         return;   // a pulse: it only woke the feed
      CIcJsonIn j;
      if(!j.Parse(text))
        {
         Error(0, "Not a request: " + j.Error());
         return;
        }
      string t = j.Str("t");
      if(t == "pulse")
         m_pulsed = j.Bool("on");
      else if(t == "ping")   // answered at once: the screen measures the round trip through the feed
         m_pipe.Send("{\"t\":\"pong\",\"id\":" + IntegerToString(j.Int("id")) + BrokerLink() + "}");
      else if(t == "history")
         AddHistory(j);
      else if(t == "watch")
         SetWatch(j.Str("list"));
      else if(t == "quotes")
         SetQuotes(j.Str("list"));
      else if(t == "find")
         Find(j.Int("id"), j.Str("q"));
      else if(t == "spec")
         SendSpec(j.Int("id"), j.Str("sym"));
      else if(t == "symbols")
         SendSymbols();
      else if(t == "hello")
         SendHello();
      else
         Error(j.Int("id"), "Unknown request " + t);
     }

public:
                     CIcFeed() : m_lastTry(0), m_lastClock(0), m_balance(-1), m_equity(-1), m_pulsed(false), m_mwCount(-1) {}
                    ~CIcFeed() { Reset(); }

   // One round: connect when needed, answer what arrived, send what changed.
   void              Step()
     {
      ulong now = GetTickCount64();
      if(!m_pipe.IsOpen())
        {
         if(now - m_lastTry < 1000)
            return;
         m_lastTry = now;
         if(!m_pipe.Open())
            return;
         Reset();
         SendHello();
         SendSymbols();
        }
      string in[];
      int n = m_pipe.Receive(in);
      for(int i = 0; i < n; i++)
         Handle(in[i]);
      Pending(now);
      Bars();
      Quotes(now);
      Clock(now);
      if(m_pipe.Broken())
        {
         m_pipe.Close();
         Reset();
        }
     }

   // Trading is about time: while a screen is open the loop runs on the program's pulses, about
   // every millisecond; otherwise it sleeps between rounds. Each round is a few cheap calls while
   // nothing changed.
   void              Run()
     {
      while(!IsStopped())
        {
         Step();
         if(m_pulsed && m_pipe.IsOpen())
            m_pipe.WaitFrame();
         else
            Sleep(1);
        }
      m_pipe.Close();
     }
  };

#endif
