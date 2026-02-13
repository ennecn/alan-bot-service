const net = require("net");
const dns = require("dns");

const LISTEN_PORT = 443;
const TARGET_HOST = "api.telegram.org";
const TARGET_PORT = 443;

let targetIP = null;

function resolveTarget() {
  dns.resolve4(TARGET_HOST, (err, addresses) => {
    if (err) {
      console.error(`[${new Date().toISOString()}] DNS resolve failed: ${err.message}`);
      return;
    }
    const newIP = addresses[0];
    if (newIP !== targetIP) {
      console.log(`[${new Date().toISOString()}] Resolved ${TARGET_HOST} -> ${newIP}`);
    }
    targetIP = newIP;
  });
}

resolveTarget();
setInterval(resolveTarget, 60000);

let activeConnections = 0;
let totalConnections = 0;

const server = net.createServer((clientSocket) => {
  if (!targetIP) {
    clientSocket.destroy();
    return;
  }

  activeConnections++;
  totalConnections++;
  const connId = totalConnections;
  let cleaned = false;
  const clientAddr = (clientSocket.remoteAddress || "").replace(/^::ffff:/, "");

  console.log(`[${new Date().toISOString()}] #${connId} CONNECT from ${clientAddr} (active=${activeConnections})`);

  const targetSocket = net.createConnection({ host: targetIP, port: TARGET_PORT }, () => {
    clientSocket.pipe(targetSocket);
    targetSocket.pipe(clientSocket);
  });

  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    activeConnections--;
    clientSocket.destroy();
    targetSocket.destroy();
  };

  clientSocket.on("error", cleanup);
  clientSocket.on("close", cleanup);
  targetSocket.on("error", cleanup);
  targetSocket.on("close", cleanup);
  clientSocket.setTimeout(600000, cleanup);
  targetSocket.setTimeout(600000, cleanup);
});

server.listen(LISTEN_PORT, "0.0.0.0", () => {
  console.log(`[${new Date().toISOString()}] Telegram TCP proxy :${LISTEN_PORT} -> ${TARGET_HOST}:${TARGET_PORT}`);
});

server.on("error", (err) => {
  console.error(`[${new Date().toISOString()}] Server error: ${err.message}`);
  process.exit(1);
});
