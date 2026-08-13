import { TriageReport } from '../core/types.js';

/**
 * Renders a developer-facing Markdown summary from a TriageReport.
 * Suitable for GitHub Step Summaries or PR comments.
 */
export function generateMarkdownReport(report: TriageReport): string {
  const lines: string[] = [];

  lines.push('# CI Triage');
  lines.push('');
  lines.push('## Classification');
  lines.push(`\`${report.classification}\``);
  lines.push('');
  lines.push('## Confidence');
  lines.push(`${report.confidence} / 100`);
  lines.push('');

  lines.push('## Observed Evidence');
  if (report.observedEvidence.length === 0) {
    lines.push('- No specific log signatures extracted.');
  } else {
    for (const item of report.observedEvidence) {
      if (item.snippet) {
        lines.push(`- **${item.source}**: ${item.description} (\`${item.snippet}\`)`);
      } else {
        lines.push(`- **${item.source}**: ${item.description}`);
      }
    }
  }
  lines.push('');

  lines.push('## Inference');
  lines.push(report.inferenceDetails);
  lines.push('');

  if (report.secondarySignals && report.secondarySignals.length > 0) {
    lines.push('## Secondary Signals');
    for (const sec of report.secondarySignals) {
      lines.push(
        `- **${sec.category}** (Confidence: ${sec.confidence}): ${sec.description || 'Secondary signal detected.'}`,
      );
    }
    lines.push('');
  }

  lines.push('## Recommended Action');
  lines.push(report.recommendedAction);

  return lines.join('\n');
}
