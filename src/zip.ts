// Tom Robinson
// Kris Kowal

import { fstatSync, readSync } from "./fs-uv.js";
import { inflate } from "./inflate.js";
import { assert, utf8Decode } from "./utils.js";

const LOCAL_FILE_HEADER = 0x04034b50;
const CENTRAL_DIRECTORY_FILE_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_RECORD = 0x06054b50;
const MADE_BY_UNIX = 3;     // See http://www.pkware.com/documents/casestudies/APPNOTE.TXT

// tslint:disable: no-bitwise
// tslint:disable: prefer-for-of

class FdSource {
    private fileLength: number;
    private fd: number;

    constructor(fd: number) {
        this.fd = fd;
        this.fileLength = fstatSync(fd).size;
    }

    public length() {
        return this.fileLength;
    }

    public read(start: number, length: number) {
        const result = new Uint8Array(length);
        while (length > 0) {
            let pos = 0;
            const toRead = length > 8192 ? 8192 : length;
            readSync(this.fd, result.subarray(pos, pos + toRead), start);
            length -= toRead;
            start += toRead;
            pos += toRead;
        }
        return result;
    }
}

class BufferSource {
    private buffer: Uint8Array;

    constructor(buffer: Uint8Array) {
        this.buffer = buffer;
    }

    public length() {
        return this.buffer.length;
    }

    public read(start: number, length: number) {
        return this.buffer.subarray(start, start + length);
    }
}

interface IStructure {
    signature: number;
    version: number;
    version_needed: number;
    flags: number;
    compression_method: number;
    last_mod_file_time: number;
    last_mod_file_date: number;
    crc_32: number;
    compressed_size: number;
    uncompressed_size: number;
    file_name_length: number;
    extra_field_length: number;
    file_name: string;
    extra_field: Uint8Array;
    file_comment_length: number;
    file_comment: string;
    disk_number: number;
    internal_file_attributes: number;
    external_file_attributes: number;
    local_file_header_offset: number;
    mode: string | boolean;
    central_dir_disk_number: number;
    central_dir_disk_records: number;
    central_dir_total_records: number;
    central_dir_size: number;
    central_dir_offset: number;
}

interface IDescriptor {
    crc_32: number;
    compressed_size: number;
    uncompressed_size: number;
}

export class Reader {
    private source: BufferSource | FdSource;
    private offset: number;

    constructor(data: Uint8Array | number) {
        if (ArrayBuffer.isView(data)) {
            this.source = new BufferSource(data);
        } else {
            this.source = new FdSource(data);
        }
        this.offset = 0;
    }

    public length() {
        return this.source.length();
    }

    public position() {
        return this.offset;
    }

    public seek(offset: number) {
        this.offset = offset;
    }

    public read(length: number) {
        const bytes = this.source.read(this.offset, length);
        this.offset += length;
        return bytes;
    }

    public readInteger(length: number, bigEndian?: boolean) {
        if (bigEndian) {
            return bytesToNumberBE(this.read(length));
        } else {
            return bytesToNumberLE(this.read(length));
        }
    }

    public readString(length: number): string {
        return utf8Decode(this.read(length));
    }

    public readUncompressed(length: number, method: number) {
        const compressed = this.read(length);
        let uncompressed: Uint8Array;
        if (method === 0) {
            uncompressed = compressed;
        } else if (method === 8) {
            uncompressed = inflate(compressed);
        } else {
            throw new Error("Unknown compression method: " + method);
        }
        return uncompressed;
    }

    public readStructure() {
        const stream = this;
        const structure = {} as IStructure;

        // local file header signature     4 bytes  (0x04034b50)
        structure.signature = stream.readInteger(4);

        switch (structure.signature) {
            case LOCAL_FILE_HEADER:
                this.readLocalFileHeader(structure);
                break;
            case CENTRAL_DIRECTORY_FILE_HEADER:
                this.readCentralDirectoryFileHeader(structure);
                break;
            case END_OF_CENTRAL_DIRECTORY_RECORD:
                this.readEndOfCentralDirectoryRecord(structure);
                break;
            default:
                throw new Error("Unknown ZIP structure signature: 0x" + structure.signature.toString(16));
        }

        return structure;
    }

