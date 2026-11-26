// Tests for InnaChart.exe's parts that need no MetaTrader 5 and no window: frames, HTTP,
// WebSocket, the web server's checks, the store and the placement arithmetic.
// Built and run by scripts\build-screen.ps1 -Tests.
using System;
using System.IO;
using System.Text;

static class HostTests
{
    static int failed, passed;

    static void Check(bool ok, string what)
    {
        if (ok) passed++;
        else
        {
            failed++;
            Console.WriteLine("FAIL: " + what);
        }
    }

    static void Equal<T>(T want, T got, string what)
    {
        Check(Equals(want, got), what + " (want " + want + ", got " + got + ")");
    }

    static void Throws<E>(Action a, string what) where E : Exception
    {
        try { a(); Check(false, what + " (no exception)"); }
        catch (E) { Check(true, what); }
        catch (Exception e) { Check(false, what + " (threw " + e.GetType().Name + ")"); }
    }

    static int Main()
    {
        FramesTests();
        HttpTests();
        WebSocketTests();
        WebChecks();
        StoreTests();
        PlacementTests();
        RoutingTests();
        Console.WriteLine(passed + " passed, " + failed + " failed");
        return failed == 0 ? 0 : 1;
    }

    static void FramesTests()
    {
        byte[] f = Frames.Encode("{\"t\":\"bar\"}");
        Equal(4 + 11, f.Length, "a frame is the length and the body");
        Equal(11, (int)f[0], "the length is little-endian");
        var ms = new MemoryStream();
        ms.Write(f, 0, f.Length);
        byte[] g = Frames.Encode("{\"t\":\"quote\",\"sym\":\"\u00e9\"}");
        ms.Write(g, 0, g.Length);
        ms.Position = 0;
        Equal("{\"t\":\"bar\"}", Frames.Read(ms), "the first frame reads back");
        Equal("{\"t\":\"quote\",\"sym\":\"\u00e9\"}", Frames.Read(ms), "UTF-8 reads back");
        Equal<string>(null, Frames.Read(ms), "a clean end reads as null");
        Throws<EndOfStreamException>(() => Frames.Read(new MemoryStream(new byte[] { 5, 0, 0, 0, 1 })), "a cut frame throws");
        Throws<InvalidDataException>(() => Frames.Read(new MemoryStream(new byte[] { 0, 0, 0x20, 0 })), "a frame over 1 MiB is refused");
        Throws<InvalidDataException>(() => Frames.Encode(new string('x', Frames.Max + 1)), "too large to send");
        Equal("bars", Frames.TypeOf("{\"t\":\"bars\",\"id\":1}"), "the type of a feed message");
        Equal("", Frames.TypeOf("{\"id\":1,\"t\":\"bars\"}"), "a message not starting with t has no type");
        Equal("", Frames.TypeOf("[1]"), "not an object");
    }

    static HttpRequest Parse(string text)
    {
        return HttpRequest.Read(new MemoryStream(Encoding.ASCII.GetBytes(text)));
    }

    static void HttpTests()
    {
        HttpRequest r = Parse("GET /ws?term=1234&key=ab%20c HTTP/1.1\r\nHost: 127.0.0.1:8141\r\nupgrade: websocket\r\n\r\n");
        Equal("GET", r.Method, "method");
        Equal("/ws", r.Path, "path");
        Equal("1234", r.QueryValue("term"), "query value");
        Equal("ab c", r.QueryValue("key"), "query value decoded");
        Equal("", r.QueryValue("none"), "a missing query value");
        Equal("websocket", r.Header("Upgrade"), "headers ignore case");
        r = Parse("PUT /api/store/a.json HTTP/1.1\r\nHost: x\r\nContent-Length: 5\r\n\r\nhello");
        Equal("hello", Encoding.ASCII.GetString(r.Body), "the body");
        Equal<HttpRequest>(null, Parse(""), "a connection that sent nothing");
        Throws<InvalidDataException>(() => Parse("GET / HTTP/1.1\r\nHost: x\r\n"), "a header without its end");
        Throws<InvalidDataException>(() => Parse("GET / HTTP/1.1\r\nTransfer-Encoding: chunked\r\n\r\n"), "chunked bodies");
        Throws<InvalidDataException>(() => Parse("GET / HTTP/1.1\r\nContent-Length: 99999999\r\n\r\n"), "a body too large");
        Throws<InvalidDataException>(() => Parse("HELLO\r\n\r\n"), "not HTTP");
        Throws<InvalidDataException>(() => Parse("GET / HTTP/1.1\r\nX: " + new string('a', 20000) + "\r\n\r\n"), "a header too large");
    }

