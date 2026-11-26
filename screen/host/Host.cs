// Ties the parts together: the feed's pipe, the web server and the screens' WebSockets, and the
// glue. Messages from a feed go to the screens of that MT5; requests from a screen go to its MT5's
// feed, except "host.*" ones, which are for this program (hide the screen, for one).
using System;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;
using System.Windows.Forms;

sealed class Options
{
    public int Port = 8141;
    public string Web;
    public string StoreDir;
    public string DataDir;
    public bool NoGlue;
    public bool NoTray;   // for tests: no icon in the taskbar corner
    public string Instance = "";   // for tests: its own mutex and pipes, apart from the trader's InnaChart

    // A name made apart for a test instance: "InnaChart.Feed" -> "InnaChart.Feed.e2e".
    public string Named(string name)
    {
        return Instance == "" ? name : name + "." + Instance;
    }
    public string Key;   // for tests: a fixed key instead of a random one

    public static Options Parse(string[] args)
    {
        var o = new Options();
        string exeDir = AppDomain.CurrentDomain.BaseDirectory;
        o.Web = Path.Combine(exeDir, "web");
        o.StoreDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "InnaChart");
        o.DataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "InnaChart");
        for (int i = 0; i < args.Length; i++)
        {
            string a = args[i];
            string next = i + 1 < args.Length ? args[i + 1] : null;
            if (a == "--port" && next != null) { o.Port = int.Parse(next); i++; }
            else if (a == "--web" && next != null) { o.Web = Path.GetFullPath(next); i++; }
            else if (a == "--store" && next != null) { o.StoreDir = Path.GetFullPath(next); i++; }
            else if (a == "--data" && next != null) { o.DataDir = Path.GetFullPath(next); i++; }
            else if (a == "--no-glue") o.NoGlue = true;
            else if (a == "--no-tray") o.NoTray = true;
            else if (a == "--instance" && next != null)
            {
                foreach (char ch in next) if (!char.IsLetterOrDigit(ch)) throw new ArgumentException("--instance takes letters and digits");
                o.Instance = next;
                i++;
            }
            else if (a == "--key" && next != null) { o.Key = next; i++; }
        }
        return o;
    }
}

sealed class ScreenSession
{
    public int Pid;
    public WsConnection Ws;
    public string Watch = "";    // the charts it watches ("M15@XAUUSD\n...")
    public string Quotes = "";   // the symbols whose quotes it shows
}

sealed class Host
{
    public const int MaxRequest = 64 * 1024;

    readonly Options options;
    readonly string key;
    readonly QuoteCache quotes = new QuoteCache();
    FeedServer feed;
    FeedServer ticket;     // the ActionInna EA's order ticket (one chart per MT5 serves it)
    string ticketKey;
    readonly List<ScreenSession> sessions = new List<ScreenSession>();
    readonly Waiting waiting = new Waiting();
    static readonly string[] Replies = { "bars", "found", "spec", "error", "pong" };
    WebServer web;
    public Glue Glue;
    public Store Store;
    Control ui;   // to run glue work on the UI thread

    public Host(Options options)
    {
        this.options = options;
        var bytes = new byte[24];
        using (var rng = RandomNumberGenerator.Create()) rng.GetBytes(bytes);
        key = !string.IsNullOrEmpty(options.Key) && options.Key.Length >= 16 ? options.Key : BitConverter.ToString(bytes).Replace("-", "").ToLowerInvariant();
    }

    public int Port { get { return web.Port; } }

    public string UrlFor(int pid)
    {
        return "http://127.0.0.1:" + web.Port + "/?term=" + pid + "#key=" + key;
    }

    public void Start(Control uiThread)
    {
        ui = uiThread;
        Log.Open(Path.Combine(options.DataDir, "host.log"));
        Store = new Store(options.StoreDir);
        web = new WebServer(options.Web, Store, key, OnScreen);
        web.Start(options.Port);
        Log.Write("InnaChart started on 127.0.0.1:" + web.Port + ", files from " + options.Web + ".");
        feed = new FeedServer(options.Named(FeedServer.FeedPipe), new[] { "hello", "symbols", "account", "clock" }, null);
        feed.Connected += t =>
        {
            SendJoined(t.Pid, "watch");
            SendJoined(t.Pid, "quotes");
            UpdatePulse(t.Pid);
            Broadcast(t.Pid, Status(t.Pid));
        };
        feed.Disconnected += t =>
        {
            quotes.Forget(t.Pid);
            Broadcast(t.Pid, Status(t.Pid));
        };
        feed.Message += OnFeed;
        feed.Start();
        StartTicket();
        Glue = new Glue(UrlFor, Path.Combine(options.DataDir, "browser"));
        Glue.Enabled = !options.NoGlue;
        Glue.Separate = ReadSetting("separate") == "1";
        Glue.Start();
    }

