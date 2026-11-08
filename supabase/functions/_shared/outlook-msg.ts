// Minimal reader for Outlook .msg files (OLE compound file / MS-CFB with
// MS-OXMSG property streams). Only reads headers, subject, sender, bodies and
// attachment names/sizes. Attachment contents are never interpreted.

import {
  type MailAttachmentInfo,
  type MailHeader,
  type ParsedMail,
  parseHeaderBlock,
} from "./phishing-analysis.ts";

const SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const END_OF_CHAIN = 0xfffffffe;
const FREE_SECT = 0xffffffff;
const NO_STREAM = 0xffffffff;
const MAX_SECTORS = 200_000;
const MAX_ENTRIES = 5_000;

type DirectoryEntry = {
  name: string;
  type: number;
  left: number;
  right: number;
  child: number;
  start: number;
  size: number;
};

export class MsgParseError extends Error {}

export function isCompoundFile(bytes: Uint8Array): boolean {
  return bytes.length >= 512 && SIGNATURE.every((value, index) => bytes[index] === value);
}

class CompoundFile {
  private view: DataView;
  private sectorSize: number;
  private miniSectorSize: number;
  private miniCutoff: number;
  private fat: number[] = [];
  private miniFat: number[] = [];
  private miniStream: Uint8Array = new Uint8Array();
  entries: DirectoryEntry[] = [];

  constructor(private bytes: Uint8Array) {
    if (!isCompoundFile(bytes)) throw new MsgParseError("not_a_compound_file");
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const sectorShift = this.view.getUint16(0x1e, true);
    const miniShift = this.view.getUint16(0x20, true);
    if (sectorShift !== 9 && sectorShift !== 12) throw new MsgParseError("bad_sector_size");
    this.sectorSize = 1 << sectorShift;
    this.miniSectorSize = 1 << miniShift;
    this.miniCutoff = this.view.getUint32(0x38, true);
    this.readFat();
    const firstDir = this.view.getUint32(0x30, true);
    const dirBytes = this.readChain(firstDir, this.fat, (sid) => this.sector(sid), this.sectorSize);
    for (let offset = 0; offset + 128 <= dirBytes.length && this.entries.length < MAX_ENTRIES; offset += 128) {
      this.entries.push(this.readEntry(dirBytes, offset));
    }
    const root = this.entries[0];
    if (!root || root.type !== 5) throw new MsgParseError("root_missing");
    const firstMiniFat = this.view.getUint32(0x3c, true);
    if (firstMiniFat !== END_OF_CHAIN && firstMiniFat !== FREE_SECT) {
      const miniFatBytes = this.readChain(firstMiniFat, this.fat, (sid) => this.sector(sid), this.sectorSize);
      const view = new DataView(miniFatBytes.buffer, miniFatBytes.byteOffset, miniFatBytes.byteLength);
      for (let offset = 0; offset + 4 <= miniFatBytes.length; offset += 4) {
        this.miniFat.push(view.getUint32(offset, true));
      }
    }
    if (root.start !== END_OF_CHAIN && root.size > 0) {
      this.miniStream = this.readChain(root.start, this.fat, (sid) => this.sector(sid), this.sectorSize)
        .subarray(0, root.size);
    }
  }

  private sector(sid: number): Uint8Array {
    const offset = (sid + 1) * this.sectorSize;
    if (offset + this.sectorSize > this.bytes.length) {
      // Truncated last sector: return what exists.
      if (offset >= this.bytes.length) throw new MsgParseError("sector_out_of_range");
      return this.bytes.subarray(offset);
    }
    return this.bytes.subarray(offset, offset + this.sectorSize);
  }

  private readFat(): void {
    const fatSectors: number[] = [];
    for (let index = 0; index < 109; index += 1) {
      const sid = this.view.getUint32(0x4c + index * 4, true);
      if (sid === FREE_SECT || sid === END_OF_CHAIN) continue;
      fatSectors.push(sid);
    }
    let difat = this.view.getUint32(0x44, true);
    let guard = 0;
    const perSector = this.sectorSize / 4 - 1;
    while (difat !== END_OF_CHAIN && difat !== FREE_SECT && guard++ < 10_000) {
      const sector = this.sector(difat);
      const view = new DataView(sector.buffer, sector.byteOffset, sector.byteLength);
      for (let index = 0; index < perSector; index += 1) {
        const sid = view.getUint32(index * 4, true);
        if (sid !== FREE_SECT && sid !== END_OF_CHAIN) fatSectors.push(sid);
      }
      difat = view.getUint32(perSector * 4, true);
    }
    for (const sid of fatSectors) {
      const sector = this.sector(sid);
      const view = new DataView(sector.buffer, sector.byteOffset, sector.byteLength);
      for (let offset = 0; offset + 4 <= sector.length; offset += 4) {
        this.fat.push(view.getUint32(offset, true));
      }
      if (this.fat.length > MAX_SECTORS * 4) throw new MsgParseError("fat_too_large");
    }
  }

  private readChain(
    start: number,
    table: number[],
    read: (sid: number) => Uint8Array,
    unit: number,
  ): Uint8Array {
    const chunks: Uint8Array[] = [];
    const seen = new Set<number>();
    let sid = start;
    while (sid !== END_OF_CHAIN && sid !== FREE_SECT) {
      if (seen.has(sid) || sid >= table.length || seen.size > MAX_SECTORS) {
        throw new MsgParseError("broken_chain");
      }
      seen.add(sid);
      chunks.push(read(sid));
      const next = table[sid];
      if (next === undefined) break;
      sid = next;
    }
    const out = new Uint8Array(chunks.length * unit);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out.subarray(0, offset);
  }

