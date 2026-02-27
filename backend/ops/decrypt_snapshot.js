const crypto = require('crypto');
const fs = require('fs');

if (process.argv.length < 4) {
  console.error('Usage: node decrypt_snapshot.js <encPath> <metaPath> [out.html]');
  process.exit(2);
}

const encPath = process.argv[2];
const metaPath = process.argv[3];
const outPath = process.argv[4] || null;

if (!fs.existsSync(encPath) || !fs.existsSync(metaPath)) {
  console.error('Snapshot files not found:', encPath, metaPath);
  process.exit(2);
}

const encHex = fs.readFileSync(encPath, 'utf8').trim();
const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
const ivHex = meta.iv;

const keyEnv = process.env.SNAPSHOT_KEY;
if (!keyEnv) {
  console.error('Environment variable SNAPSHOT_KEY is required to decrypt snapshots');
  process.exit(2);
}

const key = Buffer.from(keyEnv.padEnd(32, '0').slice(0, 32), 'utf8');
const iv = Buffer.from(ivHex, 'hex');

try {
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  let decrypted = decipher.update(encHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  if (outPath) {
    fs.writeFileSync(outPath, decrypted, 'utf8');
    console.log('Decrypted snapshot written to', outPath);
  } else {
    process.stdout.write(decrypted);
  }
} catch (err) {
  console.error('Failed to decrypt snapshot:', err.message);
  process.exit(1);
}
