import { TriageReport } from '../core/types.js';

/**
 * Safely formats a snippet to prevent breaking Markdown layout (handles backticks, newlines, long strings).
 */
function formatSafeSnippet(snippet: string): string {
  const maxLen = 300;
  const truncated = snippet.length > maxLen ? `${snippet.slice(0, maxLen)}...` : snippet;

  if (truncated.includes('\n') || truncated.includes('`')) {
    const safeContent = truncated.replace(/```/g, "'''");
    return `\n\`\`\`\n${safeContent}\n\`\`\``;
  }

  return `\`${truncated}\``;
}

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

  lines.push('## Evidence');
  if (report.observedEvidence.length === 0) {
    lines.push('- No specific log signatures extracted.');
  } else {
    for (const item of report.observedEvidence) {
      let contributorNote = '';
      if (item.contributingDetectors && item.contributingDetectors.length > 1) {
        const cats = Array.from(new Set(item.contributingDetectors.map((c) => c.category))).join(
          ', ',
        );
        contributorNote = ` *(Corroborated by ${cats})*`;
      }

      if (item.snippet) {
        const formattedSnippet = formatSafeSnippet(item.snippet);
        if (formattedSnippet.startsWith('\n')) {
          lines.push(
            `- **${item.source}**: ${item.description}${contributorNote}${formattedSnippet}`,
          );
        } else {
          lines.push(
            `- **${item.source}**: ${item.description}${contributorNote} (${formattedSnippet})`,
          );
        }
      } else {
        lines.push(`- **${item.source}**: ${item.description}${contributorNote}`);
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
