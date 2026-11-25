// Opens one browser app window per MetaTrader 5 and glues it onto MT5's chart area (the MDIClient
// window): owned by MT5's main window (so it stays just above MT5 and hides when MT5 is minimised),
// without a taskbar button, placed so the page covers the chart area exactly, and cut to the page
// with a window region (Edge's title bar and borders are outside it). Runs on the UI thread.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;

static class Native
{
    public delegate bool EnumProc(IntPtr h, IntPtr l);
    public delegate void WinEventProc(IntPtr hook, uint ev, IntPtr hwnd, int obj, int child, uint thread, uint time);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT
    {
        public int L, T, R, B;
        public int W { get { return R - L; } }
        public int H { get { return B - T; } }
        public bool Same(RECT o) { return L == o.L && T == o.T && R == o.R && B == o.B; }
    }

    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr l);
    [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr p, EnumProc f, IntPtr l);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindowEx(IntPtr p, IntPtr a, string c, string w);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")] public static extern IntPtr SetWindowLongPtr(IntPtr h, int i, IntPtr v);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] public static extern IntPtr GetWindowLongPtr(IntPtr h, int i);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint f);
    [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] public static extern int SetWindowRgn(IntPtr h, IntPtr rgn, bool redraw);
    [DllImport("gdi32.dll")] public static extern IntPtr CreateRectRgn(int a, int b, int c, int d);
    [DllImport("user32.dll")] public static extern IntPtr SetWinEventHook(uint min, uint max, IntPtr module, WinEventProc proc, uint pid, uint thread, uint flags);
    [DllImport("user32.dll")] public static extern bool UnhookWinEvent(IntPtr hook);
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);

    public const int GWL_STYLE = -16, GWL_EXSTYLE = -20, GWLP_HWNDPARENT = -8;
    public const long WS_EX_APPWINDOW = 0x40000, WS_EX_TOOLWINDOW = 0x80;
    public const uint SWP_NOZORDER = 0x4, SWP_NOACTIVATE = 0x10, SWP_FRAMECHANGED = 0x20;
    public const int SW_HIDE = 0, SW_SHOWNORMAL = 1, SW_SHOWNOACTIVATE = 4;
    public const uint WM_CLOSE = 0x10;
    public const uint EVENT_OBJECT_LOCATIONCHANGE = 0x800B, WINEVENT_OUTOFCONTEXT = 0;

    public static void DpiAware()
    {
        try { if (SetProcessDpiAwarenessContext(new IntPtr(-4))) return; }   // per monitor, version 2
        catch (EntryPointNotFoundException) { }
        SetProcessDPIAware();
    }

    public static string Class(IntPtr h)
    {
        var c = new StringBuilder(256);
        GetClassName(h, c, 256);
        return c.ToString();
    }

    public static string Title(IntPtr h)
    {
        var t = new StringBuilder(512);
        GetWindowText(h, t, 512);
        return t.ToString();
    }
}

// Where the page must go: the chart area, and the window's frame around the page (its insets).
static class Placement
{
    // The window's rectangle so that its page, inset by (l, t, r, b) inside it, covers target.
    public static Native.RECT Outer(Native.RECT target, int l, int t, int r, int b)
    {
        return new Native.RECT { L = target.L - l, T = target.T - t, R = target.R + r, B = target.B + b };
    }
}

sealed class Screen
{
    public int Pid;
    public IntPtr Main, Mdi, Win;
    public Process Browser;
    public DateTime LaunchedAt;
    public bool Hidden;           // hidden by the trader: MT5's own charts show
    public bool Lost;             // the window was closed without us: not opened again until Show
    public Native.RECT Last;      // the chart area it was last placed on
    public int InL, InT, InR, InB;
    public bool Placed;
    public IntPtr Hook;
}

sealed class Glue
{
    readonly Func<int, string> urlFor;
    readonly string profileDir;
    readonly Dictionary<int, Screen> screens = new Dictionary<int, Screen>();
    readonly Timer timer = new Timer { Interval = 200 };
    readonly Native.WinEventProc onEvent;
    DateTime lastScan = DateTime.MinValue;
    public bool Enabled = true;   // open a screen with every MT5
    public bool AllHidden;
    public bool Separate;         // a window of its own instead of glued onto MT5's chart area

    public Glue(Func<int, string> urlFor, string profileDir)
    {
        this.urlFor = urlFor;
        this.profileDir = profileDir;
        onEvent = OnWinEvent;   // kept alive while hooked
        timer.Tick += (s, e) => Tick();
    }

