//+------------------------------------------------------------------+
//| ActionInna - entry/SL/TP preview lines, zones and price tags     |
//+------------------------------------------------------------------+
#ifndef ACTIONINNA_PREVIEWLINES_MQH
#define ACTIONINNA_PREVIEWLINES_MQH

#include "Defines.mqh"
#include "Util.mqh"
#include "SymbolSpec.mqh"
#include "Ui.mqh"

// MT5 draws an object that is shown again (its timeframes set back to all) on top of the others, as
// if it had just been added: lines and tags hidden that way came back over the panel. So they are
// hidden by drawing them in no colour, and keep their place in the drawing order: they were created
// before the panel, so they stay under it. Showing one is left to the caller, which sets its colours.
void AiShowObject(const string name, const bool on)
  {
   if(on)
      return;
   ObjectSetInteger(0, name, OBJPROP_COLOR, clrNONE);
   ObjectSetString(0, name, OBJPROP_TOOLTIP, "\n");
  }

// A price tag's box: its fill and its edge.
void AiShowBox(const string name, const bool on)
  {
   AiShowObject(name, on);
   if(!on)
      ObjectSetInteger(0, name, OBJPROP_BGCOLOR, clrNONE);
  }

// Whether an object is on the chart and drawn (see AiShowObject).
bool AiShown(const string name)
  {
   return (ObjectFind(0, name) >= 0 && ObjectGetInteger(0, name, OBJPROP_TIMEFRAMES) != OBJ_NO_PERIODS &&
           (color)ObjectGetInteger(0, name, OBJPROP_COLOR) != clrNONE);
  }

// A price tag is a box (rn) with its text (ln). True when one of them had to be created.
bool AiEnsureTag(const string rn, const string ln)
  {
   bool created = false;
   if(ObjectFind(0, rn) < 0 && ObjectCreate(0, rn, OBJ_RECTANGLE_LABEL, 0, 0, 0))
     {
      ObjectSetInteger(0, rn, OBJPROP_CORNER, CORNER_LEFT_UPPER);
      ObjectSetInteger(0, rn, OBJPROP_BORDER_TYPE, BORDER_FLAT);
      ObjectSetInteger(0, rn, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, rn, OBJPROP_HIDDEN, true);
      ObjectSetInteger(0, rn, OBJPROP_ZORDER, 6);
      ObjectSetString(0, rn, OBJPROP_TOOLTIP, "\n");
      created = true;
     }
   if(ObjectFind(0, ln) < 0 && ObjectCreate(0, ln, OBJ_LABEL, 0, 0, 0))
     {
      ObjectSetInteger(0, ln, OBJPROP_CORNER, CORNER_LEFT_UPPER);
      ObjectSetInteger(0, ln, OBJPROP_ANCHOR, ANCHOR_LEFT);
      ObjectSetInteger(0, ln, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, ln, OBJPROP_HIDDEN, true);
      ObjectSetInteger(0, ln, OBJPROP_ZORDER, 7);
      ObjectSetString(0, ln, OBJPROP_TOOLTIP, "\n");
      created = true;
     }
   return created;
  }

// Where price tags go. They sit in the empty space right of the last candle (the chart shift),
// left of a panel docked there, so they cover no candles. When a tag doesn't fit there, it goes to
// the chart's edge away from the panel, as before.
struct AiTagArea
  {
   bool              left;   // the fallback edge: left when the panel is on the right half
   int               from;   // the empty space right of the last candle, in pixels
   int               to;
  };

// The widest tag drawn in the area since the app last reset it: the room kept right of the last
// candle follows it (CAiApp.UpdateShift), so the next frame's tags fit there.
int g_aiTagWidest = 0;

// Pixels between the mouse and a horizontal line; a large number when the line has no place.
int AiLineGap(const string line, const int my)
  {
   double p = ObjectGetDouble(0, line, OBJPROP_PRICE);
   int x = 0;
   int y = 0;
   if(p <= 0.0 || !ChartTimePriceToXY(0, 0, TimeCurrent(), p, x, y))
      return 1000000;
   return MathAbs(y - my);
  }

