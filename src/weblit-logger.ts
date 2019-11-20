// import { p } from "./pretty-print.js";
import { WeblitLayer } from "./weblit-interfaces.js";

export const logger: WeblitLayer = async (req, next) => {
    const res = await next(req);
    print(`${req.method} ${req.path} ${res.status} ${res.headers.get("X-Request-Time")} ${req.headers.get("User-Agent")}`);
    // p({ req, res });
    return res;
};
