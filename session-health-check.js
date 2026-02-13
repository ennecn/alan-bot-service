#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Parse command line arguments
const args = process.argv.slice(2);
let threshold = 5;
let dryRun = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--threshold' && i + 1 < args.length) {
    threshold = parseInt(args[i + 1], 10);
    if (isNaN(threshold) || threshold < 1) {
      console.error('Error: --threshold must be a positive integer');
      process.exit(1);
    }
    i++;
  } else if (args[i] === '--dry-run') {
    dryRun = true;
  } else if (args[i] === '--help' || args[i] === '-h') {
    console.log('Usage: node session-health-check.js [options]');
    console.log('');
    console.log('Options:');
    console.log('  --threshold N    Number of consecutive errors to trigger cleanup (default: 5)');
    console.log('  --dry-run        Report issues without making changes');
    console.log('  --help, -h       Show this help message');
    process.exit(0);
  } else {
    console.error(`Unknown argument: ${args[i]}`);
    process.exit(1);
  }
}

const SESSIONS_DIR = '/home/node/.openclaw/agents/main/sessions';
const BACKUP_DIR = '/home/node/.openclaw/workspace/.secrets/session-backups';

console.log('='.repeat(60));
console.log('Session Health Check');
console.log('='.repeat(60));
console.log(`Threshold: ${threshold} consecutive errors`);
console.log(`Mode: ${dryRun ? 'DRY RUN (no changes)' : 'ACTIVE (will clean files)'}`);
console.log('');

// Ensure backup directory exists
if (!dryRun) {
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  } catch (err) {
    console.error(`Error creating backup directory: ${err.message}`);
    process.exit(1);
  }
}

/**
 * Check if a line represents an error response
 */
function isErrorResponse(line) {
  try {
    const entry = JSON.parse(line);
    return (
      entry.type === 'message' &&
      entry.message &&
      entry.message.role === 'assistant' &&
      entry.message.stopReason === 'error' &&
      Array.isArray(entry.message.content) &&
      entry.message.content.length === 0
    );
  } catch (err) {
    return false;
  }
}

/**
 * Count consecutive error responses from the end of lines array
 */
function countConsecutiveErrorsFromEnd(lines) {
  let count = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (isErrorResponse(lines[i])) {
      count++;
    } else {
      break;
    }
  }
  return count;
}

/**
 * Process a single session file
 */
function processSessionFile(filePath) {
  const fileName = path.basename(filePath);

  try {
    // Read file content
    const content = fs.readFileSync(filePath, 'utf8');

    // Handle empty files
    if (!content.trim()) {
      return { fileName, status: 'empty', errorCount: 0 };
    }

    // Split into lines and filter out empty lines
    const lines = content.split('\n').filter(line => line.trim());

    if (lines.length === 0) {
      return { fileName, status: 'empty', errorCount: 0 };
    }

    // Count consecutive errors from end
    const errorCount = countConsecutiveErrorsFromEnd(lines);

    if (errorCount === 0) {
      return { fileName, status: 'healthy', errorCount: 0 };
    }

    if (errorCount < threshold) {
      return { fileName, status: 'minor_issues', errorCount };
    }

    // File needs cleaning
    return {
      fileName,
      status: 'needs_cleaning',
      errorCount,
      totalLines: lines.length,
      cleanLines: lines.slice(0, lines.length - errorCount)
    };

  } catch (err) {
    return { fileName, status: 'error', error: err.message };
  }
}

/**
 * Clean a session file by removing consecutive errors from the end
 */
function cleanSessionFile(filePath, cleanLines) {
  const fileName = path.basename(filePath);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFileName = `${fileName}.backup.${timestamp}`;
  const backupPath = path.join(BACKUP_DIR, backupFileName);

  try {
    // Create backup
    fs.copyFileSync(filePath, backupPath);

    // Write cleaned content
    const cleanedContent = cleanLines.join('\n') + '\n';
    fs.writeFileSync(filePath, cleanedContent, 'utf8');

    return { success: true, backupPath };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// Main execution
console.log('Scanning session files...\n');

let totalScanned = 0;
let healthyCount = 0;
let minorIssuesCount = 0;
let needsCleaningCount = 0;
let cleanedCount = 0;
let errorCount = 0;

try {
  // Read all .jsonl files
  const files = fs.readdirSync(SESSIONS_DIR)
    .filter(f => f.endsWith('.jsonl'))
    .map(f => path.join(SESSIONS_DIR, f));

  totalScanned = files.length;

  console.log(`Found ${totalScanned} session files\n`);

  const results = files.map(processSessionFile);

  // Process results
  for (const result of results) {
    if (result.status === 'healthy') {
      healthyCount++;
    } else if (result.status === 'minor_issues') {
      minorIssuesCount++;
      console.log(`⚠️  ${result.fileName}: ${result.errorCount} consecutive errors (below threshold)`);
    } else if (result.status === 'needs_cleaning') {
      needsCleaningCount++;
      console.log(`❌ ${result.fileName}: ${result.errorCount} consecutive errors (exceeds threshold)`);

      if (!dryRun) {
        const cleanResult = cleanSessionFile(
          path.join(SESSIONS_DIR, result.fileName),
          result.cleanLines
        );

        if (cleanResult.success) {
          cleanedCount++;
          console.log(`   ✓ Cleaned: removed ${result.errorCount} error entries`);
          console.log(`   ✓ Backup: ${path.basename(cleanResult.backupPath)}`);
        } else {
          console.log(`   ✗ Failed to clean: ${cleanResult.error}`);
        }
      } else {
        console.log(`   → Would remove ${result.errorCount} error entries (dry run)`);
      }
    } else if (result.status === 'error') {
      errorCount++;
      console.log(`⚠️  ${result.fileName}: Error reading file - ${result.error}`);
    }
  }

} catch (err) {
  console.error(`\nFatal error: ${err.message}`);
  process.exit(1);
}

// Print summary
console.log('\n' + '='.repeat(60));
console.log('Summary');
console.log('='.repeat(60));
console.log(`Total sessions scanned:     ${totalScanned}`);
console.log(`Healthy sessions:           ${healthyCount}`);
console.log(`Sessions with minor issues: ${minorIssuesCount}`);
console.log(`Sessions needing cleaning:  ${needsCleaningCount}`);

if (!dryRun && needsCleaningCount > 0) {
  console.log(`Sessions cleaned:           ${cleanedCount}`);
  if (cleanedCount < needsCleaningCount) {
    console.log(`Failed to clean:            ${needsCleaningCount - cleanedCount}`);
  }
}

if (errorCount > 0) {
  console.log(`Files with read errors:     ${errorCount}`);
}

console.log('='.repeat(60));

if (dryRun && needsCleaningCount > 0) {
  console.log('\n💡 Run without --dry-run to perform cleaning');
}

process.exit(0);

