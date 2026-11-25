// Several screens may show one MT5 (the glued window and a browser tab, say), and they share its one
// feed. Each request's id is swapped for one of this program's own, so the reply reaches only the
// screen that asked; the charts and symbols the screens watch are joined, so one screen never stops
// another's updates.
using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;

static class Routing
{
    static readonly Regex Id = new Regex("\"id\":(-?\\d{1,15})");

    // The id of a message ("id" is the first one: the feed writes it right after "t"); 0 without one.
    public static long IdOf(string json)
    {
        Match m = Id.Match(json);
        long id;
        return m.Success && long.TryParse(m.Groups[1].Value, out id) ? id : 0;
    }

    // The message with its id replaced.
    public static string WithId(string json, long id)
    {
        return Id.Replace(json, "\"id\":" + id, 1);
    }

    // The "list" of a watch or quotes request ("a\nb"), or null when the message is not one.
    public static string ListOf(string json)
    {
        try
        {
            var d = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(json);
            object v;
            return d != null && d.TryGetValue("list", out v) ? v as string : null;
        }
        catch (ArgumentException) { return null; }
        catch (InvalidOperationException) { return null; }
    }

    // The "key" of a host.auth message, or "".
    public static string KeyOf(string json)
    {
        try
        {
            var d = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(json);
            object v;
            return d != null && d.TryGetValue("key", out v) && v is string ? (string)v : "";
        }
        catch (ArgumentException) { return ""; }
        catch (InvalidOperationException) { return ""; }
    }

    // The lines of every list, each once, in the order first seen.
    public static string Union(IEnumerable<string> lists)
    {
        var seen = new HashSet<string>();
        var all = new List<string>();
        foreach (string list in lists)
        {
            if (string.IsNullOrEmpty(list)) continue;
            foreach (string line in list.Split('\n'))
                if (line.Length > 0 && seen.Add(line)) all.Add(line);
        }
        return string.Join("\n", all.ToArray());
    }

    public static string Request(string type, string list)
    {
        var d = new Dictionary<string, object>();
        d["t"] = type;
        d["list"] = list;
        return new JavaScriptSerializer().Serialize(d);
    }
}

// The requests sent on to a feed and waiting for their replies: the program's id -> the screen
// and the id it used.
sealed class Waiting
{
    sealed class Entry
    {
        public ScreenSession Session;
        public long Id;
        public DateTime At;
    }

    readonly Dictionary<long, Entry> entries = new Dictionary<long, Entry>();
    long next = 1;

    // A new id for a screen's request.
    public long Add(ScreenSession session, long id)
    {
        lock (entries)
        {
            if (entries.Count > 500) Prune(TimeSpan.FromSeconds(60));
            long mine = next++;
            entries[mine] = new Entry { Session = session, Id = id, At = DateTime.UtcNow };
            return mine;
        }
    }

    // The screen and its id for a reply; false when no screen waits for it (any more).
    public bool Take(long mine, out ScreenSession session, out long id)
    {
        lock (entries)
        {
            Entry e;
            if (entries.TryGetValue(mine, out e))
            {
                entries.Remove(mine);
                session = e.Session;
                id = e.Id;
                return true;
            }
        }
        session = null;
        id = 0;
        return false;
    }

    public void Forget(ScreenSession session)
    {
        lock (entries)
        {
            var gone = new List<long>();
            foreach (var kv in entries) if (kv.Value.Session == session) gone.Add(kv.Key);
            foreach (long k in gone) entries.Remove(k);
        }
    }

    public int Count { get { lock (entries) return entries.Count; } }

    void Prune(TimeSpan age)
    {
        var gone = new List<long>();
        foreach (var kv in entries) if (DateTime.UtcNow - kv.Value.At > age) gone.Add(kv.Key);
        foreach (long k in gone) entries.Remove(k);
    }
}
