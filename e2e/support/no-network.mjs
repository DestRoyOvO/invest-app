// Preload for the end-to-end server (node --import): refuses every outbound connection except to this machine, so
// fixture mode really runs without network access. Loopback stays open for the mock model and the server itself.
// A download the fixtures do not cover (a new data source, a forgotten fetchImpl) then fails loudly: its request
// errors, the page shows the failure and the server output has a "[no-network]" line, instead of the suite quietly
// depending on the internet.

import net from "node:net";

function isLocal(host) {
  if (host === undefined || host === null || host === "") return true; // Node connects to localhost by default
  const name = String(host).toLowerCase().replace(/^\[|\]$/g, "");
  return name === "localhost" || name.endsWith(".localhost") || name === "::1" || name === "::ffff:127.0.0.1" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(name);
}

const connect = net.Socket.prototype.connect;

// Every TCP and TLS client (http, https, fetch, the openai SDK) connects through net.Socket.prototype.connect.
net.Socket.prototype.connect = function connectLocalOnly(...args) {
  // net.connect() hands over its normalized [options, callback] array; sockets also take (options), (path) or (port, host).
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  let host;
  let port;
  let path;
  if (first !== null && typeof first === "object") {
    ({ host, port, path } = first);
  } else if (typeof first === "string" && !/^\d+$/.test(first)) {
    path = first;
  } else {
    port = first;
    host = typeof args[1] === "string" ? args[1] : undefined;
  }
  // Like Node itself: a truthy path is a local pipe or socket file, anything else a TCP connection to host:port.
  if (!path && !isLocal(host)) {
    const error = Object.assign(new Error(`The end-to-end server has no network access: refused ${host}:${port}`), { code: "E2E_NO_NETWORK" });
    process.stderr.write(`[no-network] refused a connection to ${host}:${port}\n`);
    process.nextTick(() => this.destroy(error));
    return this;
  }
  return connect.apply(this, args);
};