    // ZIP local file header
    // Offset   Bytes   Description
    // 0        4       Local file header signature = 0x04034b50
    // 4        2       Version needed to extract (minimum)
    // 6        2       General purpose bit flag
    // 8        2       Compression method
    // 10       2       File last modification time
    // 12       2       File last modification date
    // 14       4       CRC-32
    // 18       4       Compressed size
    // 22       4       Uncompressed size
    // 26       2       File name length (n)
    // 28       2       Extra field length (m)
    // 30       n       File name
    // 30+n     m       Extra field
    public readLocalFileHeader(structure: IStructure = {} as IStructure) {
        const stream = this;

        if (!structure.signature) {
            structure.signature = stream.readInteger(4);
        }    // Local file header signature = 0x04034b50

        if (structure.signature !== LOCAL_FILE_HEADER) {
            throw new Error(
                "ZIP local file header signature invalid (expects 0x04034b50, actually 0x"
                + structure.signature.toString(16) + ")");
        }

        structure.version_needed = stream.readInteger(2);    // Version needed to extract (minimum)
        structure.flags = stream.readInteger(2);    // General purpose bit flag
        structure.compression_method = stream.readInteger(2);    // Compression method
        structure.last_mod_file_time = stream.readInteger(2);    // File last modification time
        structure.last_mod_file_date = stream.readInteger(2);    // File last modification date
        structure.crc_32 = stream.readInteger(4);    // CRC-32
        structure.compressed_size = stream.readInteger(4);    // Compressed size
        structure.uncompressed_size = stream.readInteger(4);    // Uncompressed size
        structure.file_name_length = stream.readInteger(2);    // File name length (n)
        structure.extra_field_length = stream.readInteger(2);    // Extra field length (m)

        const n = structure.file_name_length;
        const m = structure.extra_field_length;

        structure.file_name = stream.readString(n);     // File name
        structure.extra_field = stream.read(m);           // Extra fieldFile name

        return structure;
    }

    // ZIP central directory file header
    // Offset   Bytes   Description
    // 0        4       Central directory file header signature = 0x02014b50
    // 4        2       Version made by
    // 6        2       Version needed to extract (minimum)
    // 8        2       General purpose bit flag
    // 10       2       Compression method
    // 12       2       File last modification time
    // 14       2       File last modification date
    // 16       4       CRC-32
    // 20       4       Compressed size
    // 24       4       Uncompressed size
    // 28       2       File name length (n)
    // 30       2       Extra field length (m)
    // 32       2       File comment length (k)
    // 34       2       Disk number where file starts
    // 36       2       Internal file attributes
    // 38       4       External file attributes
    // 42       4       Relative offset of local file header
    // 46       n       File name
    // 46+n     m       Extra field
    // 46+n+m   k       File comment
    public readCentralDirectoryFileHeader(structure: IStructure = {} as IStructure) {
        const stream = this;

        if (!structure.signature) {
            structure.signature = stream.readInteger(4);
        } // Central directory file header signature = 0x02014b50

        if (structure.signature !== CENTRAL_DIRECTORY_FILE_HEADER) {
            throw new Error(
                "ZIP central directory file header signature invalid (expects 0x02014b50, actually 0x"
                + structure.signature.toString(16) + ")");
        }

        structure.version = stream.readInteger(2);    // Version made by
        structure.version_needed = stream.readInteger(2);    // Version needed to extract (minimum)
        structure.flags = stream.readInteger(2);    // General purpose bit flag
        structure.compression_method = stream.readInteger(2);    // Compression method
        structure.last_mod_file_time = stream.readInteger(2);    // File last modification time
        structure.last_mod_file_date = stream.readInteger(2);    // File last modification date
        structure.crc_32 = stream.readInteger(4);    // CRC-32
        structure.compressed_size = stream.readInteger(4);    // Compressed size
        structure.uncompressed_size = stream.readInteger(4);    // Uncompressed size
        structure.file_name_length = stream.readInteger(2);    // File name length (n)
        structure.extra_field_length = stream.readInteger(2);    // Extra field length (m)
        structure.file_comment_length = stream.readInteger(2);    // File comment length (k)
        structure.disk_number = stream.readInteger(2);    // Disk number where file starts
        structure.internal_file_attributes = stream.readInteger(2);    // Internal file attributes
        structure.external_file_attributes = stream.readInteger(4);    // External file attributes
        structure.local_file_header_offset = stream.readInteger(4);    // Relative offset of local file header

        const n = structure.file_name_length;
        const m = structure.extra_field_length;
        const k = structure.file_comment_length;

        structure.file_name = stream.readString(n);     // File name
        structure.extra_field = stream.read(m);           // Extra field
        structure.file_comment = stream.readString(k);     // File comment
        structure.mode = stream.detectChmod(structure.version, structure.external_file_attributes); // chmod

        return structure;
    }

