import { Headers } from "./Headers.js";
import { HttpEvent, IParsable, IReadableStream } from "./interfaces";
import { assert, readTo, toParsable, utf8Decode } from "./utils.js";

export class HttpDecoder implements IReadableStream<HttpEvent> {
    private source: IParsable;
    private type?: "request" | "response";
    private iter: AsyncGenerator<HttpEvent>;

    constructor(source: IReadableStream<Uint8Array>, type?: "request" | "response") {
        this.source = toParsable(source);
        this.type = type;
        this.iter = this.main();
    }

    public next() { return this.iter.next(); }

    public [Symbol.asyncIterator]() { return this; }

    private async* main() {
        const headStorageBuffer = new Uint8Array(8 * 1024);
        while (true) {
            const headBuffer = await readTo(this.source, headStorageBuffer, "\r\n\r\n");
            if (!headBuffer) { return; }
            const [first, ...rest] = utf8Decode(headBuffer).trim().split("\r\n");
            const match = first.match(/^(?:HTTP\/(\d\.\d) (\d+) ([^\r\n]+)|([A-Z]+) ([^ ]+) HTTP\/(\d\.\d))/);
            assert(match, "HTTP Decoder: Expected HTTP data");

            const [, version1, status, statusText, method, path, version2] = match;

            const version = parseInt(version1 || version2, 10);
            assert(version >= 1 && version < 2, "HTTP Decoder: Only HTTP version 1.x supported");

            let contentLength: number | undefined;
            let chunkedEncoding: boolean | undefined;

            const headers = new Headers();
            for (const line of rest) {
                const headerMatch = line.match(/^([^:\r\n]+): *([^\r\n]*)/);
                assert(headerMatch, "HTTP Decoder: Malformed header line");
                headers.append(headerMatch[1], headerMatch[2]);
            }

            let headerValue: string | undefined;
            headerValue = headers.get("Content-Length");
            if (headerValue) { contentLength = parseInt(headerValue, 10); }
            headerValue = headers.get("Transfer-Encoding");
            if (headerValue) { chunkedEncoding = headerValue.toLowerCase() === "chunked"; }
            headerValue = headers.get("Connection");

            const body = chunkedEncoding
                ? chunkedDecoder(this.source)
                : typeof contentLength === "number"
                    ? countedDecoder(this.source, contentLength)
                    : method !== "GET"
                        ? rawDecoder(this.source)
                        : undefined;

            const event: HttpEvent = version1
                ? {
                    type: "response",
                    status: parseInt(status, 10),
                    statusText,
                    version,
                    headers,
                    body,
                } : {
                    type: "request",
                    method,
                    path,
                    version,
                    headers,
                    body,
                };

            assert(!this.type || event.type === this.type, "HTTP Decoder: Wrong event type received.");

            yield event;

            if (body) {
                while (!(await body.next()).done) {
                    // If the consumer didn't consume the body, throw it away now.
                }
            }
        }
    }
}

/**
 * If the body was declared with a fixed length, then we need to read and
 * forward chunks till exactly enough bytes have been consumed.
 */
async function* countedDecoder(source: IParsable, contentLength: number) {
    while (contentLength > 0) {
        const chunk = await source.read(contentLength);
        assert(chunk, "HTTP Decoder: Unexpected end of stream while reading counted body.");
        contentLength -= chunk.length;
        yield chunk;
    }
}

/**
 * If the body was declared as chunked encoding, then we need to read body
 * chunks according to the chunked encoding format.
 */
async function* chunkedDecoder(source: IParsable) {
    const lengthBuffer = new Uint8Array(10);
    while (true) {
        const lengthChunk = await readTo(source, lengthBuffer, "\r\n");
        assert(lengthChunk, "HTTP Decoder: Unexpected end of stream while reading chunk length header.");

        const lengthMatch = utf8Decode(lengthChunk).match(/[0-9a-f]+/i);
        assert(lengthMatch, "HTTP Decoder: Malformed chunk length header.");

        const length = parseInt(lengthMatch[0], 16);
        const chunk = await readTo(source, new Uint8Array(length + 2));
        assert(chunk, "HTTP Decoder: Unexpected end of stream while reading chunk body.");
        assert(chunk[length] === 0x0d && chunk[length + 1] === 0x0a,
            "HTTP Decoder: Malformed chunk trailer");

        if (length === 0) { break; }
        yield chunk.subarray(0, length);
    }
}

/**
 * If we think there was a body, but don't know the length, read till end of stream.
 */
async function* rawDecoder(source: IParsable) {
    while (true) {
        const chunk = await source.read();
        if (!chunk) { break; }
        yield chunk;
    }
}