    public void Start()
    {
        CloseLeftovers();
        timer.Start();
    }

    // Screens left open by a run of this program that did not end cleanly: their pages hold that
    // run's key and could not connect any more, so they close before new ones open.
    static readonly HashSet<IntPtr> leftovers = new HashSet<IntPtr>();

    static void CloseLeftovers()
    {
        Native.EnumWindows((h, l) =>
        {
            if (Native.Class(h) != "Chrome_WidgetWin_1") return true;
            string t = Native.Title(h);
            int hash = t.LastIndexOf(" #", StringComparison.Ordinal);
            int pid;
            bool ours = t == "Modern Screen" || (t.StartsWith("Modern Screen", StringComparison.Ordinal) && hash > 0 && int.TryParse(t.Substring(hash + 2), out pid));
            if (ours)
            {
                leftovers.Add(h);   // never taken for a new screen while it closes
                Native.PostMessage(h, Native.WM_CLOSE, IntPtr.Zero, IntPtr.Zero);
            }
            return true;
        }, IntPtr.Zero);
    }

    public void Stop()
    {
        timer.Stop();
        foreach (Screen sc in new List<Screen>(screens.Values)) Close(sc);
        screens.Clear();
    }

    public static string FindBrowser()
    {
        string[] candidates =
        {
            Environment.ExpandEnvironmentVariables(@"%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"),
            Environment.ExpandEnvironmentVariables(@"%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"),
            Environment.ExpandEnvironmentVariables(@"%ProgramFiles%\Google\Chrome\Application\chrome.exe"),
            Environment.ExpandEnvironmentVariables(@"%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"),
            Environment.ExpandEnvironmentVariables(@"%LocalAppData%\Google\Chrome\Application\chrome.exe"),
        };
        foreach (string c in candidates) if (File.Exists(c)) return c;
        return null;
    }

    void Tick()
    {
        if (!Enabled) return;
        if (DateTime.Now - lastScan > TimeSpan.FromSeconds(1))
        {
            lastScan = DateTime.Now;
            Scan();
        }
        foreach (Screen sc in new List<Screen>(screens.Values)) Keep(sc);
    }

    // Finds the running MT5s, opens a screen for a new one, closes the screen of one that is gone.
    void Scan()
    {
        var alive = new HashSet<int>();
        foreach (Process p in Process.GetProcessesByName("terminal64"))
        {
            using (p)
            {
                IntPtr main;
                try { main = p.MainWindowHandle; }
                catch (InvalidOperationException) { continue; }
                if (main == IntPtr.Zero) continue;
                IntPtr mdi = Native.FindWindowEx(main, IntPtr.Zero, "MDIClient", null);
                if (mdi == IntPtr.Zero) continue;   // still starting (or a login window)
                alive.Add(p.Id);
                Screen sc;
                if (!screens.TryGetValue(p.Id, out sc))
                {
                    sc = new Screen { Pid = p.Id, Main = main, Mdi = mdi, Hidden = AllHidden };
                    screens[p.Id] = sc;
                    sc.Hook = Native.SetWinEventHook(Native.EVENT_OBJECT_LOCATIONCHANGE, Native.EVENT_OBJECT_LOCATIONCHANGE,
                        IntPtr.Zero, onEvent, (uint)p.Id, 0, Native.WINEVENT_OUTOFCONTEXT);
                    Log.Write("MT5 " + p.Id + " found.");
                }
                sc.Main = main;
                sc.Mdi = mdi;
            }
        }
        foreach (Screen sc in new List<Screen>(screens.Values))
        {
            if (alive.Contains(sc.Pid)) continue;
            Log.Write("MT5 " + sc.Pid + " closed; its screen closes too.");
            Close(sc);
            screens.Remove(sc.Pid);
        }
    }

    void OnWinEvent(IntPtr hook, uint ev, IntPtr hwnd, int obj, int child, uint thread, uint time)
    {
        if (obj != 0) return;   // the window itself, not a part of it
        foreach (Screen sc in screens.Values)
            if (sc.Hook == hook && (hwnd == sc.Mdi || hwnd == sc.Main)) { Keep(sc); return; }
    }

