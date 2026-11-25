//+------------------------------------------------------------------+
//| ActionInna - open positions and pending orders, as AiLive        |
//+------------------------------------------------------------------+
#ifndef ACTIONINNA_TRADES_MQH
#define ACTIONINNA_TRADES_MQH

#include "Defines.mqh"

// AiReadLive and AiReadShown: shownOnly leaves out (and counts) what AiMagicShown does.
int AiReadTrades(const string symbol, const bool shownOnly, AiLive &out[], AiOthers &others)
  {
   ArrayResize(out, 0);
   ZeroMemory(others);
   int n = 0;
   int total = PositionsTotal();
   for(int i = 0; i < total; i++)
     {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0)
         continue;
      string sym = PositionGetString(POSITION_SYMBOL);
      if(symbol != "" && sym != symbol)
         continue;
      long magic = PositionGetInteger(POSITION_MAGIC);
      // Counted before anything else is read: a bot may hold hundreds.
      if(shownOnly && !AiMagicShown(magic))
        {
         others.count++;
         others.positions++;
         others.profit += PositionGetDouble(POSITION_PROFIT) + PositionGetDouble(POSITION_SWAP);
         continue;
        }
      bool buy = (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY);
      AiLive l;
      ZeroMemory(l);
      l.ticket = ticket;
      l.id = (ulong)PositionGetInteger(POSITION_IDENTIFIER);
      l.symbol = sym;
      l.openMsc = PositionGetInteger(POSITION_TIME_MSC);
      l.isOrder = false;
      l.type = buy ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;
      l.side = buy ? AI_BUY : AI_SELL;
      l.lots = PositionGetDouble(POSITION_VOLUME);
      l.open = PositionGetDouble(POSITION_PRICE_OPEN);
      l.sl = PositionGetDouble(POSITION_SL);
      l.tp = PositionGetDouble(POSITION_TP);
      l.profit = PositionGetDouble(POSITION_PROFIT) + PositionGetDouble(POSITION_SWAP);
      l.magic = magic;
      ArrayResize(out, n + 1, 16);
      out[n] = l;
      n++;
     }
   total = OrdersTotal();
   for(int j = 0; j < total; j++)
     {
      ulong ticket = OrderGetTicket(j);
      if(ticket == 0)
         continue;
      string sym = OrderGetString(ORDER_SYMBOL);
      if(symbol != "" && sym != symbol)
         continue;
      ENUM_ORDER_TYPE t = (ENUM_ORDER_TYPE)OrderGetInteger(ORDER_TYPE);
      if(t == ORDER_TYPE_BUY || t == ORDER_TYPE_SELL || t == ORDER_TYPE_CLOSE_BY)
         continue;
      if(shownOnly && !AiMagicShown(OrderGetInteger(ORDER_MAGIC)))
        {
         others.count++;
         continue;
        }
      bool buy = (t == ORDER_TYPE_BUY_LIMIT || t == ORDER_TYPE_BUY_STOP || t == ORDER_TYPE_BUY_STOP_LIMIT);
      AiLive l;
      ZeroMemory(l);
      l.ticket = ticket;
      l.symbol = sym;
      l.openMsc = OrderGetInteger(ORDER_TIME_SETUP_MSC);
      l.isOrder = true;
      l.type = t;
      l.side = buy ? AI_BUY : AI_SELL;
      l.lots = OrderGetDouble(ORDER_VOLUME_CURRENT);
      l.open = OrderGetDouble(ORDER_PRICE_OPEN);
      l.sl = OrderGetDouble(ORDER_SL);
      l.tp = OrderGetDouble(ORDER_TP);
      l.stopLimit = OrderGetDouble(ORDER_PRICE_STOPLIMIT);
      l.timeType = (int)OrderGetInteger(ORDER_TYPE_TIME);
      l.expiration = (datetime)OrderGetInteger(ORDER_TIME_EXPIRATION);
      l.magic = OrderGetInteger(ORDER_MAGIC);
      l.comment = OrderGetString(ORDER_COMMENT);
      ArrayResize(out, n + 1, 16);
      out[n] = l;
      n++;
     }
   return n;
  }

// Positions and pending orders on 'symbol', or on every symbol when it is "". Market orders still
// being filled are left out.
int AiReadLive(const string symbol, AiLive &out[])
  {
   AiOthers none;
   return AiReadTrades(symbol, false, out, none);
  }

// AiReadLive without the trades AiMagicShown leaves out (another EA's), which 'others' counts.
int AiReadShown(const string symbol, AiLive &out[], AiOthers &others)
  {
   return AiReadTrades(symbol, true, out, others);
  }

// A position or pending order by its ticket, on any symbol.
bool AiFindLive(const ulong ticket, AiLive &l)
  {
   ZeroMemory(l);
   if(ticket == 0)
      return false;
   AiLive all[];
   int n = AiReadLive("", all);
   for(int i = 0; i < n; i++)
      if(all[i].ticket == ticket)
        {
         l = all[i];
         return true;
        }
   return false;
  }

// AiFindLive for a change the trader asks for: another EA's trade, while AiMagicShown leaves those
// out, is not found, and 'hidden' says why. ActionInna leaves it alone.
bool AiFindShown(const ulong ticket, AiLive &l, bool &hidden)
  {
   hidden = false;
   if(!AiFindLive(ticket, l))
      return false;
   if(AiMagicShown(l.magic))
      return true;
   hidden = true;
   ZeroMemory(l);
   return false;
  }

string AiHiddenText(const ulong ticket)
  {
   return "#" + IntegerToString((long)ticket) + " belongs to another EA (a bot): ActionInna leaves it alone. " +
          "Turn on \"Show other EAs' trades\" to change it here";
  }

// On an account that closes first in, first out: the oldest other position on l's symbol, which has
// to be closed before l can be. 0 when there is none.
ulong AiFifoBlocker(const AiLive &l)
  {
   if(l.isOrder || AccountInfoInteger(ACCOUNT_FIFO_CLOSE) == 0)
      return 0;
   AiLive all[];
   int n = AiReadLive(l.symbol, all);
   ulong blocker = 0;
   long oldest = l.openMsc;
   ulong oldestTicket = l.ticket;
   for(int i = 0; i < n; i++)
     {
      if(all[i].isOrder || all[i].ticket == l.ticket)
         continue;
      if(all[i].openMsc < oldest || (all[i].openMsc == oldest && all[i].ticket < oldestTicket))
        {
         oldest = all[i].openMsc;
         oldestTicket = all[i].ticket;
         blocker = all[i].ticket;
        }
     }
   return blocker;
  }

// The position a market order went into. Its ticket is usually the order's and its identifier always
// is; on a netting account the order may also have joined the symbol's one position.
bool AiFindPosition(const string symbol, const ulong orderTicket, AiLive &l)
  {
   ZeroMemory(l);
   AiLive all[];
   int n = AiReadLive(symbol, all);
   bool netting = (AccountInfoInteger(ACCOUNT_MARGIN_MODE) != ACCOUNT_MARGIN_MODE_RETAIL_HEDGING);
   for(int i = 0; i < n; i++)
      if(!all[i].isOrder && (all[i].ticket == orderTicket || all[i].id == orderTicket || netting))
        {
         l = all[i];
         return true;
        }
   return false;
  }

#endif
