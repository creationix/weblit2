import { Shutdown, Stream, Write } from "uv";
import { IDuplexStream } from "./interfaces.js";

interface IDataEvent {
    error?: Error;
    data?: ArrayBuffer;
}

interface IPromiseEvent {
    resolve(value?: ArrayBuffer): void;
    reject(error: Error): void;
}

export class UvStream implements IDuplexStream<Uint8Array> {
    private readEnd: boolean;
    private writeEnding: boolean;
    private writeEnd: boolean;
    private handle: Stream;
    private readonly queue: Array<IDataEvent | IPromiseEvent>;
    private read: number;
    private write: number;
    private paused: boolean;
    private iter: AsyncGenerator<Uint8Array>;

    constructor(handle: Stream) {
        this.handle = handle;
        this.readEnd = false;
        this.writeEnding = false;
        this.writeEnd = false;
        this.queue = [];
        this.read = 0;
        this.write = 0;
        this.paused = true;
        this.iter = this.main();
    }

    public async next(): Promise<IteratorResult<Uint8Array>> {
        return this.iter.next();
    }

    public async push({ done, value }: IteratorResult<Uint8Array>): Promise<void> {
        if (this.writeEnding) {
            throw new Error("Stream already ending");
        }
        if (done) { this.writeEnding = true; }
        return new Promise((resolve, reject) => {
            const callback = (error?: Error) => error ? reject(error) : resolve();
            if (done) {
                this.handle.shutdown(new Shutdown(), (error: Error) => {
                    this.writeEnd = true;
                    this.checkEnd().then(() => callback(error));
                });
            } else if (value) {
                this.handle.write(new Write(), value, (error: Error) => {
                    if (error) {
                        this.writeEnd = true;
                        this.checkEnd().then(() => callback(error));
                    } else {
                        callback(error);
                    }
                });
            } else {
                throw new Error("Missing value or done");
            }
        });
    }

    public [Symbol.asyncIterator]() { return this; }

    private async * main(): AsyncGenerator<Uint8Array> {

        const onRead = (error?: Error, data?: ArrayBuffer): void => {
            if (this.read > this.write) {
                const { resolve, reject } = this.queue[this.write++] as IPromiseEvent;
                if (error) {
                    reject(error);
                } else {
                    resolve(data);
                }
            } else {
                if (!this.paused) {
                    this.paused = true;
                    this.handle.readStop();
                }
                this.queue[this.write++] = { error, data };
            }
        };

        while (true) {
            if (this.write > this.read) {
                const { error, data } = this.queue[this.read++] as IDataEvent;
                if (error) { throw error; }
                if (!data) { break; }
                yield new Uint8Array(data);
            } else {
                if (this.paused) {
                    this.paused = false;
                    this.handle.readStart(onRead);
                }
                const data = await new Promise<ArrayBuffer | undefined>((resolve, reject) => {
                    this.queue[this.read++] = { resolve, reject };
                });
                if (!data) { break; }
                yield new Uint8Array(data);
            }
        }

        this.readEnd = true;
        await this.checkEnd();

    }

    private async checkEnd() {
        if (this.readEnd && this.writeEnd) {
            return new Promise((resolve) => this.handle.close(() => resolve()));
        }
    }

}
