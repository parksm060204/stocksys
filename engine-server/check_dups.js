const fs = require('fs');
const content = fs.readFileSync('../lib/stock-data.ts', 'utf-8');
const tickers = [...content.matchAll(/ticker:\s*\"([^\"]+)\"/g)].map(m => m[1]);
const duplicates = tickers.filter((t, i) => tickers.indexOf(t) !== i);
console.log('Duplicates:', [...new Set(duplicates)]);
