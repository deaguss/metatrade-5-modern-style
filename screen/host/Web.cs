// The screen's own little web server, on 127.0.0.1 only: the page's files, the store for drawings
// and templates, and a WebSocket to the feed. Each start makes a random key; the page gets it after
// the # of its address (never sent in a request line) and sends it back in a header with every
// store request, and as the WebSocket's first message. The Host header must be this server (no
// other name may point here), and the WebSocket's Origin must be this server too.
using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Threading;

sealed class HttpRequest
{
    public const int MaxHeader = 16 * 1024;
    public const int MaxBody = 8 * 1024 * 1024;

    public string Method = "";
    public string Path = "";
    public string Query = "";
    public readonly Dictionary<string, string> Headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
    public byte[] Body = new byte[0];

    public string Header(string name)
    {
        string v;
        return Headers.TryGetValue(name, out v) ? v : "";
    }

    public string QueryValue(string key)
    {
        foreach (string part in Query.Split('&'))
        {
            int eq = part.IndexOf('=');
            string k = eq < 0 ? part : part.Substring(0, eq);
            if (k == key) return eq < 0 ? "" : Uri.UnescapeDataString(part.Substring(eq + 1).Replace('+', ' '));
        }
        return "";
    }

    // Reads one request. null when the connection closed before sending anything.
    public static HttpRequest Read(Stream s)
    {
        var head = new MemoryStream();
        uint last4 = 0;   // the last four bytes read
        while (last4 != 0x0D0A0D0A)
        {
            int b = s.ReadByte();
            if (b < 0)
            {
                if (head.Length == 0) return null;
                throw new InvalidDataException("The request ended inside its header.");
            }
            head.WriteByte((byte)b);
            if (head.Length > MaxHeader) throw new InvalidDataException("The request header is too large.");
            last4 = (last4 << 8) | (uint)b;
        }
        string text = Encoding.ASCII.GetString(head.ToArray());
        string[] lines = text.Split(new[] { "\r\n" }, StringSplitOptions.None);
        string[] first = lines[0].Split(' ');
        if (first.Length != 3 || !first[2].StartsWith("HTTP/1.", StringComparison.Ordinal))
            throw new InvalidDataException("Not an HTTP request.");
        var req = new HttpRequest { Method = first[0] };
        string target = first[1];
        int q = target.IndexOf('?');
        req.Path = q < 0 ? target : target.Substring(0, q);
        req.Query = q < 0 ? "" : target.Substring(q + 1);
        for (int i = 1; i < lines.Length; i++)
        {
            if (lines[i].Length == 0) continue;
            int colon = lines[i].IndexOf(':');
            if (colon <= 0) throw new InvalidDataException("A bad header line.");
            req.Headers[lines[i].Substring(0, colon).Trim()] = lines[i].Substring(colon + 1).Trim();
        }
        string lenText = req.Header("Content-Length");
        if (lenText != "")
        {
            int len;
            if (!int.TryParse(lenText, out len) || len < 0) throw new InvalidDataException("A bad Content-Length.");
            if (len > MaxBody) throw new InvalidDataException("The request body is too large.");
            req.Body = new byte[len];
            int off = 0;
            while (off < len)
            {
                int n = s.Read(req.Body, off, len - off);
                if (n <= 0) throw new InvalidDataException("The request ended inside its body.");
                off += n;
            }
        }
        else if (req.Header("Transfer-Encoding") != "")
            throw new InvalidDataException("Chunked bodies are not accepted.");
        return req;
    }
}

// A WebSocket connection (RFC 6455), text messages only.
sealed class WsConnection
{
    public const int MaxMessage = 1 << 20;
    const string Guid = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

    readonly Stream input;
    readonly Stream output;
    readonly object writeLock = new object();
    volatile bool closed;

    public WsConnection(Stream input, Stream output)
    {
        this.input = input;
        this.output = output;
    }

    public bool Closed { get { return closed; } }

    public static string AcceptKey(string key)
    {
        using (var sha = SHA1.Create())
            return Convert.ToBase64String(sha.ComputeHash(Encoding.ASCII.GetBytes(key.Trim() + Guid)));
    }

    // A frame from the server: never masked.
    public static byte[] EncodeFrame(int opcode, byte[] payload)
    {
        int n = payload.Length;
        int head = n < 126 ? 2 : (n <= 0xFFFF ? 4 : 10);
        byte[] f = new byte[head + n];
        f[0] = (byte)(0x80 | opcode);
        if (n < 126) f[1] = (byte)n;
        else if (n <= 0xFFFF)
        {
            f[1] = 126;
            f[2] = (byte)(n >> 8);
            f[3] = (byte)n;
        }
        else
        {
            f[1] = 127;
            long l = n;
            for (int i = 0; i < 8; i++) f[2 + i] = (byte)(l >> (56 - 8 * i));
        }
        Buffer.BlockCopy(payload, 0, f, head, n);
        return f;
    }

    static void ReadExactly(Stream s, byte[] buf, int count)
    {
        int off = 0;
        while (off < count)
        {
            int n = s.Read(buf, off, count - off);
            if (n <= 0) throw new EndOfStreamException("The WebSocket closed inside a frame.");
            off += n;
        }
    }

