import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import { type CBORType, encodeCBOR } from '@levischuck/tiny-cbor';

/**
 * A passkey that lives in memory: what a browser and its authenticator send to the Worker, built from a real P-256 key
 * so the Worker's verification runs unchanged. Loaded both in workerd and in Node, so only APIs the two share.
 */
export class SoftwareAuthenticator {
    readonly credentialId = crypto.getRandomValues(new Uint8Array(16));
    private signCount = 0;
    private readonly key: SigningKey;

    private constructor(key: SigningKey) {
        this.key = key;
    }

    static async create(): Promise<SoftwareAuthenticator> {
        const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
        if (!('privateKey' in keys)) {
            throw new Error('ECDSA generated a single key rather than a pair');
        }
        const jwk = await crypto.subtle.exportKey('jwk', keys.publicKey);
        if (jwk instanceof ArrayBuffer || jwk.x === undefined || jwk.y === undefined) {
            throw new Error('The public key exported without its x and y coordinates');
        }
        const { privateKey } = keys;
        return new SoftwareAuthenticator({
            x: fromBase64url(jwk.x),
            y: fromBase64url(jwk.y),
            sign: async (data) =>
                new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, data)),
        });
    }

    get id(): string {
        return base64url(this.credentialId);
    }

    /** What navigator.credentials.create() resolves to on `origin` for the Worker's registration options. */
    async register(origin: string, challenge: string): Promise<RegistrationResponseJSON> {
        const coseKey = new Map<number, CBORType>([
            [1, 2],
            [3, -7],
            [-1, 1],
            [-2, this.key.x],
            [-3, this.key.y],
        ]);
        // Flags 0x45: user present, user verified, attested credential data.
        const authData = concat(
            await rpIdHash(origin),
            [0x45],
            [0, 0, 0, 0],
            new Uint8Array(16),
            [0, this.credentialId.length],
            this.credentialId,
            new Uint8Array(encodeCBOR(coseKey)),
        );
        const attestation = new Map<string, CBORType>([
            ['fmt', 'none'],
            ['attStmt', new Map()],
            ['authData', authData],
        ]);
        return {
            id: this.id,
            rawId: this.id,
            type: 'public-key',
            response: {
                clientDataJSON: base64url(clientData('webauthn.create', origin, challenge)),
                attestationObject: base64url(new Uint8Array(encodeCBOR(attestation))),
                transports: ['internal'],
            },
            clientExtensionResults: {},
        };
    }

    /** What navigator.credentials.get() resolves to on `origin` for the Worker's login options. */
    async assert(origin: string, challenge: string, userHandle?: string): Promise<AuthenticationResponseJSON> {
        this.signCount += 1;
        const count = this.signCount;
        // Flags 0x05: user present, user verified. Then the sign count, big-endian.
        const authData = concat(
            await rpIdHash(origin),
            [0x05],
            [count >>> 24, (count >>> 16) & 0xff, (count >>> 8) & 0xff, count & 0xff],
        );
        const clientDataJSON = clientData('webauthn.get', origin, challenge);
        const signed = await this.key.sign(concat(authData, await sha256(clientDataJSON)));
        return {
            id: this.id,
            rawId: this.id,
            type: 'public-key',
            response: {
                clientDataJSON: base64url(clientDataJSON),
                authenticatorData: base64url(authData),
                signature: base64url(derSignature(signed)),
                ...(userHandle !== undefined && { userHandle }),
            },
            clientExtensionResults: {},
        };
    }
}

type Bytes = Uint8Array | readonly number[];

/** The P-256 public key's coordinates, and a signer holding its private half. */
interface SigningKey {
    x: Uint8Array;
    y: Uint8Array;
    sign: (data: Uint8Array) => Promise<Uint8Array>;
}

const ENCODER = new TextEncoder();

function clientData(type: string, origin: string, challenge: string): Uint8Array {
    return ENCODER.encode(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
}

async function rpIdHash(origin: string): Promise<Uint8Array> {
    return sha256(ENCODER.encode(new URL(origin).hostname));
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
    return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}

function concat(...parts: Bytes[]): Uint8Array {
    const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
    let offset = 0;
    for (const part of parts) {
        out.set(part, offset);
        offset += part.length;
    }
    return out;
}

// WebCrypto returns ECDSA signatures as r||s; WebAuthn wants ASN.1 DER.
function derSignature(raw: Uint8Array): Uint8Array {
    const integer = (bytes: Uint8Array): Uint8Array => {
        let start = 0;
        while (start < bytes.length - 1 && bytes[start] === 0) {
            start += 1;
        }
        const trimmed = bytes.slice(start);
        // A leading byte with the high bit set would read as negative, so it gets a zero byte in front.
        const isHighBitSet = (trimmed[0] ?? 0) >= 0x80;
        return concat(isHighBitSet ? [0x02, trimmed.length + 1, 0] : [0x02, trimmed.length], trimmed);
    };
    const body = concat(integer(raw.slice(0, 32)), integer(raw.slice(32)));
    return concat([0x30, body.length], body);
}

// Node 24 has neither Uint8Array.prototype.toBase64 nor Uint8Array.fromBase64.
function base64url(bytes: Uint8Array): string {
    return btoa(String.fromCodePoint(...bytes))
        .replaceAll('+', '-')
        .replaceAll('/', '_')
        .replaceAll('=', '');
}

function fromBase64url(text: string): Uint8Array {
    const binary = atob(text.replaceAll('-', '+').replaceAll('_', '/'));
    return Uint8Array.from(binary, (character) => character.codePointAt(0) ?? 0);
}
