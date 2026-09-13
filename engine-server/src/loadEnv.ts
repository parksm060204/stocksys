import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

export function loadEnv() {
  const candidateDirs = [process.cwd()];
  let curr = __dirname;
  for (let i = 0; i < 5; i++) {
    candidateDirs.push(curr);
    curr = path.dirname(curr);
  }

  // 우선순위: .env.local (최우선) -> engine-server/.env.local -> engine-server/.env -> .env (기본 fallback)
  const envFilePatterns = [
    '.env.local',
    'engine-server/.env.local',
    'engine-server/.env',
    '.env'
  ];

  const loadedFiles = new Set<string>();

  for (const pattern of envFilePatterns) {
    for (const dir of candidateDirs) {
      const fullPath = path.resolve(dir, pattern);
      if (!loadedFiles.has(fullPath) && fs.existsSync(fullPath)) {
        dotenv.config({ path: fullPath });
        loadedFiles.add(fullPath);
      }
    }
  }
}

loadEnv();
