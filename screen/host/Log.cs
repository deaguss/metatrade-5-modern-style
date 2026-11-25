// The program's log, %LOCALAPPDATA%\InnaChart\host.log: one line a thing that happened, never
// a message's contents. It keeps one older file of 512 KB.
using System;
using System.IO;

static class Log
{
    static string path;
    static readonly object gate = new object();

    public static void Open(string file)
    {
        path = file;
        Directory.CreateDirectory(Path.GetDirectoryName(file));
    }

    public static void Write(string line)
    {
        if (path == null) return;
        try
        {
            lock (gate)
            {
                var info = new FileInfo(path);
                if (info.Exists && info.Length > 512 * 1024)
                {
                    string old = path + ".1";
                    if (File.Exists(old)) File.Delete(old);
                    File.Move(path, old);
                }
                File.AppendAllText(path, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  " + line + Environment.NewLine);
            }
        }
        catch (Exception) { }
    }
}
