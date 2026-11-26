// Writes InnaChart.ico (every size of the logo) for scripts\build-screen.ps1, which puts it inside
// InnaChart.exe: Explorer, the Start menu and shortcuts then show it sharp at any display scale.
using System;
using System.IO;

static class WriteIcon
{
    static int Main(string[] args)
    {
        if (args.Length != 1)
        {
            Console.Error.WriteLine("usage: WriteIcon <path of the .ico to write>");
            return 2;
        }
        File.WriteAllBytes(args[0], Logo.Ico(Logo.IcoSizes));
        return 0;
    }
}
