//+------------------------------------------------------------------+
//| InnaChart - feeds InnaChart with this terminal's data |
//+------------------------------------------------------------------+
// A service: it runs without a chart and starts again each time MetaTrader 5 starts. Add it once:
// Navigator > Services > right-click > Add Service > InnaChart > OK. It sends the terminal's bars
// and prices to InnaChart.exe on this PC, and nothing anywhere else. It never trades.
#property service
#property copyright   "MetaTrader 5 Modern Style contributors"
#property link        "https://github.com/deaguss/metatrade-5-modern-style"
#property version     "1.00"
#property description "Feeds InnaChart with this terminal's bars and prices. It never trades."

#include <InnaChart/Feed.mqh>

void OnStart()
  {
   CIcFeed feed;
   feed.Run();
  }
