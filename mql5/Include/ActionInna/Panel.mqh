//+------------------------------------------------------------------+
//| ActionInna - panel layout and drawing                            |
//+------------------------------------------------------------------+
#ifndef ACTIONINNA_PANEL_MQH
#define ACTIONINNA_PANEL_MQH

#include "Defines.mqh"
#include "Util.mqh"
#include "Ui.mqh"

// Everything the panel shows, already formatted by the app.
struct AiView
  {
   string            symbol;
   string            period;          // the chart's timeframe, as MT5 names it (M15)
   string            bid;
   string            ask;
   string            spread;
   string            spreadPips;      // the spread alone, for the pill between SELL and BUY
   int               phase;
   int               side;
   bool              pending;
   bool              compact;         // the slim layout: chosen by the trader, or forced by a short chart
   bool              forcedCompact;   // compact only because the chart is too short for the full panel
   bool              menuOpen;
   bool              docked;          // the panel follows the chart's right edge
   string            chipText[3];
   int               chip;            // 0..2 presets, 3 custom
   string            customText;
   string            customUnit;
   string            riskShort;       // the active risk in a few characters, for the compact layout
   string            riskLabel;
   string            riskWord;        // the risk row's name: Risk, or Lots for a fixed size
   string            slText;
   string            slUnit;
   string            tpText;
   string            tpUnit;
   string            entryText;
   string            entryType;
   string            lots;
   string            lotsNum;         // the lots alone, in large type
   string            unitsText;       // (66 units)
   string            risk;
   string            riskMoney;       // the risk in money, for its tile
   string            riskPctText;     // and in % of the risk base
   string            reward;
   string            rewardMoney;
   string            rewardPctText;
   string            rr;
   string            pips;
   string            pipsShort;       // SL 150 / TP 150, under the risk : reward
   string            pipValue;
   string            margin;
   string            marginShort;     // the margin alone
   string            freeShort;       // (free $97,664)
   string            commission;
   bool              showCommission;
   string            confirmText;
   bool              confirmEnabled;
   bool              showCancel;      // X only appears when it has something to close
   string            status;
   int               statusLevel;     // 0 info, 1 warning, 2 error, 3 done
   bool              autoRecall;
   bool              oneClick;
   string            baseName;
   string            editing;         // edit field the trader is typing in
   bool              refreshEdits;    // values changed outside the edit fields
   int               focusCmd;        // control with keyboard focus (ENUM_AI_CMD), AI_CMD_NONE = none

   // The modify card: a change to an open trade, waiting for Confirm.
   bool              modOpen;
   int               modSide;
   int               modY;            // height of the line that was dropped, the card's centre
   string            modTitle;
   string            modTicket;
   bool              modEntryEdit;    // pending order: the entry can be typed
   string            modEntryText;
   string            modEntryWas;
   string            modEntryMoney;
   int               modEntryTone;    // -1 loss, 1 gain, 0 neither
   string            modSlText;
   string            modSlWas;
   string            modSlMoney;
   int               modSlTone;
   string            modTpText;
   string            modTpWas;
   string            modTpMoney;
   int               modTpTone;
   string            modRR;
   string            modStatus;
   int               modStatusLevel;  // 0 info, 1 warning, 2 error
   string            modConfirmText;
   bool              modConfirmEnabled;
  };

// An en dash for the - buttons: a hyphen is too short to read as minus. (Sources stay ASCII.)
#define AI_DASH ShortToString(0x2013)

// The full ticket's rows, top to bottom, in unscaled pixels. Render lays them out and FullHeight
// adds them up, so the panel knows whether the full ticket fits the chart without drawing it.
#define AI_HEAD_H       36   // header: grip, symbol, menu, dock, collapse
#define AI_TOP_GAP      8
#define AI_SIDE_H       50   // SELL and BUY
#define AI_SIDE_GAP     8
#define AI_SEG_H        28   // Market | Limit / Stop
#define AI_SEG_GAP      6
#define AI_ROW_H        26   // entry, risk, stop loss and take profit rows
#define AI_ROW_GAP      5
#define AI_LEVELS_GAP   8    // after the take profit row
#define AI_DIV_GAP      6    // after the line above the money
#define AI_LOTS_H       22
#define AI_TILE_H       44
#define AI_TILE_GAP     5
#define AI_META_H       16   // pip value and margin: one row, or two when long
#define AI_COMM_H       17
#define AI_META_GAP     6
#define AI_CONFIRM_H    38
#define AI_CONFIRM_GAP  5
#define AI_STATUS_H     31   // two lines of status