    // Opens, finds and places the screen of one MT5, as needed.
    void Keep(Screen sc)
    {
        if (!Enabled || sc.Lost) return;
        if (sc.Win != IntPtr.Zero && !Native.IsWindow(sc.Win))
        {
            Log.Write("The screen of MT5 " + sc.Pid + " was closed; the tray menu opens it again.");
            sc.Win = IntPtr.Zero;
            sc.Lost = true;
            return;
        }
        if (sc.Win == IntPtr.Zero)
        {
            // A window opened before (perhaps while the screen was hidden) is taken first, so a
            // second one never opens on top of it.
            sc.Win = FindWindow(sc.Pid);
            if (sc.Win == IntPtr.Zero)
            {
                if (sc.Hidden) return;
                if (sc.Browser == null) Launch(sc);
                else if (DateTime.Now - sc.LaunchedAt > TimeSpan.FromSeconds(30))
                {
                    // Its page never loaded (or the browser refused): the tray menu tries again.
                    Log.Write("The screen of MT5 " + sc.Pid + " did not open; the tray menu tries again.");
                    sc.Browser = null;
                    sc.Lost = true;
                }
                return;
            }
            if (Separate) Release(sc);
            else Attach(sc);
        }
        if (sc.Hidden)
        {
            if (Native.IsWindowVisible(sc.Win)) Native.ShowWindow(sc.Win, Native.SW_HIDE);
            return;
        }
        if (Separate)
        {
            if (!Native.IsWindowVisible(sc.Win)) Native.ShowWindow(sc.Win, Native.SW_SHOWNOACTIVATE);
            return;   // the trader places it
        }
        if (Native.IsIconic(sc.Main)) return;   // an owned window hides with its owner
        if (!Native.IsWindowVisible(sc.Win)) Native.ShowWindow(sc.Win, Native.SW_SHOWNOACTIVATE);
        Place(sc, false);
    }

    // A window of its own again: no owner, a taskbar button, its title bar and borders, placed on
    // MT5's chart area once and then left where the trader puts it.
    void Release(Screen sc)
    {
        Native.SetWindowLongPtr(sc.Win, Native.GWLP_HWNDPARENT, IntPtr.Zero);
        long ex = (long)Native.GetWindowLongPtr(sc.Win, Native.GWL_EXSTYLE);
        ex = (ex & ~Native.WS_EX_TOOLWINDOW) | Native.WS_EX_APPWINDOW;
        Native.ShowWindow(sc.Win, Native.SW_HIDE);
        Native.SetWindowLongPtr(sc.Win, Native.GWL_EXSTYLE, new IntPtr(ex));
        Native.SetWindowRgn(sc.Win, IntPtr.Zero, true);
        Native.RECT r;
        if (Native.GetWindowRect(sc.Mdi, out r) && r.W > 200 && r.H > 150)
            Native.SetWindowPos(sc.Win, IntPtr.Zero, r.L, r.T, r.W, r.H, Native.SWP_NOZORDER | Native.SWP_FRAMECHANGED);
        if (!sc.Hidden) Native.ShowWindow(sc.Win, Native.SW_SHOWNORMAL);
        sc.Placed = false;
        Log.Write("The screen of MT5 " + sc.Pid + " is a window of its own.");
    }

    // Glued onto MT5 (separate = false) or a window of its own (true), for every screen.
    public void SetSeparate(bool separate)
    {
        Separate = separate;
        foreach (Screen sc in screens.Values)
        {
            if (sc.Win == IntPtr.Zero || !Native.IsWindow(sc.Win)) continue;
            if (separate) Release(sc);
            else Attach(sc);
        }
    }

    void Launch(Screen sc)
    {
        string browser = FindBrowser();
        if (browser == null)
        {
            Log.Write("Neither Microsoft Edge nor Google Chrome was found; the screen cannot open.");
            sc.Lost = true;
            return;
        }
        Native.RECT r;
        Native.GetWindowRect(sc.Mdi, out r);
        string args = "--app=\"" + urlFor(sc.Pid) + "\" --user-data-dir=\"" + profileDir + "\" --no-first-run --no-default-browser-check" +
            " --disable-features=Translate --hide-crash-restore-bubble" +
            " --window-position=" + r.L + "," + r.T + " --window-size=" + Math.Max(r.W, 200) + "," + Math.Max(r.H, 200);
        try
        {
            sc.Browser = Process.Start(new ProcessStartInfo(browser, args) { UseShellExecute = false });
            sc.LaunchedAt = DateTime.Now;
            Log.Write("Opened the screen of MT5 " + sc.Pid + ".");
        }
        catch (Exception e)
        {
            Log.Write("The browser did not start: " + e.Message);
            sc.Lost = true;
        }
    }