  private readEntry(bytes: Uint8Array, offset: number): DirectoryEntry {
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 128);
    const nameLength = Math.min(64, view.getUint16(0x40, true));
    const nameBytes = bytes.subarray(offset, offset + Math.max(0, nameLength - 2));
    return {
      name: new TextDecoder("utf-16le").decode(nameBytes),
      type: view.getUint8(0x42),
      left: view.getUint32(0x44, true),
      right: view.getUint32(0x48, true),
      child: view.getUint32(0x4c, true),
      start: view.getUint32(0x74, true),
      size: view.getUint32(0x78, true),
    };
  }

  /** Child entries (ids) of a storage, by walking its red-black tree. */
  children(id: number): number[] {
    const out: number[] = [];
    const stack = [this.entries[id]?.child ?? NO_STREAM];
    const seen = new Set<number>();
    while (stack.length) {
      const current = stack.pop()!;
      if (current === NO_STREAM || seen.has(current) || !this.entries[current]) continue;
      seen.add(current);
      out.push(current);
      const entry = this.entries[current]!;
      stack.push(entry.left, entry.right);
    }
    return out;
  }

  stream(id: number): Uint8Array {
    const entry = this.entries[id];
    if (!entry || entry.type !== 2) return new Uint8Array();
    if (entry.size === 0) return new Uint8Array();
    if (entry.size < this.miniCutoff) {
      const data = this.readChain(entry.start, this.miniFat, (sid) => {
        const offset = sid * this.miniSectorSize;
        return this.miniStream.subarray(offset, offset + this.miniSectorSize);
      }, this.miniSectorSize);
      return data.subarray(0, entry.size);
    }
    return this.readChain(entry.start, this.fat, (sid) => this.sector(sid), this.sectorSize)
      .subarray(0, entry.size);
  }
}

function utf16(bytes: Uint8Array): string {
  return new TextDecoder("utf-16le").decode(bytes).replace(/\u0000+$/, "");
}

function ansi(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/\u0000+$/, "");
  } catch {
    return new TextDecoder("windows-1252").decode(bytes).replace(/\u0000+$/, "");
  }
}

type PropertyMap = Map<string, Uint8Array>;

function propertiesOf(file: CompoundFile, storageId: number): PropertyMap {
  const map: PropertyMap = new Map();
  for (const id of file.children(storageId)) {
    const entry = file.entries[id]!;
    const match = /^__substg1\.0_([0-9A-Fa-f]{8})$/.exec(entry.name);
    if (match && entry.type === 2) map.set(match[1]!.toUpperCase(), file.stream(id));
  }
  return map;
}

function stringProperty(map: PropertyMap, tag: string): string | null {
  const unicode = map.get(`${tag}001F`);
  if (unicode) return utf16(unicode);
  const eightBit = map.get(`${tag}001E`);
  return eightBit ? ansi(eightBit) : null;
}

/** Parses an Outlook .msg into the same shape as a MIME mail. */
export function parseOutlookMsg(bytes: Uint8Array): ParsedMail {
  const file = new CompoundFile(bytes);
  const props = propertiesOf(file, 0);
  const transportHeaders = stringProperty(props, "007D");
  const subject = stringProperty(props, "0037");
  const senderName = stringProperty(props, "0C1A");
  const senderEmail = stringProperty(props, "5D01") ?? stringProperty(props, "0C1F") ??
    stringProperty(props, "0065");
  let headers: MailHeader[] = transportHeaders ? parseHeaderBlock(transportHeaders) : [];
  if (!headers.some((entry) => entry.name === "from") && (senderEmail || senderName)) {
    const address = senderEmail && senderEmail.includes("@") ? ` <${senderEmail}>` : "";
    headers = [...headers, { name: "from", value: `${senderName ?? ""}${address}`.trim() }];
  }
  if (!headers.some((entry) => entry.name === "subject") && subject) {
    headers = [...headers, { name: "subject", value: subject }];
  }
  const text = stringProperty(props, "1000") ?? "";
  const htmlBinary = props.get("10130102");
  const html = htmlBinary ? ansi(htmlBinary) : stringProperty(props, "1013") ?? "";

  const attachments: MailAttachmentInfo[] = [];
  for (const id of file.children(0)) {
    const entry = file.entries[id]!;
    if (entry.type !== 1 || !/^__attach_version1\.0_#/i.test(entry.name)) continue;
    const attach = propertiesOf(file, id);
    const filename = stringProperty(attach, "3707") ?? stringProperty(attach, "3704") ??
      stringProperty(attach, "3001") ?? "Anhang";
    const mime = stringProperty(attach, "370E") ?? "application/octet-stream";
    const data = attach.get("37010102");
    attachments.push({
      filename: filename.slice(0, 255),
      contentType: mime.toLowerCase().slice(0, 120),
      size: data?.length ?? 0,
    });
    if (attachments.length >= 50) break;
  }
  return {
    headers,
    text: text.slice(0, 200_000),
    html: html.slice(0, 200_000),
    attachments,
    embedded: [],
  };
}
