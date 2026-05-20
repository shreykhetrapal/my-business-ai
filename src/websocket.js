import { randomBytes, createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import net from "node:net";
import tls from "node:tls";

const websocketGuid = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

function createAcceptValue(key) {
  return createHash("sha1").update(`${key}${websocketGuid}`).digest("base64");
}

function encodeFrame({ data, opcode = 1, mask = false }) {
  const payload = Buffer.isBuffer(data) ? data : Buffer.from(String(data));
  const headerLength = payload.length < 126 ? 2 : payload.length <= 65535 ? 4 : 10;
  const maskLength = mask ? 4 : 0;
  const frame = Buffer.alloc(headerLength + maskLength + payload.length);

  frame[0] = 0x80 | opcode;
  let offset = 2;
  if (payload.length < 126) {
    frame[1] = payload.length;
  } else if (payload.length <= 65535) {
    frame[1] = 126;
    frame.writeUInt16BE(payload.length, 2);
    offset = 4;
  } else {
    frame[1] = 127;
    frame.writeBigUInt64BE(BigInt(payload.length), 2);
    offset = 10;
  }

  if (mask) {
    frame[1] |= 0x80;
    const maskKey = randomBytes(4);
    maskKey.copy(frame, offset);
    offset += 4;
    for (let i = 0; i < payload.length; i += 1) {
      frame[offset + i] = payload[i] ^ maskKey[i % 4];
    }
  } else {
    payload.copy(frame, offset);
  }

  return frame;
}

export class WebSocketConnection extends EventEmitter {
  constructor(socket, { maskOutgoing = false } = {}) {
    super();
    this.socket = socket;
    this.maskOutgoing = maskOutgoing;
    this.buffer = Buffer.alloc(0);
    this.closed = false;

    socket.on("data", (chunk) => this.handleData(chunk));
    socket.on("close", () => {
      this.closed = true;
      this.emit("close");
    });
    socket.on("error", (error) => this.emit("error", error));
  }

  send(data) {
    if (this.closed) return;
    this.socket.write(encodeFrame({ data, opcode: 1, mask: this.maskOutgoing }));
  }

  sendJson(payload) {
    this.send(JSON.stringify(payload));
  }

  close() {
    if (this.closed) return;
    this.socket.write(encodeFrame({ data: Buffer.alloc(0), opcode: 8, mask: this.maskOutgoing }));
    this.socket.end();
    this.closed = true;
  }

  handleData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    while (this.buffer.length >= 2) {
      const first = this.buffer[0];
      const second = this.buffer[1];
      const opcode = first & 0x0f;
      const masked = (second & 0x80) !== 0;
      let payloadLength = second & 0x7f;
      let offset = 2;

      if (payloadLength === 126) {
        if (this.buffer.length < offset + 2) return;
        payloadLength = this.buffer.readUInt16BE(offset);
        offset += 2;
      } else if (payloadLength === 127) {
        if (this.buffer.length < offset + 8) return;
        payloadLength = Number(this.buffer.readBigUInt64BE(offset));
        offset += 8;
      }

      const maskOffset = offset;
      if (masked) {
        offset += 4;
      }
      if (this.buffer.length < offset + payloadLength) return;

      let payload = this.buffer.subarray(offset, offset + payloadLength);
      if (masked) {
        const maskKey = this.buffer.subarray(maskOffset, maskOffset + 4);
        payload = Buffer.from(payload.map((byte, index) => byte ^ maskKey[index % 4]));
      }

      this.buffer = this.buffer.subarray(offset + payloadLength);

      if (opcode === 1) {
        this.emit("message", payload.toString("utf8"));
      } else if (opcode === 8) {
        this.close();
        this.emit("close");
      } else if (opcode === 9) {
        this.socket.write(encodeFrame({ data: payload, opcode: 10, mask: this.maskOutgoing }));
      }
    }
  }
}

export function acceptWebSocketUpgrade(request, socket, head, onConnection) {
  const key = request.headers["sec-websocket-key"];
  if (!key) {
    socket.destroy();
    return;
  }

  socket.write(
    [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${createAcceptValue(key)}`,
      "\r\n"
    ].join("\r\n")
  );

  const connection = new WebSocketConnection(socket, { maskOutgoing: false });
  if (head?.length) {
    connection.handleData(head);
  }
  onConnection(connection);
}

export function connectWebSocket(urlString, { headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const secure = url.protocol === "wss:";
    const port = Number(url.port || (secure ? 443 : 80));
    const key = randomBytes(16).toString("base64");
    const path = `${url.pathname || "/"}${url.search || ""}`;
    const socket = secure
      ? tls.connect({ host: url.hostname, port, servername: url.hostname })
      : net.connect({ host: url.hostname, port });

    let handshake = Buffer.alloc(0);
    let settled = false;

    function fail(error) {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(error);
    }

    socket.once("error", fail);
    socket.once("connect", () => {
      const requestHeaders = [
        `GET ${path} HTTP/1.1`,
        `Host: ${url.host}`,
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Key: ${key}`,
        "Sec-WebSocket-Version: 13",
        ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`),
        "\r\n"
      ].join("\r\n");
      socket.write(requestHeaders);
    });

    socket.on("data", function onHandshake(chunk) {
      handshake = Buffer.concat([handshake, chunk]);
      const splitAt = handshake.indexOf("\r\n\r\n");
      if (splitAt === -1) return;

      socket.off("data", onHandshake);
      const responseHead = handshake.subarray(0, splitAt).toString("utf8");
      const rest = handshake.subarray(splitAt + 4);
      if (!responseHead.startsWith("HTTP/1.1 101")) {
        fail(new Error(`WebSocket upgrade failed: ${responseHead.split("\r\n")[0]}`));
        return;
      }

      settled = true;
      const connection = new WebSocketConnection(socket, { maskOutgoing: true });
      if (rest.length) {
        connection.handleData(rest);
      }
      resolve(connection);
    });
  });
}