// Object names are AI_P_<TOKEN>#<part>. Clickable tokens map to commands; tokens starting with X
// are decoration. The panel and the card are surfaces (CAiUi.BeginSurface): their backgrounds are
// painted into one picture each, and a click on the picture is matched to a control by position.
class CAiPanel
  {
private:
   // Keyboard focus order: every control in visual order, with its rectangle for the focus ring
   // and for matching a click on the picture.
   int               m_fCmd[];
   int               m_fx[];
   int               m_fy[];
   int               m_fw[];
   int               m_fh[];
   int               m_dragRight;     // the header moves the panel left of this x
   int               m_cardX;         // where the modify card was drawn; m_cardW is 0 while it is closed
   int               m_cardY;
   int               m_cardW;
   int               m_cardH;

   void              ClearFocusList()
     {
      ArrayResize(m_fCmd, 0);
      ArrayResize(m_fx, 0);
      ArrayResize(m_fy, 0);
      ArrayResize(m_fw, 0);
      ArrayResize(m_fh, 0);
     }

   void              AddFocus(const ENUM_AI_CMD cmd, const int fx, const int fy, const int fw, const int fh)
     {
      int n = ArraySize(m_fCmd);
      ArrayResize(m_fCmd, n + 1);
      ArrayResize(m_fx, n + 1);
      ArrayResize(m_fy, n + 1);
      ArrayResize(m_fw, n + 1);
      ArrayResize(m_fh, n + 1);
      m_fCmd[n] = (int)cmd;
      m_fx[n] = fx;
      m_fy[n] = fy;
      m_fw[n] = fw;
      m_fh[n] = fh;
     }

   // A button that is part of the focus order.
   void              Control(const ENUM_AI_CMD cmd, const string base, const int bx, const int by, const int bw, const int bh,
                             const string text, const color bg, const color border, const color txt, const int size, const bool bold, CAiUi &ui,
                             const int r = -1)
     {
      ui.Button(base, bx, by, bw, bh, text, bg, border, txt, size, bold, r);
      AddFocus(cmd, bx, by, bw, bh);
     }

   // Selected controls are neutral: text-coloured edge and bold text, so blue keeps meaning BUY.
   void              Choice(const ENUM_AI_CMD cmd, const string base, const int bx, const int by, const int bw, const int bh,
                            const string text, const bool on, const int size, const AiTheme &t, CAiUi &ui)
     {
      Control(cmd, base, bx, by, bw, bh, text, on ? t.selected : t.chip, on ? t.text : t.inputBorder, t.text, size, on, ui);
     }

   void              Wrap(const string text, const int maxW, const int fs, CAiUi &ui, string &l1, string &l2)
     {
      l1 = text;
      l2 = "";
      if(text == "" || ui.TextWidth(text, fs) <= maxW)
         return;
      string words[];
      int n = StringSplit(text, ' ', words);
      l1 = "";
      int i = 0;
      for(; i < n; i++)
        {
         string cand = (l1 == "") ? words[i] : l1 + " " + words[i];
         if(l1 != "" && ui.TextWidth(cand, fs) > maxW)
            break;
         l1 = cand;
        }
      for(; i < n; i++)
         l2 = (l2 == "") ? words[i] : l2 + " " + words[i];
      while(StringLen(l2) > 4 && ui.TextWidth(l2, fs) > maxW)
         l2 = StringSubstr(l2, 0, StringLen(l2) - 4) + "...";
     }

   // A field in a rounded frame, with - and + either side of the number. The field itself is MT5's
   // edit box, without an edge of its own, over the painted frame.
   void              Stepper(const ENUM_AI_CMD dec, const ENUM_AI_CMD inc, const string key, const string edit, const string text,
                             const int fx, const int fy, const int fw, const int rowH, const AiView &v, const AiTheme &t, CAiUi &ui)
     {
      int sw = ui.S(22);
      ui.Shape(fx, fy, fw, rowH, ui.S(4), t.inputBg, t.inputBorder);
      Control(dec, AI_P + key + "DEC", fx + 1, fy + 1, sw, rowH - 2, AI_DASH, t.inputBg, t.inputBg, t.muted, ui.fontSize + 1, true, ui, ui.S(3));
      Control(inc, AI_P + key + "INC", fx + fw - 1 - sw, fy + 1, sw, rowH - 2, "+", t.inputBg, t.inputBg, t.muted, ui.fontSize + 1, true, ui, ui.S(3));
      ui.Edit(edit, fx + 1 + sw, fy + ui.S(3), fw - 2 - 2 * sw, rowH - ui.S(6), text, t.text, t.inputBg, t.inputBg, v.refreshEdits, v.editing, ALIGN_CENTER);
     }

   // Stop loss or take profit: name, field with - and +, unit (pips / price / R), and Last.
   void              LevelRow(const ENUM_AI_CMD modeCmd, const ENUM_AI_CMD lastCmd, const ENUM_AI_CMD dec, const ENUM_AI_CMD inc, const string key,
                              const string label, const string text, const string unit, const int cx, const int cy, const int cw, const int lblW,
                              const int gap, const int rowH, const AiView &v, const AiTheme &t, CAiUi &ui)
     {
      int fs = ui.fontSize;
      int unitW = ui.S(48);
      int lastW = ui.S(40);
      int fx = cx + lblW;
      int fw = cw - lblW - unitW - lastW - 2 * gap;
      ui.Label(AI_P + "X" + key + "LBL#t", cx, cy + rowH / 2, label, t.muted, fs, ANCHOR_LEFT, false);
      Stepper(dec, inc, key, AI_P + "E_" + key, text, fx, cy, fw, rowH, v, t, ui);
      Control(modeCmd, AI_P + key + "MODE", fx + fw + gap, cy, unitW, rowH, unit, t.chip, t.inputBorder, t.text, fs - 1, false, ui);
      Control(lastCmd, AI_P + key + "LAST", fx + fw + unitW + 2 * gap, cy, lastW, rowH, "Last", t.chip, t.inputBorder, t.muted, fs - 1, false, ui);
     }

   int               Readout(const string key, const string label, const string value, const color vc, const int cx, const int cy,
                             const int cw, const int rh, const AiTheme &t, CAiUi &ui, const bool bold)
     {
      ui.Label(AI_P + "XR" + key + "#l", cx, cy, label, t.muted, ui.fontSize - 1, ANCHOR_LEFT_UPPER, false);
      ui.Label(AI_P + "XR" + key + "#v", cx + cw, cy, value, vc, ui.fontSize - 1, ANCHOR_RIGHT_UPPER, bold);
      return cy + rh;
     }

   // One of the three money tiles: its name, the number and what it is in %.
   void              Tile(const string key, const string label, const string value, const string sub, const color vc, const int tx, const int ty,
                          const int tw, const int th, const AiTheme &t, CAiUi &ui)
     {
      int fs = ui.fontSize;
      int in = ui.S(8);
      int fit = tw - 2 * in;
      ui.Shape(tx, ty, tw, th, ui.S(4), t.tile, t.tile);
      ui.Label(AI_P + "XT" + key + "#k", tx + in, ty + ui.S(5), label, t.muted, fs - 1, ANCHOR_LEFT_UPPER, false);
      ui.Label(AI_P + "XT" + key + "#v", tx + in, ty + ui.S(17), ui.Fit(value, fit, fs, true), vc, fs, ANCHOR_LEFT_UPPER, true);
      ui.Label(AI_P + "XT" + key + "#s", tx + in, ty + ui.S(30), ui.Fit(sub, fit, fs - 1), t.muted, fs - 1, ANCHOR_LEFT_UPPER, false);
     }

   // A whole-row toggle: a box that is filled when on, plus the words On/Off, so the state never
   // depends on colour alone.
   int               Toggle(const ENUM_AI_CMD cmd, const string key, const string label, const bool on, const int cx, const int cy, const int cw,
                            const AiTheme &t, CAiUi &ui)
     {
      int rh = ui.S(24);
      int box = ui.S(12);
      ui.Shape(cx, cy + (rh - box) / 2, box, box, ui.S(3), on ? t.text : t.inputBg, on ? t.text : t.inputBorder);
      string st = on ? "On" : "Off";
      int room = cw - box - ui.S(8) - ui.TextWidth("Off", ui.fontSize - 1, true) - ui.S(8);
      ui.Label(AI_P + key + "#tx", cx + box + ui.S(8), cy + rh / 2, ui.Fit(label, room, ui.fontSize - 1), t.text, ui.fontSize - 1, ANCHOR_LEFT, false, 13);
      ui.Label(AI_P + key + "#st", cx + cw, cy + rh / 2, st, t.muted, ui.fontSize - 1, ANCHOR_RIGHT, on, 13);
      AddFocus(cmd, cx, cy, cw, rh);
      return cy + rh;
     }

   // CONFIRM (and X when it can close something), then two status lines.
   int               ConfirmAndStatus(const AiView &v, const AiTheme &t, CAiUi &ui, const int cx, const int top, const int cw, const int gap, const bool showConfirm)
     {
      int fs = ui.fontSize;
      int cy = top;
      if(showConfirm)
        {
         int xw = ui.S(44);
         int ch2 = ui.S(AI_CONFIRM_H);
         int confW = v.showCancel ? cw - xw - ui.S(6) : cw;
         color cbg = v.confirmEnabled ? ((v.side == AI_BUY) ? t.buyFill : t.sellFill) : t.chip;
         color cbd = v.confirmEnabled ? cbg : t.inputBorder;
         color ctx = v.confirmEnabled ? t.onFill : t.muted;
         Control(AI_CMD_CONFIRM, AI_P + "CONFIRM", cx, cy, confW, ch2, v.confirmText, cbg, cbd, ctx, fs + 1, true, ui, ui.S(6));
         if(v.showCancel)
            Control(AI_CMD_CANCEL, AI_P + "CANCEL", cx + confW + ui.S(6), cy, xw, ch2, "X", t.chip, t.inputBorder, t.text, fs, true, ui, ui.S(6));
         cy += ch2 + ui.S(AI_CONFIRM_GAP);
        }
      color sc = t.muted;
      if(v.statusLevel == 1)
         sc = t.warn;
      else if(v.statusLevel == 2)
         sc = t.danger;
      else if(v.statusLevel == 3)
         sc = t.good;
      string l1 = "";
      string l2 = "";
      Wrap(v.status, cw, fs - 1, ui, l1, l2);
      ui.Label(AI_P + "XST1#t", cx, cy, l1, sc, fs - 1, ANCHOR_LEFT_UPPER, false);
      ui.Label(AI_P + "XST2#t", cx, cy + ui.S(14), l2, sc, fs - 1, ANCHOR_LEFT_UPPER, false);
      return cy + ui.S(AI_STATUS_H);
     }

   // Whether pip value and margin take two rows: long amounts would run into each other on one.
   bool              MetaTwoRows(const AiView &v, const int cw, CAiUi &ui)
     {
      int mf = ui.fontSize - 1;
      int pipW = ui.TextWidth("Pip value", mf) + ui.S(5) + ui.TextWidth(v.pipValue, mf, true);
      int marginW = ui.TextWidth("Margin", mf) + ui.S(5) + ui.TextWidth(v.marginShort, mf, true) + ui.S(4) + ui.TextWidth(v.freeShort, mf);
      return (pipW + ui.S(12) + marginW > cw);
     }

   // The full ticket's height, without its menu, as Render lays it out (the AI_ rows above).
   int               FullHeight(const AiView &v, CAiUi &ui)
     {
      int rows = ui.S(AI_ROW_H);
      int hgt = ui.S(AI_HEAD_H) + ui.S(AI_TOP_GAP) + ui.S(AI_SIDE_H) + ui.S(AI_SIDE_GAP) + ui.S(AI_SEG_H) + ui.S(AI_SEG_GAP);
      if(v.pending)
         hgt += rows + ui.S(AI_ROW_GAP);
      hgt += 2 * (rows + ui.S(AI_ROW_GAP)) + rows + ui.S(AI_LEVELS_GAP);
      hgt += ui.S(AI_DIV_GAP) + ui.S(AI_LOTS_H) + ui.S(AI_TILE_H) + ui.S(AI_TILE_GAP);
      hgt += ui.S(AI_META_H) * (MetaTwoRows(v, w - 2 * ui.S(10), ui) ? 2 : 1);
      if(v.showCommission)
         hgt += ui.S(AI_COMM_H);
      hgt += ui.S(AI_META_GAP) + ui.S(AI_CONFIRM_H) + ui.S(AI_CONFIRM_GAP) + ui.S(AI_STATUS_H);
      return hgt;
     }

   int               Menu(const AiView &v, const AiTheme &t, CAiUi &ui, const int cx, const int top, const int cw, const int gap, const int rowH)
     {
      int fs = ui.fontSize;
      int cy = top;
      ui.Shape(cx, cy, cw, 1, 0, t.divider, t.divider);
      cy += ui.S(6);
      cy = Toggle(AI_CMD_OPT_AUTO, "OPTAUTO", "Set SL/TP automatically", v.autoRecall, cx, cy, cw, t, ui);
      cy = Toggle(AI_CMD_OPT_ONECLICK, "OPTONE", "One-click trading (no preview)", v.oneClick, cx, cy, cw, t, ui);
      cy += gap;
      Control(AI_CMD_OPT_BASE, AI_P + "OPTBASE", cx, cy, cw, rowH, "Risk % is measured on: " + v.baseName, t.chip, t.inputBorder, t.text, fs - 1, false, ui);
      cy += rowH + gap;
      int hw = (cw - gap) / 2;
      Control(AI_CMD_PIN, AI_P + "PIN", cx, cy, hw, rowH, "Pin to new charts", t.chip, t.inputBorder, t.text, fs - 1, false, ui);
      Control(AI_CMD_TEMPLATE, AI_P + "SAVETPL", cx + hw + gap, cy, cw - hw - gap, rowH, "Save template", t.chip, t.inputBorder, t.text, fs - 1, false, ui);
      return cy + rowH + ui.S(8);
     }

   // Four bars around the focused control, in the text colour (above 3:1 on the panel in both themes).
   void              FocusRing(const int idx, const AiTheme &t, CAiUi &ui)
     {
      int th = MathMax(2, ui.S(2));
      int off = MathMax(1, ui.S(2));
      int fx = m_fx[idx] - off - th;
      int fy = m_fy[idx] - off - th;
      int fw = m_fw[idx] + 2 * (off + th);
      int fh = m_fh[idx] + 2 * (off + th);
      ui.Rect(AI_P + "XFOC#t", fx, fy, fw, th, t.text, t.text, 15);
      ui.Rect(AI_P + "XFOC#b", fx, fy + fh - th, fw, th, t.text, t.text, 15);
      ui.Rect(AI_P + "XFOC#l", fx, fy, th, fh, t.text, t.text, 15);
      ui.Rect(AI_P + "XFOC#r", fx + fw - th, fy, th, fh, t.text, t.text, 15);
     }

   color             ToneColor(const int tone, const AiTheme &t) const
     {
      if(tone < 0)
         return t.danger;
      if(tone > 0)
         return t.good;
      return t.muted;
     }

   // One level on the modify card: label and price field, then "was ..." and the money below them.
   int               CardRow(const string key, const string label, const bool editable, const string text, const string was, const string money,
                             const int tone, const int cx, const int cy, const int cw, const int lblW, const AiView &v, const AiTheme &t, CAiUi &ui)
     {
      int fs = ui.fontSize;
      int rowH = ui.S(24);
      ui.Label(AI_P + "XM" + key + "L#t", cx, cy + rowH / 2, label, t.text, fs, ANCHOR_LEFT, false);
      if(editable)
        {
         ui.Shape(cx + lblW, cy, cw - lblW, rowH, ui.S(4), t.inputBg, t.inputBorder);
         ui.Edit(AI_P + "E_M" + key, cx + lblW + ui.S(4), cy + ui.S(3), cw - lblW - ui.S(8), rowH - ui.S(6), text, t.text, t.inputBg, t.inputBg,
                 v.refreshEdits, v.editing);
        }
      else
         ui.Label(AI_P + "XM" + key + "V#t", cx + cw, cy + rowH / 2, text, t.text, fs, ANCHOR_RIGHT, false);
      int sy = cy + rowH + ui.S(2);
      ui.Label(AI_P + "XM" + key + "W#t", cx, sy, was, t.muted, fs - 1, ANCHOR_LEFT_UPPER, false);
      ui.Label(AI_P + "XM" + key + "M#t", cx + cw, sy, money, ToneColor(tone, t), fs - 1, ANCHOR_RIGHT_UPPER, tone != 0);
      return cy + rowH + ui.S(19);
     }

   // Matches the steps RenderCard takes, so the card can be placed before it is drawn.
   int               CardHeight(CAiUi &ui) const
     {
      return ui.S(8) + ui.S(24) + ui.S(6) + 3 * (ui.S(24) + ui.S(19)) + 1 + ui.S(6) + ui.S(17) + ui.S(4) + ui.S(34) + ui.S(32) + ui.S(10);
     }

   // The header: grip, symbol and timeframe on the left (where the panel is taken to move it), then
   // the menu, dock and collapse buttons.
   int               Header(const AiView &v, const AiTheme &t, CAiUi &ui)
     {
      int fs = ui.fontSize;
      int pad = ui.S(10);
      int gap = ui.S(4);
      int hh = ui.S(AI_HEAD_H);
      int bw = ui.S(26);
      int by = y + (hh - bw) / 2;
      int right = x + w - ui.S(6);
      int colX = right - bw;
      int dockX = v.forcedCompact ? right - bw : colX - gap - bw;
      int menuX = dockX - gap - bw;
      m_dragRight = menuX - gap;

      // Six dots: the panel can be taken here.
      int gx = x + pad;
      int gy = y + hh / 2 - ui.S(5);
      int dot = MathMax(2, ui.S(2));
      for(int r = 0; r < 3; r++)
         for(int c = 0; c < 2; c++)
            ui.Shape(gx + c * ui.S(4), gy + r * ui.S(4), dot, dot, dot / 2, t.muted, t.muted);

      int sx = gx + ui.S(12);
      int perW = ui.TextWidth(v.period, fs - 1);
      string sym = ui.Fit(v.symbol, m_dragRight - sx - perW - ui.S(10), fs + 2, true);
      ui.Label(AI_P + "XSYM#t", sx, y + hh / 2, sym, t.text, fs + 2, ANCHOR_LEFT, true);
      ui.Label(AI_P + "XPER#t", sx + ui.TextWidth(sym, fs + 2, true) + ui.S(6), y + hh / 2, v.period, t.muted, fs - 1, ANCHOR_LEFT, false);

      Control(AI_CMD_MENU, AI_P + "MENU", menuX, by, bw, bw, "...", v.menuOpen ? t.selected : t.bg, v.menuOpen ? t.selected : t.bg, t.text, fs, true, ui);
      // Dock: a window with its right part filled, in the text colour while docked.
      Control(AI_CMD_DOCK, AI_P + "DOCK", dockX, by, bw, bw, "", v.docked ? t.selected : t.bg, v.docked ? t.selected : t.bg, t.text, fs, false, ui);
      color ic = v.docked ? t.text : t.muted;
      int iw = ui.S(14);
      int ih = ui.S(11);
      int ix = dockX + (bw - iw) / 2;
      int iy = by + (bw - ih) / 2;
      ui.Shape(ix, iy, iw, ih, ui.S(2), v.docked ? t.selected : t.bg, ic);
      ui.Shape(ix + iw - ui.S(5), iy, ui.S(5), ih, ui.S(2), ic, ic);
      // While a short chart forces the slim layout there is nothing to expand, so no button.
      if(!v.forcedCompact)
         Control(AI_CMD_COLLAPSE, AI_P + "COLLAPSE", colX, by, bw, bw, v.compact ? "+" : AI_DASH, t.bg, t.bg, t.text, fs + 2, true, ui);
      ui.Shape(x + 1, y + hh, w - 2, 1, 0, t.divider, t.divider);
      return y + hh;
     }

public:
   int               x;
   int               y;               // where the panel is drawn
   int               prefY;           // where the trader put it; y moves up only while the chart is too short
   int               w;
   int               h;
   int               fullH;           // height of the full layout, measured on its last render
   bool              docked;          // follows the right edge of the chart
   int               tagsFrom;        // the price tags' column starts here (-1: no column); the card keeps left of it
   int               chartW;
   int               chartH;

                     CAiPanel() : m_dragRight(0), m_cardX(0), m_cardY(0), m_cardW(0), m_cardH(0), x(0), y(0), prefY(0), w(300), h(300),
                     fullH(0), docked(true), tagsFrom(-1), chartW(800), chartH(600) {}

   int               DockX(CAiUi &ui) const
     {
      return chartW - w - ui.S(10);
     }

   void              Place(const int cw, const int ch, CAiUi &ui)
     {
      chartW = cw;
      chartH = ch;
      w = ui.S(300);
      // A first guess below the full ticket's height: the first frame then draws it and measures it.
      if(fullH <= 0)
         fullH = ui.S(380);
      if(docked)
         x = DockX(ui);
      Clamp(ui);
     }

   // Moves the panel where the trader drags it. Near an edge of the chart, or near its docked place,
   // it snaps there.
   void              MoveTo(const int nx, const int ny, CAiUi &ui)
     {
      int snap = ui.S(12);
      x = nx;
      prefY = ny;
      if(MathAbs(x) < snap)
         x = 0;
      if(MathAbs(x - DockX(ui)) < snap)
         x = DockX(ui);
      if(MathAbs(prefY) < snap)
         prefY = 0;
      if(MathAbs(prefY + h - chartH) < snap)
         prefY = chartH - h;
      Clamp(ui);
     }

   void              Clamp(CAiUi &ui)
     {
      if(x > chartW - ui.S(60))
         x = chartW - ui.S(60);
      if(x < 0)
         x = 0;
      if(prefY < 0)
         prefY = 0;
      y = MathMax(0, MathMin(prefY, chartH - h));
     }

   // Whether the full layout fits the chart's height.
   bool              FullFits(CAiUi &ui) const
     {
      return (fullH + ui.S(8) <= chartH);
     }

   bool              Contains(const int px, const int py) const
     {
      return (px >= x && px < x + w && py >= y && py < y + h);
     }

   bool              InCard(const int px, const int py) const
     {
      return (m_cardW > 0 && px >= m_cardX && px < m_cardX + m_cardW && py >= m_cardY && py < m_cardY + m_cardH);
     }

   // The free part of the header, left of its buttons, moves the panel.
   bool              InHeader(const int px, const int py, CAiUi &ui) const
     {
      return (px >= x && px < m_dragRight && py >= y && py < y + ui.S(AI_HEAD_H));
     }

   int               FocusCount() const
     {
      return ArraySize(m_fCmd);
     }

   ENUM_AI_CMD       FocusCmd(const int i) const
     {
      if(i < 0 || i >= ArraySize(m_fCmd))
         return AI_CMD_NONE;
      return (ENUM_AI_CMD)m_fCmd[i];
     }

   int               FocusIndex(const int cmd) const
     {
      if(cmd == AI_CMD_NONE)
         return -1;
      int n = ArraySize(m_fCmd);
      for(int i = 0; i < n; i++)
         if(m_fCmd[i] == cmd)
            return i;
      return -1;
     }

   // The control at a point of the panel or the card (a click on their picture).
   ENUM_AI_CMD       CmdAt(const int px, const int py) const
     {
      for(int i = ArraySize(m_fCmd) - 1; i >= 0; i--)
         if(px >= m_fx[i] && px < m_fx[i] + m_fw[i] && py >= m_fy[i] && py < m_fy[i] + m_fh[i])
            return (ENUM_AI_CMD)m_fCmd[i];
      return AI_CMD_NONE;
     }

   ENUM_AI_CMD       CmdFromName(const string name) const
     {
      int plen = StringLen(AI_P);
      if(StringFind(name, AI_P) != 0)
         return AI_CMD_NONE;
      int hash = StringFind(name, "#", plen);
      string token = (hash > 0) ? StringSubstr(name, plen, hash - plen) : StringSubstr(name, plen);
      if(token == "BUY" || token == "MBUY")
         return AI_CMD_BUY;
      if(token == "SELL" || token == "MSELL")
         return AI_CMD_SELL;
      if(token == "CONFIRM")
         return AI_CMD_CONFIRM;
      if(token == "CANCEL")
         return AI_CMD_CANCEL;
      if(token == "RISK1")
         return AI_CMD_RISK1;
      if(token == "RISK2")
         return AI_CMD_RISK2;
      if(token == "RISK3")
         return AI_CMD_RISK3;
      if(token == "RISKUNIT")
         return AI_CMD_RISK_UNIT;
      if(token == "MRISK")
         return AI_CMD_RISK_NEXT;
      if(token == "SLMODE")
         return AI_CMD_SL_MODE;
      if(token == "TPMODE")
         return AI_CMD_TP_MODE;
      if(token == "SLLAST")
         return AI_CMD_SL_RECALL;
      if(token == "TPLAST")
         return AI_CMD_TP_RECALL;
      if(token == "SLDEC")
         return AI_CMD_SL_DEC;
      if(token == "SLINC")
         return AI_CMD_SL_INC;
      if(token == "TPDEC")
         return AI_CMD_TP_DEC;
      if(token == "TPINC")
         return AI_CMD_TP_INC;
      if(token == "ENTRYDEC")
         return AI_CMD_ENTRY_DEC;
      if(token == "ENTRYINC")
         return AI_CMD_ENTRY_INC;
      if(token == "MKT")
         return AI_CMD_MARKET;
      if(token == "PND")
         return AI_CMD_PENDING;
      if(token == "KIND")
         return AI_CMD_KIND;
      if(token == "MENU")
         return AI_CMD_MENU;
      if(token == "DOCK")
         return AI_CMD_DOCK;
      if(token == "COLLAPSE")
         return AI_CMD_COLLAPSE;
      if(token == "OPTAUTO")
         return AI_CMD_OPT_AUTO;
      if(token == "OPTONE")
         return AI_CMD_OPT_ONECLICK;
      if(token == "OPTBASE")
         return AI_CMD_OPT_BASE;
      if(token == "PIN")
         return AI_CMD_PIN;
      if(token == "SAVETPL")
         return AI_CMD_TEMPLATE;
      if(token == "MODOK")
         return AI_CMD_MOD_CONFIRM;
      if(token == "MODX")
         return AI_CMD_MOD_CANCEL;
      return AI_CMD_NONE;
     }

   void              Render(const AiView &v, const AiTheme &t, CAiUi &ui)
     {
      ClearFocusList();
      int fs = ui.fontSize;
      int pad = ui.S(10);
      int gap = ui.S(4);
      int cx = x + pad;
      int cw = w - 2 * pad;
      int rowH = ui.S(AI_ROW_H);

      // The picture first: the labels and fields created after it are drawn over it.
      ui.BeginSurface(AI_P + "XBG#r", x, y);
      int cy = Header(v, t, ui) + ui.S(AI_TOP_GAP);

      // SELL / BUY with live prices. The side being previewed is filled.
      bool live = (v.phase != AI_PHASE_IDLE);
      bool sellOn = (live && v.side == AI_SELL);
      bool buyOn = (live && v.side == AI_BUY);
      if(v.compact)
        {
         int third = (cw - 2 * gap) / 3;
         int mh = ui.S(34);
         Control(AI_CMD_SELL, AI_P + "MSELL", cx, cy, third, mh, v.bid, sellOn ? t.sellFill : t.sellDim, sellOn ? t.sellFill : t.sellEdge,
                 sellOn ? t.onFill : t.sellText, fs + 1, true, ui, ui.S(6));
         Control(AI_CMD_RISK_NEXT, AI_P + "MRISK", cx + third + gap, cy, third, mh, v.riskShort, t.chip, t.inputBorder, t.text, fs - 1, false, ui, ui.S(6));
         Control(AI_CMD_BUY, AI_P + "MBUY", cx + 2 * (third + gap), cy, cw - 2 * (third + gap), mh, v.ask, buyOn ? t.buyFill : t.buyDim,
                 buyOn ? t.buyFill : t.buyEdge, buyOn ? t.onFill : t.buyText, fs + 1, true, ui, ui.S(6));
         cy += mh + ui.S(8);
         cy = ConfirmAndStatus(v, t, ui, cx, cy, cw, gap, v.phase != AI_PHASE_IDLE);
         // The full ticket is not drawn here, so its height is worked out: when the chart grows tall
         // enough, the next frame goes back to it.
         fullH = FullHeight(v, ui);
         if(v.menuOpen)
            cy = Menu(v, t, ui, cx, cy, cw, gap, ui.S(24));
         h = cy - y;
         ui.EndSurface(w, h, t.bg, t.border, t.shadow);
         int fc = FocusIndex(v.focusCmd);
         if(fc >= 0)
            FocusRing(fc, t, ui);
         return;
        }

      int half = (cw - ui.S(6)) / 2;
      int bh = ui.S(AI_SIDE_H);
      color sellTx = sellOn ? t.onFill : t.sellText;
      color buyTx = buyOn ? t.onFill : t.buyText;
      // Prices in large type, smaller for a long one (BTCUSD, indices), so they keep clear of the spread pill.
      int pillW = (v.spreadPips != "") ? ui.TextWidth(v.spreadPips, fs - 1) + ui.S(14) : 0;
      int priceRoom = half - ui.S(12) - pillW / 2 - ui.S(6);
      int pf = fs + 6;
      while(pf > fs && MathMax(ui.TextWidth(v.bid, pf, true), ui.TextWidth(v.ask, pf, true)) > priceRoom)
         pf--;
      ui.Shape(cx, cy, half, bh, ui.S(6), sellOn ? t.sellFill : t.sellDim, sellOn ? t.sellFill : t.sellEdge);
      ui.Label(AI_P + "SELL#t1", cx + ui.S(12), cy + ui.S(8), "SELL", sellTx, fs - 1, ANCHOR_LEFT_UPPER, true);
      ui.Label(AI_P + "SELL#t2", cx + ui.S(12), cy + ui.S(21), ui.Fit(v.bid, priceRoom, pf, true), sellTx, pf, ANCHOR_LEFT_UPPER, true);
      AddFocus(AI_CMD_SELL, cx, cy, half, bh);
      int bx2 = cx + half + ui.S(6);
      int bw2 = cw - half - ui.S(6);
      ui.Shape(bx2, cy, bw2, bh, ui.S(6), buyOn ? t.buyFill : t.buyDim, buyOn ? t.buyFill : t.buyEdge);
      ui.Label(AI_P + "BUY#t1", bx2 + bw2 - ui.S(12), cy + ui.S(8), "BUY", buyTx, fs - 1, ANCHOR_RIGHT_UPPER, true);
      ui.Label(AI_P + "BUY#t2", bx2 + bw2 - ui.S(12), cy + ui.S(21), ui.Fit(v.ask, priceRoom, pf, true), buyTx, pf, ANCHOR_RIGHT_UPPER, true);
      AddFocus(AI_CMD_BUY, bx2, cy, bw2, bh);
      // The spread, in a pill between the two.
      if(v.spreadPips != "")
        {
         int pw = pillW;
         int ph = ui.S(18);
         ui.Shape(x + w / 2 - pw / 2, cy + bh / 2 - ph / 2, pw, ph, ph / 2, t.bg, t.border);
         ui.Label(AI_P + "XSPREAD#t", x + w / 2, cy + bh / 2, v.spreadPips, t.muted, fs - 1, ANCHOR_CENTER, false, 14);
        }
      cy += bh + ui.S(AI_SIDE_GAP);

      // Market | Limit / Stop, both choices in sight.
      int segH = ui.S(AI_SEG_H);
      int segW = (cw - ui.S(6)) / 2;
      ui.Shape(cx, cy, cw, segH, ui.S(6), t.inputBg, t.divider);
      Control(AI_CMD_MARKET, AI_P + "MKT", cx + ui.S(2), cy + ui.S(2), segW, segH - ui.S(4), "Market", v.pending ? t.inputBg : t.selected,
              v.pending ? t.inputBg : t.selected, v.pending ? t.muted : t.text, fs - 1, !v.pending, ui);
      Control(AI_CMD_PENDING, AI_P + "PND", cx + ui.S(4) + segW, cy + ui.S(2), cw - segW - ui.S(6), segH - ui.S(4), "Limit / Stop",
              v.pending ? t.selected : t.inputBg, v.pending ? t.selected : t.inputBg, v.pending ? t.text : t.muted, fs - 1, v.pending, ui);
      cy += segH + ui.S(AI_SEG_GAP);

      // The name column is as wide as its longest name, so a larger font never runs into the fields.
      int lblW = MathMax(ui.S(64), MathMax(ui.TextWidth("Take profit", fs), MathMax(ui.TextWidth("Stop loss", fs), ui.TextWidth(v.riskWord, fs))) + ui.S(10));
      // Entry price (pending only), with the order type it makes.
      if(v.pending)
        {
         int typeW = ui.S(48) + ui.S(40) + gap;
         ui.Label(AI_P + "XENL#t", cx, cy + rowH / 2, "Entry", t.muted, fs, ANCHOR_LEFT, false);
         Stepper(AI_CMD_ENTRY_DEC, AI_CMD_ENTRY_INC, "ENTRY", AI_P + "E_ENTRY", v.entryText, cx + lblW, cy, cw - lblW - typeW - gap, rowH, v, t, ui);
         ui.Label(AI_P + "XENT#t", cx + cw, cy + rowH / 2, ui.Fit(v.entryType, typeW, fs - 1, true), t.muted, fs - 1, ANCHOR_RIGHT, true);
         cy += rowH + ui.S(AI_ROW_GAP);
        }

      // Risk: three presets, then a custom value with its unit (%, money, lots) in one frame.
      ui.Label(AI_P + "XRISKL#t", cx, cy + rowH / 2, v.riskWord, t.muted, fs, ANCHOR_LEFT, false);
      int avail = cw - lblW;
      int chipW = (int)((avail - 3 * gap) / 4.7);
      int rx = cx + lblW;
      Choice(AI_CMD_RISK1, AI_P + "RISK1", rx, cy, chipW, rowH, v.chipText[0], v.chip == 0, fs - 1, t, ui);
      Choice(AI_CMD_RISK2, AI_P + "RISK2", rx + chipW + gap, cy, chipW, rowH, v.chipText[1], v.chip == 1, fs - 1, t, ui);
      Choice(AI_CMD_RISK3, AI_P + "RISK3", rx + 2 * (chipW + gap), cy, chipW, rowH, v.chipText[2], v.chip == 2, fs - 1, t, ui);
      bool customOn = (v.chip == 3);
      int fx = rx + 3 * (chipW + gap);
      int fw = cx + cw - fx;
      int uw = ui.S(26);
      color ff = customOn ? t.selected : t.inputBg;
      ui.Shape(fx, cy, fw, rowH, ui.S(4), ff, customOn ? t.text : t.inputBorder);
      ui.Edit(AI_P + "E_RISK", fx + ui.S(3), cy + ui.S(3), fw - uw - ui.S(6), rowH - ui.S(6), v.customText, t.text, ff, ff, v.refreshEdits, v.editing);
      ui.Shape(fx + fw - uw - 1, cy + ui.S(6), 1, rowH - ui.S(12), 0, t.inputBorder, t.inputBorder);
      Control(AI_CMD_RISK_UNIT, AI_P + "RISKUNIT", fx + fw - uw, cy + 1, uw - 1, rowH - 2, v.customUnit, ff, ff, customOn ? t.text : t.muted, fs - 1, customOn, ui,
              ui.S(3));
      cy += rowH + ui.S(AI_ROW_GAP);

      LevelRow(AI_CMD_SL_MODE, AI_CMD_SL_RECALL, AI_CMD_SL_DEC, AI_CMD_SL_INC, "SL", "Stop loss", v.slText, v.slUnit, cx, cy, cw, lblW, gap, rowH, v, t, ui);
      cy += rowH + ui.S(AI_ROW_GAP);
      LevelRow(AI_CMD_TP_MODE, AI_CMD_TP_RECALL, AI_CMD_TP_DEC, AI_CMD_TP_INC, "TP", "Take profit", v.tpText, v.tpUnit, cx, cy, cw, lblW, gap, rowH, v, t, ui);
      cy += rowH + ui.S(AI_LEVELS_GAP);

      // What the order means in money: the lots large, then risk, reward and R:R in tiles.
      ui.Shape(cx, cy, cw, 1, 0, t.divider, t.divider);
      cy += ui.S(AI_DIV_GAP);
      int lineY = cy + ui.S(11);
      int unitsW = ui.TextWidth(v.unitsText, fs - 1);
      ui.Label(AI_P + "XRLOTS#l", cx, lineY, "Lots", t.muted, fs, ANCHOR_LEFT, false);
      ui.Label(AI_P + "XRLOTS#u", cx + cw, lineY, v.unitsText, t.muted, fs - 1, ANCHOR_RIGHT, false);
      ui.Label(AI_P + "XRLOTS#v", cx + cw - unitsW - ui.S(6), lineY, v.lotsNum, t.text, fs + 6, ANCHOR_RIGHT, true);
      cy += ui.S(AI_LOTS_H);
      int th = ui.S(AI_TILE_H);
      int tw = (cw - 2 * gap) / 3;
      Tile("RISK", "Risk", v.riskMoney, v.riskPctText, t.danger, cx, cy, tw, th, t, ui);
      Tile("REWARD", "Reward", v.rewardMoney, v.rewardPctText, t.good, cx + tw + gap, cy, tw, th, t, ui);
      Tile("RR", "R : R", v.rr, v.pipsShort, t.text, cx + 2 * (tw + gap), cy, cw - 2 * (tw + gap), th, t, ui);
      cy += th + ui.S(AI_TILE_GAP);
      // Pip value on the left, margin and what stays free on the right.
      // Long amounts (a large account, a big panel scale) take two rows rather than run into each other.
      int mf = fs - 1;
      int freeW = ui.TextWidth(v.freeShort, mf);
      int marW = ui.TextWidth(v.marginShort, mf, true);
      ui.Label(AI_P + "XMETA#a", cx, cy, "Pip value", t.muted, mf, ANCHOR_LEFT_UPPER, false);
      ui.Label(AI_P + "XMETA#b", cx + ui.TextWidth("Pip value", mf) + ui.S(5), cy, v.pipValue, t.text, mf, ANCHOR_LEFT_UPPER, true);
      if(MetaTwoRows(v, cw, ui))
         cy += ui.S(AI_META_H);
      ui.Label(AI_P + "XMETA#e", cx + cw, cy, v.freeShort, t.muted, mf, ANCHOR_RIGHT_UPPER, false);
      ui.Label(AI_P + "XMETA#d", cx + cw - freeW - ui.S(4), cy, v.marginShort, t.text, mf, ANCHOR_RIGHT_UPPER, true);
      ui.Label(AI_P + "XMETA#c", cx + cw - freeW - marW - ui.S(9), cy, "Margin", t.muted, mf, ANCHOR_RIGHT_UPPER, false);
      cy += ui.S(AI_META_H);
      if(v.showCommission)
         cy = Readout("COMM", "Commission", v.commission, t.muted, cx, cy, cw, ui.S(AI_COMM_H), t, ui, false);
      cy += ui.S(AI_META_GAP);

      cy = ConfirmAndStatus(v, t, ui, cx, cy, cw, gap, true);
      // Measured before the menu: an open menu may run past a short chart (the panel moves up),
      // but it must not push the panel into the compact layout.
      fullH = cy - y;
      if(v.menuOpen)
         cy = Menu(v, t, ui, cx, cy, cw, gap, ui.S(24));

      h = cy - y;
      ui.EndSurface(w, h, t.bg, t.border, t.shadow);
      int fi = FocusIndex(v.focusCmd);
      if(fi >= 0)
         FocusRing(fi, t, ui);
     }

   // The modify card: beside the panel on the chart's side, level with the line that was dropped.
   // Drawn after the panel in the same frame; its controls join the end of the Tab order.
   void              RenderCard(const AiView &v, const AiTheme &t, CAiUi &ui)
     {
      m_cardW = 0;
      m_cardH = 0;
      if(!v.modOpen)
         return;
      int fs = ui.fontSize;
      int pad = ui.S(10);
      int gap = ui.S(4);
      int cw = ui.S(236);
      int cardW = cw + 2 * pad;
      int cardH = CardHeight(ui);
      bool panelRight = (x + w / 2 > chartW / 2);
      int left = panelRight ? x - cardW - ui.S(8) : x + w + ui.S(8);
      if(panelRight && tagsFrom > 0 && left + cardW > tagsFrom - ui.S(8))
         left = tagsFrom - cardW - ui.S(8);
      m_cardX = MathMax(0, MathMin(left, chartW - cardW));
      m_cardY = MathMax(0, MathMin(v.modY - cardH / 2, chartH - cardH));
      m_cardW = cardW;
      m_cardH = cardH;
      int firstFocus = FocusCount();

      ui.BeginSurface(AI_P + "XMBG#r", m_cardX, m_cardY);
      int cx = m_cardX + pad;
      int cy = m_cardY + ui.S(8);
      int hb = ui.S(24);
      int tw = ui.TextWidth(v.modTicket, fs - 1);
      ui.Label(AI_P + "XMTKT#t", cx + cw, cy + hb / 2, v.modTicket, t.muted, fs - 1, ANCHOR_RIGHT, false);
      ui.Label(AI_P + "XMTTL#t", cx, cy + hb / 2, ui.Fit(v.modTitle, cw - tw - 2 * gap, fs, true), t.text, fs, ANCHOR_LEFT, true);
      cy += hb + ui.S(6);

      int lblW = ui.S(76);
      cy = CardRow("ENTRY", "Entry", v.modEntryEdit, v.modEntryText, v.modEntryWas, v.modEntryMoney, v.modEntryTone, cx, cy, cw, lblW, v, t, ui);
      cy = CardRow("SL", "Stop loss", true, v.modSlText, v.modSlWas, v.modSlMoney, v.modSlTone, cx, cy, cw, lblW, v, t, ui);
      cy = CardRow("TP", "Take profit", true, v.modTpText, v.modTpWas, v.modTpMoney, v.modTpTone, cx, cy, cw, lblW, v, t, ui);

      ui.Shape(cx, cy, cw, 1, 0, t.divider, t.divider);
      cy += 1 + ui.S(6);
      cy = Readout("MRR", "Risk : reward", v.modRR, t.text, cx, cy, cw, ui.S(17), t, ui, false);
      cy += ui.S(4);

      color sc = t.muted;
      if(v.modStatusLevel == 1)
         sc = t.warn;
      else if(v.modStatusLevel == 2)
         sc = t.danger;
      string l1 = "";
      string l2 = "";
      Wrap(v.modStatus, cw, fs - 1, ui, l1, l2);
      ui.Label(AI_P + "XMST1#t", cx, cy, l1, sc, fs - 1, ANCHOR_LEFT_UPPER, false);
      ui.Label(AI_P + "XMST2#t", cx, cy + ui.S(15), l2, sc, fs - 1, ANCHOR_LEFT_UPPER, false);
      cy += ui.S(34);

      int bh = ui.S(32);
      int cancelW = ui.S(72);
      int okW = cw - cancelW - gap;
      color cbg = v.modConfirmEnabled ? ((v.modSide == AI_BUY) ? t.buyFill : t.sellFill) : t.chip;
      color cbd = v.modConfirmEnabled ? cbg : t.inputBorder;
      color ctx = v.modConfirmEnabled ? t.onFill : t.muted;
      Control(AI_CMD_MOD_CONFIRM, AI_P + "MODOK", cx, cy, okW, bh, v.modConfirmText, cbg, cbd, ctx, fs, v.modConfirmEnabled, ui, ui.S(6));
      Control(AI_CMD_MOD_CANCEL, AI_P + "MODX", cx + okW + gap, cy, cancelW, bh, "Cancel", t.chip, t.inputBorder, t.text, fs, false, ui, ui.S(6));
      ui.EndSurface(cardW, cardH, t.bg, t.border, t.shadow);

      int fi = FocusIndex(v.focusCmd);
      if(fi >= firstFocus)
         FocusRing(fi, t, ui);
     }
  };

#endif
