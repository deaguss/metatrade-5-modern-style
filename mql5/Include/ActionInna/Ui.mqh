//+------------------------------------------------------------------+
//| ActionInna - theme and chart-object helpers for the panel        |
//+------------------------------------------------------------------+
#ifndef ACTIONINNA_UI_MQH
#define ACTIONINNA_UI_MQH

#include "Defines.mqh"
#include "Util.mqh"

// Colour roles. Blue means BUY and red means SELL, nothing else; green is the take profit and
// success, amber a warning. Selection is neutral (text colour), so it never reads as a trade side.
// Every pair used for text meets 4.5:1 and every control edge 3:1 (see DESIGN.md).
struct AiTheme
  {
   bool              dark;
   color             bg;
   color             border;
   color             text;
   color             muted;
   color             inputBg;
   color             inputBorder;  // edges of fields and buttons, 3:1 against bg
   color             chip;
   color             selected;     // background of a selected chip or toggle
   color             buyFill;      // filled BUY button and buy tag, white text on it
   color             sellFill;
   color             buyEdge;      // border of the idle BUY button
   color             sellEdge;
   color             buyDim;       // idle BUY button background
   color             sellDim;
   color             buyText;      // BUY text on buyDim
   color             sellText;
   color             onFill;
   color             danger;
   color             warn;
   color             good;
   color             divider;
   color             slLine;       // chart lines stay bright so they show on any chart
   color             tpLine;
   color             entryLine;    // neutral for both sides; the tag names the side
   color             slTag;        // tag fills, white text on them
   color             tpTag;
   color             entryTag;
   color             zoneSl;
   color             zoneTp;
   color             tile;         // the money tiles under the fields
   double            shadow;       // opacity of the panel's and the card's shadow
  };

// A rounded shape painted into a surface (see CAiUi.BeginSurface), in the surface's own pixels.
struct AiShape
  {
   int               x;
   int               y;
   int               w;
   int               h;
   int               r;
   color             fill;
   color             edge;
  };

// Signed distance from a point to a rounded rectangle: negative inside, positive outside.
double AiRoundDist(const double px, const double py, const double x0, const double y0, const double w, const double h, const double r)
  {
   double qx = MathAbs(px - (x0 + w / 2.0)) - (w / 2.0 - r);
   double qy = MathAbs(py - (y0 + h / 2.0)) - (h / 2.0 - r);
   double ox = MathMax(qx, 0.0);
   double oy = MathMax(qy, 0.0);
   return MathSqrt(ox * ox + oy * oy) + MathMin(MathMax(qx, qy), 0.0) - r;
  }

// An MQL5 colour (0x00BBGGRR) as the 0xRRGGBB of an ARGB pixel.
uint AiRgb(const color c)
  {
   uint u = (uint)c;
   return ((u & 0xFF) << 16) | (u & 0xFF00) | ((u >> 16) & 0xFF);
  }

// Blends two colours: t = 0 gives a, t = 1 gives b. MQL5 colours are stored as 0x00BBGGRR.
color AiMix(const color a, const color b, const double t)
  {
   uint ua = (uint)a;
   uint ub = (uint)b;
   int ar = (int)(ua & 0xFF);
   int ag = (int)((ua >> 8) & 0xFF);
   int ab = (int)((ua >> 16) & 0xFF);
   int br = (int)(ub & 0xFF);
   int bgr = (int)((ub >> 8) & 0xFF);
   int bb = (int)((ub >> 16) & 0xFF);
   int r = (int)MathRound(ar + (br - ar) * t);
   int g = (int)MathRound(ag + (bgr - ag) * t);
   int bl = (int)MathRound(ab + (bb - ab) * t);
   return (color)((uint)r | ((uint)g << 8) | ((uint)bl << 16));
  }

bool AiIsDark(const color c)
  {
   uint u = (uint)c;
   double lum = 0.299 * (double)(u & 0xFF) + 0.587 * (double)((u >> 8) & 0xFF) + 0.114 * (double)((u >> 16) & 0xFF);
   return lum < 128.0;
  }