    // The next text message; null when the other side closed. Answers pings; refuses binary,
    // unmasked and oversized frames by closing.
    public string Receive()
    {
        var message = new MemoryStream();
        bool inMessage = false;
        byte[] two = new byte[2];
        while (!closed)
        {
            try { ReadExactly(input, two, 2); }
            catch (Exception) { closed = true; return null; }
            bool fin = (two[0] & 0x80) != 0;
            int op = two[0] & 0x0F;
            bool masked = (two[1] & 0x80) != 0;
            long len = two[1] & 0x7F;
            try
            {
                if (len == 126)
                {
                    byte[] b = new byte[2];
                    ReadExactly(input, b, 2);
                    len = (b[0] << 8) | b[1];
                }
                else if (len == 127)
                {
                    byte[] b = new byte[8];
                    ReadExactly(input, b, 8);
                    len = 0;
                    for (int i = 0; i < 8; i++) len = (len << 8) | b[i];
                }
                if (!masked || len < 0 || len > MaxMessage || message.Length + len > MaxMessage) { Close(1009); return null; }
                byte[] mask = new byte[4];
                ReadExactly(input, mask, 4);
                byte[] payload = new byte[len];
                ReadExactly(input, payload, (int)len);
                for (int i = 0; i < payload.Length; i++) payload[i] ^= mask[i & 3];
                if (op == 8) { Close(1000); return null; }
                if (op == 9) { Send(10, payload); continue; }
                if (op == 10) continue;
                if (op == 2 || (op == 0 && !inMessage) || (op == 1 && inMessage) || op > 2) { Close(1003); return null; }
                inMessage = true;
                message.Write(payload, 0, payload.Length);
                if (fin)
                {
                    try { return new UTF8Encoding(false, true).GetString(message.ToArray()); }
                    catch (DecoderFallbackException) { Close(1007); return null; }
                }
            }
            catch (Exception) { closed = true; return null; }
        }
        return null;
    }

    bool Send(int opcode, byte[] payload)
    {
        if (closed && opcode != 8) return false;
        try
        {
            byte[] frame = EncodeFrame(opcode, payload);
            lock (writeLock)
            {
                output.Write(frame, 0, frame.Length);
                output.Flush();
            }
            return true;
        }
        catch (Exception)
        {
            closed = true;
            return false;
        }
    }

    public bool SendText(string text)
    {
        return Send(1, Encoding.UTF8.GetBytes(text));
    }

    public void Close(int code = 1000)
    {
        if (closed) return;
        Send(8, new[] { (byte)(code >> 8), (byte)code });
        closed = true;
    }
}

sealed class WebServer
{
    readonly string webRoot;
    readonly Store store;
    readonly string key;
    readonly Action<WsConnection, HttpRequest> onScreen;
    TcpListener listener;
    public int Port { get; private set; }

    public WebServer(string webRoot, Store store, string key, Action<WsConnection, HttpRequest> onScreen)
    {
        this.webRoot = webRoot;
        this.store = store;
        this.key = key;
        this.onScreen = onScreen;
    }

    // Takes the first free port from the one asked.
    public void Start(int port)
    {
        for (int p = port; p < port + 20; p++)
        {
            try
            {
                var l = new TcpListener(IPAddress.Loopback, p);
                l.Start();
                listener = l;
                Port = p;
                break;
            }
            catch (SocketException) { }
        }
        if (listener == null) throw new IOException("No free port from " + port + " to " + (port + 19) + " on 127.0.0.1.");
        new Thread(AcceptLoop) { IsBackground = true, Name = "web accept" }.Start();
    }

    void AcceptLoop()
    {
        while (true)
        {
            TcpClient client;
            try { client = listener.AcceptTcpClient(); }
            catch (Exception) { return; }
            new Thread(() => Serve(client)) { IsBackground = true, Name = "web" }.Start();
        }
    }

    public static bool IsAllowedHost(string host, int port)
    {
        return host == "127.0.0.1:" + port || host == "localhost:" + port;
    }

    public static bool IsAllowedOrigin(string origin, int port)
    {
        return origin == "http://127.0.0.1:" + port || origin == "http://localhost:" + port;
    }

    public static bool KeyMatches(string given, string key)
    {
        if (string.IsNullOrEmpty(given) || string.IsNullOrEmpty(key) || given.Length != key.Length) return false;
        int diff = 0;
        for (int i = 0; i < key.Length; i++) diff |= given[i] ^ key[i];
        return diff == 0;
    }

    // A file under the web root for a URL path, or null when the path is not one we serve.
    public static string StaticPath(string urlPath)
    {
        string p = urlPath == "/" ? "/index.html" : urlPath;
        if (p.Length > 200 || !p.StartsWith("/", StringComparison.Ordinal)) return null;
        foreach (char c in p)
            if (!(char.IsLetterOrDigit(c) && c < 128) && c != '/' && c != '.' && c != '-' && c != '_') return null;
        if (p.Contains("..") || p.Contains("//")) return null;
        return p.Substring(1).Replace('/', Path.DirectorySeparatorChar);
    }

