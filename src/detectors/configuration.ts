import { Detector, DetectorInput, createEvidenceItem } from './base.js';
import { DetectorResult, EvidenceItem } from '../core/types.js';
import { generateFingerprint } from '../parser/fingerprint.js';

const WORKFLOW_YAML_PATTERN =
  /\b(?:Invalid workflow file|yaml: line \d+:|parsing error in workflow|Workflow is not valid|Invalid YAML|YAML parse error|Failed to parse workflow|Failed to parse workflow YAML file)\b/i;

const SECRET_ENV_PATTERN =
  /\b(?:Secret [^\s]+ is not defined|Environment variable [^\s]+ is required|Missing required environment variable|env variable [^\s]+ not found|is required but not set)\b/i;

const ACTION_INPUT_PATTERN =
  /\b(?:Invalid input:|Unexpected input\(s\)|Required parameter missing|Invalid action input)\b/i;

const MISSING_CONFIG_FILE_PATTERN =
  /\b(?:tsconfig\.json not found|Could not find config file|\.eslintrc[^\s]* not found|package\.json not found|No configuration file found)\b/i;

export class ConfigurationDetector implements Detector {
  public readonly id = 'configuration';
  public readonly category = 'CONFIGURATION';

  public detect(input: DetectorInput): DetectorResult | null {
    const { parseResult, context } = input;
    if (parseResult.frames.length === 0) {
      return null;
    }

    const evidence: EvidenceItem[] = [];
    let primaryRawError = '';

    for (const frame of parseResult.frames) {
      const allLines = [frame.rawErrorLine, ...frame.linesBefore, ...frame.linesAfter].join('\n');

      if (WORKFLOW_YAML_PATTERN.test(allLines)) {
        evidence.push(
          createEvidenceItem(
            `config_yaml_${frame.id}`,
            'log_signature',
            `Observed workflow YAML parsing error: "${frame.rawErrorLine.slice(0, 150)}"`,
            95,
            frame.rawErrorLine,
          ),
        );
        if (!primaryRawError) primaryRawError = frame.rawErrorLine;
      }

      if (SECRET_ENV_PATTERN.test(allLines)) {
        evidence.push(
          createEvidenceItem(
            `config_env_${frame.id}`,
            'log_signature',
            `Observed missing environment variable/secret: "${frame.rawErrorLine.slice(0, 150)}"`,
            90,
            frame.rawErrorLine,
          ),
        );
        if (!primaryRawError) primaryRawError = frame.rawErrorLine;
      }

      if (ACTION_INPUT_PATTERN.test(allLines)) {
        evidence.push(
          createEvidenceItem(
            `config_input_${frame.id}`,
            'log_signature',
            `Observed invalid action input parameter: "${frame.rawErrorLine.slice(0, 150)}"`,
            90,
            frame.rawErrorLine,
          ),
        );
        if (!primaryRawError) primaryRawError = frame.rawErrorLine;
      }

      if (MISSING_CONFIG_FILE_PATTERN.test(allLines)) {
        evidence.push(
          createEvidenceItem(
            `config_file_${frame.id}`,
            'log_signature',
            `Observed missing configuration file error: "${frame.rawErrorLine.slice(0, 150)}"`,
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

    const confidenceScore = 90;
    const fingerprint = generateFingerprint(
      primaryRawError || parseResult.frames[0].rawErrorLine,
      context.config.customSecretPatterns,
      parseResult.frames[0].fingerprint.fileLocation,
    );

    return {
      category: 'CONFIGURATION',
      confidenceScore,
      evidence,
      fingerprint,
      suggestedAction:
        'Verify CI workflow syntax, repository secrets/environment variables, action parameters, and project configuration files.',
    };
  }
}
