import { fstat, open, readFileStream } from "./fs.js";
import { Headers } from "./Headers.js";
import { guess } from "./mime.js";
import { sha1 } from "./sha1.js";
import { pathJoin } from "./utils.js";
import { WeblitLayer } from "./weblit-interfaces.js";

export function serveFiles(basePath: string, { autoIndex = "index.html" }: { autoIndex?: string } = {}): WeblitLayer {
    const serveFile: WeblitLayer = async (req, next) => {
        const reqPath = req.pathname || req.path;
        let path = pathJoin(basePath, pathJoin(reqPath));
        if (autoIndex && reqPath[reqPath.length - 1] === "/") { path += "/" + autoIndex; }
        try {
            const fd = await open(path, "r", 0o666);
            const statEntry = await fstat(fd);
            const etag = `${statEntry.mtime ? "" : "W/"}"${sha1(JSON.stringify({ statEntry }))}"`;

            const range = req.headers.get("Range");
            const headers = new Headers({
                "ETag": etag,
                "Content-Type": guess(path),
            });
            if (statEntry.mtime) {
                headers.set("Last-Modified", new Date(statEntry.mtime).toUTCString());
            }
            if (range) {
                const match = range.match(/bytes=([0-9]+)?-([0-9]+)?/);
                if (match) {
                    const [, s, e] = match;
                    let start: number;
                    let end: number;
                    const size = statEntry.size;
                    if (e && !s) {
                        start = size - parseInt(e, 10);
                        end = size - 1;
                    } else {
                        start = s ? parseInt(s, 10) : 0;
                        end = e ? parseInt(e, 10) : size - 1;
                    }
                    const length = end - start + 1;
                    if (start < 0 || end >= size) {
                        throw new Error("Invalid range request!");
                    }

                    headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
                    headers.set("Content-Length", length);
                    return {
                        status: 206,
                        headers,
                        body: readFileStream(fd, { start, length }),
                    };
                }
            }

            headers.set("Content-Length", statEntry.size);
            headers.set("Accept-Ranges", "bytes");

            if (req.headers.get("If-None-Match") === etag) {
                return {
                    status: 304,
                    headers,
                };
            }

            return {
                status: 200,
                headers,
                body: readFileStream(fd),
            };

        } catch (err) {
            if (/^ENOENT:/.test(err.message)) {
                return next(req);
            }
            throw err;
        }
    };
    return serveFile;
}
