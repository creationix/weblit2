import { assert, flatten, utf8Decode, utf8Encode } from "./utils.js";
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

// PUT a zip file to this route to see it's contents sent back as JSON.
// Test with curl -i http://localhost:8080/unzip -T zip.zip
server.route({ method: "PUT", path: "/unzip" }, async (req) => {
    assert(req.body, "Body missing in PUT");

    // Buffer the request body into memory as a single Uint8Array
    const reqBody = await flatten(req.body);
    // Pass the zip file contents to the zip reader.
    const zip = new Reader(reqBody);

    // Iterate over the zip file and create object entries for filenames and contents.
    const object: any = {};
    for (const entry of zip) {
        if (entry.isFile()) {
            const name = entry.getName();
            const data = entry.getData();
            object[name] = utf8Decode(data);
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

server.start({ port: 8080 });