    static byte[] Masked(int first, byte[] payload)
    {
        byte[] mask = { 0x37, 0xfa, 0x21, 0x3d };
        var ms = new MemoryStream();
        ms.WriteByte((byte)first);
        if (payload.Length < 126) ms.WriteByte((byte)(0x80 | payload.Length));
        else
        {
            ms.WriteByte(0x80 | 126);
            ms.WriteByte((byte)(payload.Length >> 8));
            ms.WriteByte((byte)payload.Length);
        }
        ms.Write(mask, 0, 4);
        for (int i = 0; i < payload.Length; i++) ms.WriteByte((byte)(payload[i] ^ mask[i & 3]));
        return ms.ToArray();
    }

    static WsConnection Ws(MemoryStream output, params byte[][] frames)
    {
        var input = new MemoryStream();
        foreach (byte[] f in frames) input.Write(f, 0, f.Length);
        input.Position = 0;
        return new WsConnection(input, output);
    }

    static void WebSocketTests()
    {
        Equal("s3pPLMBiTxaQ9kYGzzhZRbK+xOo=", WsConnection.AcceptKey("dGhlIHNhbXBsZSBub25jZQ=="), "the accept key of RFC 6455's example");
        var output = new MemoryStream();
        WsConnection ws = Ws(output, new byte[] { 0x81, 0x85, 0x37, 0xfa, 0x21, 0x3d, 0x7f, 0x9f, 0x4d, 0x51, 0x58 });
        Equal("Hello", ws.Receive(), "RFC 6455's masked Hello");
        Equal<string>(null, ws.Receive(), "the end of the stream ends the connection");

        output = new MemoryStream();
        ws = Ws(output, Masked(0x01, Encoding.UTF8.GetBytes("Hel")), Masked(0x89, new byte[] { 1, 2 }), Masked(0x80, Encoding.UTF8.GetBytes("lo")));
        Equal("Hello", ws.Receive(), "a fragmented message with a ping between");
        byte[] pong = output.ToArray();
        Check(pong.Length == 4 && pong[0] == 0x8A && pong[1] == 2 && pong[2] == 1 && pong[3] == 2, "the ping is answered with its payload");

        string big = new string('a', 300);
        ws = Ws(new MemoryStream(), Masked(0x81, Encoding.UTF8.GetBytes(big)));
        Equal(big, ws.Receive(), "a 16-bit length");

        output = new MemoryStream();
        ws = Ws(output, new byte[] { 0x81, 0x02, (byte)'h', (byte)'i' });
        Equal<string>(null, ws.Receive(), "an unmasked frame from the page closes the connection");
        Check(output.Length >= 2 && output.ToArray()[0] == 0x88, "with a close frame");

        ws = Ws(new MemoryStream(), Masked(0x82, new byte[] { 1 }));
        Equal<string>(null, ws.Receive(), "binary messages are refused");

        ws = Ws(new MemoryStream(), Masked(0x81, new byte[] { 0xC3, 0x28 }));
        Equal<string>(null, ws.Receive(), "text that is not UTF-8 is refused");

        ws = Ws(new MemoryStream(), new byte[] { 0x81, 0xFF, 0, 0, 0, 0, 0x10, 0, 0, 0 });
        Equal<string>(null, ws.Receive(), "a frame over the limit is refused");

        Equal(2 + 125, WsConnection.EncodeFrame(1, new byte[125]).Length, "a 7-bit length");
        byte[] f126 = WsConnection.EncodeFrame(1, new byte[126]);
        Check(f126.Length == 4 + 126 && f126[1] == 126 && f126[2] == 0 && f126[3] == 126, "a 16-bit length is big-endian");
        byte[] f64 = WsConnection.EncodeFrame(1, new byte[70000]);
        Check(f64.Length == 10 + 70000 && f64[1] == 127 && f64[7] == 1 && f64[8] == 0x11 && f64[9] == 0x70, "a 64-bit length is big-endian");
        Equal(0x81, (int)f64[0], "a final text frame");
    }

