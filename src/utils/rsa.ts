import * as crypto from "crypto";

/**
 * Encrypt password using Zkong's RSA public key.
 * Matches Appendix II Java example: RSA/ECB/PKCS1Padding, Base64 output.
 *
 * @param publicKeyBase64 - Base64-encoded X.509 SubjectPublicKeyInfo (as returned by getErpPublicKey data field)
 * @param password - plaintext password (e.g. ZKONG_PASSWORD)
 * @returns Base64-encoded ciphertext to use as `password` in login request
 */
export function encryptPassword(
  publicKeyBase64: string,
  password: string
): string {
  const pem = [
    "-----BEGIN PUBLIC KEY-----",
    publicKeyBase64.match(/.{1,64}/g)?.join("\n") ?? publicKeyBase64,
    "-----END PUBLIC KEY-----",
  ].join("\n");

  const buffer = Buffer.from(password, "utf8");
  const encrypted = crypto.publicEncrypt(
    {
      key: pem,
      padding: crypto.constants.RSA_PKCS1_PADDING,
    },
    buffer
  );
  return encrypted.toString("base64");
}
