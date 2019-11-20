import { HttpDecoder } from "./HttpDecoder.js";
import { HttpEncoder } from "./HttpEncoder.js";
import { HttpEvent, IDuplexStream, IHttpRequest, IHttpResponse, IReadableStream, IWritableStream } from "./interfaces.js";

export class HttpCodec implements IReadableStream<HttpEvent>, IWritableStream<HttpEvent> {
    private encoder: IWritableStream<HttpEvent>;
    private decoder: IReadableStream<HttpEvent>;

    constructor(source: IDuplexStream<Uint8Array>) {
        this.encoder = new HttpEncoder(source);
        this.decoder = new HttpDecoder(source);
    }

    public push(evt: IteratorResult<HttpEvent>) {
        return this.encoder.push(evt);
    }

    public next() {
        return this.decoder.next();
    }

    public [Symbol.asyncIterator]() {
        return this.decoder[Symbol.asyncIterator]();
    }
}

export class HttpServerCodec implements IReadableStream<IHttpRequest>, IWritableStream<IHttpResponse> {
    private encoder: IWritableStream<IHttpResponse>;
    private decoder: IReadableStream<IHttpRequest>;

    constructor(source: IDuplexStream<Uint8Array>) {
        this.encoder = new HttpEncoder(source, "response") as IWritableStream<IHttpResponse>;
        this.decoder = new HttpDecoder(source, "request") as IReadableStream<IHttpRequest>;
    }

    public push(evt: IteratorResult<IHttpResponse>) {
        return this.encoder.push(evt);
    }

    public next() {
        return this.decoder.next();
    }

    public [Symbol.asyncIterator]() {
        return this.decoder[Symbol.asyncIterator]();
    }
}