    // The browser window showing this MT5's screen: its title carries "#<pid>" once the page
    // loaded, and its address ("term=<pid>") before.
    static IntPtr FindWindow(int pid)
    {
        IntPtr found = IntPtr.Zero;
        string a = "#" + pid, b = "term=" + pid;
        Native.EnumWindows((h, l) =>
        {
            if (leftovers.Contains(h) || !Native.IsWindowVisible(h) || Native.Class(h) != "Chrome_WidgetWin_1") return true;
            string t = Native.Title(h);
            if (t.StartsWith("Modern Screen", StringComparison.Ordinal) && t.EndsWith(a, StringComparison.Ordinal) ||
                t.Contains(b + "&") || t.EndsWith(b, StringComparison.Ordinal))
            {
                found = h;
                return false;
            }
            return true;
        }, IntPtr.Zero);
        return found;
    }

    void Attach(Screen sc)
    {
        Native.SetWindowLongPtr(sc.Win, Native.GWLP_HWNDPARENT, sc.Main);
        long ex = (long)Native.GetWindowLongPtr(sc.Win, Native.GWL_EXSTYLE);
        ex = (ex & ~Native.WS_EX_APPWINDOW) | Native.WS_EX_TOOLWINDOW;   // no taskbar button of its own
        Native.ShowWindow(sc.Win, Native.SW_HIDE);
        Native.SetWindowLongPtr(sc.Win, Native.GWL_EXSTYLE, new IntPtr(ex));
        if (!sc.Hidden) Native.ShowWindow(sc.Win, Native.SW_SHOWNOACTIVATE);
        sc.Placed = false;
        Place(sc, true);
        Log.Write("The screen of MT5 " + sc.Pid + " is glued on.");
    }

    static IntPtr Content(IntPtr win)
    {
        IntPtr found = IntPtr.Zero;
        Native.EnumChildWindows(win, (h, l) =>
        {
            if (Native.Class(h) == "Chrome_RenderWidgetHostHWND") { found = h; return false; }
            return true;
        }, IntPtr.Zero);
        return found;
    }

    void Place(Screen sc, bool force)
    {
        Native.RECT target;
        if (!Native.GetWindowRect(sc.Mdi, out target) || target.W <= 0 || target.H <= 0) return;
        if (!force && sc.Placed && target.Same(sc.Last)) return;
        // Measure the frame around the page each time: Edge may change it (zoom, DPI).
        IntPtr content = Content(sc.Win);
        Native.RECT w, c;
        if (content != IntPtr.Zero && Native.GetWindowRect(sc.Win, out w) && Native.GetWindowRect(content, out c) && c.W > 0)
        {
            sc.InL = c.L - w.L;
            sc.InT = c.T - w.T;
            sc.InR = w.R - c.R;
            sc.InB = w.B - c.B;
        }
        Native.RECT outer = Placement.Outer(target, sc.InL, sc.InT, sc.InR, sc.InB);
        Native.SetWindowPos(sc.Win, IntPtr.Zero, outer.L, outer.T, outer.W, outer.H, Native.SWP_NOZORDER | Native.SWP_NOACTIVATE);
        Native.SetWindowRgn(sc.Win, Native.CreateRectRgn(sc.InL, sc.InT, sc.InL + target.W, sc.InT + target.H), true);
        sc.Last = target;
        sc.Placed = true;
    }

    void Close(Screen sc)
    {
        if (sc.Hook != IntPtr.Zero) { Native.UnhookWinEvent(sc.Hook); sc.Hook = IntPtr.Zero; }
        if (sc.Win != IntPtr.Zero && Native.IsWindow(sc.Win)) Native.PostMessage(sc.Win, Native.WM_CLOSE, IntPtr.Zero, IntPtr.Zero);
        sc.Win = IntPtr.Zero;
    }

    // Hide or show the screen of one MT5 (pid), or of every MT5 (pid 0).
    public void SetHidden(int pid, bool hidden)
    {
        if (pid == 0) AllHidden = hidden;
        foreach (Screen sc in screens.Values)
        {
            if (pid != 0 && sc.Pid != pid) continue;
            sc.Hidden = hidden;
            if (!hidden)
            {
                sc.Lost = false;
                sc.Placed = false;
            }
            Keep(sc);
            if (!hidden && sc.Win != IntPtr.Zero)
            {
                if (Separate && Native.IsIconic(sc.Win)) Native.ShowWindow(sc.Win, 9);   // SW_RESTORE
                Native.SetForegroundWindow(sc.Win);
            }
        }
    }

    public bool AnyShown()
    {
        foreach (Screen sc in screens.Values) if (!sc.Hidden && !sc.Lost) return true;
        return false;
    }

    public List<int> Pids()
    {
        return new List<int>(screens.Keys);
    }
}