    public detectChmod(versionMadeBy: number, externalFileAttributes: number): boolean | string {
        const madeBy = versionMadeBy >> 8;
        let mode = externalFileAttributes >>> 16;
        let chmod: string | boolean = false;

        mode = (mode & 0x1ff);
        if (madeBy === MADE_BY_UNIX) {
            chmod = mode.toString(8);
        }
        return chmod;
    }

    // finds the end of central directory record
    // I'd like to slap whoever thought it was a good idea to put a variable length comment field here
    public locateEndOfCentralDirectoryRecord() {
        const length = this.length();
        const minPosition = length - Math.pow(2, 16) - 22;

        let position = length - 22 + 1;
        while (--position) {
            if (position < minPosition) {
                throw new Error("Unable to find end of central directory record");
            }

            this.seek(position);
            const possibleSignature = this.readInteger(4);
            if (possibleSignature !== END_OF_CENTRAL_DIRECTORY_RECORD) {
                continue;
            }

            this.seek(position + 20);
            const possibleFileCommentLength = this.readInteger(2);
            if (position + 22 + possibleFileCommentLength === length) {
                break;
            }
        }

        this.seek(position);
        return position;
    }

    // ZIP end of central directory record
    // Offset   Bytes   Description
    // 0        4       End of central directory signature = 0x06054b50
    // 4        2       Number of this disk
    // 6        2       Disk where central directory starts
    // 8        2       Number of central directory records on this disk
    // 10       2       Total number of central directory records
    // 12       4       Size of central directory (bytes)
    // 16       4       Offset of start of central directory, relative to start of archive
    // 20       2       ZIP file comment length (n)
    // 22       n       ZIP file comment
    public readEndOfCentralDirectoryRecord(structure: IStructure = {} as IStructure) {
        const stream = this;

        if (!structure.signature) {
            structure.signature = stream.readInteger(4);
        } // End of central directory signature = 0x06054b50

        if (structure.signature !== END_OF_CENTRAL_DIRECTORY_RECORD) {
            throw new Error(
                "ZIP end of central directory record signature invalid (expects 0x06054b50, actually 0x"
                + structure.signature.toString(16) + ")");
        }

        // Number of this disk
        structure.disk_number = stream.readInteger(2);
        // Disk where central directory starts
        structure.central_dir_disk_number = stream.readInteger(2);
        // Number of central directory records on this disk
        structure.central_dir_disk_records = stream.readInteger(2);
        // Total number of central directory records
        structure.central_dir_total_records = stream.readInteger(2);
        // Size of central directory (bytes)
        structure.central_dir_size = stream.readInteger(4);
        // Offset of start of central directory, relative to start of archive
        structure.central_dir_offset = stream.readInteger(4);
        // ZIP file comment length (n)
        structure.file_comment_length = stream.readInteger(2);

        const n = structure.file_comment_length;

        structure.file_comment = stream.readString(n);     // ZIP file comment

        return structure;
    }

    public readDataDescriptor() {
        const stream = this;
        const descriptor = {} as IDescriptor;

        descriptor.crc_32 = stream.readInteger(4);
        if (descriptor.crc_32 === 0x08074b50) {
            descriptor.crc_32 = stream.readInteger(4);
        } // CRC-32

        descriptor.compressed_size = stream.readInteger(4);    // Compressed size
        descriptor.uncompressed_size = stream.readInteger(4);    // Uncompressed size

        return descriptor;
    }

