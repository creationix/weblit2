export type Binary = ArrayBuffer | ArrayBufferView;
export type RecursiveIterable<T> = T
    | Iterable<RecursiveIterable<T>>;
export type AsyncRecursiveIterable<T> = T
    | Promise<AsyncRecursiveIterable<T>>
    | Iterable<AsyncRecursiveIterable<T>>
    | AsyncIterable<AsyncRecursiveIterable<T>>;
export type DataStream = RecursiveIterable<Binary | string>;

// TODO: find a way to represent this properly without crashing typescript
// export type AsyncDataStream = AsyncRecursiveIterable<Binary | string>;
export type AsyncDataStream = undefined |
    Binary | string | Promise<Binary | string> | Iterable<Binary | string> | AsyncIterable<Binary | string>;

export interface IReadableStream<Out> extends AsyncIterableIterator<Out> { }

export interface IWritableStream<In> {
    push(evt: IteratorResult<In>): Promise<void>;
}

export interface IDuplexStream<In, Out = In> extends IReadableStream<Out>, IWritableStream<In> { }

export interface IParsable {
    /** Read the next data chunk with optional size limit. */
    read(max?: number): Promise<Uint8Array | undefined>;

    /** Read into buffer till terminator is found and included in result. */
    readTo(buffer: Uint8Array, terminator?: string): Promise<Uint8Array | undefined>;
}

export interface IHeaders extends Iterable<[string, string]> {
    append(name: string, value: string | number): void;
    delete(name: string): void;
    get(name: string): string | undefined;
    has(name: string): boolean;
    set(name: string, value: string | number): void;
    entries(): IterableIterator<[string, string]>;
    keys(): IterableIterator<string>;
}

export interface IHeadersObject { [key: string]: (string | number); }

export type HeaderLike = Iterable<[string, string]> | IHeadersObject;

export interface IRequest {
    method: string;
    path: string;
    version?: number;
    headers?: HeaderLike;
    body?: AsyncDataStream;
}

export interface IResponse {
    status: number;
    statusText?: string;
    version?: number;
    headers?: HeaderLike;
    body?: AsyncDataStream;
}

export interface IHttpRequest extends IRequest {
    type: "request";
    method: string;
    path: string;
    version: number;
    headers: IHeaders;
    body?: Uint8Array | IReadableStream<Uint8Array>;
}

export interface IHttpResponse extends IResponse {
    type: "response";
    status: number;
    statusText: string;
    version: number;
    headers: IHeaders;
    body?: Uint8Array | IReadableStream<Uint8Array>;
}

export type HttpEvent = IHttpRequest | IHttpResponse;
