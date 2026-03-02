#!/usr/bin/env node
/**
 * Decrypt an encrypted census export file (.enc.json)
 *
 * Usage: node decrypt-export.js <input-file> [output-file]
 *
 * Example:
 *   node decrypt-export.js export_secours_1234567890.enc.json decrypted.json
 */

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const PASSPHRASE = 'CENSUS-GABON-2026';
const SALT = 'CENSUS-GABON-SALT-2026';
const ITERATIONS = 100000;

function fromBase64(b64) {
  return Buffer.from(b64, 'base64');
}

async function decrypt(inputPath, outputPath) {
  // Read encrypted file
  const raw = fs.readFileSync(inputPath, 'utf-8');
  const envelope = JSON.parse(raw);

  if (!envelope.encrypted) {
    console.log('File is not encrypted. Copying as-is.');
    if (outputPath) {
      fs.writeFileSync(outputPath, JSON.stringify(envelope, null, 2));
      console.log(`Written to ${outputPath}`);
    } else {
      console.log(JSON.stringify(envelope, null, 2));
    }
    return;
  }

  if (envelope.version !== 1) {
    console.error(`Unknown encryption version: ${envelope.version}`);
    process.exit(1);
  }

  const iv = fromBase64(envelope.iv);
  const encryptedData = fromBase64(envelope.data);

  // Derive key using PBKDF2 (matching the Web Crypto API parameters)
  const key = crypto.pbkdf2Sync(
    PASSPHRASE,
    SALT,
    ITERATIONS,
    32, // 256 bits
    'sha256'
  );

  // AES-GCM: last 16 bytes are the auth tag
  const authTag = encryptedData.slice(encryptedData.length - 16);
  const ciphertext = encryptedData.slice(0, encryptedData.length - 16);

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertext, null, 'utf-8');
  decrypted += decipher.final('utf-8');

  const data = JSON.parse(decrypted);

  if (outputPath) {
    fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));
    console.log(`Decrypted successfully. Written to ${outputPath}`);
    console.log(`Total habitations: ${data.totalHabitations || 'N/A'}`);
    console.log(`Export date: ${data.exportDate || 'N/A'}`);
  } else {
    // Output to stdout
    console.log(JSON.stringify(data, null, 2));
  }
}

// CLI
const args = process.argv.slice(2);
if (args.length === 0) {
  console.log('Usage: node decrypt-export.js <input-file.enc.json> [output-file.json]');
  process.exit(1);
}

const inputFile = path.resolve(args[0]);
const outputFile = args[1] ? path.resolve(args[1]) : null;

if (!fs.existsSync(inputFile)) {
  console.error(`File not found: ${inputFile}`);
  process.exit(1);
}

decrypt(inputFile, outputFile).catch(err => {
  console.error('Decryption failed:', err.message);
  process.exit(1);
});