    public iterator() {
        const stream = this;

        // find the end record and read it
        stream.locateEndOfCentralDirectoryRecord();
        const endRecord = stream.readEndOfCentralDirectoryRecord();

        // seek to the beginning of the central directory
        stream.seek(endRecord.central_dir_offset);

        let count = endRecord.central_dir_disk_records;

        return {
            next() {
                if ((count--) === 0) {
                    // tslint:disable-next-line: no-string-throw
                    throw "stop-iteration";
                }

                // read the central directory header
                const centralHeader = stream.readCentralDirectoryFileHeader();

                // save our new position so we can restore it
                const saved = stream.position();

                // seek to the local header and read it
                stream.seek(centralHeader.local_file_header_offset);
                const localHeader = stream.readLocalFileHeader();

                // dont read the content just save the position for later use
                const start = stream.position();

                // seek back to the next central directory header
                stream.seek(saved);

                return new Entry(
                    localHeader, stream, start,
                    centralHeader.compressed_size,
                    centralHeader.compression_method,
                    centralHeader.mode);
            },
        };
    }

    public forEach(block: (entry: Entry) => void, context?: any) {
        const iterator = this.iterator();
        let next;
        while (true) {
            try {
                next = iterator.next();
            } catch (exception) {
                if (exception === "stop-iteration") {
                    break;
                }
                if (exception === "skip-iteration") {
                    continue;
                }
                throw exception;
            }
            block.call(context, next);
        }
    }

    public toObject(charset?: string) {
        const object: any = {};
        this.forEach((entry: Entry) => {
            if (entry.isFile()) {
                let data: Uint8Array | string = entry.getData();
                if (charset) {
                    assert(charset === "utf8");
                    data = utf8Decode(data);
                }
                object[entry.getName()] = data;
            }
        });
        return object;
    }

    // tslint:disable-next-line: variable-name
    public close(_mode: any, _options: any) {
        // nothing?
    }

}

export class Entry {
    private mode: any;
    private header: IStructure;
    private realStream: Reader;
    private stream: Uint8Array | null;
    private start: number;
    private compressedSize: number;
    private compressionMethod: number;

    constructor(
        header: IStructure,
        realStream: Reader,
        start: number,
        compressedSize: number,
        compressionMethod: number,
        mode: any,
    ) {
        this.mode = mode;
        this.header = header;
        this.realStream = realStream;
        this.stream = null;
        this.start = start;
        this.compressedSize = compressedSize;
        this.compressionMethod = compressionMethod;
    }

    public getName() {
        return this.header.file_name;
    }

    public isFile() {
        return !this.isDirectory();
    }

    public isDirectory() {
        return this.getName().slice(-1) === "/";
    }

    public lastModified() {
        return decodeDateTime(this.header.last_mod_file_date, this.header.last_mod_file_time);
    }

    public getData(): Uint8Array {
        if (this.stream == null) {
            const bookmark = this.realStream.position();
            this.realStream.seek(this.start);
            this.stream = this.realStream.readUncompressed(this.compressedSize, this.compressionMethod);
            this.realStream.seek(bookmark);
        }
        return this.stream;
    }

    public getMode() {
        return this.mode;
    }

}

function bytesToNumberLE(bytes: Uint8Array) {
    let acc = 0;
    for (let i = 0; i < bytes.length; i++) {
        acc += bytes[i] << (8 * i);
    }
    return acc;
}

function bytesToNumberBE(bytes: Uint8Array) {
    let acc = 0;
    for (let i = 0; i < bytes.length; i++) {
        acc = (acc << 8) + bytes[i];
    }
    return acc;
}

// function numberToBytesLE(num: number, length: number) {
//     const bytes: number[] = [];
//     for (let i = 0; i < length; i++) {
//         bytes[i] = (num >> (8 * i)) & 0xFF;
//     }
//     return new Uint8Array(bytes);
// }

// function numberToBytesBE(num: number, length: number) {
//     const bytes: number[] = [];
//     for (let i = 0; i < length; i++) {
//         bytes[length - i - 1] = (num >> (8 * i)) & 0xFF;
//     }
//     return new Uint8Array(bytes);
// }

function decodeDateTime(date: number, time: number): Date {
    return new Date(
        (date >>> 9) + 1980,
        ((date >>> 5) & 15) - 1,
        (date) & 31,
        (time >>> 11) & 31,
        (time >>> 5) & 63,
        (time & 63) * 2,
    );
}
