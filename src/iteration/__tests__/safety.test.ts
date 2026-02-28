import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SafetySystem } from '../safety.js';
import type { Modification, ModificationTier } from '../types.js';

// Mock child_process
vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

function makeMod(
  tier: ModificationTier,
  targetFile: string,
): Modification {
  return {
    tier,
    targetFile,
    change: {
      type: 'parameter',
      key: 'test',
      oldValue: 1,
      newValue: 2,
    },
  };
}

describe('SafetySystem', () => {
  let safety: SafetySystem;

  beforeEach(() => {
    vi.clearAllMocks();
    safety = new SafetySystem({
      workspacePath: '/tmp/workspace',
      maxRegression: 0.05,
      allowedTiers: ['parameter', 'prompt'],
    });
  });

  describe('validateScope', () => {
    it('should reject code tier when not allowed', () => {
      const mod = makeMod('code', 'src/test.ts');
      const result = safety.validateScope([mod]);

      expect(result.passed).toBe(false);
      expect(result.tier).toBe(1);
      expect(result.message).toContain('code');
      expect(result.message).toContain('not allowed');
    });

    it('should accept parameter tier when allowed', () => {
      const mod = makeMod('parameter', 'config/settings.json');
      const result = safety.validateScope([mod]);

      expect(result.passed).toBe(true);
      expect(result.tier).toBe(1);
    });

    it('should accept prompt tier when allowed', () => {
      const mod: Modification = {
        tier: 'prompt',
        targetFile: 'prompts/system.txt',
        change: {
          type: 'prompt',
          section: 'intro',
          oldText: 'hello',
          newText: 'hi there',
        },
      };
      const result = safety.validateScope([mod]);

      expect(result.passed).toBe(true);
    });

    it('should reject files outside workspace', () => {
      const mod = makeMod('parameter', '../../etc/passwd');
      const result = safety.validateScope([mod]);

      expect(result.passed).toBe(false);
      expect(result.message).toContain('outside workspace');
    });

    it('should reject critical files', () => {
      const criticalFiles = [
        'package.json',
        'tsconfig.json',
        'node_modules/foo/bar.js',
      ];

      for (const file of criticalFiles) {
        const mod = makeMod('parameter', file);
        const result = safety.validateScope([mod]);

        expect(result.passed).toBe(false);
        expect(result.message).toContain('critical file');
      }
    });

    it('should pass for valid modifications', () => {
      const mods = [
        makeMod('parameter', 'config/alan.json'),
        makeMod('parameter', 'config/emotion.json'),
      ];
      const result = safety.validateScope(mods);

      expect(result.passed).toBe(true);
      expect(result.message).toContain('2 modification(s)');
    });

    it('should pass for empty modifications list', () => {
      const result = safety.validateScope([]);
      expect(result.passed).toBe(true);
    });
  });

  describe('checkRegression', () => {
    it('should pass when score improves', () => {
      const result = safety.checkRegression(3.0, 3.5, 0.05);

      expect(result.passed).toBe(true);
      expect(result.tier).toBe(4);
    });

    it('should pass when score stays the same', () => {
      const result = safety.checkRegression(3.0, 3.0, 0.05);

      expect(result.passed).toBe(true);
    });

    it('should pass when drop is within threshold', () => {
      const result = safety.checkRegression(3.0, 2.96, 0.05);

      expect(result.passed).toBe(true);
    });

    it('should fail when drop exceeds threshold', () => {
      const result = safety.checkRegression(3.0, 2.9, 0.05);

      expect(result.passed).toBe(false);
      expect(result.tier).toBe(4);
      expect(result.message).toContain('regressed');
    });

    it('should include score details', () => {
      const result = safety.checkRegression(3.0, 2.8, 0.05);

      expect(result.details).toBeDefined();
      expect(result.details?.beforeScore).toBe(3.0);
      expect(result.details?.afterScore).toBe(2.8);
      expect(result.details?.maxRegression).toBe(0.05);
    });
  });

  describe('createBranch', () => {
    it('should create branch with timestamp name', async () => {
      const { execSync } = await import('node:child_process');
      (execSync as ReturnType<typeof vi.fn>).mockReturnValue(Buffer.from(''));

      const result = safety.createBranch('/tmp/workspace');

      expect(result.passed).toBe(true);
      expect(result.tier).toBe(2);
      expect(result.details?.branch).toMatch(/^alan-iter-\d+$/);
      expect(execSync).toHaveBeenCalledWith(
        expect.stringContaining('git checkout -b alan-iter-'),
        expect.objectContaining({ cwd: '/tmp/workspace' }),
      );
    });

    it('should return failure when git fails', async () => {
      const { execSync } = await import('node:child_process');
      (execSync as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('git error');
      });

      const result = safety.createBranch('/tmp/workspace');

      expect(result.passed).toBe(false);
      expect(result.tier).toBe(2);
      expect(result.message).toContain('Failed to create branch');
    });
  });

  describe('validateApprovalRequired', () => {
    it('should fail when code-tier mod has no approval callback', () => {
      const mod = makeMod('code', 'src/test.ts');
      const result = safety.validateApprovalRequired([mod], {});
      expect(result.passed).toBe(false);
      expect(result.message).toContain('approval callback');
    });

    it('should pass when code-tier mod has approval callback', () => {
      const mod = makeMod('code', 'src/test.ts');
      const result = safety.validateApprovalRequired([mod], {
        approvalCallback: async () => true,
      });
      expect(result.passed).toBe(true);
    });

    it('should pass for parameter-tier mods without approval callback', () => {
      const mod = makeMod('parameter', 'config/settings.json');
      const result = safety.validateApprovalRequired([mod], {});
      expect(result.passed).toBe(true);
    });

    it('should pass for prompt-tier mods without approval callback', () => {
      const mod: Modification = {
        tier: 'prompt',
        targetFile: 'prompts/system.txt',
        change: {
          type: 'prompt',
          section: 'intro',
          oldText: 'hello',
          newText: 'hi there',
        },
      };
      const result = safety.validateApprovalRequired([mod], {});
      expect(result.passed).toBe(true);
    });

    it('should pass for empty modifications without approval callback', () => {
      const result = safety.validateApprovalRequired([], {});
      expect(result.passed).toBe(true);
    });
  });

  describe('autoRevert', () => {
    it('should checkout main and delete branch', async () => {
      const { execSync } = await import('node:child_process');
      (execSync as ReturnType<typeof vi.fn>).mockReturnValue(Buffer.from(''));

      const result = safety.autoRevert('/tmp/workspace', 'alan-iter-123');

      expect(result.passed).toBe(true);
      expect(result.tier).toBe(5);
      expect(execSync).toHaveBeenCalledTimes(2);
    });

    it('should return failure when revert fails', async () => {
      const { execSync } = await import('node:child_process');
      (execSync as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('revert error');
      });

      const result = safety.autoRevert('/tmp/workspace', 'alan-iter-123');

      expect(result.passed).toBe(false);
      expect(result.tier).toBe(5);
    });
  });
});
