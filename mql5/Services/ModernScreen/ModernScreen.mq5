//+------------------------------------------------------------------+
//| ModernScreen - feeds the Modern Screen with this terminal's data |
//+------------------------------------------------------------------+
// A service: it runs without a chart and starts again each time MetaTrader 5 starts. Add it once:
// Navigator > Services > right-click > Add Service > ModernScreen > OK. It sends the terminal's bars
// and prices to ModernScreen.exe on this PC, and nothing anywhere else. It never trades.
#property service
#property copyright   "MetaTrader 5 Modern Style contributors"
#property link        "https://github.com/deaguss/metatrade-5-modern-style"
#property version     "1.00"
#property description "Feeds the Modern Screen with this terminal's bars and prices. It never trades."

#include <ModernScreen/Feed.mqh>

void OnStart()
  {
   CMsFeed feed;
   feed.Run();
  }