    static void WebChecks()
    {
        Check(WebServer.IsAllowedHost("127.0.0.1:8141", 8141), "the server's own host");
        Check(WebServer.IsAllowedHost("localhost:8141", 8141), "localhost");
        Check(!WebServer.IsAllowedHost("evil.example:8141", 8141), "another name pointing here (DNS rebinding)");
        Check(!WebServer.IsAllowedHost("127.0.0.1:8142", 8141), "another port");
        Check(WebServer.IsAllowedOrigin("http://127.0.0.1:8141", 8141), "the page's own origin");
        Check(!WebServer.IsAllowedOrigin("https://example.com", 8141), "another site's page");
        Check(!WebServer.IsAllowedOrigin("", 8141), "no origin");
        Check(!WebServer.IsAllowedOrigin("null", 8141), "a file page");
        Check(WebServer.KeyMatches("abc123", "abc123"), "the key");
        Check(!WebServer.KeyMatches("abc124", "abc123"), "a wrong key");
        Check(!WebServer.KeyMatches("", "abc123"), "no key");
        Check(!WebServer.KeyMatches("abc12", "abc123"), "a short key");
        Equal("index.html", WebServer.StaticPath("/"), "the page");
        Equal("js" + Path.DirectorySeparatorChar + "chart.js", WebServer.StaticPath("/js/chart.js"), "a script");
        Equal<string>(null, WebServer.StaticPath("/../secret.json"), "a path out of the web folder");
        Equal<string>(null, WebServer.StaticPath("/js/..%2fx.js"), "an escaped path");
        Equal<string>(null, WebServer.StaticPath("/C:/x.js"), "a drive");
        Equal<string>(null, WebServer.StaticPath("/a\\b.js"), "a backslash");
        Equal<string>(null, WebServer.StaticPath("//x.js"), "a double slash");
        Equal("text/javascript; charset=utf-8", WebServer.ContentType("a.js"), "scripts");
        Equal<string>(null, WebServer.ContentType("a.exe"), "nothing else is served");
    }

    static void StoreTests()
    {
        Check(Store.ValidName("templates.json"), "a plain name");
        Check(Store.ValidName("drawings.xauusd.json"), "a name with one dot part");
        Check(Store.ValidName("drawings.us30-cash_m.json"), "dashes and underscores");
        Check(!Store.ValidName("../templates.json"), "a path");
        Check(!Store.ValidName("a..json"), "two dots");
        Check(!Store.ValidName("Templates.json"), "capitals");
        Check(!Store.ValidName("a.txt"), "not JSON");
        Check(!Store.ValidName("a/b.json"), "a folder");
        Check(!Store.ValidName(".json"), "no name");
        string dir = Path.Combine(Path.GetTempPath(), "InnaChartTests-" + Guid.NewGuid().ToString("N"));
        try
        {
            var s = new Store(dir);
            Equal<byte[]>(null, s.Read("layout.json"), "a missing file reads as null");
            s.Write("layout.json", Encoding.UTF8.GetBytes("{\"a\":1}"));
            s.Write("layout.json", Encoding.UTF8.GetBytes("{\"a\":2}"));
            Equal("{\"a\":2}", Encoding.UTF8.GetString(s.Read("layout.json")), "the last write");
            Equal("{\"a\":1}", File.ReadAllText(Path.Combine(dir, "layout.json.bak")), "the file it replaced is kept");
            Throws<ArgumentException>(() => s.Write("../x.json", new byte[0]), "a bad name is refused");
        }
        finally { Directory.Delete(dir, true); }
    }

