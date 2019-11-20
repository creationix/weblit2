/**
 * Promise and async iterator friendly filesystem APIs.
 */

import { Flags, StatEntry } from "uv";
import * as fs from "./fs-uv.js";
import { AsyncDataStream } from "./interfaces.js";
import { iterateBody } from "./utils.js";

/** Open a file. */
export async function open(path: string, flags: Flags, mode: number): Promise<number> {
    return new Promise((resolve, reject) =>
        fs.open(path, flags, mode, (error, fd) =>
            error ? reject(error) : resolve(fd)));
}

export async function close(fd: number): Promise<void> {
    return new Promise((resolve, reject) =>
        fs.close(fd, (error) =>
            error ? reject(error) : resolve()));
}

export async function fstat(fd: number): Promise<StatEntry> {
    return new Promise((resolve, reject) =>
        fs.fstat(fd, (error, statEntry) =>
            error ? reject(error) : resolve(statEntry)));
}

export async function read(fd: number, buffer: Uint8Array, position: number): Promise<number> {
    return new Promise((resolve, reject) =>
        fs.read(fd, buffer, position, (error, bytesRead) =>
            error ? reject(error) : resolve(bytesRead)));
}

export function write(fd: number, buffer: Uint8Array, position: number): Promise<number> {
    return new Promise((resolve, reject) =>
        fs.write(fd, buffer, position, (error, bytesWritten) =>
            error ? reject(error) : resolve(bytesWritten)));
}

export async function* readStreaming(fd: number, buffer: Uint8Array): AsyncGenerator<Uint8Array> {
    while (true) {
        const bytesRead = await read(fd, buffer, -1);
        if (bytesRead === 0) { return; }
        yield buffer.subarray(0, bytesRead);
    }
}

export async function* readStreamingSlice(
    fd: number, buffer: Uint8Array, start: number, length: number): AsyncGenerator<Uint8Array> {
    let position = start;
    while (length !== 0) {
        if (length > 0 && length < buffer.length) {
            buffer = buffer.subarray(0, length);
        }
        const bytesRead = await read(fd, buffer, position);
        position += bytesRead;
        length -= bytesRead;
        if (bytesRead === 0) { return; }
        yield buffer.subarray(0, bytesRead);
    }
}

export async function* readFileStream(path: string | number, {
    chunkSize = 64 * 1024,
    flags = "r" as Flags,
    mode = 0o666,
    start = 0,
    length = -1,
}: {
    chunkSize?: number,
    flags?: Flags,
    mode?: number,
    start?: number,
    length?: number,
} = {}): AsyncIterableIterator<Uint8Array> {
    const fd = typeof path === "number" ? path : await open(path, flags, mode);
    try {
        const buffer = new Uint8Array(chunkSize);
        const iterable = start === 0 && length === -1
            ? readStreaming(fd, buffer)
            : readStreamingSlice(fd, buffer, start, length);
        for await (const chunk of iterable) {
            yield chunk.slice();
        }
    } finally {
        await close(fd);
    }
}

export async function writeFileStream(path: string, body: AsyncDataStream, {
    flags = "w" as Flags,
    mode = 0o666,
} = {}) {
    const fd = await open(path, flags, mode);
    try {
        for await (const chunk of iterateBody(body)) {
            await write(fd, chunk, -1);
        }
    } finally {
        await close(fd);
    }
}
