const handler = require('serve-handler');
const http = require('http');

const server = http.createServer((req, res) => {
  return handler(req, res, { public: __dirname, trailingSlash: false });
});

const port = process.env.PORT || 3000;
server.listen(port, () => console.log(`Listening on port ${port}`));
