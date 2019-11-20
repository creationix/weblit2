import { Tcp } from "uv";
import { HttpCodec, HttpServerCodec } from "./HttpCodec.js";
import { IDuplexStream, IWritableStream } from "./interfaces.js";
import { colorize, p } from "./pretty-print.js";
import { bindServer, connect, listenServer } from "./tcp.js";
import { iterateBody, utf8Decode } from "./utils.js";
import { UvStream } from "./UvStream.js";
import { cleanupRequest, cleanupResponse } from "./weblit-tools.js";

p(connect);

const testData = [
    `HTTP/1.1 200 OK\r\n`,
    `Server: nginx/1.10.3 (Ubuntu)\r\n`,
    `Date: Fri, 15 Nov 2019 23:19:11 GMT\r\n`,
    `Content-Type: application/json\r\n`,
    `Content-Length: 396\r\n`,
    `Connection: close\r\n`,
    `Access-Control-Allow-Origin: *\r\n`,
    `Access-Control-Allow-Methods: GET, OPTIONS\r\n`,
    `Access-Control-Allow-Headers: DNT,Keep-Alive,User-Agent,X-Requested-With,If-Modified-Since,Cache-Control\r\n`,
    `X-Request-Time: 0ms\r\n`,
    `\r\n`,
    `{"blobs":"https://lit.luvit.io/blobs/{hash}","search":"https://lit.luvit.io/search/{query}","package":"https://lit.luvit.io/packages/{author}/{name}/{version}","versions":"https://lit.luvit.io/packages/{author}/{name}","names":"https://lit.luvit.io/packages/{author}","trees":"https://lit.luvit.io/trees/{hash}","metrics":"https://lit.luvit.io/metrics","authors":"https://lit.luvit.io/packages"}\n`,
    `HTTP/1.1 200 OK\r\n`,
    `Content-Type: text/plain\r\n`,
    `Transfer-Encoding: chunked\r\n`,
    `\r\n`,
    `7\r\n`,
    `Mozilla\r\n`,
    `9\r\n`,
    `Developer\r\n`,
    `7\r\n`,
    `Network\r\n`,
    `0\r\n`,
    `\r\n`,
    `GET / HTTP/1.1\r\n`,
    `Host: lit.luvit.io\r\n`,
    `User-Agent: curl/7.58.0\r\n`,
    `Accept: */*\r\n`,
    `\r\n`,
    `PUT /upload.txt HTTP/1.1\r\n`,
    `Host: lit.luvit.io\r\n`,
    `User-Agent: mxs\r\n`,
    `Content-Type: text/plain\r\n`,
    `\r\n`,
    `Hello World\n`,
];

const logger: IWritableStream<Uint8Array> = {
    async push({ done, value }: IteratorResult<Uint8Array>) {
        if (done) {
            p("Write done!");
        } else {
            p("Write", utf8Decode(value));
        }
    },
};

function makeStream(): IDuplexStream<Uint8Array> {
    const iter = iterateBody(testData) as unknown as IDuplexStream<Uint8Array>;
    iter.push = logger.push;
    return iter;
}

async function main() {

    print("\ntest 1\n");
    let http;
    http = new HttpCodec(makeStream());
    p(http);
    for await (const value of http) {
        p("HTTP Event", value);
        if (value.body) {
            for await (const chunk of value.body) {
                p("HTTP Body", chunk);
            }
        }
    }
    p("done");

    print("\ntest 2\n");
    http = new HttpCodec(makeStream());
    for await (const value of http) {
        await http.push({ value });
    }
    p("done");

    print("\ntest 3\n");
    http = new HttpCodec(makeStream());
    await http.push({
        value: cleanupRequest({
            method: "GET",
            path: "/index.html",
            headers: {
                "User-Agent": "MagicScript",
                "Content-Length": 12,
            },
            body: "Hello World\n",
        }),
    });
    await http.push({
        value: cleanupResponse({ status: 404 }),
    });
    p("done");

    const serverTcp = new Tcp();
    await bindServer(serverTcp, "127.0.0.1", 8080);
    p("SERVER: server bound", serverTcp.sockname);
    for await (const clientTcp of listenServer(serverTcp)) {
        p("SERVER: client connected", clientTcp.peername);
        const clientStream = new HttpServerCodec(new UvStream(clientTcp));
        for await (const req of clientStream) {
            p("SERVER: client request received", req);
            await clientStream.push({
                value: cleanupResponse({
                    status: 200,
                    headers: {
                        "Date": new Date().toUTCString(),
                        "Server": "MagicScript",
                        "Connection": "close",
                        "Content-Length": 0,
                    },
                }),
            });
        }
    }
}

main().catch((err) => print(colorize("failure", err.stack)));
