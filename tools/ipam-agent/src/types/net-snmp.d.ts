// Minimal typings for the parts of net-snmp the agent uses.
declare module "net-snmp" {
  export type VarbindValue = Buffer | number | bigint | string | null;
  export interface Varbind {
    oid: string;
    type: number;
    value: VarbindValue;
  }
  export interface Session {
    get(
      oids: string[],
      callback: (error: Error | null, varbinds: Varbind[]) => void,
    ): void;
    subtree(
      oid: string,
      maxRepetitions: number,
      feed: (varbinds: Varbind[]) => boolean | void,
      done: (error: Error | null) => void,
    ): void;
    close(): void;
    on(event: "error", listener: (error: Error) => void): void;
  }
  export interface SessionOptions {
    port?: number;
    retries?: number;
    timeout?: number;
    version?: number;
    transport?: "udp4" | "udp6";
  }
  export interface User {
    name: string;
    level: number;
    authProtocol?: number;
    authKey?: string;
    privProtocol?: number;
    privKey?: string;
  }
  export const Version2c: number;
  export const Version3: number;
  export const SecurityLevel: {
    noAuthNoPriv: number;
    authNoPriv: number;
    authPriv: number;
  };
  export const AuthProtocols: Record<
    "md5" | "sha" | "sha224" | "sha256" | "sha384" | "sha512",
    number
  >;
  export const PrivProtocols: Record<
    "des" | "aes" | "aes256b" | "aes256r",
    number
  >;
  export function createSession(
    target: string,
    community: string,
    options?: SessionOptions,
  ): Session;
  export function createV3Session(
    target: string,
    user: User,
    options?: SessionOptions,
  ): Session;
  export function isVarbindError(varbind: Varbind): boolean;
  const snmp: {
    Version2c: number;
    Version3: number;
    SecurityLevel: typeof SecurityLevel;
    AuthProtocols: typeof AuthProtocols;
    PrivProtocols: typeof PrivProtocols;
    createSession: typeof createSession;
    createV3Session: typeof createV3Session;
    isVarbindError: typeof isVarbindError;
  };
  export default snmp;
}
