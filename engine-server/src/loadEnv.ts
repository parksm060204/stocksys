import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

export function loadEnv() {
  const candidatePaths = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), 'engine-server/.env'),
    path.resolve(process.cwd(), '.env.local'),
    path.resolve(process.cwd(), '../.env.local'),
  ];

  let curr = __dirname;
  for (let i = 0; i < 5; i++) {
    candidatePaths.push(path.resolve(curr, '.env'));
    candidatePaths.push(path.resolve(curr, '.env.local'));
    candidatePaths.push(path.resolve(curr, 'engine-server/.env'));
    curr = path.dirname(curr);
  }

  for (const envPath of candidatePaths) {
    if (fs.existsSync(envPath)) {
      dotenv.config({ path: envPath });
    }
  }
}

loadEnv();
