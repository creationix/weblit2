import { readFileStream } from "./fs.js";
import { p } from "./pretty-print.js";
import { consume, utf8Decode } from "./utils.js";
import { Reader } from "./zip.js";

consume(readFileStream("zip.zip")).then((data) => {
    const reader = new Reader(data);
    reader.forEach((entry) => {
        p(entry);
        const contents = utf8Decode(entry.getData());
        p({ contents });
    });
    reader.iterator();
    p(reader.toObject());
    p(reader.toObject("utf8"));
});
