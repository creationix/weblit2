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
});
