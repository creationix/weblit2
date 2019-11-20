
import { HeaderLike, IHeaders } from "./interfaces.js";

export class Headers implements IHeaders {
    private data: {
        [key: string]: {
            name: string, value: string,
        },
    };

    constructor(init?: HeaderLike) {
        this.data = {};
        if (!init) { return; }
        const iter =
            (init as Iterable<[string, string]>)[Symbol.iterator]
                ? init as Iterable<[string, string]> : Object.entries(init);
        for (const [name, value] of iter) {
            this.set(name, value);
        }
    }

    /**
     * Append a new header value to the set.
     * Does not replace existing header by the same name.
     */
    public append(name: string, value: string | number): void {
        const key = name.toLocaleLowerCase();
        const entry = this.data[key];
        if (entry) {
            entry.value += "," + value;
        } else {
            this.data[key] = { name, value: "" + value };
        }
    }

    /**
     * Remove all header values with given case-insensitive name.
     */
    public delete(name: string): void {
        delete this.data[name.toLowerCase()];
    }

    public get(name: string): string | undefined {
        const entry = this.data[name.toLowerCase()];
        return entry ? entry.value : undefined;
    }

    public has(name: string): boolean {
        return !!this.data[name.toLowerCase()];
    }

    public set(name: string, value: string | number): void {
        this.data[name.toLowerCase()] = { name, value: "" + value };
    }

    public [Symbol.iterator](): IterableIterator<[string, string]> {
        return this.entries();
    }

    public * entries(): IterableIterator<[string, string]> {
        for (const { name, value } of Object.values(this.data)) {
            yield [name, value];
        }
    }

    public * keys(): IterableIterator<string> {
        for (const { name } of Object.values(this.data)) {
            yield name;
        }
    }

    public * values(): IterableIterator<string> {
        for (const { value } of Object.values(this.data)) {
            yield value;
        }
    }

    public toJSON(): { [key: string]: string } {
        const obj: { [key: string]: string } = {};
        for (const [name, value] of this) {
            obj[name] = value;
        }
        return obj;
    }
}