    public static string ContentType(string path)
    {
        switch (Path.GetExtension(path).ToLowerInvariant())
        {
            case ".html": return "text/html; charset=utf-8";
            case ".js": return "text/javascript; charset=utf-8";
            case ".css": return "text/css; charset=utf-8";
            case ".json": return "application/json; charset=utf-8";
            case ".svg": return "image/svg+xml";
            case ".png": return "image/png";
            case ".ico": return "image/x-icon";
            default: return null;
        }
    }

    void Serve(TcpClient client)
    {
        using (client)
        {
            try
            {
                client.NoDelay = true;
                NetworkStream net = client.GetStream();
                var input = new BufferedStream(net, 1 << 16);
                HttpRequest req = HttpRequest.Read(input);
                if (req == null) return;
                if (!IsAllowedHost(req.Header("Host"), Port)) { Respond(net, 403, "text/plain", "Forbidden"); return; }

                if (req.Path == "/ws")
                {
                    if (req.Header("Upgrade").ToLowerInvariant() != "websocket" || req.Header("Sec-WebSocket-Key") == "")
                    { Respond(net, 400, "text/plain", "A WebSocket is expected"); return; }
                    if (!IsAllowedOrigin(req.Header("Origin"), Port))
                    { Respond(net, 403, "text/plain", "Forbidden"); return; }
                    string accept = WsConnection.AcceptKey(req.Header("Sec-WebSocket-Key"));
                    byte[] hello = Encoding.ASCII.GetBytes("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + accept + "\r\n\r\n");
                    net.Write(hello, 0, hello.Length);
                    var ws = new WsConnection(input, net);
                    // The first message must be {"t":"host.auth","key":...}, within 5 seconds.
                    client.ReceiveTimeout = 5000;
                    string first = ws.Receive();
                    if (first == null || Frames.TypeOf(first) != "host.auth" || !KeyMatches(Routing.KeyOf(first), key))
                    {
                        ws.Close(1008);
                        return;
                    }
                    client.ReceiveTimeout = 0;
                    onScreen(ws, req);
                    return;
                }

                if (req.Path.StartsWith("/api/store/", StringComparison.Ordinal))
                {
                    if (!KeyMatches(req.Header("X-Key"), key)) { Respond(net, 403, "text/plain", "Forbidden"); return; }
                    string name = req.Path.Substring("/api/store/".Length);
                    if (!Store.ValidName(name)) { Respond(net, 400, "text/plain", "A bad name"); return; }
                    if (req.Method == "GET")
                    {
                        byte[] data = store.Read(name);
                        if (data == null) Respond(net, 404, "text/plain", "Not found");
                        else Respond(net, 200, "application/json; charset=utf-8", data);
                    }
                    else if (req.Method == "PUT")
                    {
                        store.Write(name, req.Body);
                        Respond(net, 204, null, new byte[0]);
                    }
                    else Respond(net, 405, "text/plain", "Method not allowed");
                    return;
                }

                if (req.Method != "GET") { Respond(net, 405, "text/plain", "Method not allowed"); return; }
                string rel = StaticPath(req.Path);
                string type = rel == null ? null : ContentType(rel);
                string file = rel == null ? null : Path.Combine(webRoot, rel);
                if (type == null || !File.Exists(file)) { Respond(net, 404, "text/plain", "Not found"); return; }
                Respond(net, 200, type, File.ReadAllBytes(file));
            }
            catch (Exception e)
            {
                if (!(e is IOException || e is ObjectDisposedException)) Log.Write("A web request failed: " + e.Message);
            }
        }
    }

    void Respond(Stream s, int status, string type, string text)
    {
        Respond(s, status, type, Encoding.UTF8.GetBytes(text));
    }

    void Respond(Stream s, int status, string type, byte[] body)
    {
        var h = new StringBuilder();
        h.Append("HTTP/1.1 ").Append(status).Append(' ').Append(Reason(status)).Append("\r\n");
        if (type != null) h.Append("Content-Type: ").Append(type).Append("\r\n");
        h.Append("Content-Length: ").Append(body.Length).Append("\r\n");
        h.Append("Cache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nX-Frame-Options: DENY\r\n");
        if (type != null && type.StartsWith("text/html", StringComparison.Ordinal))
            h.Append("Content-Security-Policy: default-src 'self'; connect-src 'self' ws://127.0.0.1:").Append(Port)
             .Append(" ws://localhost:").Append(Port)
             .Append("; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'\r\n");
        h.Append("Connection: close\r\n\r\n");
        byte[] head = Encoding.ASCII.GetBytes(h.ToString());
        s.Write(head, 0, head.Length);
        s.Write(body, 0, body.Length);
        s.Flush();
    }

    static string Reason(int status)
    {
        switch (status)
        {
            case 200: return "OK";
            case 204: return "No Content";
            case 400: return "Bad Request";
            case 403: return "Forbidden";
            case 404: return "Not Found";
            case 405: return "Method Not Allowed";
            default: return "Error";
        }
    }
}