// True when the mouse is on a shown price tag (its box).
bool AiOnTag(const string box, const int mx, const int my)
  {
   if(!AiShown(box))
      return false;
   int x = (int)ObjectGetInteger(0, box, OBJPROP_XDISTANCE);
   int y = (int)ObjectGetInteger(0, box, OBJPROP_YDISTANCE);
   int w = (int)ObjectGetInteger(0, box, OBJPROP_XSIZE);
   int h = (int)ObjectGetInteger(0, box, OBJPROP_YSIZE);
   return (mx >= x && mx < x + w && my >= y && my < y + h);
  }

// How near the mouse is to a line, for picking the line it takes: on a tag, a negative number
// (any tag beats any line, and of two tags the one whose line is nearest); else the pixels to the
// line.
int AiHitDistance(const string line, const string box, const int mx, const int my)
  {
   int gap = AiLineGap(line, my);
   if(AiOnTag(box, mx, my))
      return -1000 + MathMin(gap, 999);
   return gap;
  }

// A coloured price tag on the line. Off-screen levels stick to the edge with an arrow. 'brief' is
// what it says when the space right of the last candle is narrower than 'text': the price and the
// money, which must stay readable while the line is dragged.
void AiPlaceTag(const string rn, const string ln, const double price, const string text, const string brief, const color bg, const color fg,
                CAiUi &ui, const AiTagArea &area, const int chartW, const int chartH)
  {
   AiEnsureTag(rn, ln);
   int x = 0;
   int y = 0;
   if(!ChartTimePriceToXY(0, 0, TimeCurrent(), price, x, y))
     {
      AiShowBox(rn, false);
      AiShowObject(ln, false);
      return;
     }
   int fs = MathMax(ui.fontSize - 1, 7);
   int h = ui.S(18);
   int pad = ui.S(6);
   string arrow = "";
   int ty = y - h / 2;
   if(y < 0)
     {
      arrow = "^ ";
      ty = 0;
     }
   else if(y > chartH)
     {
      arrow = "v ";
      ty = chartH - h;
     }
   string shown = arrow + text;
   ty = MathMax(0, MathMin(ty, chartH - h));
   int w = ui.TextWidth(shown, fs) + 2 * pad;
   int tx = 0;
   int room = area.to - area.from;
   if(room > 0)
      g_aiTagWidest = MathMax(g_aiTagWidest, w);
   if(room >= w)
      tx = area.from;
   else if(room >= ui.S(90))
     {
      // Narrower than the tag (MT5 keeps the shift within half the chart): the brief text, so the
      // tag stays off the candles and still shows the money. The rest is in the card and the panel.
      shown = ui.Fit(arrow + brief, room - 2 * pad, fs, false);
      w = ui.TextWidth(shown, fs) + 2 * pad;
      tx = area.from;
     }
   else
      tx = area.left ? ui.S(8) : chartW - w - ui.S(8);
   tx = MathMax(0, MathMin(tx, chartW - w));
   ObjectSetInteger(0, rn, OBJPROP_XDISTANCE, tx);
   ObjectSetInteger(0, rn, OBJPROP_YDISTANCE, ty);
   ObjectSetInteger(0, rn, OBJPROP_XSIZE, w);
   ObjectSetInteger(0, rn, OBJPROP_YSIZE, h);
   ObjectSetInteger(0, rn, OBJPROP_BGCOLOR, bg);
   ObjectSetInteger(0, rn, OBJPROP_COLOR, bg);
   ObjectSetInteger(0, ln, OBJPROP_XDISTANCE, tx + pad);
   ObjectSetInteger(0, ln, OBJPROP_YDISTANCE, ty + h / 2);
   ObjectSetString(0, ln, OBJPROP_TEXT, shown);
   ObjectSetString(0, ln, OBJPROP_FONT, ui.font);
   ObjectSetInteger(0, ln, OBJPROP_FONTSIZE, ui.F(fs));
   ObjectSetInteger(0, ln, OBJPROP_COLOR, fg);
  }

