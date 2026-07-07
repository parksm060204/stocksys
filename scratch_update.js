const fs = require('fs');
const path = require('path');

const filesToProcess = [
  'lib/lp/accounts.ts',
  'lib/lp/engine.ts',
];

const replacements = [
  { from: /PlayerType/g, to: 'InvestorCategory' },
  { from: /playerType/g, to: 'investorCategory' },
  { from: /"PENSION"/g, to: '"INST_PENSION"' },
  { from: /"SECURITIES"/g, to: '"INST_FINANCE"' },
  { from: /"INVESTMENT_TRUST"/g, to: '"INST_TRUST"' },
  { from: /"INSURANCE_BANK"/g, to: '"INST_BANK_INS"' },
  { from: /"PE_HEDGE"/g, to: '"INST_PEF"' },
  { from: /"IB"/g, to: '"FOREIGNER"' },
];

for (const file of filesToProcess) {
  const filePath = path.join(process.cwd(), file);
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    continue;
  }
  
  let content = fs.readFileSync(filePath, 'utf8');
  for (const { from, to } of replacements) {
    content = content.replace(from, to);
  }
  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`Updated ${file}`);
}
