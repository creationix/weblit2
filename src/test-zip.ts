import { readFileStream } from "./fs.js";
import { p } from "./pretty-print.js";
import { consume } from "./utils.js";
import { Reader } from "./zip.js";

consume(readFileStream("zip.zip")).then((data) => {
    const reader = new Reader(data);
    reader.forEach((entry) => {
        p(entry);
    });
    reader.iterator();
});
