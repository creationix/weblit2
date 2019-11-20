import { IHttpRequest, IHttpResponse, IRequest, IResponse } from "./interfaces.js";

/**
 * This is a middleware layer.
 * These can be used to hook in things like HTTP routes, auto caching, header fixing, etc...
 * @param req - The HTTP request as originally come from client (or possibly modified by a parent layer).
 * @param next - Represents the next inner layer.  Calling this is optional depending on the use case.
 * @returns - The HTTP response we wish to give to the client (or parent layer).
 */
export type WeblitLayer<REQ = IWeblitRequest, RES = IResponse> = (
    req: REQ,
    next: (req: IRequest) => Promise<IHttpResponse>,
) => (Promise<RES> | RES);

export interface IWeblitRequest extends IHttpRequest {
    pathname?: string;
    query?: {
        [key: string]: string;
    };
}

export interface IWeblitRoutedRequest extends IWeblitRequest {
    params: { [key: string]: string };
}
