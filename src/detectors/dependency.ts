import { Detector, DetectorInput, createEvidenceItem } from './base.js';
import { DetectorResult, EvidenceItem } from '../core/types.js';
import { generateFingerprint } from '../parser/fingerprint.js';

const PKG_RESOLUTION_PATTERN =
  /\b(?:npm ERR! code (?:E404|ERESOLVE|ENOENT|ETARGET|EINVALIDPACKAGENAME)|yarn error|pip error: No matching distribution found|pip error: Could not find a version|ERROR: Could not find a version|ERROR: No matching distribution found)\b/i;

const PKG_NOT_FOUND_PATTERN =
  /\b(?:No matching version found for|Could not find a version that satisfies the requirement|Package ['"][^'"]+['"] not found|404 Not Found - GET https?:\/\/(?:registry\.npmjs\.org|pypi\.org|pkg\.go\.dev)|'[^']+' is not in the npm registry)\b/i;

const DEPENDENCY_CONFLICT_PATTERN =
  /\b(?:unable to resolve dependency tree|peer dependency missing|Unmet peer dependency|Conflicting peer dependency|peer dep missing|EPEERINVALID)\b/i;

const LOCKFILE_PATTERN =
  /\b(?:package-lock\.json is out of date|yarn\.lock is out of sync|Frozen lockfile requirement failed|Lockfile not up to date|Cannot update lockfile)\b/i;

const ENGINE_MISMATCH_PATTERN =
  /\b(?:Unsupported engine|The engine "[^"]+" is incompatible|Requires node [^\s]+|Requires Python [^\s]+)\b/i;

export class DependencyDetector implements Detector {
  public readonly id = 'dependency';
  public readonly category = 'DEPENDENCY';

  public detect(input: DetectorInput): DetectorResult | null {
    const { parseResult, context } = input;
    if (parseResult.frames.length === 0) {
      return null;
    }

    const evidence: EvidenceItem[] = [];
    let primaryRawError = '';

    for (const frame of parseResult.frames) {
      const allLines = [frame.rawErrorLine, ...frame.linesBefore, ...frame.linesAfter].join('\n');

      if (PKG_RESOLUTION_PATTERN.test(allLines)) {
        evidence.push(
          createEvidenceItem(
            `dep_resolution_${frame.id}`,
            'log_signature',
            `Observed package resolution failure: "${frame.rawErrorLine.slice(0, 150)}"`,
            95,
            frame.rawErrorLine,
          ),
        );
        if (!primaryRawError) primaryRawError = frame.rawErrorLine;
      }

      if (PKG_NOT_FOUND_PATTERN.test(allLines)) {
        evidence.push(
          createEvidenceItem(
            `dep_not_found_${frame.id}`,
            'log_signature',
            `Observed missing package failure: "${frame.rawErrorLine.slice(0, 150)}"`,
            95,
            frame.rawErrorLine,
          ),
        );
        if (!primaryRawError) primaryRawError = frame.rawErrorLine;
      }

      if (DEPENDENCY_CONFLICT_PATTERN.test(allLines)) {
        evidence.push(
          createEvidenceItem(
            `dep_conflict_${frame.id}`,
            'log_signature',
            `Observed dependency version conflict: "${frame.rawErrorLine.slice(0, 150)}"`,
            90,
            frame.rawErrorLine,
          ),
        );
        if (!primaryRawError) primaryRawError = frame.rawErrorLine;
      }

      if (LOCKFILE_PATTERN.test(allLines)) {
        evidence.push(
          createEvidenceItem(
            `dep_lockfile_${frame.id}`,
            'log_signature',
            `Observed lockfile out-of-sync error: "${frame.rawErrorLine.slice(0, 150)}"`,
            90,
            frame.rawErrorLine,
          ),
        );
        if (!primaryRawError) primaryRawError = frame.rawErrorLine;
      }

      if (ENGINE_MISMATCH_PATTERN.test(allLines)) {
        evidence.push(
          createEvidenceItem(
            `dep_engine_${frame.id}`,
            'log_signature',
            `Observed engine/environment version mismatch: "${frame.rawErrorLine.slice(0, 150)}"`,
            85,
            frame.rawErrorLine,
          ),
        );
        if (!primaryRawError) primaryRawError = frame.rawErrorLine;
      }
    }

    if (evidence.length === 0) {
      return null;
    }

    const confidenceScore = Math.min(100, 80 + evidence.length * 5);
    const fingerprint = generateFingerprint(
      primaryRawError || parseResult.frames[0].rawErrorLine,
      context.config.customSecretPatterns,
      parseResult.frames[0].fingerprint.fileLocation,
    );

    return {
      category: 'DEPENDENCY',
      confidenceScore,
      evidence,
      fingerprint,
      suggestedAction:
        'Verify package names and version constraints, resolve peer dependency conflicts, or update the lockfile.',
    };
  }
}
