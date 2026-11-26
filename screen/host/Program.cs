// InnaChart.exe: a tray program that serves InnaChart and glues it onto each MetaTrader 5.
// One runs per Windows user; starting it again shows the screens of the one already running.
using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

static class Program
{
    const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    const string RunName = "InnaChart";

    [StructLayout(LayoutKind.Sequential)]
    struct PowerThrottling { public uint Version, ControlMask, StateMask; }
    [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll")] static extern bool SetProcessInformation(IntPtr process, int infoClass, ref PowerThrottling info, uint size);
    [DllImport("winmm.dll")] static extern uint timeBeginPeriod(uint ms);
    [DllImport("winmm.dll")] static extern uint timeEndPeriod(uint ms);

    [STAThread]
    static int Main(string[] args)
    {
        Options options = Options.Parse(args);
        bool first;
        using (var mutex = new Mutex(true, options.Named(@"Local\InnaChart.Host"), out first))
        using (var showEvent = new EventWaitHandle(false, EventResetMode.AutoReset, options.Named(@"Local\InnaChart.Show")))
        {
            if (!first)
            {
                showEvent.Set();   // the running one shows its screens
                return 0;
            }
            Native.DpiAware();
            KeepFullSpeed();
            timeBeginPeriod(1);   // this program's sleeps (the feed's pulses) in 1 ms steps, not 15.6 ms
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            var host = new Host(options);
            using (var tray = new Tray(host, showEvent, !options.NoTray))
            {
                try { host.Start(tray.Ui); }
                catch (Exception e)
                {
                    MessageBox.Show("InnaChart could not start:\n\n" + e.Message, "InnaChart", MessageBoxButtons.OK, MessageBoxIcon.Error);
                    return 1;
                }
                Application.Run(tray);
                host.Stop();
                timeEndPeriod(1);
            }
        }
        return 0;
    }

    // Windows 11 slows down, and ignores the timer requests of, programs with no visible window:
    // this one asks to be left at full speed, or the feed's pulses would come every 15.6 ms.
    static void KeepFullSpeed()
    {
        const uint IgnoreTimerResolution = 0x4, ExecutionSpeed = 0x1;
        var state = new PowerThrottling { Version = 1, ControlMask = IgnoreTimerResolution | ExecutionSpeed, StateMask = 0 };
        try { SetProcessInformation(GetCurrentProcess(), 4 /* ProcessPowerThrottling */, ref state, (uint)Marshal.SizeOf(state)); }
        catch (EntryPointNotFoundException) { }
    }

    public static bool StartsWithWindows()
    {
        using (RegistryKey k = Registry.CurrentUser.OpenSubKey(RunKey))
            return k != null && k.GetValue(RunName) != null;
    }

    public static void SetStartWithWindows(bool on)
    {
        using (RegistryKey k = Registry.CurrentUser.CreateSubKey(RunKey))
        {
            if (on) k.SetValue(RunName, "\"" + Application.ExecutablePath + "\"");
            else if (k.GetValue(RunName) != null) k.DeleteValue(RunName);
        }
    }
}

// The tray icon and its menu, a global hotkey (Ctrl+Alt+M) to show or hide the screens, and the
// UI thread the glue runs on.
sealed class Tray : ApplicationContext
{
    [DllImport("user32.dll")] static extern bool RegisterHotKey(IntPtr h, int id, uint mods, uint vk);
    [DllImport("user32.dll")] static extern bool UnregisterHotKey(IntPtr h, int id);
    const int WM_HOTKEY = 0x312;
    const uint MOD_ALT = 1, MOD_CONTROL = 2, MOD_NOREPEAT = 0x4000;

    readonly Host host;
    readonly NotifyIcon icon;
    readonly HotkeyWindow hotkeys;
    readonly ToolStripMenuItem showItem;
    readonly RegisteredWaitHandle showWait;
    public readonly Control Ui = new Control();

    public Tray(Host host, EventWaitHandle showEvent, bool visible)
    {
        this.host = host;
        Ui.CreateControl();
        IntPtr unused = Ui.Handle;   // the handle makes BeginInvoke work

        showItem = new ToolStripMenuItem("Show the screen", null, (s, e) => Toggle()) { Checked = true };
        var startItem = new ToolStripMenuItem("Start with Windows", null, (s, e) =>
        {
            var item = (ToolStripMenuItem)s;
            Program.SetStartWithWindows(!item.Checked);
            item.Checked = Program.StartsWithWindows();
        }) { Checked = Program.StartsWithWindows() };
        var menu = new ContextMenuStrip();
        var separateItem = new ToolStripMenuItem("Separate window (not glued onto MetaTrader 5)", null, (s, e) => host.SetSeparate(!host.Glue.Separate));
        menu.Items.Add(showItem);
        menu.Items.Add(separateItem);
        menu.Opening += (s, e) => separateItem.Checked = host.Glue != null && host.Glue.Separate;
        menu.Items.Add(new ToolStripMenuItem("Open in a browser tab", null, (s, e) => OpenInBrowser()));
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(startItem);
        menu.Items.Add(new ToolStripMenuItem("Open the saved files folder", null, (s, e) => Process.Start("explorer.exe", "\"" + host.Store.Folder + "\"")));
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(new ToolStripMenuItem("Exit", null, (s, e) => ExitThread()));

        icon = new NotifyIcon
        {
            Icon = Logo.Icon(SystemInformation.SmallIconSize.Width),   // the tray's own size: never stretched
            Text = "InnaChart (Ctrl+Alt+M shows or hides it)",
            ContextMenuStrip = menu,
            Visible = visible,
        };
        icon.MouseClick += (s, e) => { if (e.Button == MouseButtons.Left) Toggle(); };

        hotkeys = new HotkeyWindow(Toggle);
        if (!RegisterHotKey(hotkeys.Handle, 1, MOD_CONTROL | MOD_ALT | MOD_NOREPEAT, (uint)Keys.M))
            Log.Write("Ctrl+Alt+M is taken by another program; the tray icon shows and hides the screen.");

        showWait = ThreadPool.RegisterWaitForSingleObject(showEvent, (st, timedOut) => host.OnUi(() => SetShown(true)), null, -1, false);
    }

    // Hides the screens when one shows; shows them (opening a closed one again) otherwise.
    void Toggle()
    {
        bool showing = showItem.Checked && host.Glue != null && host.Glue.AnyShown();
        SetShown(!showing);
    }

    void SetShown(bool shown)
    {
        showItem.Checked = shown;
        if (host.Glue != null) host.Glue.SetHidden(0, !shown);
    }

    void OpenInBrowser()
    {
        var pids = host.Glue.Pids();
        Process.Start(host.UrlFor(pids.Count > 0 ? pids[0] : 0));
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            showWait.Unregister(null);
            UnregisterHotKey(hotkeys.Handle, 1);
            hotkeys.DestroyHandle();
            icon.Visible = false;
            icon.Dispose();
            Ui.Dispose();
        }
        base.Dispose(disposing);
    }

    sealed class HotkeyWindow : NativeWindow
    {
        readonly Action onHotkey;

        public HotkeyWindow(Action onHotkey)
        {
            this.onHotkey = onHotkey;
            CreateHandle(new CreateParams());
        }

        protected override void WndProc(ref Message m)
        {
            if (m.Msg == WM_HOTKEY) onHotkey();
            base.WndProc(ref m);
        }
    }
}
