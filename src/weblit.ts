import { Tcp } from "uv";
import { HttpServerCodec } from "./HttpCodec.js";
import { IHttpResponse, IRequest } from "./interfaces.js";
import { colorize, p } from "./pretty-print.js";
import { bindServer, listenServer } from "./tcp.js";
import { UvStream } from "./UvStream.js";
import { IWeblitRoutedRequest, WeblitLayer } from "./weblit-interfaces.js";
import { cleanupRequest, cleanupResponse, compileGlob, compileRoute } from "./weblit-tools.js";

export class WeblitServer {
    private layers: WeblitLayer[];
    private serverTcp?: Tcp;
    constructor() {
        this.layers = [];
    }

    public use(layer: WeblitLayer): this {
        this.layers.push(layer);
        return this;
    }

    public route(options: { method?: string, path?: string, host?: string }, layer: WeblitLayer<IWeblitRoutedRequest>) {
        const method = options.method;
        const path = options.path ? compileRoute(options.path) : undefined;
        const host = options.host ? compileGlob(options.host) : undefined;
        return this.use(async (req, next) => {
            if (method && (req.method !== method)) { return next(req); }
            if (host && !host(req.headers.get("Host"))) { return next(req); }
            let params;
            if (path) {
                params = path(req.pathname ? req.pathname : req.path);
                if (!params) { return next(req); }
            }
            return layer({
                ...req,
                params: params || {},
            }, next);
        });
    }

    public async start({ host, port }: { host?: string, port?: string | number } = {}) {
        this.serverTcp = new Tcp();
        await bindServer(this.serverTcp, host, port);
        p("SERVER: server bound", this.serverTcp.sockname);
        for await (const clientTcp of listenServer(this.serverTcp)) {
            this.onConnection(clientTcp);
        }
        p("SERVER: Exiting...");
        this.serverTcp.close();
    }
    private async onConnection(clientTcp: Tcp) {
        const { ip, port } = clientTcp.peername;
        print("SERVER: new TCP client accepted", ip, port);
        const clientStream = new HttpServerCodec(new UvStream(clientTcp));
        let next: (req: IRequest) => Promise<IHttpResponse> = innerLayer;
        for (let i = this.layers.length - 1; i >= 0; i--) {
            const layer = this.layers[i];
            const inner = next;
            next = async (req) => cleanupResponse(await layer(cleanupRequest(req), inner));
        }
        try {
            for await (const req of clientStream) {
                let res;
                res = await next(req);
                // print("\nPUSH 1\n");
                await clientStream.push({ value: res });
                // print("\nPUSH 2\n");
                const connection = res.headers.get("Connection");
                if (connection && connection.toLowerCase() === "close") {
                    break;
                }
            }
            await clientStream.push({ done: true, value: undefined });
        } catch (err) {
            print(colorize("failure", err.stack), ip, port);
            clientTcp.close();
            return;
        }
        print("SERVER: TCP client done", ip, port);
    }
}

// tslint:disable-next-line: variable-name
async function innerLayer(_req: IRequest): Promise<IHttpResponse> {
    return cleanupResponse({ status: 404 });
}
