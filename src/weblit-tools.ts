import { Headers } from "./Headers.js";
import { IHttpRequest, IHttpResponse, IRequest, IResponse } from "./interfaces.js";
import { iterateBody, tryFlatten } from "./utils.js";
import { IWeblitRequest } from "./weblit-interfaces.js";

export function parseQuery(query: string) {
    const params: { [key: string]: string | boolean } = {};
    for (const part of query.split("&")) {
        const match = part.match(/^([^=]+)(?:=(.*))?$/);
        if (!match) { continue; }
        const [, key, value] = match;
        params[key] = value === undefined ? true : value;
    }
    return params;
}

function escapeRegex(str: string) {
    return str.replace(/[-[\]/{}()*+?.\\^$|]/g, "\\$&");
}

export function compileGlob(glob: string) {
    const reg = new RegExp(glob.split("*").map(escapeRegex).join(".*"));
    return (str?: string) => str ? reg.test(str) : false;
}

export function compileRoute(route: string) {
    const names: string[] = [];
    const reg = new RegExp("^" + route.split(/(:[a-z0-9_]+:?)/).map((part, i) => {
        if (i % 2) {
            if (part[part.length - 1] === ":") {
                names.push(part.substr(1, part.length - 2));
                return "(.+)";
            }
            names.push(part.substr(1));
            return "([^/]+)";
        }
        return escapeRegex(part);
    }).join("") + "$");
    return (str: string) => {
        const match = str.match(reg);
        if (!match) { return; }
        const params: { [key: string]: string } = {};
        for (let i = 0, l = names.length; i < l; i++) {
            params[names[i]] = match[i + 1];
        }
        return params;
    };
}

export const statusCodes: { [status: number]: string } = {
    100: "Continue",
    101: "Switching Protocols",
    102: "Processing", // RFC 2518, obsoleted by RFC 4918
    200: "OK",
    201: "Created",
    202: "Accepted",
    203: "Non-Authoritative Information",
    204: "No Content",
    205: "Reset Content",
    206: "Partial Content",
    207: "Multi-Status", // RFC 4918
    300: "Multiple Choices",
    301: "Moved Permanently",
    302: "Moved Temporarily",
    303: "See Other",
    304: "Not Modified",
    305: "Use Proxy",
    307: "Temporary Redirect",
    400: "Bad Request",
    401: "Unauthorized",
    402: "Payment Required",
    403: "Forbidden",
    404: "Not Found",
    405: "Method Not Allowed",
    406: "Not Acceptable",
    407: "Proxy Authentication Required",
    408: "Request Time-out",
    409: "Conflict",
    410: "Gone",
    411: "Length Required",
    412: "Precondition Failed",
    413: "Request Entity Too Large",
    414: "Request-URI Too Large",
    415: "Unsupported Media Type",
    416: "Requested Range Not Satisfiable",
    417: "Expectation Failed",
    418: "I'm a teapot", // RFC 2324
    422: "Unprocessable Entity", // RFC 4918
    423: "Locked", // RFC 4918
    424: "Failed Dependency", // RFC 4918
    425: "Unordered Collection", // RFC 4918
    426: "Upgrade Required", // RFC 2817
    500: "Internal Server Error",
    501: "Not Implemented",
    502: "Bad Gateway",
    503: "Service Unavailable",
    504: "Gateway Time-out",
    505: "HTTP Version not supported",
    506: "Variant Also Negotiates", // RFC 2295
    507: "Insufficient Storage", // RFC 4918
    509: "Bandwidth Limit Exceeded",
    510: "Not Extended", // RFC 2774
};

export function cleanupRequest(req: IRequest): IHttpRequest | IWeblitRequest {
    return {
        ...req, // Pass cutom props through
        type: "request",
        method: req.method,
        path: req.path,
        version: req.version || 1.1,
        headers: new Headers(req.headers),
        body: req.body ? iterateBody(req.body) : undefined,
    };
}

export function cleanupResponse(res: IResponse): IHttpResponse {
    const flat = tryFlatten(res.body);
    return {
        ...res, // Pass cutom props through
        type: "response",
        status: res.status,
        headers: res.headers instanceof Headers ? res.headers as Headers : new Headers(res.headers),
        statusText: res.statusText || statusCodes[res.status],
        body: res.body !== undefined ? flat || iterateBody(res.body) : undefined,
        version: res.version || 1.1,
    };
}
