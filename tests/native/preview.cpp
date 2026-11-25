// Draws ActionInna's panel without MT5. It runs the app against the fake terminal (mql.h) through a
// few states, and writes what is on the fake chart -- the painted pictures, the labels, the fields
// and the lines -- as one HTML page per state, so the layout can be looked at in a browser.
//   bash tests/native/preview.sh    ->  tests/native/out/preview/*.html
// Text is set in the browser with the panel's font, so it is close to MT5 but not exact: the fake
// measures text roughly, and places what follows a text by that measure.
#include <algorithm>
#include <fstream>
#define main app_tests_main
#include "app.cpp"
#undef main

static std::string Css(uint32_t c)
  {
   char b[16];
   snprintf(b, sizeof b, "#%02x%02x%02x", c & 0xFF, (c >> 8) & 0xFF, (c >> 16) & 0xFF);
   return b;
  }

static std::string Html(const std::string &s)
  {
   std::string o;
   for(char ch : s)
      o += (ch == '<') ? std::string("&lt;") : (ch == '&') ? std::string("&amp;") : (ch == '\x13') ? std::string("&ndash;") : std::string(1, ch);   // the fake's ShortToString(0x2013)
   return o;
  }

static std::string Font(const FakeObj &o)
  {
   auto it = o.s.find(OBJPROP_FONT);
   std::string face = (it == o.s.end()) ? "Arial" : it->second;
   bool bold = face.size() > 5 && face.compare(face.size() - 5, 5, " Bold") == 0;
   if(bold)
      face = face.substr(0, face.size() - 5);
   auto sz = o.i.find(OBJPROP_FONTSIZE * 16);
   double px = (sz == o.i.end() ? 9 : sz->second) * 96.0 / 72.0;
   char b[160];
   snprintf(b, sizeof b, "font:%s %.1fpx '%s'", bold ? "700" : "400", px, face.c_str());
   return b;
  }

static std::string Shift(int anchor)
  {
   switch(anchor)
     {
      case ANCHOR_LEFT: return "translate(0,-50%)";
      case ANCHOR_LEFT_LOWER: return "translate(0,-100%)";
      case ANCHOR_LOWER: return "translate(-50%,-100%)";
      case ANCHOR_RIGHT_LOWER: return "translate(-100%,-100%)";
      case ANCHOR_RIGHT: return "translate(-100%,-50%)";
      case ANCHOR_RIGHT_UPPER: return "translate(-100%,0)";
      case ANCHOR_UPPER: return "translate(-50%,0)";
      case ANCHOR_CENTER: return "translate(-50%,-50%)";
      default: return "none";
     }
  }