    static void RoutingTests()
    {
        Equal(5L, Routing.IdOf("{\"t\":\"history\",\"sym\":\"XAUUSD\",\"id\":5}"), "a screen's request id");
        Equal(0L, Routing.IdOf("{\"t\":\"watch\",\"list\":\"\"}"), "no id");
        Equal("{\"t\":\"bars\",\"id\":42,\"bars\":[[1,2]]}", Routing.WithId("{\"t\":\"bars\",\"id\":7,\"bars\":[[1,2]]}", 42), "the id swapped, once");
        Equal("M15@XAUUSD\nH1@EURUSD", Routing.ListOf("{\"t\":\"watch\",\"list\":\"M15@XAUUSD\\nH1@EURUSD\"}"), "a watch list");
        Equal<string>(null, Routing.ListOf("{\"t\":\"watch\"}"), "no list");
        Equal<string>(null, Routing.ListOf("not json"), "not JSON");
        Equal("M15@XAUUSD\nH1@EURUSD\nD1@BTCUSD", Routing.Union(new[] { "M15@XAUUSD\nH1@EURUSD", "", "H1@EURUSD\nD1@BTCUSD" }), "lists joined, each line once");
        Equal("{\"t\":\"quotes\",\"list\":\"A\\nB\"}", Routing.Request("quotes", "A\nB"), "a joined request");
        Equal("{\"t\":\"ticket.trades\",\"list\":[]}", Routing.Prefixed("{\"t\":\"trades\",\"list\":[]}", "ticket."), "an EA message for the screens");
        Equal("{\"t\":\"preview\",\"id\":3}", Routing.Unprefixed("{\"t\":\"ticket.preview\",\"id\":3}", "ticket."), "a screen's request for the EA");
        Equal<string>(null, Routing.Unprefixed("{\"t\":\"history\",\"id\":3}", "ticket."), "not a ticket request");
        Equal("abc", Routing.KeyOf("{\"t\":\"host.auth\",\"key\":\"abc\"}"), "the key of the first message");
        Equal("", Routing.KeyOf("{\"t\":\"host.auth\",\"key\":5}"), "a key that is not text");
        Equal("", Routing.KeyOf("{"), "not JSON");

        // The logo: an .ico with every size (each a PNG), and icons of the exact size asked for.
        byte[] ico = Logo.Ico(new[] { 16, 20, 256 });
        Check(ico[0] == 0 && ico[1] == 0 && ico[2] == 1 && ico[3] == 0 && ico[4] == 3, "an .ico header with 3 sizes");
        Check(ico[6] == 16 && ico[22] == 20 && ico[38] == 0, "16, 20 and 256 (written as 0)");
        int first = BitConverter.ToInt32(ico, 6 + 12);
        Check(ico[first] == 0x89 && ico[first + 1] == (byte)'P' && ico[first + 2] == (byte)'N' && ico[first + 3] == (byte)'G', "each size kept as a PNG");
        Equal(20, Logo.Icon(20).Width, "an icon of the tray's size at 125%");
        Equal(40, Logo.Icon(40).Width, "and of a large icon at 125%");
        Check(Logo.Icon(20) == Logo.Icon(20), "made once, then kept");

        var qc = new QuoteCache();
        qc.Keep(7, "{\"t\":\"quote\",\"sym\":\"XAUUSD\",\"bid\":2650.1,\"ask\":2650.3,\"prev\":2640}");
        qc.Keep(7, "{\"t\":\"quote\",\"sym\":\"EURUSD\",\"bid\":1.085,\"ask\":1.0851,\"prev\":1.08}");
        qc.Keep(7, "{\"t\":\"quote\",\"sym\":\"XAUUSD\",\"bid\":2651.1,\"ask\":2651.3,\"prev\":2640}");
        qc.Keep(8, "{\"t\":\"quote\",\"sym\":\"XAUUSD\",\"bid\":9,\"ask\":9,\"prev\":9}");
        qc.Keep(7, "{\"t\":\"quote\",\"bid\":1}");
        var known = qc.For(7, "EURUSD\nGBPUSD\nXAUUSD");
        Equal(2, known.Count, "a new screen gets the quotes already known for its symbols, none for the others");
        Check(known.Count == 2 && known[0].Contains("EURUSD") && known[1].Contains("2651.1"), "in its list's order, the newest of each");
        Equal(0, qc.For(9, "XAUUSD").Count, "another MT5's quotes stay its own");
        Equal(3, qc.Count, "a quote without a symbol is not kept");
        Equal("US30.cash", QuoteCache.SymbolOf("{\"t\":\"quote\",\"sym\":\"US30.cash\",\"bid\":1}"), "a symbol with a dot");
        Equal("A\"B", QuoteCache.SymbolOf("{\"t\":\"quote\",\"sym\":\"A\\\"B\",\"bid\":1}"), "an escaped quote in a symbol");
        qc.Forget(7);
        Equal(0, qc.For(7, "XAUUSD\nEURUSD").Count, "an MT5 that went away: its quotes are forgotten");
        Equal(1, qc.Count, "the other MT5's stay");

        var w = new Waiting();
        var a = new ScreenSession { Pid = 1 };
        var b = new ScreenSession { Pid = 1 };
        long ma = w.Add(a, 5);
        long mb = w.Add(b, 5);
        Check(ma != mb, "two screens asking with the same id get different ids");
        ScreenSession who;
        long id;
        Check(w.Take(mb, out who, out id) && who == b && id == 5, "the reply goes to the screen that asked, with its id");
        Check(!w.Take(mb, out who, out id), "once");
        w.Forget(a);
        Check(!w.Take(ma, out who, out id), "a closed screen's requests are forgotten");
        Equal(0, w.Count, "nothing left waiting");
    }

    static void PlacementTests()
    {
        var target = new Native.RECT { L = 571, T = 102, R = 1911, B = 734 };
        Native.RECT o = Placement.Outer(target, 8, 36, 7, 7);
        Check(o.L == 563 && o.T == 66 && o.R == 1918 && o.B == 741, "the window grows by its frame around the chart area");
        Equal(1340 + 15, o.W, "its width");
    }
}
