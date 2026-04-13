require('dotenv').config();
const bcrypt = require('bcryptjs');

async function main() {
  const adminPin = process.env.ADMIN_PIN || '1234';
  const bouncerPin = process.env.BOUNCER_PIN || '9999';

  const adminHash   = await bcrypt.hash(adminPin, 12);
  const bouncerHash = await bcrypt.hash(bouncerPin, 12);
  
  console.log('\nPaste these into your .env:\n');
  console.log('ADMIN_PIN_HASH='   + adminHash);
  console.log('BOUNCER_PIN_HASH=' + bouncerHash);
  console.log('\nThen remove ADMIN_PIN and BOUNCER_PIN from .env (optional for dev)\n');
}
main();
