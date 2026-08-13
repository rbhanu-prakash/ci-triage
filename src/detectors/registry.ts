import { Detector, DetectorInput } from './base.js';
import { DetectorResult } from '../core/types.js';
import { TestFailureDetector } from './test-failure.js';
import { NetworkDetector } from './network.js';
import { DependencyDetector } from './dependency.js';
import { TimeoutDetector } from './timeout.js';
import { PermissionDetector } from './permission.js';
import { ResourceDetector } from './resource.js';
import { BuildDetector } from './build.js';
import { ConfigurationDetector } from './configuration.js';
import { CodeRegressionDetector } from './code-regression.js';
import { FlakyTestDetector } from './flaky-test.js';
import { UnknownDetector } from './unknown.js';

export class DetectorRegistry {
  private detectors: Detector[] = [];
  private fallbackDetector: UnknownDetector;

  constructor() {
    // Register standard detectors in evaluation order
    this.detectors = [
      new TestFailureDetector(),
      new NetworkDetector(),
      new DependencyDetector(),
      new TimeoutDetector(),
      new PermissionDetector(),
      new ResourceDetector(),
      new BuildDetector(),
      new ConfigurationDetector(),
      new CodeRegressionDetector(),
      new FlakyTestDetector(),
    ];
    this.fallbackDetector = new UnknownDetector();
  }

  /**
   * Register a custom detector.
   */
  public registerDetector(detector: Detector): void {
    this.detectors.push(detector);
  }

  /**
   * Returns all registered detectors.
   */
  public getDetectors(): Detector[] {
    return [...this.detectors];
  }

  /**
   * Runs all detectors against input evidence and returns ALL matching detector results.
   * If no detector matches, returns a single UNKNOWN fallback result.
   */
  public evaluateAll(input: DetectorInput): DetectorResult[] {
    const candidates: DetectorResult[] = [];

    for (const detector of this.detectors) {
      const result = detector.detect(input);
      if (result) {
        candidates.push(result);
      }
    }

    if (candidates.length === 0) {
      return [this.fallbackDetector.detect(input)];
    }

    // Sort candidate results by confidence score descending
    candidates.sort((a, b) => b.confidenceScore - a.confidenceScore);
    return candidates;
  }

  /**
   * @deprecated Deprecated in Phase 3. Single-result selection is deprecated.
   * Phase 3 exposes detector signals via evaluateAll().
   * Phase 4 will own conflict resolution, ranking/selection, confidence aggregation, and final classification.
   */
  public evaluate(input: DetectorInput): DetectorResult {
    const candidates = this.evaluateAll(input);
    return candidates[0];
  }
}

const defaultRegistry = new DetectorRegistry();

/**
 * @deprecated Deprecated in Phase 3. Single-result selection is deprecated.
 * Phase 3 exposes detector signals via triageAllFailures().
 * Phase 4 will own conflict resolution, ranking/selection, confidence aggregation, and final classification.
 */
export function triageFailure(input: DetectorInput): DetectorResult {
  return defaultRegistry.evaluate(input);
}

/**
 * Convenience function to evaluate failure detectors for a given analysis input and return all matching signals.
 */
export function triageAllFailures(input: DetectorInput): DetectorResult[] {
  return defaultRegistry.evaluateAll(input);
}
