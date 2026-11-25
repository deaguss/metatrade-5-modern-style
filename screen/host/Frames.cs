// Frames on the feed's pipe: a 4-byte little-endian length, then that many bytes of UTF-8 JSON.
using System;
using System.IO;
using System.Text;

static class Frames
{
    public const int Max = 1 << 20;   // as the feed allows

    static readonly Encoding Utf8 = new UTF8Encoding(false, true);

    public static byte[] Encode(string json)
    {
        byte[] body = Utf8.GetBytes(json);
        if (body.Length > Max) throw new InvalidDataException("A frame of " + body.Length + " bytes is too large.");
        byte[] frame = new byte[4 + body.Length];
        frame[0] = (byte)body.Length;
        frame[1] = (byte)(body.Length >> 8);
        frame[2] = (byte)(body.Length >> 16);
        frame[3] = (byte)(body.Length >> 24);
        Buffer.BlockCopy(body, 0, frame, 4, body.Length);
        return frame;
    }

    // The next frame's text, or null when the stream ended cleanly before a frame.
    public static string Read(Stream s)
    {
        byte[] head = new byte[4];
        int got = ReadAll(s, head, 4);
        if (got == 0) return null;
        if (got < 4) throw new EndOfStreamException("The pipe closed inside a frame's length.");
        int len = head[0] | (head[1] << 8) | (head[2] << 16) | (head[3] << 24);
        if (len < 0 || len > Max) throw new InvalidDataException("A frame claims " + len + " bytes.");
        byte[] body = new byte[len];
        if (ReadAll(s, body, len) < len) throw new EndOfStreamException("The pipe closed inside a frame.");
        return Utf8.GetString(body);
    }

    static int ReadAll(Stream s, byte[] buf, int count)
    {
        int off = 0;
        while (off < count)
        {
            int n = s.Read(buf, off, count - off);
            if (n <= 0) break;
            off += n;
        }
        return off;
    }

    // The "t" of a message the feed wrote: it always starts {"t":"...". "" when it doesn't.
    public static string TypeOf(string json)
    {
        const string head = "{\"t\":\"";
        if (json == null || !json.StartsWith(head, StringComparison.Ordinal)) return "";
        int end = json.IndexOf('"', head.Length);
        return end < 0 ? "" : json.Substring(head.Length, end - head.Length);
    }
}
