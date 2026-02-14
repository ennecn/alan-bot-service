import { resolve } from 'path';
import { existsSync } from 'fs';
import { importSTCardFromPng, importSTCardFromJson } from './importers/st-card.js';
import { importSTWorldInfo, importSTCharacterBook } from './importers/st-world.js';
import { getDb } from './db/index.js';
import { defaultConfig } from './config.js';
import { IdentityEngine } from './engines/identity/index.js';

const DATA_DIR = resolve(process.cwd(), 'data');

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help') {
    console.log(`
Metroid ST 导入工具

用法:
  tsx src/import.ts card <角色卡.png|.json> [--user 用户名]
  tsx src/import.ts world <世界书.json> [--char 角色名] [--user 用户名]
  tsx src/import.ts all <角色卡.png> [世界书.json] [--user 用户名]

示例:
  tsx src/import.ts card "D:\\sillytavern\\...\\characters\\沉迹.png"
  tsx src/import.ts world "D:\\sillytavern\\...\\worlds\\修真玄幻.json"
  tsx src/import.ts all "D:\\sillytavern\\...\\characters\\沉迹.png" "D:\\sillytavern\\...\\worlds\\修真玄幻.json"
`);
    return;
  }

  const command = args[0];
  const userName = getFlag(args, '--user') || '用户';
  const charName = getFlag(args, '--char');

  const config = { ...defaultConfig, dataDir: DATA_DIR, dbPath: resolve(DATA_DIR, 'metroid.db') };
  const db = getDb(config);
  const identity = new IdentityEngine(db);

  if (command === 'card' || command === 'all') {
    const cardPath = args[1];
    if (!cardPath || !existsSync(cardPath)) {
      console.error(`找不到文件: ${cardPath}`);
      process.exit(1);
    }

    console.log(`\n导入角色卡: ${cardPath}`);
    const isPng = cardPath.toLowerCase().endsWith('.png');
    const result = isPng
      ? importSTCardFromPng(cardPath, userName)
      : importSTCardFromJson(cardPath, userName);

    console.log(`  角色名: ${result.card.name}`);
    console.log(`  性格: ${result.card.personality?.slice(0, 60)}...`);
    console.log(`  描述长度: ${result.card.description?.length || 0} 字符`);

    if (result.warnings.length) {
      console.log(`  ⚠ 警告:`);
      result.warnings.forEach(w => console.log(`    - ${w}`));
    }

    // Create agent
    const agent = identity.createAgent(result.card.name, result.card);
    console.log(`  ✓ 已创建 Agent: ${agent.name} (${agent.id})`);

    // Import embedded character book if present
    if (result.characterBook?.entries?.length) {
      console.log(`\n导入内嵌世界书 (${result.characterBook.entries.length} 条)...`);
      const bookResult = importSTCharacterBook(
        result.characterBook, db, result.card.name, userName,
      );
      console.log(`  ✓ 导入: ${bookResult.entriesImported} 条, 跳过: ${bookResult.entriesSkipped} 条`);
      if (bookResult.warnings.length) {
        bookResult.warnings.forEach(w => console.log(`  ⚠ ${w}`));
      }
    }

    // Handle linked world book
    if (result.linkedWorldName && command === 'all' && args[2]) {
      // World book path provided as second argument
      const worldPath = args[2];
      if (existsSync(worldPath)) {
        console.log(`\n导入关联世界书: ${worldPath}`);
        const worldResult = importSTWorldInfo(worldPath, db, result.card.name, userName);
        console.log(`  ✓ 导入: ${worldResult.entriesImported} 条, 跳过: ${worldResult.entriesSkipped} 条`);
        if (worldResult.warnings.length) {
          worldResult.warnings.forEach(w => console.log(`  ⚠ ${w}`));
        }
      }
    }
  }

  if (command === 'world') {
    const worldPath = args[1];
    if (!worldPath || !existsSync(worldPath)) {
      console.error(`找不到文件: ${worldPath}`);
      process.exit(1);
    }

    console.log(`\n导入世界书: ${worldPath}`);
    const result = importSTWorldInfo(worldPath, db, charName, userName);
    console.log(`  ✓ 导入: ${result.entriesImported} 条, 跳过: ${result.entriesSkipped} 条`);
    if (result.warnings.length) {
      result.warnings.forEach(w => console.log(`  ⚠ ${w}`));
    }
  }

  console.log('\n导入完成！');
  db.close();
}

function getFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

main().catch(err => {
  console.error('导入失败:', err);
  process.exit(1);
});
