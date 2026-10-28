import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const VERSION = "v1";
const ALLOWED_PROTOCOLS = new Set(["http:", "https:", "socks4:", "socks5:"]);

function keyFromSecret(secret: string) {
  if (secret.length < 32) throw new Error("X Worker 密钥长度不足，无法安全保存代理。");
  return createHash("sha256").update(`diyproject:x-proxy:${secret}`).digest();
}

export function normalizeProxyUrl(value: string) {
  const normalized = value.trim();
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error("代理地址格式无效。");
  }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) throw new Error("代理仅支持 HTTP、HTTPS、SOCKS4 或 SOCKS5。");
  if (!parsed.hostname || !parsed.port) throw new Error("代理地址必须包含主机和端口。");
  parsed.pathname = "";
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

export function encryptProxyUrl(value: string, secret: string) {
  const proxyUrl = normalizeProxyUrl(value);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFromSecret(secret), iv);
  const encrypted = Buffer.concat([cipher.update(proxyUrl, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptProxyUrl(value: string, secret: string) {
  const [version, ivValue, tagValue, encryptedValue, ...rest] = value.split(".");
  if (version !== VERSION || !ivValue || !tagValue || !encryptedValue || rest.length) {
    throw new Error("代理密文格式无效。");
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", keyFromSecret(secret), Buffer.from(ivValue, "base64url"));
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedValue, "base64url")),
      decipher.final(),
    ]).toString("utf8");
    return normalizeProxyUrl(decrypted);
  } catch {
    throw new Error("代理密文无法解密，请重新保存代理配置。");
  }
}

export function getProxyDisplayHost(value: string) {
  const parsed = new URL(normalizeProxyUrl(value));
  return `${parsed.hostname}:${parsed.port}`;
}

export function maskProxyUrl(value: string) {
  const parsed = new URL(normalizeProxyUrl(value));
  const credentials = parsed.username || parsed.password ? "***@" : "";
  return `${parsed.protocol}//${credentials}${parsed.hostname}:${parsed.port}`;
}
