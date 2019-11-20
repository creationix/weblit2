import { HttpEvent, IHttpRequest, IHttpResponse, IReadableStream, IWritableStream } from "./interfaces";
import { assert, flattenSync, utf8Encode } from "./utils.js";

export class HttpEncoder implements IWritableStream<HttpEvent> {
    private sink: IWritableStream<Uint8Array>;
    private type?: "request" | "response";

    constructor(sink: IWritableStream<Uint8Array>, type?: "request" | "response") {
        this.sink = sink;
        this.type = type;
    }

    public async push({ done, value }: IteratorResult<HttpEvent>) {
        // Forward end of stream to sink.
        if (done) { return this.sink.push({ done, value }); }

        assert(!this.type || value.type === this.type, "HTTP Encoder: Wrong event type received.");

        const lines: string[] = [];
        if (value.type === "request") {
            const { method, path, version } = value as IHttpRequest;
            lines.push(`${method} ${path} HTTP/${version}\r\n`);
        } else if (value.type === "response") {
            const { version, status, statusText } = value as IHttpResponse;
            lines.push(`HTTP/${version} ${status} ${statusText}\r\n`);
        } else {
            throw new Error("HTTP Encoder: Unknown event type received.");
        }
        const { headers, body } = value as HttpEvent;
        for (const [name, header] of headers) {
            lines.push(`${name}: ${String(header).replace(/[\r\n]+/, " ")}\r\n`);
        }
        lines.push("\r\n");

        await this.sink.push({ value: utf8Encode(lines.join("")) });

        let contentLength: number | undefined;
        let chunkedEncoding: boolean | undefined;

        let headerValue: string | undefined;
        headerValue = headers.get("Content-Length");
        if (headerValue) { contentLength = parseInt(headerValue, 10); }
        headerValue = headers.get("Transfer-Encoding");
        if (headerValue) { chunkedEncoding = headerValue.toLowerCase() === "chunked"; }

        if (body) {
            const bodyStream = (ArrayBuffer.isView(body) ? [body] : body) as IReadableStream<Uint8Array>;
            if (typeof contentLength === "number") {
                await countedEncoder(this.sink, bodyStream, contentLength);
            } else if (chunkedEncoding) {
                await chunkedEncoder(this.sink, bodyStream);
            } else {
                await rawEncoder(this.sink, bodyStream);
            }
        }
    }
}

async function rawEncoder(sink: IWritableStream<Uint8Array>, body: IReadableStream<Uint8Array>) {
    for await (const chunk of body) {
        await sink.push({ value: chunk });
    }
}

async function countedEncoder(
    sink: IWritableStream<Uint8Array>, body: IReadableStream<Uint8Array>, contentLength: number) {
    for await (const value of body) {
        contentLength -= value.length;
        await sink.push({ value: value.slice() });
    }
    assert(contentLength === 0, "HTTP Encoder: Body length didn't match declared Content-Length");
}

async function chunkedEncoder(sink: IWritableStream<Uint8Array>, body: IReadableStream<Uint8Array>) {
    for await (const chunk of body) {
        const value = flattenSync([
            `${chunk.length.toString(16)}\r\n`,
            chunk,
            `\r\n`,
        ]);
        await sink.push({ value });
    }
    await sink.push({ value: utf8Encode(`0\r\n\r\n`) });
}
