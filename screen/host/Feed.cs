// The pipes MetaTrader 5 connects to: the InnaChart service's feed, and the ActionInna EA's ticket. The pipe tells which process
// is on the other end, and the service runs inside terminal64.exe, so each feed is known by its
// MetaTrader 5's process id: the screen glued onto that MetaTrader 5 gets that feed.
using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Threading;

sealed class Terminal
{
    public readonly int Pid;
    readonly NamedPipeServerStream pipe;
    readonly object writeLock = new object();
    readonly Dictionary<string, string> last = new Dictionary<string, string>();
    readonly object pulseLock = new object();
    volatile bool closed;
    volatile bool pulsing;
    static readonly byte[] Pulse = new byte[4];   // an empty frame

    // The messages a screen that connects later needs first: the last of each.
    readonly string[] replayed;

    public Terminal(int pid, NamedPipeServerStream pipe, string[] replayed)
    {
        Pid = pid;
        this.pipe = pipe;
        this.replayed = replayed;
    }

    public bool Closed { get { return closed; } }

    public void Remember(string type, string json)
    {
        if (Array.IndexOf(replayed, type) < 0) return;
        lock (last) last[type] = json;
    }

    public List<string> Snapshot()
    {
        var list = new List<string>();
        lock (last)
        {
            foreach (string t in replayed)
            {
                string json;
                if (last.TryGetValue(t, out json)) list.Add(json);
            }
        }
        return list;
    }

    public bool Send(string json)
    {
        if (closed) return false;
        try
        {
            byte[] frame = Frames.Encode(json);
            lock (writeLock)
            {
                pipe.Write(frame, 0, frame.Length);
                pipe.Flush();
            }
            return true;
        }
        catch (Exception e)
        {
            if (e is IOException || e is ObjectDisposedException || e is InvalidOperationException) { Close(); return false; }
            if (e is InvalidDataException) { Log.Write("Not sent to MT5 " + Pid + ": " + e.Message); return false; }
            throw;
        }
    }

    public string Read() { return Frames.Read(pipe); }

    // While on, an empty frame about every millisecond wakes the feed, so a tick leaves MT5 at once
    // instead of after the feed's sleep. On while a screen shows this MT5.
    // A feed that runs on pulses says so in its hello.
    public bool Pulses
    {
        get
        {
            string hello;
            lock (last) last.TryGetValue("hello", out hello);
            return hello != null && hello.Contains("\"pulse\":true");
        }
    }

    public void SetPulse(bool on)
    {
        lock (pulseLock)
        {
            if (on == pulsing || closed) return;
            if (on && !Pulses) return;   // an older feed would answer each pulse with an error
            pulsing = on;
            Send(on ? "{\"t\":\"pulse\",\"on\":true}" : "{\"t\":\"pulse\",\"on\":false}");
            if (on) new Thread(PulseLoop) { IsBackground = true, Name = "pulse " + Pid }.Start();
        }
    }

    void PulseLoop()
    {
        var clock = System.Diagnostics.Stopwatch.StartNew();
        int sent = 0;
        while (pulsing && !closed)
        {
            if (++sent == 2000) Log.Write("MT5 " + Pid + "'s feed is woken every " + (clock.Elapsed.TotalMilliseconds / sent).ToString("0.00") + " ms.");
            try
            {
                lock (writeLock)
                {
                    pipe.Write(Pulse, 0, Pulse.Length);
                    pipe.Flush();
                }
            }
            catch (Exception)
            {
                Close();
                return;
            }
            Thread.Sleep(1);
        }
    }

    public void Close()
    {
        closed = true;
        pulsing = false;
        try { pipe.Dispose(); } catch (Exception) { }
    }
}

sealed class FeedServer
{
    public const string FeedPipe = "InnaChart.Feed";
    public const string TicketPipe = "InnaChart.Ticket";

