/**
 * Coordinator -- orchestrates distributed testing across multiple machines.
 * Uses SSH (via ssh_cmd.py) for command dispatch.
 */

import { execSync } from 'node:child_process';
import type { TestPlan, TestResult } from './types.js';

export interface MachineConfig {
  id: string;
  name: string;
  /** SSH host identifier (e.g., 'macmini', 'vesper', 'vps') */
  sshHost: string;
  /** SSH helper script path */
  sshScript: string;
  /** Working directory on the remote machine */
  workDir: string;
  /** Alan Engine URL on this machine */
  alanUrl: string;
}

export interface CoordinatorConfig {
  machines: MachineConfig[];
  /** Path to ssh_cmd.py helper */
  sshCmdPath?: string;
}

export class Coordinator {
  private config: CoordinatorConfig;

  constructor(config: CoordinatorConfig) {
    this.config = config;
  }

  /**
   * Split a test plan across machines evenly.
   */
  distribute(plan: TestPlan): Map<string, TestPlan> {
    const machines = this.config.machines;
    if (machines.length === 0) return new Map();

    const result = new Map<string, TestPlan>();
    const casesPerMachine = Math.ceil(plan.cases.length / machines.length);

    for (let i = 0; i < machines.length; i++) {
      const machine = machines[i];
      const start = i * casesPerMachine;
      const end = Math.min(start + casesPerMachine, plan.cases.length);
      const cases = plan.cases.slice(start, end);

      if (cases.length === 0) continue;

      result.set(machine.id, {
        cases,
        config: {
          ...plan.config,
          target_url: machine.alanUrl,
        },
      });
    }

    return result;
  }

  /**
   * Run distributed tests across all machines.
   */
  async run(plan: TestPlan): Promise<{ results: TestResult[]; failures: string[] }> {
    const distributed = this.distribute(plan);
    const allResults: TestResult[][] = [];
    const failures: string[] = [];

    const promises = [...distributed.entries()].map(async ([machineId, partialPlan]) => {
      const machine = this.config.machines.find((m) => m.id === machineId);
      if (!machine) {
        failures.push(machineId);
        return;
      }

      try {
        const results = await this.runOnMachine(machine, partialPlan);
        allResults.push(results);
      } catch {
        failures.push(machineId);
      }
    });

    await Promise.all(promises);

    return {
      results: this.mergeResults(allResults),
      failures,
    };
  }

  /**
   * Merge partial results from multiple machines, re-indexing case_index.
   */
  mergeResults(partials: TestResult[][]): TestResult[] {
    const merged: TestResult[] = [];
    let index = 0;

    for (const batch of partials) {
      for (const result of batch) {
        merged.push({ ...result, case_index: index++ });
      }
    }

    return merged;
  }

  private async runOnMachine(machine: MachineConfig, plan: TestPlan): Promise<TestResult[]> {
    const planJson = JSON.stringify(plan);
    const remotePlanPath = '/tmp/alan-test-plan.json';
    const remoteResultPath = '/tmp/alan-test-results.json';

    // Write plan file to remote machine
    // Use echo with base64 to avoid shell escaping issues
    const encoded = Buffer.from(planJson).toString('base64');
    this.sshExec(machine, `echo '${encoded}' | base64 -d > ${remotePlanPath}`);

    // Run test on remote machine
    this.sshExec(
      machine,
      `cd ${machine.workDir} && npx tsx src/testing/cli/run-test.ts --plan ${remotePlanPath} --output ${remoteResultPath}`,
    );

    // Read results back
    const resultJson = this.sshExec(machine, `cat ${remoteResultPath}`);
    return JSON.parse(resultJson) as TestResult[];
  }

  private sshExec(machine: MachineConfig, command: string): string {
    const sshScript = machine.sshScript || this.config.sshCmdPath || 'ssh_cmd.py';
    const result = execSync(`python "${sshScript}" ${machine.sshHost} "${command}"`, {
      encoding: 'utf-8',
      timeout: 300_000, // 5 minutes
    });
    return result.trim();
  }
}
