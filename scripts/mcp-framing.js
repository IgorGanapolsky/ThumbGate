'use strict';

// MCP stdio framing shared by the standalone server, the shared daemon and the
// thin shim. Kept dependency-free so the shim stays small.

function tryParseMessage(buffer) {
  const source = buffer.toString('utf8');

  const headerEnd = source.indexOf('\r\n\r\n');
  if (headerEnd !== -1) {
    const header = source.slice(0, headerEnd);
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) {
      throw new Error('Missing Content-Length header');
    }
    const length = Number(match[1]);
    const bodyStart = headerEnd + 4;
    if (buffer.length < bodyStart + length) {
      return null;
    }
    let request;
    try {
      request = JSON.parse(buffer.slice(bodyStart, bodyStart + length).toString('utf8'));
    } catch (err) {
      err.transport = 'framed';
      err.jsonrpcCode = -32700;
      throw err;
    }
    return {
      request,
      remaining: buffer.slice(bodyStart + length),
      transport: 'framed',
    };
  }

  const newlineIndex = source.indexOf('\n');
  if (newlineIndex === -1) return null;
  const line = source.slice(0, newlineIndex).trim();
  if (!line) {
    return {
      request: null,
      remaining: Buffer.from(source.slice(newlineIndex + 1)),
    };
  }
  let request;
  try {
    request = JSON.parse(line);
  } catch (err) {
    err.transport = 'ndjson';
    err.jsonrpcCode = -32603;
    throw err;
  }
  return {
    request,
    remaining: Buffer.from(source.slice(newlineIndex + 1)),
    transport: 'ndjson',
  };
}


function frameJsonRpc(body, transport) {
  return transport === 'ndjson'
    ? `${body}\n`
    : `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`;
}

module.exports = { tryParseMessage, frameJsonRpc };
