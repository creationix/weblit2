import { readFileStream } from "./fs.js";
import { p } from "./pretty-print.js";
import { consume, utf8Decode } from "./utils.js";
import { Reader } from "./zip.js";

consume(readFileStream("zip.zip")).then((data) => {
    const reader = new Reader(data);
    for (const entry of reader) {
        p(entry);
        const contents = utf8Decode(entry.getData());
        p({ contents });
    }
    p(reader.toObject());
    p(reader.toObject("utf8"));

    print("GETTING just README");
    p(extractFile(reader, "README"));
});

function extractFile(reader: Reader, filename: string): Uint8Array | void {
    for (const entry of reader) {
        if (entry.isFile() && entry.getName() === filename) {
            return entry.getData();
        }
    }
}
