import { assert, consumeSync } from "./utils.js";

/* Copyright (C) 1999 Masanao Izumo <iz@onicos.co.jp>
 * Version: 1.0.0.1
 * LastModified: Dec 25 1999
 *
 * Ported to CommonJS by Tom Robinson, 2010
 *
 * Ported to TypeScript for MagicScript by Tim Caswell, 2019
*/

export function inflate(input: Uint8Array) {
    // tslint:disable: no-bitwise
    // tslint:disable: variable-name
    // tslint:disable: triple-equals
    // tslint:disable: one-variable-per-declaration
    // tslint:disable: no-shadowed-variable
    // tslint:disable: no-conditional-assignment

    // all of these variables must be reset between runs otherwise we get very strange bugs
    // so we've wrapped the whole thing in a closure which is also the CommonJS API.

    /* constant parameters */
    const WSIZE = 32768;		// Sliding Window size
    const STORED_BLOCK = 0;

    /* for inflate */
    const lbits = 9; 		// bits in base literal/length lookup table
    const dbits = 6; 		// bits in base distance lookup table

    /* variables (inflate) */
    let slide: number[];
    let wp: number;			// current position in slide
    let fixed_tl: HuftList | null = null;	// inflate static
    let fixed_td: HuftList | null;		// inflate static
    // tslint:disable-next-line: prefer-const
    let fixed_bl: number, fixed_bd: number;	// inflate static
    let bit_buf: number;		// bit buffer
    let bit_len: number;		// bits in bit buffer
    let method: number;
    let eof: boolean;
    let copy_leng: number;
    let copy_dist: number;
    let tl: HuftList | null, td: HuftList | null;	// literal/length and distance decoder tables
    let bl: number, bd: number;	// number of bits decoded by tl and td

    let inflate_data: Uint8Array | undefined;
    let inflate_pos: number;

    /* constant tables (inflate) */
    const MASK_BITS = [
        0x0000,
        0x0001, 0x0003, 0x0007, 0x000f, 0x001f, 0x003f, 0x007f, 0x00ff,
        0x01ff, 0x03ff, 0x07ff, 0x0fff, 0x1fff, 0x3fff, 0x7fff, 0xffff,
    ];
    // Tables for deflate from PKZIP's appnote.txt.
    const cplens = [ // Copy lengths for literal codes 257..285
        3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31,
        35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258, 0, 0,
    ];
    /* note: see note #13 above about the 258 in this list. */
    const cplext = [ // Extra bits for literal codes 257..285
        0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2,
        3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0, 99, 99,
    ]; // 99==invalid
    const cpdist = [ // Copy offsets for distance codes 0..29
        1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193,
        257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145,
        8193, 12289, 16385, 24577,
    ];
    const cpdext = [ // Extra bits for distance codes
        0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6,
        7, 7, 8, 8, 9, 9, 10, 10, 11, 11,
        12, 12, 13, 13,
    ];
    const border = [  // Order of the bit length code lengths
        16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15,
    ];
    /* objects (inflate) */

    class HuftList {
        public next: HuftList | null;
        public list: HuftNode[] | null;

        constructor() {
            this.next = null;
            this.list = null;
        }
    }

    class HuftNode {
        public e: number; // number of extra bits or operation
        public b: number; // number of bits in this code or subcode
        public n: number; // literal, length base, or distance base
        public t: HuftNode[] | null; // (HuftNode) pointer to next level of table

        constructor() {
            this.e = 0;
            this.b = 0;

            // union
            this.n = 0;
            this.t = null;
        }
    }

    class HuftBuild {
        public BMAX: number;
        public N_MAX: number;
        public status: number;
        public root: HuftList | null;
        public m: number;

        constructor(
            b: number[],	// code lengths in bits (all assumed <= BMAX)
            n: number,	// number of codes (assumed <= N_MAX)
            s: number,	// number of simple-valued codes (0..s-1)
            d: number[] | null,	// list of base values for non-simple codes
            e: number[] | null,	// list of extra bits for non-simple codes
            mm: number,	// maximum lookup bits
        ) {
            this.BMAX = 16;   // maximum bit length of any code
            this.N_MAX = 288; // maximum number of codes in any set
            this.status = 0;	// 0: success, 1: incomplete table, 2: bad input
            this.root = null;	// (HuftList) starting table
            this.m = 0;		// maximum lookup bits, returns actual

            /* Given a list of code lengths and a maximum table size, make a set of
               tables to decode that set of codes.	Return zero on success, one if
               the given code set is incomplete (the tables are still built in this
               case), two if the input is invalid (all zero length codes or an
               oversubscribed set of lengths), and three if not enough memory.
               The code with value 256 is special, and the tables are constructed
               so that no bits beyond that code are fetched when that code is
               decoded. */
            {
                let a;			// counter for codes of length k
                const c = new Array(this.BMAX + 1);	// bit length count table
                let el;			// length of EOB code (value 256)
                let f;			// i repeats in table every f entries
                let g;			// maximum code length
                let h;			// table level
                let i;			// counter, current code
                let j;			// counter
                let k;			// number of bits in current code
                const lx = new Array(this.BMAX + 1);	// stack of bits per table
                let p;			// pointer into c[], b[], or v[]
                let pidx;		// index of p
                let q: HuftNode[] | null;			// (HuftNode) points to current table
                const r = new HuftNode(); // table entry for structure assignment
                const u = new Array(this.BMAX); // HuftNode[BMAX][]  table stack
                const v = new Array(this.N_MAX); // values in order of bit length
                let w;
                const x = new Array(this.BMAX + 1); // bit offsets, then code stack
                let xp;			// pointer into x or c
                let y;			// number of dummy codes added
                let z;			// number of entries in current table
                let o;
                let tail: HuftList | null;		// (HuftList)

                tail = this.root = null;
                for (i = 0; i < c.length; i++) {
                    c[i] = 0;
                }
                for (i = 0; i < lx.length; i++) {
                    lx[i] = 0;
                }
                for (i = 0; i < u.length; i++) {
                    u[i] = null;
                }
                for (i = 0; i < v.length; i++) {
                    v[i] = 0;
                }
                for (i = 0; i < x.length; i++) {
                    x[i] = 0;
                }

                // Generate counts for each bit length
                el = n > 256 ? b[256] : this.BMAX; // set length of EOB code, if any
                p = b; pidx = 0;
                i = n;
                do {
                    c[p[pidx]]++;	// assume all entries <= BMAX
                    pidx++;
                } while (--i > 0);
                if (c[0] == n) {	// null input--all zero length codes
                    this.root = null;
                    this.m = 0;
                    this.status = 0;
                    return;
                }

                // Find minimum and maximum length, bound *m by those
                for (j = 1; j <= this.BMAX; j++) {
                    if (c[j] != 0) {
                        break;
                    }
                }
                k = j;			// minimum code length
                if (mm < j) {
                    mm = j;
                }
                for (i = this.BMAX; i != 0; i--) {
                    if (c[i] != 0) {
                        break;
                    }
                }
                g = i;			// maximum code length
                if (mm > i) {
                    mm = i;
                }

                // Adjust last length count to fill out codes, if needed
                for (y = 1 << j; j < i; j++ , y <<= 1) {
                    if ((y -= c[j]) < 0) {
                        this.status = 2;	// bad input: more codes than bits
                        this.m = mm;
                        return;
                    }
                }
                if ((y -= c[i]) < 0) {
                    this.status = 2;
                    this.m = mm;
                    return;
                }
                c[i] += y;

                // Generate starting offsets into the value table for each length
                x[1] = j = 0;
                p = c;
                pidx = 1;
                xp = 2;
                while (--i > 0) {		// note that i == g from above
                    x[xp++] = (j += p[pidx++]);
                }

                // Make a table of values in order of bit lengths
                p = b; pidx = 0;
                i = 0;
                do {
                    if ((j = p[pidx++]) != 0) {
                        v[x[j]++] = i;
                    }
                } while (++i < n);
                n = x[g];			// set n to length of v

                // Generate the Huffman codes and for each, make the table entries
                x[0] = i = 0;		// first Huffman code is zero
                p = v; pidx = 0;		// grab values in bit order
                h = -1;			// no tables yet--level -1
                w = lx[0] = 0;		// no bits decoded yet
                q = null;			// ditto
                z = 0;			// ditto

                // go through the bit lengths (k already is bits in shortest code)
                for (; k <= g; k++) {
                    a = c[k];
                    while (a-- > 0) {
                        // here i is the Huffman code of length k bits for value p[pidx]
                        // make tables up to required level
                        while (k > w + lx[1 + h]) {
                            w += lx[1 + h]; // add bits already decoded
                            h++;

                            // compute minimum size table less than or equal to *m bits
                            z = (z = g - w) > mm ? mm : z; // upper limit
                            if ((f = 1 << (j = k - w)) > a + 1) { // try a k-w bit table
                                // too few codes for k-w bit table
                                f -= a + 1;	// deduct codes from patterns left
                                xp = k;
                                while (++j < z) { // try smaller tables up to z bits
                                    if ((f <<= 1) <= c[++xp]) {
                                        break;
                                    }	// enough codes to use up j bits
                                    f -= c[xp];	// else deduct codes from patterns
                                }
                            }
                            if (w + j > el && w < el) {
                                j = el - w;
                            }	// make EOB code end at table
                            z = 1 << j;	// table entries for j-bit table
                            lx[1 + h] = j; // set table size in stack

                            // allocate and link in new table
                            q = new Array(z);
                            for (o = 0; o < z; o++) {
                                q[o] = new HuftNode();
                            }

                            if (tail == null) {
                                tail = this.root = new HuftList();
                            } else {
                                tail = (tail.next as HuftList) = new HuftList();
                            }
                            tail.next = null;
                            tail.list = q;
                            u[h] = q;	// table starts after link

                            /* connect to last table, if there is one */
                            if (h > 0) {
                                x[h] = i;		// save pattern for backing up
                                r.b = lx[h];	// bits to dump before this table
                                r.e = 16 + j;	// bits in this table
                                r.t = q;		// pointer to this table
                                j = (i & ((1 << w) - 1)) >> (w - lx[h]);
                                u[h - 1][j].e = r.e;
                                u[h - 1][j].b = r.b;
                                u[h - 1][j].n = r.n;
                                u[h - 1][j].t = r.t;
                            }
                        }

                        // set up table entry in r
                        r.b = k - w;
                        if (pidx >= n) {
                            r.e = 99;
                        } else if (p[pidx] < s) {
                            r.e = (p[pidx] < 256 ? 16 : 15); // 256 is end-of-block code
                            r.n = p[pidx++];	// simple code is just the value
                        } else {
                            assert(e);
                            r.e = e[p[pidx] - s];	// non-simple--look up in lists
                            assert(d);
                            r.n = d[p[pidx++] - s];
                        }

                        // fill code-like entries with r //
                        f = 1 << (k - w);
                        assert(q);
                        for (j = i >> w; j < z; j += f) {
                            q[j].e = r.e;
                            q[j].b = r.b;
                            q[j].n = r.n;
                            q[j].t = r.t;
                        }

                        // backwards increment the k-bit code i
                        for (j = 1 << (k - 1); (i & j) != 0; j >>= 1) {
                            i ^= j;
                        }
                        i ^= j;

                        // backup over finished tables
                        while ((i & ((1 << w) - 1)) != x[h]) {
                            w -= lx[h];		// don't need to update q
                            h--;
                        }
                    }
                }

                /* return actual size of base table */
                this.m = lx[1];

                /* Return true (1) if we were given an incomplete table */
                this.status = ((y != 0 && g != 1) ? 1 : 0);
            } /* end of constructor */
        }
    }

    /* routines (inflate) */

    function GET_BYTE() {
        assert(inflate_data);
        if (inflate_data.length == inflate_pos) {
            return -1;
        }
        return inflate_data[inflate_pos++];
    }

    function NEEDBITS(n: number) {
        while (bit_len < n) {
            bit_buf |= GET_BYTE() << bit_len;
            bit_len += 8;
        }
    }

    function GETBITS(n: number) {
        return bit_buf & MASK_BITS[n];
    }

    function DUMPBITS(n: number) {
        bit_buf >>= n;
        bit_len -= n;
    }

    function inflate_codes(buff: Uint8Array, off: number, size: number) {
        /* inflate (decompress) the codes in a deflated (compressed) block.
           Return an error code or zero if it all goes ok. */
        let e;		// table entry flag/number of extra bits
        let t;		// (HuftNode) pointer to table entry
        let n;

        if (size == 0) {
            return 0;
        }

        // inflate the coded data
        n = 0;
        for (; ;) {			// do until end of block
            NEEDBITS(bl);
            assert(tl && tl.list);
            t = tl.list[GETBITS(bl)];
            e = t.e;
            while (e > 16) {
                if (e == 99) {
                    return -1;
                }
                DUMPBITS(t.b);
                e -= 16;
                NEEDBITS(e);
                assert(t.t);
                t = t.t[GETBITS(e)];
                e = t.e;
            }
            DUMPBITS(t.b);

            if (e == 16) {		// then it's a literal
                wp &= WSIZE - 1;
                buff[off + n++] = slide[wp++] = t.n;
                if (n == size) {
                    return size;
                }
                continue;
            }

            // exit if end of block
            if (e == 15) {
                break;
            }

            // it's an EOB or a length

            // get length of block to copy
            NEEDBITS(e);
            copy_leng = t.n + GETBITS(e);
            DUMPBITS(e);

            // decode distance of block to copy
            NEEDBITS(bd);
            assert(td && td.list);
            t = td.list[GETBITS(bd)];
            e = t.e;

            while (e > 16) {
                if (e == 99) {
                    return -1;
                }
                DUMPBITS(t.b);
                e -= 16;
                NEEDBITS(e);
                assert(t && t.t);
                t = t.t[GETBITS(e)];
                e = t.e;
            }
            DUMPBITS(t.b);
            NEEDBITS(e);
            copy_dist = wp - t.n - GETBITS(e);
            DUMPBITS(e);

            // do the copy
            while (copy_leng > 0 && n < size) {
                copy_leng--;
                copy_dist &= WSIZE - 1;
                wp &= WSIZE - 1;
                buff[off + n++] = slide[wp++]
                    = slide[copy_dist++];
            }

            if (n == size) {
                return size;
            }
        }

        method = -1; // done
        return n;
    }

    function inflate_stored(buff: Uint8Array, off: number, size: number) {
        /* "decompress" an inflated type 0 (stored) block. */
        let n;

        // go to byte boundary
        n = bit_len & 7;
        DUMPBITS(n);

        // get the length and its complement
        NEEDBITS(16);
        n = GETBITS(16);
        DUMPBITS(16);
        NEEDBITS(16);
        if (n != ((~bit_buf) & 0xffff)) {
            return -1;
        }			// error in compressed data
        DUMPBITS(16);

        // read and output the compressed data
        copy_leng = n;

        n = 0;
        while (copy_leng > 0 && n < size) {
            copy_leng--;
            wp &= WSIZE - 1;
            NEEDBITS(8);
            buff[off + n++] = slide[wp++] =
                GETBITS(8);
            DUMPBITS(8);
        }

        if (copy_leng == 0) {
            method = -1;
        } // done
        return n;
    }

    function inflate_fixed(buff: Uint8Array, off: number, size: number) {
        /* decompress an inflated type 1 (fixed Huffman codes) block.  We should
           either replace this with a custom decoder, or at least precompute the
           Huffman tables. */

        // if first time, set up tables for fixed blocks
        if (fixed_tl == null) {
            let i;			// temporary variable
            const l = new Array(288);	// length list for huft_build
            let h;	// HuftBuild

            // literal table
            for (i = 0; i < 144; i++) {
                l[i] = 8;
            }
            for (; i < 256; i++) {
                l[i] = 9;
            }
            for (; i < 280; i++) {
                l[i] = 7;
            }
            for (; i < 288; i++) {	// make a complete, but wrong code set
                l[i] = 8;
            }
            fixed_bl = 7;

            h = new HuftBuild(l, 288, 257, cplens, cplext,
                fixed_bl);
            if (h.status != 0) {
                print("HufBuild error: " + h.status);
                return -1;
            }
            fixed_tl = h.root;
            fixed_bl = h.m;

            // distance table
            for (i = 0; i < 30; i++) {	// make an incomplete code set
                l[i] = 5;
            }
            let fixed_bd = 5;

            h = new HuftBuild(l, 30, 0, cpdist, cpdext, fixed_bd);
            if (h.status > 1) {
                fixed_tl = null;
                print("HufBuild error: " + h.status);
                return -1;
            }
            fixed_td = h.root;
            fixed_bd = h.m;
        }

        tl = fixed_tl;
        td = fixed_td;
        bl = fixed_bl;
        bd = fixed_bd;
        return inflate_codes(buff, off, size);
    }

    function inflate_dynamic(buff: Uint8Array, off: number, size: number) {
        // decompress an inflated type 2 (dynamic Huffman codes) block.
        let i;		// temporary variables
        let j;
        let l;		// last length
        let n;		// number of lengths to get
        let t;		// (HuftNode) literal/length code table
        let nb;		// number of bit length codes
        let nl;		// number of literal/length codes
        let nd;		// number of distance codes
        const ll = new Array(286 + 30); // literal/length and distance code lengths
        let h;		// (HuftBuild)

        for (i = 0; i < ll.length; i++) {
            ll[i] = 0;
        }

        // read in table lengths
        NEEDBITS(5);
        nl = 257 + GETBITS(5);	// number of literal/length codes
        DUMPBITS(5);
        NEEDBITS(5);
        nd = 1 + GETBITS(5);	// number of distance codes
        DUMPBITS(5);
        NEEDBITS(4);
        nb = 4 + GETBITS(4);	// number of bit length codes
        DUMPBITS(4);
        if (nl > 286 || nd > 30) {
            return -1;
        }		// bad lengths

        // read in bit-length-code lengths
        for (j = 0; j < nb; j++) {
            NEEDBITS(3);
            ll[border[j]] = GETBITS(3);
            DUMPBITS(3);
        }
        for (; j < 19; j++) {
            ll[border[j]] = 0;
        }

        // build decoding table for trees--single level, 7 bit lookup
        bl = 7;
        h = new HuftBuild(ll, 19, 19, null, null, bl);
        if (h.status != 0) {
            return -1;
        }	// incomplete code set

        tl = h.root;
        bl = h.m;

        // read in literal and distance code lengths
        n = nl + nd;
        i = l = 0;
        while (i < n) {
            NEEDBITS(bl);
            assert(tl && tl.list);
            t = tl.list[GETBITS(bl)];
            j = t.b;
            DUMPBITS(j);
            j = t.n;
            if (j < 16) {		// length of code in bits (0..15)
                ll[i++] = l = j;
            } else if (j == 16) {	// repeat last length 3 to 6 times
                NEEDBITS(2);
                j = 3 + GETBITS(2);
                DUMPBITS(2);
                if (i + j > n) {
                    return -1;
                }
                while (j-- > 0) {
                    ll[i++] = l;
                }
            } else if (j == 17) {	// 3 to 10 zero length codes
                NEEDBITS(3);
                j = 3 + GETBITS(3);
                DUMPBITS(3);
                if (i + j > n) {
                    return -1;
                }
                while (j-- > 0) {
                    ll[i++] = 0;
                }
                l = 0;
            } else {		// j == 18: 11 to 138 zero length codes
                NEEDBITS(7);
                j = 11 + GETBITS(7);
                DUMPBITS(7);
                if (i + j > n) {
                    return -1;
                }
                while (j-- > 0) {
                    ll[i++] = 0;
                }
                l = 0;
            }
        }

        // build the decoding tables for literal/length and distance codes
        bl = lbits;
        h = new HuftBuild(ll, nl, 257, cplens, cplext, bl);
        if (bl == 0) {	// no literals or lengths
            h.status = 1;
        }
        if (h.status != 0) {
            if (h.status == 1) {
                // **incomplete literal tree**
            }
            return -1;		// incomplete code set
        }
        tl = h.root;
        bl = h.m;

        for (i = 0; i < nd; i++) {
            ll[i] = ll[i + nl];
        }
        bd = dbits;
        h = new HuftBuild(ll, nd, 0, cpdist, cpdext, bd);
        td = h.root;
        bd = h.m;

        if (bd == 0 && nl > 257) {   // lengths but no distances
            // **incomplete distance tree**
            return -1;
        }

        if (h.status == 1) {
            // **incomplete distance tree**
        }
        if (h.status != 0) {
            return -1;
        }

        // decompress until an end-of-block code
        return inflate_codes(buff, off, size);
    }

    function inflate_start() {

        if (slide == null) {
            slide = new Array(2 * WSIZE);
        }
        wp = 0;
        bit_buf = 0;
        bit_len = 0;
        method = -1;
        eof = false;
        copy_leng = copy_dist = 0;
        tl = null;
    }

    function inflate_internal(buff: Uint8Array, off: number, size: number) {
        // decompress an inflated entry
        let n, i;

        n = 0;
        while (n < size) {
            if (eof && method == -1) {
                return n;
            }

            if (copy_leng > 0) {
                if (method != STORED_BLOCK) {
                    // STATIC_TREES or DYN_TREES
                    while (copy_leng > 0 && n < size) {
                        copy_leng--;
                        copy_dist &= WSIZE - 1;
                        wp &= WSIZE - 1;
                        buff[off + n++] = slide[wp++] =
                            slide[copy_dist++];
                    }
                } else {
                    while (copy_leng > 0 && n < size) {
                        copy_leng--;
                        wp &= WSIZE - 1;
                        NEEDBITS(8);
                        buff[off + n++] = slide[wp++] = GETBITS(8);
                        DUMPBITS(8);
                    }
                    if (copy_leng == 0) {
                        method = -1;
                    } // done
                }
                if (n == size) {
                    return n;
                }
            }

            if (method == -1) {

                if (eof) {
                    break;
                }

                // read in last block bit
                NEEDBITS(1);
                if (GETBITS(1) != 0) {
                    eof = true;
                }
                DUMPBITS(1);

                // read in block type
                NEEDBITS(2);
                method = GETBITS(2);
                DUMPBITS(2);
                tl = null;
                copy_leng = 0;
            }

            switch (method) {
                case 0: // STORED_BLOCK
                    i = inflate_stored(buff, off + n, size - n);
                    break;

                case 1: // STATIC_TREES
                    if (tl != null) {
                        i = inflate_codes(buff, off + n, size - n);
                    } else {
                        i = inflate_fixed(buff, off + n, size - n);
                    }
                    break;

                case 2: // DYN_TREES
                    if (tl != null) {
                        i = inflate_codes(buff, off + n, size - n);
                    } else {
                        i = inflate_dynamic(buff, off + n, size - n);
                    }
                    break;

                default: // error
                    i = -1;
                    break;
            }

            if (i == -1) {
                if (eof) {
                    return 0;
                }
                return -1;
            }
            n += i;
        }
        return n;
    }

    const inflate = (bytes: Uint8Array) => {
        let out, buff;
        let i;

        inflate_start();
        inflate_data = bytes;
        inflate_pos = 0;

        buff = new Uint8Array(1024);
        out = [];
        // tslint:disable-next-line: no-conditional-assignment
        while ((i = inflate_internal(buff, 0, buff.length)) > 0) {
            out.push(buff.slice(0, i));
        }
        inflate_data = undefined; // G.C.
        return consumeSync(out);
    };

    return inflate(input);

}
