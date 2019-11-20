import { autoHeaders } from "./weblit-autoheaders.js";
import { logger } from "./weblit-logger.js";
import { serveFiles } from "./weblit-static.js";
import { WeblitServer } from "./weblit.js";

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

server.start({ port: 8080 });
