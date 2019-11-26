import { decode } from "png";
import { p } from "./pretty-print.js";
import { sha1 } from "./sha1.js";
import { assert, consume, utf8Encode } from "./utils.js";
import { autoHeaders } from "./weblit-autoheaders.js";
import { logger } from "./weblit-logger.js";
import { serveFiles } from "./weblit-static.js";
import { WeblitServer } from "./weblit.js";
import { Reader } from "./zip.js";

const server = new WeblitServer();

server.use(logger);
server.use(autoHeaders);

// Serve static files from conquest folder first.
server.use(serveFiles("exploder"));

// Implement a simple API route that echos back the :name parameter
server.route({ method: "GET", path: "/greet/:name" }, (req) => ({
    status: 200,
    body: `Hello ${req.params.name}\n`,
}));

server.route({ method: "PUT", path: "/sha1" }, async (req) => {
    assert(req.body, "Body missing in PUT");

    // Buffer the request body into memory as a single Uint8Array
    const reqBody = await consume(req.body as AsyncIterableIterator<Uint8Array>);

    return {
        status: 200,
        headers: {
            "Content-Type": req.headers.get("Content-Type") || "application/octet-stream",
            "Content-Length": reqBody.length,
            "ETag": `"${sha1(reqBody)}"`,
        },
        body: reqBody,
    };
});

// PUT a zip file to this route to see it's contents sent back as JSON.
// Test with curl -i http://localhost:8080/unzip -T zip.zip
server.route({ method: "PUT", path: "/unzip" }, async (req) => {
    assert(req.body, "Body missing in PUT");

    // Buffer the request body into memory as a single Uint8Array
    const reqBody = await consume(req.body as AsyncIterableIterator<Uint8Array>);

    // Pass the zip file contents to the zip reader.
    const zip = new Reader(reqBody);

    // Iterate over the zip file and create object entries for filenames and contents.
    const object: any = {};
    for (const entry of zip) {
        if (entry.isFile()) {
            const name = entry.getName();
            const data = entry.getData();
            object[name] = {
                sha1: sha1(data),
                length: data.length,
            };
            p(name, object[name]);
        }
    }

    // JSON serialize and then utf8 encode to form the response body.
    const body = utf8Encode(JSON.stringify(object, null, 2) + "\n");

    return {
        status: 200,
        headers: {
            "Content-Type": "application/json",
            "Content-Length": body.length,
        },
        body,
    };
});

server.route({ method: "PUT", path: "/png" }, async (req) => {
    assert(req.body, "Body missing in PUT");

    // Buffer the request body into memory as a single Uint8Array
    const reqBody = await consume(req.body as AsyncIterableIterator<Uint8Array>);

    // Pass the zip file contents to the zip reader.
    const zip = new Reader(reqBody);

    // Iterate over the zip file and create object entries for filenames and contents.
    const object: any = {};
    for (const entry of zip) {
        if (!entry.isFile()) { continue; }
        const name = entry.getName();
        if (!/\.png$/.test(name)) { continue; }

        const data = entry.getData();

        let png;
        try {
            png = decode(data);
        } catch (err) {
            png = err;
        }
        object[name] = {
            sha1: sha1(data),
            length: data.length,
            png,
        };
        p({ name, ...object[name] });
    }

    // JSON serialize and then utf8 encode to form the response body.
    const body = utf8Encode(JSON.stringify(object, null, 2) + "\n");

    return {
        status: 200,
        headers: {
            "Content-Type": "application/json",
            "Content-Length": body.length,
        },
        body,
    };
});
server.start({ port: 8080 });
