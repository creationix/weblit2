import { IHttpRequest } from "./interfaces.js";
import { isUtf8 } from "./utils.js";
import { WeblitLayer } from "./weblit-interfaces.js";
import { cleanupResponse, parseQuery } from "./weblit-tools.js";

export const autoHeaders: WeblitLayer = async (rawReq: IHttpRequest, next) => {
    // const start = Date.now();

    const match = rawReq.path.match(/^([^?]*)\??(.*)/);
    const req = {
        ...rawReq,
        pathname: match ? match[1] : rawReq.path,
        query: match ? parseQuery(match[2]) : undefined,
    };

    let isHead = false;
    if (req.method === "HEAD") {
        req.method = "GET";
        isHead = true;
    }

    let res;
    try {
        res = await next(req);
    } catch (err) {
        res = cleanupResponse({
            status: 500,
            body: err.stack,
        });
    }

    const { headers, body } = res;

    if (!headers.has("Server")) {
        headers.set("Server", "Weblit2");
    }

    if (!headers.has("Date")) {
        headers.set("Date", new Date().toUTCString());
    }

    let connection = headers.get("Connection");
    if (!connection) {
        connection = req.headers.get("Connection") || "close";
        headers.set("Connection", connection);
    }

    const needLength = !(
        headers.has("Content-Length") ||
        headers.has("Transfer-Encoding") ||
        (connection && connection.toLocaleLowerCase() === "close")
    );

    if (body) {
        const needsType = !headers.has("Content-Type");
        if (ArrayBuffer.isView(body)) {
            if (needLength) {
                headers.set("Content-Length", body.byteLength);
            }
            if (needsType) {
                headers.set("Content-Type", isUtf8(body) ? "text/plain" : "application/octet-stream");
            }
        } else {
            if (needLength) {
                headers.set("Transfer-Encoding", "chunked");
            }
            if (needsType) {
                headers.set("Content-Type", "application/octet-stream");
            }
        }
    } else {
        if (needLength) {
            headers.set("Content-Length", 0);
        }
    }

    if (isHead) {
        res.body = discard(res.body);
    }

    // const delay = `${Date.now() - start}ms`;
    // headers.set("X-Request-Time", delay);

    return res;
};

function discard(body?: Uint8Array | AsyncIterableIterator<Uint8Array>) {
    if (body && !ArrayBuffer.isView(body)) {
        const iter = body[Symbol.asyncIterator]();
        function onNext({ done }: IteratorResult<Uint8Array>) {
            if (!done) { iter.next().then(onNext); }
        }
        iter.next().then(onNext);
    }
    return undefined;
}
