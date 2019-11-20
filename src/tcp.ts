import { Address, Connect, Getaddrinfo, getaddrinfo, Tcp } from "uv";

const cache: { [key: string]: Promise<{ ip: string, port: number }> } = {};

/** Resolve IP address and TCP port */
export async function resolveAddress(host: string, service: string | number): Promise<Address> {
    const key = host + service;
    if (!cache[key]) {
        cache[key] = new Promise((res, rej) =>
            getaddrinfo(new Getaddrinfo(),
                (err, val) => err ? rej(err) : res(val[0]),
                host, "" + service));
    }
    return cache[key];
}

/** Connect to server */
export async function connect(host: string, service: string | number): Promise<Tcp> {
    const { ip, port } = await resolveAddress(host, service);
    const socket = new Tcp();
    await new Promise((res, rej) =>
        socket.connect(new Connect(),
            ip, port,
            (err) => err ? rej(err) : res()));
    return socket;
}

export async function bindServer(server: Tcp, host: string = "127.0.0.1", service: string | number = 0) {
    const { ip, port } = await resolveAddress(host, service);
    server.bind(ip, port);
}

export async function* listenServer(server: Tcp, backlog = 128): AsyncIterableIterator<Tcp> {
    let resolve: (value: Tcp) => void;
    let reject: (error: Error) => void;
    server.listen(backlog, (error) => {
        if (error) {
            return reject(error);
        }
        const value = new Tcp();
        server.accept(value);
        resolve(value);
    });
    while (true) {
        yield await new Promise((res, rej) => { resolve = res; reject = rej; });
    }
}