    // The ticket's pipe. Pipe names are shared by every Windows user of the PC, so the EA serves only
    // a pipe that first sends the key written for this user in MT5's Common files folder.
    void StartTicket()
    {
        var bytes = new byte[24];
        using (var rng = RandomNumberGenerator.Create()) rng.GetBytes(bytes);
        ticketKey = BitConverter.ToString(bytes).Replace("-", "").ToLowerInvariant();
        try
        {
            string dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "MetaQuotes", "Terminal", "Common", "Files", "InnaChart");
            Directory.CreateDirectory(dir);
            // A test instance writes its own key file: the EA in MT5 reads only ticket.key.
            File.WriteAllText(Path.Combine(dir, options.Instance == "" ? "ticket.key" : "ticket." + options.Instance + ".key"), ticketKey, new System.Text.UTF8Encoding(false));
        }
        catch (Exception e)
        {
            Log.Write("The ticket's key could not be written, so the EA will not serve the ticket: " + e.Message);
        }
        ticket = new FeedServer(options.Named(FeedServer.TicketPipe), new[] { "terminal", "trades" }, () => "{\"t\":\"link\",\"key\":\"" + ticketKey + "\"}");
        ticket.Connected += t => Broadcast(t.Pid, Status(t.Pid));
        ticket.Disconnected += t => Broadcast(t.Pid, Status(t.Pid));
        ticket.Message += OnTicket;
        ticket.Start();
    }

    // The EA's messages go to the screens as "ticket.<type>"; a reply only to the screen that asked.
    void OnTicket(Terminal term, string type, string json)
    {
        if (type == "beat") return;   // the EA's sign of life: the pipe itself tells us
        if (type == "reply")
        {
            ScreenSession asker;
            long id;
            if (waiting.Take(Routing.IdOf(json), out asker, out id)) asker.Ws.SendText(Routing.WithId(Routing.Prefixed(json, "ticket."), id));
            return;
        }
        Broadcast(term.Pid, Routing.Prefixed(json, "ticket."));
    }

    // A screen's request for the ticket, on to its MT5's EA with an id of the program's own.
    void TicketRequest(ScreenSession session, string msg, WsConnection ws)
    {
        long id = Routing.IdOf(msg);
        if (id <= 0) return;
        Terminal tk = ticket.Get(session.Pid);
        if (tk == null)
        {
            ws.SendText("{\"t\":\"ticket.reply\",\"id\":" + id + ",\"ok\":false,\"err\":\"Put the ActionInna EA on a chart in MetaTrader 5, with Serve InnaChart's order ticket on, to trade from here\"}");
            return;
        }
        string bare = Routing.Unprefixed(Routing.WithId(msg, waiting.Add(session, id)), "ticket.");
        if (bare != null) tk.Send(bare);
    }

    // This program's own settings (one "name=value" a line), next to its log.
    string SettingsFile { get { return Path.Combine(options.DataDir, "settings.txt"); } }

    string ReadSetting(string name)
    {
        try
        {
            if (!File.Exists(SettingsFile)) return "";
            foreach (string line in File.ReadAllLines(SettingsFile))
                if (line.StartsWith(name + "=", StringComparison.Ordinal)) return line.Substring(name.Length + 1).Trim();
        }
        catch (IOException) { }
        return "";
    }

    void WriteSetting(string name, string value)
    {
        try
        {
            var lines = new List<string>();
            if (File.Exists(SettingsFile))
                foreach (string line in File.ReadAllLines(SettingsFile))
                    if (!line.StartsWith(name + "=", StringComparison.Ordinal)) lines.Add(line);
            lines.Add(name + "=" + value);
            File.WriteAllLines(SettingsFile, lines.ToArray());
        }
        catch (IOException e) { Log.Write("Settings not saved: " + e.Message); }
    }

    // Glued onto MT5 or a window of its own; remembered, and told to every screen.
    public void SetSeparate(bool separate)
    {
        Glue.SetSeparate(separate);
        WriteSetting("separate", separate ? "1" : "0");
        List<ScreenSession> all;
        lock (sessions) all = new List<ScreenSession>(sessions);
        foreach (ScreenSession s in all) s.Ws.SendText(Status(s.Pid));
    }

    public void Stop()
    {
        if (Glue != null) Glue.Stop();
        Log.Write("InnaChart stopped.");
    }

    string Status(int pid)
    {
        bool feedOn = feed.Get(pid) != null;
        bool ticketOn = ticket != null && ticket.Get(pid) != null;
        bool separate = Glue != null && Glue.Separate;
        return "{\"t\":\"host\",\"pid\":" + pid + ",\"feed\":" + (feedOn ? "true" : "false") + ",\"ticket\":" + (ticketOn ? "true" : "false") +
            ",\"separate\":" + (separate ? "true" : "false") + "}";
    }

    // A reply goes to the screen that asked, with its own id back; everything else to every screen
    // of that MT5.
    void OnFeed(Terminal term, string type, string json)
    {
        long mine = Array.IndexOf(Replies, type) >= 0 ? Routing.IdOf(json) : 0;
        ScreenSession asker;
        long id;
        if (mine > 0 && waiting.Take(mine, out asker, out id))
        {
            asker.Ws.SendText(Routing.WithId(json, id));
            return;
        }
        if (mine > 0) return;   // its screen has gone
        if (type == "hello") UpdatePulse(term.Pid);
        if (type == "quote") quotes.Keep(term.Pid, json);
        Broadcast(term.Pid, json);
    }

    // The feed of an MT5 runs on pulses while a screen shows it.
    void UpdatePulse(int pid)
    {
        Terminal term = feed.Get(pid);
        if (term == null) return;
        bool any;
        lock (sessions) any = sessions.Exists(s => s.Pid == pid);
        term.SetPulse(any);
    }

    // What every screen of one MT5 watches, joined, sent to its feed.
    void SendJoined(int pid, string type)
    {
        List<ScreenSession> mine;
        lock (sessions) mine = sessions.FindAll(s => s.Pid == pid);
        var lists = new List<string>();
        foreach (ScreenSession s in mine) lists.Add(type == "watch" ? s.Watch : s.Quotes);
        Terminal term = feed.Get(pid);
        if (term != null) term.Send(Routing.Request(type, Routing.Union(lists)));
    }

    void Broadcast(int pid, string json)
    {
        List<ScreenSession> targets;
        lock (sessions) targets = sessions.FindAll(s => s.Pid == pid);
        foreach (ScreenSession s in targets) s.Ws.SendText(json);
    }

    // A screen's WebSocket, for as long as it is open (on the web server's thread for it).
    void OnScreen(WsConnection ws, HttpRequest req)
    {
        int pid;
        int.TryParse(req.QueryValue("term"), out pid);
        if (pid <= 0)
        {
            List<Terminal> all = feed.All();
            pid = all.Count > 0 ? all[0].Pid : 0;
        }
        var session = new ScreenSession { Pid = pid, Ws = ws };
        lock (sessions) sessions.Add(session);
        UpdatePulse(pid);
        try
        {
            Terminal term = feed.Get(pid);
            ws.SendText(Status(pid));
            if (term != null) foreach (string json in term.Snapshot()) ws.SendText(json);
            Terminal tk = ticket.Get(pid);
            if (tk != null) foreach (string json in tk.Snapshot()) ws.SendText(Routing.Prefixed(json, "ticket."));
            string msg;
            while ((msg = ws.Receive()) != null)
            {
                if (msg.Length > MaxRequest) continue;
                string type = Frames.TypeOf(msg);
                if (type.StartsWith("host.", StringComparison.Ordinal)) { HostRequest(pid, type, msg, ws); continue; }
                if (type.StartsWith("ticket.", StringComparison.Ordinal)) { TicketRequest(session, msg, ws); continue; }
                if (type == "") continue;
                if (type == "watch" || type == "quotes")
                {
                    string list = Routing.ListOf(msg);
                    if (list == null) continue;
                    if (type == "watch") session.Watch = list;
                    else session.Quotes = list;
                    SendJoined(pid, type);
                    // the prices already known, now: the feed resends a symbol only when it moves
                    if (type == "quotes") foreach (string q in quotes.For(pid, list)) ws.SendText(q);
                    continue;
                }
                term = feed.Get(pid);
                if (term == null) continue;
                long id = Routing.IdOf(msg);
                term.Send(id != 0 ? Routing.WithId(msg, waiting.Add(session, id)) : msg);
            }
        }
        finally
        {
            lock (sessions) sessions.Remove(session);
            waiting.Forget(session);
            SendJoined(pid, "watch");
            SendJoined(pid, "quotes");
            UpdatePulse(pid);
        }
    }

    void HostRequest(int pid, string type, string msg, WsConnection ws)
    {
        if (type == "host.ping")
        {
            // Answered at once, on this connection's own thread: the screen measures its link to us.
            ws.SendText("{\"t\":\"host.pong\",\"id\":" + Routing.IdOf(msg) + "}");
        }
        else if (type == "host.hide") OnUi(() => Glue.SetHidden(pid, true));
        else if (type == "host.show") OnUi(() => Glue.SetHidden(pid, false));
        else if (type == "host.separate") OnUi(() => SetSeparate(true));
        else if (type == "host.glue") OnUi(() => SetSeparate(false));
    }

    public void OnUi(Action a)
    {
        if (ui != null && ui.IsHandleCreated) ui.BeginInvoke(a);
    }
}