    readonly string pipeName;
    readonly string[] replayed;
    readonly Func<string> firstFrame;   // sent as soon as a client connects (the ticket's key), or null

    public FeedServer(string pipeName, string[] replayed, Func<string> firstFrame)
    {
        this.pipeName = pipeName;
        this.replayed = replayed;
        this.firstFrame = firstFrame;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool GetNamedPipeClientProcessId(IntPtr pipe, out uint pid);

    readonly Dictionary<int, Terminal> terminals = new Dictionary<int, Terminal>();
    public event Action<Terminal> Connected;
    public event Action<Terminal> Disconnected;
    public event Action<Terminal, string, string> Message;   // terminal, type, json

    public void Start()
    {
        var t = new Thread(AcceptLoop) { IsBackground = true, Name = "feed accept" };
        t.Start();
    }

    public Terminal Get(int pid)
    {
        lock (terminals)
        {
            Terminal term;
            return terminals.TryGetValue(pid, out term) ? term : null;
        }
    }

    public List<Terminal> All()
    {
        lock (terminals) return new List<Terminal>(terminals.Values);
    }

    NamedPipeServerStream NewPipe()
    {
        // Only this Windows user may connect. Asynchronous (overlapped) on purpose: on a synchronous
        // pipe Windows runs one I/O at a time, so a write to MT5 would wait behind the read that is
        // always waiting for MT5's next message (up to a tick or a second late).
        var security = new PipeSecurity();
        security.AddAccessRule(new PipeAccessRule(WindowsIdentity.GetCurrent().User, PipeAccessRights.FullControl, AccessControlType.Allow));
        return new NamedPipeServerStream(pipeName, PipeDirection.InOut, NamedPipeServerStream.MaxAllowedServerInstances,
            PipeTransmissionMode.Byte, PipeOptions.Asynchronous | PipeOptions.WriteThrough, 1 << 16, 1 << 16, security);
    }

    void AcceptLoop()
    {
        while (true)
        {
            NamedPipeServerStream pipe;
            try
            {
                pipe = NewPipe();
                pipe.WaitForConnection();
            }
            catch (Exception e)
            {
                Log.Write("The feed pipe could not be served: " + e.Message);
                Thread.Sleep(2000);
                continue;
            }
            uint pid;
            if (!GetNamedPipeClientProcessId(pipe.SafePipeHandle.DangerousGetHandle(), out pid) || pid == 0)
            {
                Log.Write("A feed connected whose process is unknown; closed.");
                pipe.Dispose();
                continue;
            }
            var term = new Terminal((int)pid, pipe, replayed);
            Terminal old;
            lock (terminals)
            {
                terminals.TryGetValue(term.Pid, out old);
                terminals[term.Pid] = term;
            }
            if (old != null) old.Close();   // the service started again: the new one wins
            Log.Write("MT5 " + term.Pid + " connected its feed.");
            var reader = new Thread(() => ReadLoop(term)) { IsBackground = true, Name = "feed " + term.Pid };
            reader.Start();
            if (firstFrame != null) term.Send(firstFrame());
            if (Connected != null) Connected(term);
        }
    }

    void ReadLoop(Terminal term)
    {
        try
        {
            string json;
            while ((json = term.Read()) != null)
            {
                string type = Frames.TypeOf(json);
                term.Remember(type, json);
                if (Message != null) Message(term, type, json);
            }
        }
        catch (Exception e)
        {
            if (!term.Closed) Log.Write("MT5 " + term.Pid + "'s feed ended: " + e.Message);
        }
        finally
        {
            term.Close();
            bool current;
            lock (terminals)
            {
                Terminal now;
                current = terminals.TryGetValue(term.Pid, out now) && now == term;
                if (current) terminals.Remove(term.Pid);
            }
            if (current)
            {
                Log.Write("MT5 " + term.Pid + "'s feed disconnected.");
                if (Disconnected != null) Disconnected(term);
            }
        }
    }
}