void AiBuildTheme(const int mode, const color chartBg, AiTheme &t)
  {
   bool dark = (mode == AI_THEME_DARK) || (mode == AI_THEME_AUTO && AiIsDark(chartBg));
   t.dark = dark;
   // Measured contrast (WCAG 2.x) is noted where a pair carries text or marks a control edge.
   if(dark)
     {
      // The modern dark style: near-black surfaces, adjusted where a pair fell short of the contrast above.
      t.bg          = C'26,26,26';
      t.border      = C'51,51,51';
      t.text        = C'219,219,219';   // 12.6 on bg
      t.muted       = C'140,140,140';   // 5.2 on bg, 5.5 on tile
      t.inputBg     = C'17,17,17';
      t.inputBorder = C'104,104,104';   // 3.1 against bg, 3.4 against inputBg
      t.chip        = C'26,26,26';
      t.selected    = C'46,46,46';      // text on it 9.8
      t.buyFill     = C'41,98,255';     // white on it 4.9
      t.sellFill    = C'214,40,56';     // white on it 5.0
      t.buyEdge     = C'41,98,255';     // 3.6 against bg
      t.sellEdge    = C'242,54,69';     // 4.5 against bg
      t.buyText     = C'127,176,255';   // 7.1 on buyDim
      t.sellText    = C'255,125,136';   // 6.5 on sellDim
      t.danger      = C'255,110,110';   // 6.4 on bg
      t.warn        = C'242,177,80';    // 9.3 on bg
      t.good        = C'72,200,125';    // 8.1 on bg
      t.divider     = C'42,42,42';
      t.slLine      = C'242,54,69';
      t.tpLine      = C'8,153,129';
      t.entryLine   = C'120,123,134';
      t.tpTag       = C'6,128,106';     // white on it 4.9
      t.entryTag    = C'82,88,102';     // white on it 7.1
      t.tile        = C'20,20,20';
      t.shadow      = 0.5;
      t.buyDim      = AiMix(t.bg, t.buyEdge, 0.12);
      t.sellDim     = AiMix(t.bg, t.sellEdge, 0.10);
     }
   else
     {
      t.bg          = C'255,255,255';
      t.border      = C'210,214,222';
      t.text        = C'28,31,38';      // 16.5 on bg
      t.muted       = C'100,107,120';   // 5.4 on bg, 5.0 on chip
      t.inputBg     = C'245,247,250';
      t.inputBorder = C'128,134,146';   // 3.7 against bg
      t.chip        = C'245,247,250';
      t.selected    = C'228,231,237';   // text on it 13.3
      t.buyFill     = C'20,98,212';     // white on it 5.6
      t.sellFill    = C'198,40,56';     // white on it 5.6
      t.buyEdge     = C'20,98,212';
      t.sellEdge    = C'198,40,56';
      t.buyText     = C'16,86,190';     // 5.7 on buyDim
      t.sellText    = C'176,30,46';     // 5.7 on sellDim
      t.danger      = C'196,36,48';     // 5.8 on bg
      t.warn        = C'150,90,0';      // 5.6 on bg
      t.good        = C'16,122,62';     // 5.4 on bg
      t.divider     = C'230,233,238';
      t.slLine      = C'222,52,68';
      t.tpLine      = C'20,150,85';
      t.entryLine   = C'100,107,120';
      t.tpTag       = C'18,120,68';     // white on it 5.5
      t.entryTag    = C'72,78,92';      // white on it 8.3
      t.tile        = C'245,247,250';
      t.shadow      = 0.16;
      t.buyDim      = AiMix(t.bg, t.buyFill, 0.12);
      t.sellDim     = AiMix(t.bg, t.sellFill, 0.12);
     }
   t.onFill = clrWhite;
   t.slTag = t.sellFill;
   t.zoneSl = AiMix(chartBg, t.slLine, 0.16);
   t.zoneTp = AiMix(chartBg, t.tpLine, 0.16);
  }

