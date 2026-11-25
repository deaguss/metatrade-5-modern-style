//+------------------------------------------------------------------+
//| ModernStyle.mq5                                                  |
//| One click: the modern chart style on this chart (or all charts)  |
//+------------------------------------------------------------------+
#property copyright   "ActionInna, MIT licence"
#property link        "https://github.com/deaguss/metatrade-5-modern-style"
#property version     "1.00"
#property description "Gives the chart a modern look: near-black background, white and blue candles, no grid,"
#property description "a blue Bid line, and a price scale you can drag up and down. Saves it as a template."
#property script_show_inputs

input bool   InpAllCharts    = false;          // Apply to every open chart, not only this one
input bool   InpFreeMove     = true;           // Let the chart be dragged up and down (MT5's "Scale fix")
input bool   InpFollowPrice  = true;           // Scroll to the newest candle on every tick (MT5's "Chart autoscroll")
input bool   InpShowVolumes  = false;          // Show tick volumes under the candles
input string InpTemplate     = "ModernStyle";  // Save the style as this template ("" = do not save)

// The style's colours. MQL5 writes colours as C'red,green,blue'.
#define MS_BACKGROUND  C'15,15,15'
#define MS_TEXT        C'178,181,190'
#define MS_GRID        C'30,30,30'
#define MS_UP          C'255,255,255'
#define MS_DOWN        C'41,98,255'
#define MS_BID         C'41,98,255'
#define MS_ASK         C'242,54,69'
#define MS_STOPS       C'242,54,69'
#define MS_VOLUME      C'80,80,80'

void Style(const long chart)
  {
   ChartSetInteger(chart, CHART_MODE, CHART_CANDLES);
   ChartSetInteger(chart, CHART_FOREGROUND, false);          // objects and the panel are drawn over the candles
   ChartSetInteger(chart, CHART_SHOW_GRID, false);
   ChartSetInteger(chart, CHART_SHOW_PERIOD_SEP, false);
   ChartSetInteger(chart, CHART_SHOW_OHLC, true);
   ChartSetInteger(chart, CHART_SHOW_BID_LINE, true);
   ChartSetInteger(chart, CHART_SHOW_ASK_LINE, false);
   ChartSetInteger(chart, CHART_SHOW_TRADE_LEVELS, true);
   ChartSetInteger(chart, CHART_SHIFT, true);
   ChartSetDouble(chart, CHART_SHIFT_SIZE, 15.0);
   ChartSetInteger(chart, CHART_AUTOSCROLL, InpFollowPrice);
   ChartSetInteger(chart, CHART_SCALEFIX, InpFreeMove);
   ChartSetInteger(chart, CHART_SHOW_VOLUMES, InpShowVolumes ? CHART_VOLUME_TICK : CHART_VOLUME_HIDE);

   ChartSetInteger(chart, CHART_COLOR_BACKGROUND, MS_BACKGROUND);
   ChartSetInteger(chart, CHART_COLOR_FOREGROUND, MS_TEXT);
   ChartSetInteger(chart, CHART_COLOR_GRID, MS_GRID);
   ChartSetInteger(chart, CHART_COLOR_CHART_UP, MS_UP);
   ChartSetInteger(chart, CHART_COLOR_CANDLE_BULL, MS_UP);
   ChartSetInteger(chart, CHART_COLOR_CHART_DOWN, MS_DOWN);
   ChartSetInteger(chart, CHART_COLOR_CANDLE_BEAR, MS_DOWN);
   ChartSetInteger(chart, CHART_COLOR_CHART_LINE, MS_UP);
   ChartSetInteger(chart, CHART_COLOR_VOLUME, MS_VOLUME);
   ChartSetInteger(chart, CHART_COLOR_BID, MS_BID);
   ChartSetInteger(chart, CHART_COLOR_ASK, MS_ASK);
   ChartSetInteger(chart, CHART_COLOR_LAST, MS_BID);
   ChartSetInteger(chart, CHART_COLOR_STOP_LEVEL, MS_STOPS);
   ChartRedraw(chart);
  }

void OnStart()
  {
   int done = 0;
   if(InpAllCharts)
     {
      for(long c = ChartFirst(); c >= 0; c = ChartNext(c))
        {
         Style(c);
         done++;
        }
     }
   else
     {
      Style(0);
      done = 1;
     }

   string saved = "";
   if(InpTemplate != "")
     {
      ResetLastError();
      if(ChartSaveTemplate(0, InpTemplate))
         saved = "\n\nSaved as the template \"" + InpTemplate + "\". To use it on another chart: right-click the chart > Templates > " + InpTemplate + ".";
      else
         saved = "\n\nThe template could not be saved (error " + IntegerToString(GetLastError()) + ").";
     }
   string what = (done == 1) ? "this chart" : IntegerToString(done) + " charts";
   MessageBox("The modern style is on " + what + "." + saved, "Modern style", MB_OK | MB_ICONINFORMATION);
  }
//+------------------------------------------------------------------+
