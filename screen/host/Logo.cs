// InnaChart's logo (screen/web/img/logo.svg), drawn at the exact size Windows asks for, so it is never
// stretched and blurred: the tray icon, the screen window's title bar and taskbar button, and the
// icon inside InnaChart.exe. The i of Inna as a rising candle with its dot, a hollow falling candle
// beside it, on a blue rounded square.
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;

static class Logo
{
    // The sizes an .ico holds: 100% to 200% display scale for small and large icons, and Explorer's.
    public static readonly int[] IcoSizes = { 16, 20, 24, 32, 40, 48, 64, 96, 128, 256 };

    static readonly Dictionary<int, Icon> icons = new Dictionary<int, Icon>();

    public static Bitmap Draw(int size)
    {
        var bmp = new Bitmap(size, size, PixelFormat.Format32bppArgb);
        float k = size / 64f;   // the logo is drawn on 64 x 64
        using (Graphics g = Graphics.FromImage(bmp))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.PixelOffsetMode = PixelOffsetMode.HighQuality;
            g.CompositingQuality = CompositingQuality.HighQuality;
            g.Clear(Color.Transparent);
            g.ScaleTransform(k, k);
            using (var path = Rounded(0, 0, 64, 64, 15))
            using (var bg = new LinearGradientBrush(new PointF(0, 0), new PointF(64, 64), Color.FromArgb(59, 108, 255), Color.FromArgb(22, 54, 184)))
                g.FillPath(bg, path);
            // At small sizes the thin parts would fade into the blue: never thinner than about a pixel.
            float line = Math.Max(2.5f, 1.1f / k);
            float wick = Math.Max(3f, 1.2f / k);
            using (var white = new SolidBrush(Color.White))
            using (var light = new SolidBrush(Color.FromArgb(207, 220, 255)))
            using (var outline = new Pen(Color.FromArgb(207, 220, 255), line))
            {
                g.FillEllipse(white, 24 - 5.5f, 14.5f - 5.5f, 11, 11);
                using (var p = Rounded(24 - wick / 2, 23, wick, 30, wick / 2)) g.FillPath(white, p);
                using (var p = Rounded(17, 28, 14, 18, 3)) g.FillPath(white, p);
                using (var p = Rounded(42 - wick / 2, 14, wick, 8, wick / 2)) g.FillPath(light, p);
                using (var p = Rounded(35.25f, 21.25f, 13.5f, 15.5f, 3)) g.DrawPath(outline, p);
                using (var p = Rounded(42 - wick / 2, 36, wick, 10, wick / 2)) g.FillPath(light, p);
            }
        }
        return bmp;
    }

    // An icon of one size, made once and kept for as long as the program runs.
    public static Icon Icon(int size)
    {
        size = Math.Max(16, Math.Min(256, size));
        lock (icons)
        {
            Icon icon;
            if (!icons.TryGetValue(size, out icon))
            {
                using (Bitmap b = Draw(size)) icon = System.Drawing.Icon.FromHandle(b.GetHicon());
                icons[size] = icon;
            }
            return icon;
        }
    }

    // An .ico file with every size, each kept as a PNG (Windows Vista and later read them so).
    public static byte[] Ico(int[] sizes)
    {
        var pngs = new List<byte[]>();
        foreach (int s in sizes)
            using (Bitmap b = Draw(s))
            using (var ms = new MemoryStream())
            {
                b.Save(ms, ImageFormat.Png);
                pngs.Add(ms.ToArray());
            }
        using (var ms = new MemoryStream())
        using (var w = new BinaryWriter(ms))
        {
            w.Write((ushort)0);              // reserved
            w.Write((ushort)1);              // an icon
            w.Write((ushort)sizes.Length);
            int offset = 6 + 16 * sizes.Length;
            for (int i = 0; i < sizes.Length; i++)
            {
                w.Write((byte)(sizes[i] >= 256 ? 0 : sizes[i]));   // 0 means 256
                w.Write((byte)(sizes[i] >= 256 ? 0 : sizes[i]));
                w.Write((byte)0);            // no palette
                w.Write((byte)0);
                w.Write((ushort)1);          // planes
                w.Write((ushort)32);         // bits per pixel
                w.Write(pngs[i].Length);
                w.Write(offset);
                offset += pngs[i].Length;
            }
            foreach (byte[] png in pngs) w.Write(png);
            w.Flush();
            return ms.ToArray();
        }
    }

    static GraphicsPath Rounded(float x, float y, float w, float h, float r)
    {
        var path = new GraphicsPath();
        float d = r * 2;
        path.AddArc(x, y, d, d, 180, 90);
        path.AddArc(x + w - d, y, d, d, 270, 90);
        path.AddArc(x + w - d, y + h - d, d, d, 0, 90);
        path.AddArc(x, y + h - d, d, d, 90, 90);
        path.CloseFigure();
        return path;
    }
}