// Draws panel objects and remembers which ones the current frame used. Objects a frame does not
// use are hidden, not deleted, so they keep their place in MT5's drawing order (creation order).
//
// The panel and the modify card are each a surface: one picture (OBJ_BITMAP_LABEL) with rounded
// corners and a soft shadow, into which the backgrounds of their buttons, chips, fields and tiles
// are painted. Their text and the fields themselves are objects created after it, so drawn over it.
// A click on the picture is matched to a control by its position (CAiPanel.CmdAt).
class CAiUi
  {
private:
   string            m_names[];
   bool              m_used[];
   bool              m_shown[];
   string            m_surf;       // the surface being painted, "" for none
   int               m_surfX;
   int               m_surfY;
   bool              m_surfNew;    // its object was just created: it needs its picture
   AiShape           m_shapes[];
   string            m_sigName[];  // per surface, what its picture shows, so it is painted only on a change
   string            m_sigText[];
   uint              m_px[];
   int               m_pw;
   int               m_ph;

   int               SigSlot(const string name)
     {
      int n = ArraySize(m_sigName);
      for(int i = 0; i < n; i++)
         if(m_sigName[i] == name)
            return i;
      ArrayResize(m_sigName, n + 1);
      ArrayResize(m_sigText, n + 1);
      m_sigName[n] = name;
      m_sigText[n] = "";
      return n;
     }

   string            ResName(const string name) const
     {
      string r = name;
      StringReplace(r, "#", "_");
      return "::" + r;
     }

   // Paints a colour over pixel idx with coverage a (0..1), over what is there (straight alpha).
   void              Blend(const int idx, const uint rgb, const double a)
     {
      uint d = m_px[idx];
      double da = (double)(d >> 24) / 255.0;
      double oa = a + da * (1.0 - a);
      if(oa <= 0.0)
         return;
      double k = da * (1.0 - a);
      uint r = (uint)MathRound((((rgb >> 16) & 0xFF) * a + ((d >> 16) & 0xFF) * k) / oa);
      uint g = (uint)MathRound((((rgb >> 8) & 0xFF) * a + ((d >> 8) & 0xFF) * k) / oa);
      uint b = (uint)MathRound(((rgb & 0xFF) * a + (d & 0xFF) * k) / oa);
      uint al = (uint)MathRound(oa * 255.0);
      m_px[idx] = (al << 24) | (r << 16) | (g << 8) | b;
     }

   // An opaque rounded rectangle, smoothed at its corners.
   void              FillRound(const int x0, const int y0, const int w, const int h, const int r, const color c)
     {
      if(w <= 0 || h <= 0)
         return;
      uint rgb = AiRgb(c);
      int rr = MathMax(0, MathMin(r, MathMin(w, h) / 2));
      int ya = MathMax(0, y0);
      int yb = MathMin(m_ph, y0 + h);
      int xa = MathMax(0, x0);
      int xb = MathMin(m_pw, x0 + w);
      for(int y = ya; y < yb; y++)
        {
         bool edgeRow = (y < y0 + rr || y >= y0 + h - rr);
         for(int x = xa; x < xb; x++)
           {
            int idx = y * m_pw + x;
            if(edgeRow && (x < x0 + rr || x >= x0 + w - rr))
              {
               double cx = (x < x0 + rr) ? x0 + rr : x0 + w - rr;
               double cy = (y < y0 + rr) ? y0 + rr : y0 + h - rr;
               double dx = x + 0.5 - cx;
               double dy = y + 0.5 - cy;
               double cov = rr + 0.5 - MathSqrt(dx * dx + dy * dy);
               if(cov <= 0.0)
                  continue;
               if(cov < 1.0)
                 {
                  Blend(idx, rgb, cov);
                  continue;
                 }
              }
            m_px[idx] = 0xFF000000 | rgb;
           }
        }
     }

   // A filled shape with a 1-pixel edge: the edge colour, then the fill one pixel in.
   void              PaintShape(const int x, const int y, const int w, const int h, const int r, const color fill, const color edge)
     {
      if(edge == fill)
        {
         FillRound(x, y, w, h, r, fill);
         return;
        }
      FillRound(x, y, w, h, r, edge);
      FillRound(x + 1, y + 1, w - 2, h - 2, MathMax(0, r - 1), fill);
     }

   void              Paint(const int w, const int h, const color bg, const color edge, const double shadow)
     {
      int m = Margin();
      m_pw = w + 2 * m;
      m_ph = h + 2 * m;
      int n = m_pw * m_ph;
      ArrayResize(m_px, n);
      for(int i = 0; i < n; i++)
         m_px[i] = 0;
      int r = S(8);
      // The shadow falls a little below the card and fades out over the margin. Only the pixels the
      // card leaves uncovered are worked out.
      double blur = MathMax(1.0, (double)m);
      int off = MathMax(1, S(2));
      for(int y = 0; y < m_ph; y++)
         for(int x = 0; x < m_pw; x++)
           {
            bool inX = (x >= m && x < m + w);
            bool inY = (y >= m && y < m + h);
            if((inX && y >= m + r && y < m + h - r) || (inY && x >= m + r && x < m + w - r))
               continue;
            double d = AiRoundDist(x + 0.5, y + 0.5, m, m + off, w, h, r);
            if(d >= blur)
               continue;
            double f = (d <= 0.0) ? 1.0 : (1.0 - d / blur);
            Blend(y * m_pw + x, 0, shadow * f * f);
           }
      PaintShape(m, m, w, h, r, bg, edge);
      int k = ArraySize(m_shapes);
      for(int i = 0; i < k; i++)
         PaintShape(m + m_shapes[i].x, m + m_shapes[i].y, m_shapes[i].w, m_shapes[i].h, m_shapes[i].r, m_shapes[i].fill, m_shapes[i].edge);
     }

   int               Track(const string name)
     {
      int n = ArraySize(m_names);
      for(int i = 0; i < n; i++)
         if(m_names[i] == name)
           {
            m_used[i] = true;
            return i;
           }
      ArrayResize(m_names, n + 1);
      ArrayResize(m_used, n + 1);
      ArrayResize(m_shown, n + 1);
      m_names[n] = name;
      m_used[n] = true;
      m_shown[n] = true;
      return n;
     }

   void              Reveal(const int i, const string name)
     {
      if(!m_shown[i])
        {
         ObjectSetInteger(0, name, OBJPROP_TIMEFRAMES, OBJ_ALL_PERIODS);
         m_shown[i] = true;
        }
     }

   // Writes a position or size only when it changed: a field being typed in keeps its caret.
   void              Place(const string name, const int x, const int y, const int w, const int h)
     {
      if(ObjectGetInteger(0, name, OBJPROP_XDISTANCE) != x)
         ObjectSetInteger(0, name, OBJPROP_XDISTANCE, x);
      if(ObjectGetInteger(0, name, OBJPROP_YDISTANCE) != y)
         ObjectSetInteger(0, name, OBJPROP_YDISTANCE, y);
      if(ObjectGetInteger(0, name, OBJPROP_XSIZE) != MathMax(w, 1))
         ObjectSetInteger(0, name, OBJPROP_XSIZE, MathMax(w, 1));
      if(ObjectGetInteger(0, name, OBJPROP_YSIZE) != MathMax(h, 1))
         ObjectSetInteger(0, name, OBJPROP_YSIZE, MathMax(h, 1));
     }

   // Fresh objects get an empty tooltip; otherwise hovering shows their internal name.
   void              NoTooltip(const string name)
     {
      ObjectSetString(0, name, OBJPROP_TOOLTIP, "\n");
     }

public:
   double            scale;       // pixels: Windows display scale x panel scale input
   double            fontScale;   // fonts: the panel scale input only (Windows scales fonts itself)
   string            font;
   int               fontSize;

                     CAiUi() : m_surf(""), m_surfX(0), m_surfY(0), m_surfNew(false), m_pw(0), m_ph(0), scale(1.0), fontScale(1.0),
                     font("Trebuchet MS"), fontSize(9) {}

   // The transparent border round a surface's picture that holds its shadow.
   int               Margin() const
     {
      return S(6);
     }

   bool              Painting() const
     {
      return (m_surf != "");
     }

   // Starts a surface whose card's top left corner is at (x, y). Its object is created now, before
   // the labels and fields of the frame, so they are drawn over it.
   void              BeginSurface(const string name, const int x, const int y)
     {
      m_surf = "";
      int i = Track(name);
      m_surfNew = false;
      if(ObjectFind(0, name) < 0)
        {
         if(!ObjectCreate(0, name, OBJ_BITMAP_LABEL, 0, 0, 0))
            return;
         ObjectSetInteger(0, name, OBJPROP_CORNER, CORNER_LEFT_UPPER);
         ObjectSetInteger(0, name, OBJPROP_BACK, false);
         ObjectSetInteger(0, name, OBJPROP_SELECTABLE, false);
         ObjectSetInteger(0, name, OBJPROP_HIDDEN, true);
         ObjectSetInteger(0, name, OBJPROP_ZORDER, 10);
         NoTooltip(name);
         m_shown[i] = true;
         m_surfNew = true;
        }
      Reveal(i, name);
      m_surf = name;
      m_surfX = x;
      m_surfY = y;
      ArrayResize(m_shapes, 0);
     }

   // A rounded shape on the surface being painted, at chart coordinates.
   void              Shape(const int x, const int y, const int w, const int h, const int r, const color fill, const color edge)
     {
      if(m_surf == "" || w <= 0 || h <= 0)
         return;
      int n = ArraySize(m_shapes);
      ArrayResize(m_shapes, n + 1);
      m_shapes[n].x = x - m_surfX;
      m_shapes[n].y = y - m_surfY;
      m_shapes[n].w = w;
      m_shapes[n].h = h;
      m_shapes[n].r = r;
      m_shapes[n].fill = fill;
      m_shapes[n].edge = edge;
     }

   // Ends the surface: a card w x h. The picture is painted again only when it would change, so a
   // tick or a drag of the panel costs nothing here.
   void              EndSurface(const int w, const int h, const color bg, const color edge, const double shadow)
     {
      if(m_surf == "")
         return;
      string name = m_surf;
      m_surf = "";
      int m = Margin();
      int pw = w + 2 * m;
      int ph = h + 2 * m;
      string sig = IntegerToString(w) + "x" + IntegerToString(h) + "|" + IntegerToString((int)bg) + "," + IntegerToString((int)edge) + "," +
                   DoubleToString(shadow, 2) + "," + IntegerToString(S(100));
      int n = ArraySize(m_shapes);
      for(int i = 0; i < n; i++)
         sig += ";" + IntegerToString(m_shapes[i].x) + "," + IntegerToString(m_shapes[i].y) + "," + IntegerToString(m_shapes[i].w) + "," +
                IntegerToString(m_shapes[i].h) + "," + IntegerToString(m_shapes[i].r) + "," + IntegerToString((int)m_shapes[i].fill) + "," +
                IntegerToString((int)m_shapes[i].edge);
      int slot = SigSlot(name);
      if(m_surfNew || m_sigText[slot] != sig)
        {
         Paint(w, h, bg, edge, shadow);
         if(ResourceCreate(ResName(name), m_px, pw, ph, 0, 0, pw, COLOR_FORMAT_ARGB_NORMALIZE))
           {
            ObjectSetString(0, name, OBJPROP_BMPFILE, ResName(name));
            m_sigText[slot] = sig;
           }
        }
      Place(name, m_surfX - m, m_surfY - m, pw, ph);
     }

   int               S(const double px) const
     {
      return (int)MathRound(px * scale);
     }

   int               F(const int size) const
     {
      return (int)MathMax(6, MathRound(size * fontScale));
     }

   string            BoldFont() const
     {
      return font + " Bold";
     }

   void              BeginFrame()
     {
      int n = ArraySize(m_used);
      for(int i = 0; i < n; i++)
         m_used[i] = false;
     }

   void              EndFrame()
     {
      int n = ArraySize(m_names);
      for(int i = 0; i < n; i++)
         if(!m_used[i] && m_shown[i])
           {
            ObjectSetInteger(0, m_names[i], OBJPROP_TIMEFRAMES, OBJ_NO_PERIODS);
            m_shown[i] = false;
           }
     }

   // Call after the objects were deleted from the chart.
   void              Forget()
     {
      ArrayResize(m_names, 0);
      ArrayResize(m_used, 0);
      ArrayResize(m_shown, 0);
      ArrayResize(m_sigName, 0);
      ArrayResize(m_sigText, 0);
      m_surf = "";
     }

   void              Rect(const string name, const int x, const int y, const int w, const int h, const color bg, const color border, const int z)
     {
      int i = Track(name);
      if(ObjectFind(0, name) < 0)
        {
         if(!ObjectCreate(0, name, OBJ_RECTANGLE_LABEL, 0, 0, 0))
            return;
         ObjectSetInteger(0, name, OBJPROP_CORNER, CORNER_LEFT_UPPER);
         ObjectSetInteger(0, name, OBJPROP_BORDER_TYPE, BORDER_FLAT);
         ObjectSetInteger(0, name, OBJPROP_WIDTH, 1);
         ObjectSetInteger(0, name, OBJPROP_BACK, false);
         ObjectSetInteger(0, name, OBJPROP_SELECTABLE, false);
         ObjectSetInteger(0, name, OBJPROP_HIDDEN, true);
         NoTooltip(name);
         m_shown[i] = true;
        }
      Reveal(i, name);
      ObjectSetInteger(0, name, OBJPROP_XDISTANCE, x);
      ObjectSetInteger(0, name, OBJPROP_YDISTANCE, y);
      ObjectSetInteger(0, name, OBJPROP_XSIZE, MathMax(w, 1));
      ObjectSetInteger(0, name, OBJPROP_YSIZE, MathMax(h, 1));
      ObjectSetInteger(0, name, OBJPROP_BGCOLOR, bg);
      ObjectSetInteger(0, name, OBJPROP_COLOR, border);
      ObjectSetInteger(0, name, OBJPROP_ZORDER, z);
     }

   void              Label(const string name, const int x, const int y, const string text, const color clr, const int size, const ENUM_ANCHOR_POINT anchor, const bool bold, const int z = 13)
     {
      int i = Track(name);
      if(ObjectFind(0, name) < 0)
        {
         if(!ObjectCreate(0, name, OBJ_LABEL, 0, 0, 0))
            return;
         ObjectSetInteger(0, name, OBJPROP_CORNER, CORNER_LEFT_UPPER);
         ObjectSetInteger(0, name, OBJPROP_BACK, false);
         ObjectSetInteger(0, name, OBJPROP_SELECTABLE, false);
         ObjectSetInteger(0, name, OBJPROP_HIDDEN, true);
         NoTooltip(name);
         m_shown[i] = true;
        }
      Reveal(i, name);
      ObjectSetInteger(0, name, OBJPROP_XDISTANCE, x);
      ObjectSetInteger(0, name, OBJPROP_YDISTANCE, y);
      ObjectSetInteger(0, name, OBJPROP_ANCHOR, anchor);
      // An empty OBJ_LABEL shows the word "Label".
      ObjectSetString(0, name, OBJPROP_TEXT, (text == "") ? " " : text);
      ObjectSetString(0, name, OBJPROP_FONT, bold ? BoldFont() : font);
      ObjectSetInteger(0, name, OBJPROP_FONTSIZE, F(size));
      ObjectSetInteger(0, name, OBJPROP_COLOR, clr);
      ObjectSetInteger(0, name, OBJPROP_ZORDER, z);
     }

   // refresh: the value changed outside the field. editing: the field the trader is typing in,
   // which is left completely alone so it keeps its focus and its half-typed text.
   void              Edit(const string name, const int x, const int y, const int w, const int h, const string text, const color txt, const color bg, const color border,
                          const bool refresh, const string editing, const int align = ALIGN_RIGHT)
     {
      int i = Track(name);
      bool created = false;
      if(ObjectFind(0, name) < 0)
        {
         if(!ObjectCreate(0, name, OBJ_EDIT, 0, 0, 0))
            return;
         ObjectSetInteger(0, name, OBJPROP_CORNER, CORNER_LEFT_UPPER);
         ObjectSetInteger(0, name, OBJPROP_BACK, false);
         ObjectSetInteger(0, name, OBJPROP_SELECTABLE, false);
         ObjectSetInteger(0, name, OBJPROP_HIDDEN, true);
         ObjectSetInteger(0, name, OBJPROP_READONLY, false);
         ObjectSetInteger(0, name, OBJPROP_ALIGN, align);
         NoTooltip(name);
         created = true;
         m_shown[i] = true;
        }
      Reveal(i, name);
      // The field being typed in still moves with the panel (dragged, or laid out again), or it
      // would come apart from it; only its text and colours are left alone.
      Place(name, x, y, w, h);
      if(!created && name == editing)
         return;
      ObjectSetInteger(0, name, OBJPROP_COLOR, txt);
      ObjectSetInteger(0, name, OBJPROP_BGCOLOR, bg);
      ObjectSetInteger(0, name, OBJPROP_BORDER_COLOR, border);
      ObjectSetString(0, name, OBJPROP_FONT, font);
      ObjectSetInteger(0, name, OBJPROP_FONTSIZE, F(fontSize));
      ObjectSetInteger(0, name, OBJPROP_ZORDER, 14);
      if(created || refresh)
         ObjectSetString(0, name, OBJPROP_TEXT, text);
     }

   // A flat button with centred text. On a surface its background is painted (rounded, radius r, or
   // 4 px when r < 0); elsewhere it is a rectangle object. A click on the text reaches its command by
   // the label's name, a click beside it by its position.
   void              Button(const string base, const int x, const int y, const int w, const int h, const string text, const color bg, const color border,
                            const color txt, const int size, const bool bold, const int r = -1)
     {
      if(Painting())
         Shape(x, y, w, h, (r < 0) ? S(4) : r, bg, border);
      else
         Rect(base + "#bg", x, y, w, h, bg, border, 12);
      // Text longer than the button (a large font or scale) is shortened, never run past its edges.
      Label(base + "#tx", x + w / 2, y + h / 2, Fit(text, w - S(6), size, bold), txt, size, ANCHOR_CENTER, bold, 13);
     }

   int               TextWidth(const string text, const int size, const bool bold = false)
     {
      TextSetFont(font, -F(size) * 10, bold ? FW_BOLD : FW_NORMAL);
      uint w = 0;
      uint h = 0;
      if(TextGetSize(text, w, h) && w > 0)
         return (int)w;
      return (int)(StringLen(text) * size * 0.75 * scale);
     }

   // Shortens text with ".." until it fits maxW pixels (long broker symbol names).
   string            Fit(const string text, const int maxW, const int size, const bool bold = false)
     {
      if(maxW <= 0 || TextWidth(text, size, bold) <= maxW)
         return text;
      string s = text;
      while(StringLen(s) > 1 && TextWidth(s + "..", size, bold) > maxW)
         s = StringSubstr(s, 0, StringLen(s) - 1);
      return s + "..";
     }
  };

#endif
