// Serves the prototype on 127.0.0.1, so its ?variant= and ?shell= addresses work.
//   node prototype/serve.js [port]    then open http://127.0.0.1:8140/
'use strict';
const fs = require('fs');
const http = require('http');
const path = require('path');

const file = path.join(__dirname, 'index.html');
const port = Number(process.argv[2]) || 8140;

http.createServer((req, res) => {
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }).end(String(err));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end(data);
  });
}).listen(port, '127.0.0.1', () => console.log(`Prototype: http://127.0.0.1:${port}/?variant=A`));
