const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, 'engine-server/src/bots');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.ts'));

files.forEach(file => {
  const filePath = path.join(dir, file);
  let content = fs.readFileSync(filePath, 'utf8');

  // Replace user_id: null with user_id: this.botId, except for RetailSwarmAgent
  if (file === 'RetailSwarmAgent.ts') {
    content = content.replace(/user_id:\s*null/g, "user_id: this.bot.id");
  } else if (file === 'CommodityBots.ts' || file === 'OptionsMMAgent.ts') {
    // Check if CommodityBots uses this.bot.id or this.botId
    if (content.includes('this.bot.id')) {
      content = content.replace(/user_id:\s*null/g, "user_id: this.bot.id");
    } else {
      content = content.replace(/user_id:\s*null/g, "user_id: this.botId");
    }
  } else {
    content = content.replace(/user_id:\s*null/g, "user_id: this.botId");
  }

  fs.writeFileSync(filePath, content, 'utf8');
});

console.log('Replaced user_id: null in bots directory');