static void Dump(const std::string &file, const std::string &title)
  {
   std::vector<std::pair<int, std::string>> objs;
   for(auto &kv : g_fake.objs)
      objs.push_back({kv.second.order, kv.first});
   std::sort(objs.begin(), objs.end());
   std::ofstream f(file);
   f << "<!doctype html><meta charset=utf-8><title>" << Html(title) << "</title>"
     << "<style>body{margin:0;background:#000}.o{position:absolute;white-space:pre;line-height:1}</style>"
     << "<div style='position:relative;width:" << g_fake.chartW << "px;height:" << g_fake.chartH << "px;background:#000;overflow:hidden'>";
   std::string script;
   int pics = 0;
   for(auto &e : objs)
     {
      const std::string &n = e.second;
      FakeObj &o = g_fake.objs[n];
      if(!Shown(n))
         continue;
      int x = IntOf(n, OBJPROP_XDISTANCE), y = IntOf(n, OBJPROP_YDISTANCE);
      int w = IntOf(n, OBJPROP_XSIZE), h = IntOf(n, OBJPROP_YSIZE);
      uint32_t col = (uint32_t)o.i[OBJPROP_COLOR * 16], bg = (uint32_t)o.i[OBJPROP_BGCOLOR * 16];
      std::string text = o.s.count(OBJPROP_TEXT) ? o.s[OBJPROP_TEXT] : "";
      if(o.type == OBJ_BITMAP_LABEL)
        {
         std::string res = o.s.count(OBJPROP_BMPFILE) ? o.s[OBJPROP_BMPFILE] : "";
         auto it = g_fakePictures.find(res);
         if(it == g_fakePictures.end())
            continue;
         std::string id = "p" + std::to_string(pics++);
         f << "<canvas class=o id=" << id << " width=" << it->second.w << " height=" << it->second.h << " style='left:" << x << "px;top:" << y << "px'></canvas>";
         script += "P('" + id + "',[";
         for(size_t k = 0; k < it->second.px.size(); k++)
            script += (k ? "," : "") + std::to_string(it->second.px[k]);
         script += "]);";
        }
      else if(o.type == OBJ_LABEL)
         f << "<div class=o style=\"left:" << x << "px;top:" << y << "px;color:" << Css(col) << ";" << Font(o) << ";transform:"
           << Shift((int)o.i[OBJPROP_ANCHOR * 16]) << "\">" << Html(text) << "</div>";
      else if(o.type == OBJ_RECTANGLE_LABEL)
         f << "<div class=o style='left:" << x << "px;top:" << y << "px;width:" << w - 2 << "px;height:" << h - 2 << "px;background:" << Css(bg)
           << ";border:1px solid " << Css(col) << "'></div>";
      else if(o.type == OBJ_EDIT)
        {
         uint32_t bc = (uint32_t)o.i[OBJPROP_BORDER_COLOR * 16];
         bool centre = o.i[OBJPROP_ALIGN * 16] == ALIGN_CENTER;
         f << "<div class=o style=\"left:" << x << "px;top:" << y << "px;width:" << w - 8 << "px;height:" << h - 2 << "px;padding:0 3px;background:" << Css(bg)
           << ";border:1px solid " << Css(bc) << ";color:" << Css(col) << ";" << Font(o) << ";display:flex;align-items:center;justify-content:"
           << (centre ? "center" : "flex-end") << "\">" << Html(text) << "</div>";
        }
      else if(o.type == OBJ_HLINE)
        {
         bool dash = o.i[OBJPROP_STYLE * 16] == STYLE_DASH;
         f << "<div class=o style='left:0;top:" << YOf(o.d[OBJPROP_PRICE * 16]) << "px;width:" << g_fake.chartW << "px;border-top:"
           << std::max<int64_t>(1, o.i[OBJPROP_WIDTH * 16]) << "px " << (dash ? "dashed " : "solid ") << Css(col) << "'></div>";
        }
     }
   f << "</div><script>function P(id,px){const c=document.getElementById(id),g=c.getContext('2d'),d=g.createImageData(c.width,c.height);"
     << "for(let i=0;i<px.length;i++){const p=px[i];d.data[4*i]=p>>>16&255;d.data[4*i+1]=p>>>8&255;d.data[4*i+2]=p&255;d.data[4*i+3]=p>>>24;}"
     << "g.putImageData(d,0,0);}" << script << "</script>";
  }

int main()
  {
   std::string dir = "out/preview/";   // made by preview.sh
   Setup("preview");
   g_fake.charWidth = 0.8;   // closer to the panel's font than the tests' rough measure
   Refresh();
   Dump(dir + "1-idle.html", "Idle");
   Key('B');
   Refresh();
   Dump(dir + "2-buy-preview.html", "BUY preview");
   Click(kP + "PND#tx");
   Refresh();
   Dump(dir + "3-pending.html", "Limit / Stop");
   Click(kP + "MKT#tx");
   Click(kP + "MENU#tx");
   Refresh();
   Dump(dir + "4-menu.html", "Menu open");
   Click(kP + "MENU#tx");
   Click(kP + "COLLAPSE#tx");
   Refresh();
   Dump(dir + "5-collapsed.html", "Collapsed");
   Click(kP + "COLLAPSE#tx");
   Key(27);
   AddPos(101, POSITION_TYPE_BUY, 0.10, 1.08000, 1.07750, 1.08900);
   Refresh();
   Drag(Obj(101, "S"), 1.07650);
   Refresh();
   Dump(dir + "6-modify-card.html", "Modify card");
   printf("preview: 6 pages in tests/native/%s\n", dir.c_str());
   return 0;
  }
