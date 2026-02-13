const net = require("net");
const dns = require("dns");

const LISTEN_PORT = 443;

// Route table: SNI hostname -> target
const ROUTES = {
  "api.telegram.org": { host: "api.telegram.org", port: 443 },
  "api.cluster-fluster.com": { host: "api.cluster-fluster.com", port: 443 },
};
const DEFAULT_ROUTE = ROUTES["api.telegram.org"];

// DNS cache: hostname -> IP
const dnsCache = {};

function resolveAll() {
  const hosts = new Set(Object.values(ROUTES).map((r) => r.host));
  for (const host of hosts) {
    dns.resolve4(host, (err, addresses) => {
      if (err) {
        console.error(`[${ts()}] DNS resolve ${host} failed: ${err.message}`);
        return;
      }
      const newIP = addresses[0];
      if (newIP !== dnsCache[host]) {
        console.log(`[${ts()}] Resolved ${host} -> ${newIP}`);
      }
      dnsCache[host] = newIP;
    });
  }
}

function ts() {
  return new Date().toISOString();
}

// Parse SNI from TLS ClientHello
function extractSNI(buf) {
  // Minimum TLS record: 5 byte header + 1 byte
  if (buf.length < 6) return null;
  // TLS handshake record type = 0x16
  if (buf[0] !== 0x16) return null;
  // Skip record header (5 bytes), handshake type should be ClientHello (0x01)
  if (buf[5] !== 0x01) return null;

  let offset = 5 + 4; // record header + handshake header (type + 3-byte length)
  // Skip client version (2) + random (32)
  offset += 2 + 32;
  if (offset + 1 > buf.length) return null;
  // Skip session ID
  const sessionIdLen = buf[offset];
  offset += 1 + sessionIdLen;
  if (offset + 2 > buf.length) return null;
  // Skip cipher suites
  const cipherLen = buf.readUInt16BE(offset);
  offset += 2 + cipherLen;
  if (offset + 1 > buf.length) return null;
  // Skip compression methods
  const compLen = buf[offset];
  offset += 1 + compLen;
  if (offset + 2 > buf.length) return null;
  // Extensions length
  const extLen = buf.readUInt16BE(offset);
  offset += 2;
  const extEnd = offset + extLen;

  while (offset + 4 <= extEnd && offset + 4 <= buf.length) {
    const extType = buf.readUInt16BE(offset);
    const extDataLen = buf.readUInt16BE(offset + 2);
    offset += 4;
    if (extType === 0x0000) {
      // SNI extension
      if (offset + 5 > buf.length) return null;
      // Skip SNI list length (2), type (1)
      const nameLen = buf.readUInt16BE(offset + 3);
      offset += 5;
      if (offset + nameLen > buf.length) return null;
      return buf.toString("ascii", offset, offset + nameLen);
    }
    offset += extDataLen;
  }
  return null;
}

resolveAll();
setInterval(resolveAll, 60000);

let activeConnections = 0;
let totalConnections = 0;
const stats = {}; // per-route stats

const server = net.createServer((clientSocket) => {
  let initialData = Buffer.alloc(0);
  let connected = false;

  const clientAddr = (clientSocket.remoteAddress || "").replace(/^::ffff:/, "");

  // Wait for first data to extract SNI
  clientSocket.once("data", (chunk) => {
    initialData = Buffer.concat([initialData, chunk]);
    const sni = extractSNI(initialData);
    const route = (sni && ROUTES[sni]) || DEFAULT_ROUTE;
    const targetHost = route.host;
    const targetIP = dnsCache[targetHost];

    if (!targetIP) {
      console.error(`[${ts()}] No DNS for ${targetHost}, dropping`);
      clientSocket.destroy();
      return;
    }

    activeConnections++;
    totalConnections++;
    const connId = totalConnections;
    let cleaned = false;
    stats[targetHost] = (stats[targetHost] || 0) + 1;

    console.log(
      `[${ts()}] #${connId} ${clientAddr} -> ${sni || "no-sni"}(${targetIP}:${route.port}) active=${activeConnections}`
    );

    const targetSocket = net.createConnection(
      { host: targetIP, port: route.port },
      () => {
        connected = true;
        // Send the buffered initial data
        targetSocket.write(initialData);
        clientSocket.pipe(targetSocket);
        targetSocket.pipe(clientSocket);
      }
    );

    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      activeConnections--;
      clientSocket.destroy();
      targetSocket.destroy();
    };

    clientSocket.on("error", cleanup);
    clientSocket.on("close", cleanup);
    targetSocket.on("error", (err) => {
      console.error(`[${ts()}] #${connId} target error: ${err.message}`);
      cleanup();
    });
    targetSocket.on("close", cleanup);
    clientSocket.setTimeout(600000, cleanup);
    targetSocket.setTimeout(600000, cleanup);
  });

  clientSocket.on("error", () => clientSocket.destroy());
  // If no data within 10s, drop
  clientSocket.setTimeout(10000, () => {
    if (!connected) clientSocket.destroy();
  });
});

server.listen(LISTEN_PORT, "0.0.0.0", () => {
  const routes = Object.entries(ROUTES)
    .map(([sni, r]) => `${sni}->${r.host}:${r.port}`)
    .join(", ");
  console.log(`[${ts()}] SNI proxy :${LISTEN_PORT} | ${routes}`);
});

server.on("error", (err) => {
  console.error(`[${ts()}] Server error: ${err.message}`);
  process.exit(1);
});
