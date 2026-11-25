// The screen's saved files (drawings, templates, settings) in one folder, %APPDATA%\InnaChart
// by default. A write goes to a new file first and replaces the old one only when complete; the
// file it replaced is kept as <name>.bak.
using System;
using System.IO;
using System.Text.RegularExpressions;

sealed class Store
{
    static readonly Regex Name = new Regex(@"^[a-z0-9][a-z0-9_-]{0,80}(\.[a-z0-9_-]{1,40}){0,2}\.json$", RegexOptions.CultureInvariant);
    readonly string dir;
    readonly object gate = new object();

    public Store(string dir)
    {
        this.dir = dir;
        Directory.CreateDirectory(dir);
    }

    public string Folder { get { return dir; } }

    public static bool ValidName(string name)
    {
        return name != null && Name.IsMatch(name) && !name.Contains("..");
    }

    public byte[] Read(string name)
    {
        if (!ValidName(name)) throw new ArgumentException("A bad store name.");
        string path = Path.Combine(dir, name);
        lock (gate) return File.Exists(path) ? File.ReadAllBytes(path) : null;
    }

    public void Write(string name, byte[] data)
    {
        if (!ValidName(name)) throw new ArgumentException("A bad store name.");
        string path = Path.Combine(dir, name);
        string temp = path + ".new";
        lock (gate)
        {
            File.WriteAllBytes(temp, data);
            if (File.Exists(path)) File.Replace(temp, path, path + ".bak");
            else File.Move(temp, path);
        }
    }
}
