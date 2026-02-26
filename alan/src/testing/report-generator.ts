/**
 * Report Generator -- creates HTML reports from test results.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { TestResult, JudgeVerdict } from './types.js';

export interface ReportData {
  results: TestResult[];
  verdicts?: JudgeVerdict[];
  timestamp: string;
  config: Record<string, unknown>;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildSummarySection(results: TestResult[]): string {
  const total = results.length;
  const passed = results.filter((r) => r.success).length;
  const failed = total - passed;
  const passRate = total > 0 ? ((passed / total) * 100).toFixed(1) : '0.0';

  const latencies = results
    .filter((r) => r.success)
    .flatMap((r) => r.replies.map((rep) => rep.latency_ms));
  const avgLatency =
    latencies.length > 0
      ? (latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(0)
      : 'N/A';

  const passWidth = total > 0 ? (passed / total) * 100 : 0;

  return `
    <div class="summary">
      <h2>Summary</h2>
      <div class="stats">
        <div class="stat"><span class="label">Total</span><span class="value">${total}</span></div>
        <div class="stat"><span class="label">Passed</span><span class="value ok">${passed}</span></div>
        <div class="stat"><span class="label">Failed</span><span class="value ${failed > 0 ? 'fail' : ''}">${failed}</span></div>
        <div class="stat"><span class="label">Pass Rate</span><span class="value">${passRate}%</span></div>
        <div class="stat"><span class="label">Avg Latency</span><span class="value">${avgLatency}ms</span></div>
      </div>
      <div class="bar-container">
        <div class="bar pass" style="width: ${passWidth}%"></div>
        <div class="bar fail" style="width: ${100 - passWidth}%"></div>
      </div>
    </div>`;
}

function buildResultsTable(results: TestResult[]): string {
  const rows = results
    .map((r) => {
      const status = r.success ? '<span class="ok">PASS</span>' : '<span class="fail">FAIL</span>';
      const latency = r.success
        ? r.replies.map((rep) => rep.latency_ms).reduce((a, b) => a + b, 0) + 'ms'
        : '-';
      const error = r.error ? escapeHtml(r.error) : '';
      return `<tr>
        <td>${r.case_index}</td>
        <td>${escapeHtml(r.card_name)}</td>
        <td>${status}</td>
        <td>${r.replies.length}</td>
        <td>${latency}</td>
        <td class="error">${error}</td>
      </tr>`;
    })
    .join('\n');

  return `
    <div class="results">
      <h2>Per-Card Results</h2>
      <table>
        <thead><tr><th>#</th><th>Card</th><th>Status</th><th>Replies</th><th>Latency</th><th>Error</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function buildVerdictSection(verdicts: JudgeVerdict[]): string {
  if (verdicts.length === 0) return '';

  const rows = verdicts
    .map((v) => {
      const s = v.scores;
      return `<tr>
        <td>${v.case_index}</td>
        <td>${escapeHtml(v.card_name)}</td>
        <td>${s.character_fidelity}</td>
        <td>${s.emotional_coherence}</td>
        <td>${s.creativity}</td>
        <td>${s.consistency}</td>
        <td>${s.engagement}</td>
        <td><strong>${v.overall.toFixed(1)}</strong></td>
        <td>${escapeHtml(v.notes)}</td>
      </tr>`;
    })
    .join('\n');

  return `
    <div class="verdicts">
      <h2>Judge Scores</h2>
      <table>
        <thead><tr>
          <th>#</th><th>Card</th><th>Fidelity</th><th>Emotion</th><th>Creative</th><th>Consist.</th><th>Engage</th><th>Overall</th><th>Notes</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

export function generateReport(data: ReportData, outputDir: string): string {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Alan Test Report - ${escapeHtml(data.timestamp)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 1100px; margin: 2rem auto; padding: 0 1rem; background: #fafafa; color: #333; }
  h1 { border-bottom: 2px solid #2563eb; padding-bottom: .5rem; }
  h2 { margin-top: 2rem; color: #1e40af; }
  .stats { display: flex; gap: 2rem; margin: 1rem 0; }
  .stat { display: flex; flex-direction: column; }
  .stat .label { font-size: .85rem; color: #666; }
  .stat .value { font-size: 1.5rem; font-weight: bold; }
  .ok { color: #16a34a; }
  .fail { color: #dc2626; }
  .bar-container { display: flex; height: 24px; border-radius: 4px; overflow: hidden; margin: .5rem 0; }
  .bar.pass { background: #16a34a; }
  .bar.fail { background: #dc2626; }
  table { width: 100%; border-collapse: collapse; margin: 1rem 0; }
  th, td { padding: .5rem .75rem; text-align: left; border-bottom: 1px solid #e5e7eb; }
  th { background: #f3f4f6; font-weight: 600; }
  tr:hover { background: #f9fafb; }
  .error { color: #dc2626; font-size: .85rem; max-width: 300px; overflow: hidden; text-overflow: ellipsis; }
  .config { background: #f3f4f6; padding: 1rem; border-radius: 6px; margin: 1rem 0; }
  .config pre { margin: 0; white-space: pre-wrap; font-size: .85rem; }
</style>
</head>
<body>
<h1>Alan Test Report</h1>
<p>Generated: ${escapeHtml(data.timestamp)}</p>
<div class="config"><pre>${escapeHtml(JSON.stringify(data.config, null, 2))}</pre></div>
${buildSummarySection(data.results)}
${buildResultsTable(data.results)}
${data.verdicts ? buildVerdictSection(data.verdicts) : ''}
</body>
</html>`;

  fs.mkdirSync(outputDir, { recursive: true });
  const filename = `${data.timestamp.replace(/[:.]/g, '-')}.html`;
  const outputPath = path.join(outputDir, filename);
  fs.writeFileSync(outputPath, html, 'utf-8');

  return outputPath;
}
