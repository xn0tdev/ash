/** Parses a `text/event-stream` body into raw `data:` payload strings (joined
 * per SSE framing rules when an event spans multiple `data:` lines). Shared
 * by every provider — the wire format differs after this point, not here. */
export async function* parseSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<string, void, unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      // Some providers frame events with CRLF (\r\n\r\n); normalize to \n so the
      // \n\n split below fires. Only the \r\n PAIR is converted (never a lone
      // \r), so a \r\n split across read() chunks still resolves on the next
      // chunk instead of producing a false \n\n event boundary.
      buf = buf.replace(/\r\n/g, "\n");
      let idx: number;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const rawEvent = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const dataLines = rawEvent
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trimStart());
        if (dataLines.length) yield dataLines.join("\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
}