// The preview's entry, SL and TP lines. MT5 does not drag them: the app does (CAiApp.OnMouse), so
// a line can be taken a few pixels off it or by its tag, and its price follows every mouse move.
class CAiLines
  {
private:
   double            m_set[3];   // price last written to each line: 0 entry, 1 SL, 2 TP

   string            TagKey(const int i) const
     {
      if(i == 0)
         return "ENTRY";
      if(i == 1)
         return "SL";
      return "TP";
     }

   string            LineName(const int i) const
     {
      return AI_L + TagKey(i);
     }

   // Lines and zones: hidden in no colour (AiShowObject), shown by the colour SetLine and SetZone give.
   void              Show(const string name, const bool on)
     {
      AiShowObject(name, on);
     }

   void              SetLine(const int i, const double price, const color clr, const ENUM_LINE_STYLE style, const string tip)
     {
      string n = LineName(i);
      if(ObjectFind(0, n) < 0)
        {
         if(!ObjectCreate(0, n, OBJ_HLINE, 0, 0, price))
            return;
         ObjectSetInteger(0, n, OBJPROP_WIDTH, 1);
         ObjectSetInteger(0, n, OBJPROP_BACK, false);
         // Not MT5's to move: its own drag needs a hit within a pixel or two, and reports the new
         // price only when the button is let go.
         ObjectSetInteger(0, n, OBJPROP_SELECTABLE, false);
         ObjectSetInteger(0, n, OBJPROP_SELECTED, false);
         ObjectSetInteger(0, n, OBJPROP_HIDDEN, true);
         ObjectSetInteger(0, n, OBJPROP_ZORDER, 5);
         m_set[i] = price;
        }
      Show(n, true);
      ObjectSetInteger(0, n, OBJPROP_COLOR, clr);
      ObjectSetInteger(0, n, OBJPROP_STYLE, style);
      ObjectSetString(0, n, OBJPROP_TOOLTIP, tip);
      if(m_set[i] != price)
        {
         ObjectSetDouble(0, n, OBJPROP_PRICE, price);
         m_set[i] = price;
        }
     }

   void              SetZone(const string n, const double p1, const double p2, const color clr)
     {
      datetime t0 = iTime(_Symbol, _Period, 0);
      int ps = PeriodSeconds(_Period);
      datetime ta = t0 - 12 * ps;
      datetime tb = t0 + 2 * ps;
      if(ObjectFind(0, n) < 0)
        {
         if(!ObjectCreate(0, n, OBJ_RECTANGLE, 0, ta, p1, tb, p2))
            return;
         ObjectSetInteger(0, n, OBJPROP_FILL, true);
         ObjectSetInteger(0, n, OBJPROP_BACK, true);
         ObjectSetInteger(0, n, OBJPROP_SELECTABLE, false);
         ObjectSetInteger(0, n, OBJPROP_HIDDEN, true);
        }
      Show(n, true);
      ObjectSetInteger(0, n, OBJPROP_COLOR, clr);
      ObjectSetInteger(0, n, OBJPROP_TIME, 0, ta);
      ObjectSetDouble(0, n, OBJPROP_PRICE, 0, p1);
      ObjectSetInteger(0, n, OBJPROP_TIME, 1, tb);
      ObjectSetDouble(0, n, OBJPROP_PRICE, 1, p2);
     }

   void              EnsureTag(const string key)
     {
      AiEnsureTag(AI_T + key + "#bg", AI_T + key + "#tx");
     }

   void              HideLine(const int i)
     {
      Show(LineName(i), false);
     }

   void              HideTag(const string key)
     {
      AiShowBox(AI_T + key + "#bg", false);
      AiShowObject(AI_T + key + "#tx", false);
     }

   void              SetTag(const string key, const double price, const string text, const string brief, const color bg, const color fg, CAiUi &ui,
                            const AiTagArea &area, const int chartW, const int chartH)
     {
      AiPlaceTag(AI_T + key + "#bg", AI_T + key + "#tx", price, text, brief, bg, fg, ui, area, chartW, chartH);
     }

public:
                     CAiLines()
     {
      ArrayInitialize(m_set, 0.0);
     }

   string            LineObj(const int i) const
     {
      return LineName(i);
     }

   // The shown line the mouse is on: within 'grab' pixels of it, or on its tag (AiHitDistance). -1
   // for none; 'dist' is how far.
   int               HitTest(const int mx, const int my, const int grab, int &dist) const
     {
      int best = -1;
      dist = grab + 1;
      for(int i = 0; i < 3; i++)
        {
         string n = LineName(i);
         if(!AiShown(n))
            continue;
         int d = AiHitDistance(n, AI_T + TagKey(i) + "#bg", mx, my);
         if(d < dist)
           {
            dist = d;
            best = i;
           }
        }
      return best;
     }

   // Creates every object hidden. Called before the panel is drawn, so the panel stays on top.
   void              Create(const double anyPrice)
     {
      for(int i = 0; i < 3; i++)
        {
         SetLine(i, anyPrice, clrGray, STYLE_SOLID, "");
         HideLine(i);
        }
      SetZone(AI_Z + "SL", anyPrice, anyPrice, clrGray);
      SetZone(AI_Z + "TP", anyPrice, anyPrice, clrGray);
      Show(AI_Z + "SL", false);
      Show(AI_Z + "TP", false);
      EnsureTag("ENTRY");
      EnsureTag("SL");
      EnsureTag("TP");
      HideTag("ENTRY");
      HideTag("SL");
      HideTag("TP");
     }

   void              HideAll()
     {
      for(int i = 0; i < 3; i++)
         HideLine(i);
      Show(AI_Z + "SL", false);
      Show(AI_Z + "TP", false);
      HideTag("ENTRY");
      HideTag("SL");
      HideTag("TP");
     }

   // Lines are written again on the next Sync, so a drag that was not taken (during the pause
   // after sending) does not leave a line where it was dropped.
   void              EndDrag()
     {
      ArrayInitialize(m_set, -1.0);
     }

   void              Sync(const AiPlan &p, const AiSpec &s, const AiTheme &th, const bool show, const bool zones, const AiTagArea &area, const int chartW, const int chartH, CAiUi &ui, const string cur)
     {
      if(!show || p.entry <= 0.0)
        {
         HideAll();
         return;
        }
      SetLine(0, p.entry, th.entryLine, STYLE_SOLID, p.pending ? "Drag to move the entry price" : "Drag to make this a pending order at that price");
      if(p.sl > 0.0)
         SetLine(1, p.sl, th.slLine, STYLE_DASH, "Drag to move the stop loss");
      else
         HideLine(1);
      if(p.tp > 0.0)
         SetLine(2, p.tp, th.tpLine, STYLE_DASH, "Drag to move the take profit");
      else
         HideLine(2);

      if(zones && p.sl > 0.0)
         SetZone(AI_Z + "SL", p.entry, p.sl, th.zoneSl);
      else
         Show(AI_Z + "SL", false);
      if(zones && p.tp > 0.0)
         SetZone(AI_Z + "TP", p.entry, p.tp, th.zoneTp);
      else
         Show(AI_Z + "TP", false);

      string lots = (p.lots > 0.0) ? AiLotsStr(s, p.lots) : "-";
      string t0 = AiOrderTypeName(p.type) + " " + lots + " @ " + AiPriceStr(s, p.entry);
      SetTag("ENTRY", p.entry, t0, t0, th.entryTag, th.onFill, ui, area, chartW, chartH);
      if(p.sl > 0.0)
        {
         string t1 = "SL " + AiPriceStr(s, p.sl) + " | " + DoubleToString(p.slPips, 1) + " pips";
         string b1 = t1;
         if(p.riskMoney > 0.0)
           {
            string money = AiMoney(-p.riskMoney, cur) + " (" + DoubleToString(p.riskPct, 2) + "%)";
            t1 += " | " + money;
            b1 = "SL " + AiPriceStr(s, p.sl) + " | " + money;
           }
         SetTag("SL", p.sl, t1, b1, th.slTag, th.onFill, ui, area, chartW, chartH);
        }
      else
         HideTag("SL");
      if(p.tp > 0.0)
        {
         string t2 = "TP " + AiPriceStr(s, p.tp) + " | " + DoubleToString(p.tpPips, 1) + " pips";
         string b2 = t2;
         if(p.lots > 0.0)
           {
            string money = AiMoney(p.rewardMoney, cur, true) + " (" + DoubleToString(p.rewardPct, 2) + "%)";
            t2 += " | " + money;
            b2 = "TP " + AiPriceStr(s, p.tp) + " | " + money;
           }
         if(p.rr > 0.0)
            t2 += " | 1:" + DoubleToString(p.rr, 2);
         SetTag("TP", p.tp, t2, b2, th.tpTag, th.onFill, ui, area, chartW, chartH);
        }
      else
         HideTag("TP");
     }
  };

#endif
